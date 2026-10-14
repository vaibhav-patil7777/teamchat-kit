import secrets
import string
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.utils import timezone

from . import presence
from .api import ApiError, api, audit, need
from .features import DEFAULT_FLAGS, FEATURES, effective_features
from .models import AppSettings, AuditLog, Chat, LoginEvent, Membership, Message, PermissionTemplate, User
from .realtime import notify_users
from .services import chat_payload, file_url, get_or_create_direct, post_message, user_brief

ADMIN = dict(methods=["GET"], admin=True)


def gen_password(n=10):
    alphabet = string.ascii_letters + string.digits
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(n - 2)) + secrets.choice("@#$%") + secrets.choice(string.digits)
        if any(c.islower() for c in p) and any(c.isupper() for c in p):
            return p


def admin_user_payload(u, request):
    d = user_brief(u, request)
    last_login = u.login_events.filter(success=True).order_by("-created_at").first()
    d.update(
        {
            "is_active": u.is_active,
            "department": u.department,
            "designation": u.designation,
            "template_id": u.template_id,
            "template_name": u.template.name if u.template else None,
            "feature_overrides": u.feature_overrides or {},
            "features": effective_features(u),
            "must_change_password": u.must_change_password,
            "locked": bool(u.locked_until and u.locked_until > timezone.now()),
            "created_at": u.date_joined.isoformat(),
            "last_login": last_login.created_at.isoformat() if last_login else None,
            "device_count": u.tokens.count(),
            "message_count": Message.objects.filter(sender=u).exclude(kind="system").count(),
        }
    )
    return d


def get_user_or_404(uid):
    u = User.objects.filter(pk=uid).select_related("template").first()
    if not u:
        raise ApiError("User not found.", 404, "not_found")
    return u


def validate_username(username, exclude_id=None):
    import re

    if not re.fullmatch(r"[A-Za-z0-9_.]{3,30}", username):
        raise ApiError("Username must be 3-30 characters: letters, numbers, _ or .", 400, "bad_username")
    qs = User.objects.filter(username__iexact=username)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    if qs.exists():
        raise ApiError("This username is already taken.", 409, "username_taken")


def sign_out_user(u, reason="signed_out"):
    u.tokens.all().delete()
    notify_users([u.pk], {"type": "force_logout", "reason": reason})


def clean_overrides(raw):
    out = {}
    for k, v in (raw or {}).items():
        if k in FEATURES and isinstance(v, bool):
            out[k] = v
    return out


# ------------------------------------------------------------------ dashboard

@api(**ADMIN)
def stats(request):
    now = timezone.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    msgs = Message.objects.exclude(kind="system")
    days = [(today - timedelta(days=i)) for i in range(13, -1, -1)]
    per_day = {r["d"]: r["c"] for r in msgs.filter(created_at__gte=days[0]).annotate(d=TruncDate("created_at")).values("d").annotate(c=Count("id"))}
    files = Message.objects.exclude(file="").exclude(file__isnull=True)
    file_series = {r["d"]: r["c"] for r in files.filter(created_at__gte=days[0]).annotate(d=TruncDate("created_at")).values("d").annotate(c=Count("id"))}
    top = (
        User.objects.filter(role="member")
        .annotate(c=Count("messages_sent", filter=Q(messages_sent__created_at__gte=now - timedelta(days=7)) & ~Q(messages_sent__kind="system")))
        .order_by("-c")[:5]
    )
    return JsonResponse(
        {
            "users_total": User.objects.filter(role="member").count(),
            "users_active": User.objects.filter(role="member", is_active=True).count(),
            "online_now": len(presence.online_ids()),
            "messages_today": msgs.filter(created_at__gte=today).count(),
            "messages_total": msgs.count(),
            "groups": Chat.objects.filter(kind="group").count(),
            "storage_bytes": files.aggregate(s=Sum("file_size"))["s"] or 0,
            "files_total": files.count(),
            "series": [
                {"date": d.date().isoformat(), "messages": per_day.get(d.date(), 0), "files": file_series.get(d.date(), 0)} for d in days
            ],
            "top_users": [{"id": u.id, "name": u.name, "count": u.c} for u in top],
            "recent_logins": [
                {"username": e.username_tried, "success": e.success, "reason": e.reason, "ip": e.ip, "at": e.created_at.isoformat()}
                for e in LoginEvent.objects.order_by("-created_at")[:8]
            ],
        }
    )


# ------------------------------------------------------------------ users

@api(methods=["GET", "POST"], admin=True)
def users(request):
    if request.method == "GET":
        q = (request.GET.get("q") or "").strip()
        qs = User.objects.filter(role="member").select_related("template")
        if q:
            qs = qs.filter(Q(display_name__icontains=q) | Q(username__icontains=q) | Q(department__icontains=q))
        status = request.GET.get("status")
        if status == "active":
            qs = qs.filter(is_active=True)
        elif status == "disabled":
            qs = qs.filter(is_active=False)
        return JsonResponse({"users": [admin_user_payload(u, request) for u in qs.order_by("-date_joined")]})

    d = request.data
    username = need(d, "username", "Username", 30)
    validate_username(username)
    name = need(d, "display_name", "Full name", 100)
    password = (d.get("password") or "").strip()
    generated = False
    if not password:
        password, generated = gen_password(), True
    if len(password) < 8:
        raise ApiError("Password must be at least 8 characters.", 400, "weak_password")
    template = None
    if d.get("template_id"):
        template = PermissionTemplate.objects.filter(pk=d["template_id"]).first()
    u = User(
        username=username, display_name=name, role="member", department=(d.get("department") or "")[:80],
        designation=(d.get("designation") or "")[:80], template=template,
        feature_overrides=clean_overrides(d.get("feature_overrides")),
        must_change_password=bool(d.get("must_change_password")), created_by=request.user_obj,
    )
    u.set_password(password)
    u.save()
    chat, _ = get_or_create_direct(request.user_obj, u, system=True, created_by=request.user_obj)
    Membership.objects.filter(chat=chat, user=u).update(pinned=True)
    Membership.objects.filter(chat=chat, user=request.user_obj).update(pinned=False)
    welcome = AppSettings.get().welcome_message or f"Welcome to {AppSettings.get().app_name}, {u.name}! Message me here any time you need help."
    post_message(request, chat, request.user_obj, kind="text", body=welcome)
    audit(request.user_obj, "user_created", u.username, role="member")
    return JsonResponse({"user": admin_user_payload(u, request), "password": password, "generated": generated}, status=201)


@api(methods=["GET", "PATCH", "DELETE"], admin=True)
def user_detail(request, user_id):
    u = get_user_or_404(user_id)
    if u.role == "admin" and request.method != "GET":
        raise ApiError("The admin account cannot be modified here.", 400, "forbidden")
    if request.method == "GET":
        events = [
            {"success": e.success, "reason": e.reason, "ip": e.ip, "ua": e.user_agent, "at": e.created_at.isoformat()}
            for e in u.login_events.order_by("-created_at")[:30]
        ]
        devices = [
            {"id": t.key[:12], "device": t.device, "ip": t.ip, "created_at": t.created_at.isoformat(), "last_used": t.last_used.isoformat()}
            for t in u.tokens.order_by("-last_used")
        ]
        audits = [
            {"action": a.action, "details": a.details, "at": a.created_at.isoformat(), "actor": a.actor.name if a.actor else None}
            for a in AuditLog.objects.filter(target=u.username).order_by("-created_at")[:20]
        ]
        return JsonResponse({"user": admin_user_payload(u, request), "logins": events, "devices": devices, "audit": audits})

    if request.method == "DELETE":
        username = u.username
        sign_out_user(u, "deleted")
        for c in Chat.objects.filter(kind="direct", memberships__user=u):
            ids = list(c.memberships.values_list("user_id", flat=True))
            c.delete()
            notify_users(ids, {"type": "chat_removed", "chat_id": c.pk})
        u.delete()
        audit(request.user_obj, "user_deleted", username)
        return JsonResponse({"ok": True})

    d = request.data
    changes = []
    if "username" in d and d["username"] != u.username:
        new = need(d, "username", "Username", 30)
        validate_username(new, u.pk)
        u.username = new
        changes.append("username")
        sign_out_user(u, "credentials_changed")
    for field, label in (("display_name", "name"), ("department", "department"), ("designation", "designation")):
        if field in d:
            setattr(u, field, (d[field] or "").strip()[:100])
            changes.append(label)
    if "template_id" in d:
        u.template = PermissionTemplate.objects.filter(pk=d["template_id"]).first() if d["template_id"] else None
        changes.append("template")
    if "feature_overrides" in d:
        u.feature_overrides = clean_overrides(d["feature_overrides"])
        changes.append("permissions")
    if "must_change_password" in d:
        u.must_change_password = bool(d["must_change_password"])
        changes.append("force_password_change")
    if "is_active" in d:
        active = bool(d["is_active"])
        if active != u.is_active:
            u.is_active = active
            changes.append("enabled" if active else "disabled")
            if not active:
                sign_out_user(u, "disabled")
    if d.get("unlock"):
        u.locked_until, u.failed_logins = None, 0
        changes.append("unlocked")
    u.save()
    if "permissions" in changes or "template" in changes:
        notify_users([u.pk], {"type": "features_update", "features": effective_features(u)})
    audit(request.user_obj, "user_updated", u.username, changes=changes)
    return JsonResponse({"user": admin_user_payload(u, request)})


@api(methods=["POST"], admin=True)
def user_reset_password(request, user_id):
    u = get_user_or_404(user_id)
    if u.role == "admin":
        raise ApiError("The admin account cannot be modified here.", 400, "forbidden")
    password = (request.data.get("password") or "").strip()
    generated = not password
    password = password or gen_password()
    if len(password) < 8:
        raise ApiError("Password must be at least 8 characters.", 400, "weak_password")
    u.set_password(password)
    u.must_change_password = bool(request.data.get("must_change_password", True))
    u.failed_logins, u.locked_until = 0, None
    u.save()
    sign_out_user(u, "credentials_changed")
    audit(request.user_obj, "password_reset", u.username)
    return JsonResponse({"password": password, "generated": generated, "username": u.username})


@api(methods=["POST"], admin=True)
def user_sign_out(request, user_id):
    u = get_user_or_404(user_id)
    sign_out_user(u)
    audit(request.user_obj, "signed_out_everywhere", u.username)
    return JsonResponse({"ok": True})


@api(methods=["DELETE"], admin=True)
def user_device_revoke(request, user_id, device_id):
    u = get_user_or_404(user_id)
    t = u.tokens.filter(key__startswith=device_id).first()
    if t:
        t.delete()
    return JsonResponse({"ok": True})


# ------------------------------------------------------------------ permissions / templates

@api(methods=["GET", "POST"], admin=True)
def templates(request):
    if request.method == "POST":
        name = need(request.data, "name", "Template name", 60)
        if PermissionTemplate.objects.filter(name__iexact=name).exists():
            raise ApiError("A template with this name already exists.", 409, "exists")
        t = PermissionTemplate.objects.create(
            name=name, description=(request.data.get("description") or "")[:200], flags={k: bool(v) for k, v in (request.data.get("flags") or {}).items() if k in FEATURES}
        )
        audit(request.user_obj, "template_created", t.name)
    items = [
        {"id": t.id, "name": t.name, "description": t.description, "flags": {**DEFAULT_FLAGS, **(t.flags or {})}, "users": t.users.count()}
        for t in PermissionTemplate.objects.order_by("name")
    ]
    return JsonResponse({"features": FEATURES, "defaults": DEFAULT_FLAGS, "templates": items})


@api(methods=["PATCH", "DELETE"], admin=True)
def template_detail(request, template_id):
    t = PermissionTemplate.objects.filter(pk=template_id).first()
    if not t:
        raise ApiError("Template not found.", 404, "not_found")
    if request.method == "DELETE":
        affected = list(t.users.values_list("pk", flat=True))
        name = t.name
        t.delete()
        audit(request.user_obj, "template_deleted", name)
        for u in User.objects.filter(pk__in=affected).select_related("template"):
            notify_users([u.pk], {"type": "features_update", "features": effective_features(u)})
        return JsonResponse({"ok": True})
    d = request.data
    if "name" in d:
        t.name = need(d, "name", "Template name", 60)
    if "description" in d:
        t.description = (d["description"] or "")[:200]
    if "flags" in d:
        t.flags = {k: bool(v) for k, v in d["flags"].items() if k in FEATURES}
    t.save()
    for u in t.users.select_related("template"):
        notify_users([u.pk], {"type": "features_update", "features": effective_features(u)})
    audit(request.user_obj, "template_updated", t.name)
    return JsonResponse({"ok": True})


# ------------------------------------------------------------------ groups

@api(**ADMIN)
def groups(request):
    out = []
    for c in Chat.objects.filter(kind="group").annotate(mc=Count("memberships", distinct=True), msgs=Count("messages", distinct=True)).order_by("-created_at"):
        out.append(
            {
                "id": c.id, "name": c.name, "description": c.description, "avatar": file_url(request, c.avatar),
                "members": c.mc, "messages": c.msgs, "created_at": c.created_at.isoformat(),
                "created_by": c.created_by.name if c.created_by else None,
            }
        )
    return JsonResponse({"groups": out})


@api(methods=["GET", "DELETE"], admin=True)
def group_detail(request, chat_id):
    c = Chat.objects.filter(pk=chat_id, kind="group").first()
    if not c:
        raise ApiError("Group not found.", 404, "not_found")
    if request.method == "DELETE":
        ids = list(c.memberships.values_list("user_id", flat=True))
        name = c.name
        c.delete()
        notify_users(ids, {"type": "chat_removed", "chat_id": chat_id})
        audit(request.user_obj, "group_deleted", name)
        return JsonResponse({"ok": True})
    members = [{"user": user_brief(m.user, request), "is_admin": m.is_admin} for m in c.memberships.select_related("user")]
    return JsonResponse({"group": {"id": c.id, "name": c.name, "description": c.description, "members": members}})


@api(methods=["POST"], admin=True)
def group_member_add(request, chat_id):
    c = Chat.objects.filter(pk=chat_id, kind="group").first()
    if not c:
        raise ApiError("Group not found.", 404, "not_found")
    uid = int(request.data.get("user_id") or 0)
    u = User.objects.filter(pk=uid, is_active=True).first()
    if not u:
        raise ApiError("User not found.", 404, "not_found")
    Membership.objects.get_or_create(chat=c, user=u)
    Message.objects.create(chat=c, sender=None, kind="system", body=f"Admin added {u.name}")
    for m in Membership.objects.filter(chat=c).select_related("user"):
        notify_users([m.user_id], {"type": "chat_update", "chat": chat_payload(c, m.user, request)})
    audit(request.user_obj, "group_member_added", c.name, user=u.username)
    return JsonResponse({"ok": True})


@api(methods=["DELETE"], admin=True)
def group_member_remove(request, chat_id, user_id):
    c = Chat.objects.filter(pk=chat_id, kind="group").first()
    if not c:
        raise ApiError("Group not found.", 404, "not_found")
    Membership.objects.filter(chat=c, user_id=user_id).delete()
    notify_users([user_id], {"type": "chat_removed", "chat_id": chat_id})
    for m in Membership.objects.filter(chat=c).select_related("user"):
        notify_users([m.user_id], {"type": "chat_update", "chat": chat_payload(c, m.user, request)})
    audit(request.user_obj, "group_member_removed", c.name, user_id=user_id)
    return JsonResponse({"ok": True})


# ------------------------------------------------------------------ audit / settings / storage / announce

@api(**ADMIN)
def audit_log(request):
    limit = max(1, min(200, int(request.GET.get("limit") or 50)))
    offset = max(0, int(request.GET.get("offset") or 0))
    rows = AuditLog.objects.select_related("actor").order_by("-created_at")
    total = rows.count()
    return JsonResponse(
        {
            "total": total,
            "entries": [
                {"id": a.id, "actor": a.actor.name if a.actor else "System", "action": a.action, "target": a.target, "details": a.details, "at": a.created_at.isoformat()}
                for a in rows[offset : offset + limit]
            ],
        }
    )


@api(methods=["GET", "PUT"], admin=True)
def app_settings(request):
    s = AppSettings.get()
    if request.method == "PUT":
        d = request.data
        if "app_name" in d:
            s.app_name = need(d, "app_name", "App name", 60)
        if "max_upload_mb" in d:
            mb = int(d["max_upload_mb"])
            if not 1 <= mb <= 2048:
                raise ApiError("Max upload size must be between 1 and 2048 MB.", 400, "bad_value")
            s.max_upload_mb = mb
        if "welcome_message" in d:
            s.welcome_message = (d["welcome_message"] or "")[:300]
        s.save()
        audit(request.user_obj, "settings_updated", "app", **{k: d[k] for k in d if k in ("app_name", "max_upload_mb")})
    return JsonResponse({"app_name": s.app_name, "max_upload_mb": s.max_upload_mb, "welcome_message": s.welcome_message})


@api(**ADMIN)
def storage(request):
    rows = (
        User.objects.annotate(
            bytes=Sum("messages_sent__file_size", filter=~Q(messages_sent__file="")),
            files=Count("messages_sent", filter=~Q(messages_sent__file="") & Q(messages_sent__file__isnull=False)),
        )
        .filter(files__gt=0)
        .order_by("-bytes")
    )
    return JsonResponse({"users": [{"id": u.id, "name": u.name, "bytes": u.bytes or 0, "files": u.files} for u in rows]})


@api(methods=["POST"], admin=True)
def announce(request):
    text = need(request.data, "text", "Announcement", 1000)
    ids = request.data.get("user_ids")
    me = request.user_obj
    targets = User.objects.filter(is_active=True, role="member")
    if ids:
        targets = targets.filter(pk__in=[int(i) for i in ids if str(i).isdigit()])
    count = 0
    for u in targets:
        chat, _ = get_or_create_direct(me, u, system=True)
        post_message(request, chat, me, kind="text", body="📢 " + text)
        count += 1
    audit(me, "announcement_sent", f"{count} users", preview=text[:80])
    return JsonResponse({"sent": count})
