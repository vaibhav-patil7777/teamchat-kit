import secrets
from datetime import timedelta

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.utils import timezone

from .api import ApiError, api, audit, client_ip, need
from .models import AppSettings, AuthToken, LoginEvent, User
from .realtime import notify_users
from .services import me_payload, user_brief

SAFE_INLINE = ("image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf")


def health(request):
    return JsonResponse({"ok": True})  # no DB access: safe for uptime pings


@api(methods=["GET"], auth=False)
def public_info(request):
    s = AppSettings.get()
    return JsonResponse({"app_name": s.app_name, "welcome": s.welcome_message})


def new_token(user, request):
    key = secrets.token_hex(32)
    ua = request.META.get("HTTP_USER_AGENT", "")[:300]
    AuthToken.objects.create(key=key, user=user, device=short_device(ua), user_agent=ua, ip=client_ip(request))
    return key


def short_device(ua):
    ua_l = ua.lower()
    os_ = "Android" if "android" in ua_l else "iPhone" if "iphone" in ua_l else "iPad" if "ipad" in ua_l else "Windows" if "windows" in ua_l else "Mac" if "mac os" in ua_l else "Linux" if "linux" in ua_l else "Unknown OS"
    br = "Edge" if "edg/" in ua_l else "Chrome" if "chrome" in ua_l else "Firefox" if "firefox" in ua_l else "Safari" if "safari" in ua_l else "Browser"
    return f"{br} on {os_}"


@api(methods=["POST"], auth=False)
def login(request):
    username = need(request.data, "username", "Username")
    password = request.data.get("password") or ""
    ip, ua = client_ip(request), request.META.get("HTTP_USER_AGENT", "")[:300]
    now = timezone.now()
    user = User.objects.filter(username__iexact=username).first()

    def fail(reason, status=401, msg="Invalid username or password."):
        LoginEvent.objects.create(user=user, username_tried=username[:150], success=False, reason=reason, ip=ip, user_agent=ua)
        code = "invalid_credentials" if reason in ("unknown_user", "bad_password") else reason
        raise ApiError(msg, status, code)

    if not user:
        fail("unknown_user")
    if user.locked_until and user.locked_until > now:
        mins = int((user.locked_until - now).total_seconds() // 60) + 1
        fail("locked", 429, f"Too many failed attempts. Try again in {mins} minute(s).")
    if not user.check_password(password):
        user.failed_logins += 1
        if user.failed_logins >= settings.LOGIN_MAX_FAILS:
            user.locked_until = now + timedelta(minutes=settings.LOGIN_LOCK_MINUTES)
            user.failed_logins = 0
        user.save(update_fields=["failed_logins", "locked_until"])
        fail("bad_password")
    if not user.is_active:
        fail("disabled", 403, "This account has been disabled. Please contact your admin.")

    user.failed_logins, user.locked_until = 0, None
    user.save(update_fields=["failed_logins", "locked_until"])
    LoginEvent.objects.create(user=user, username_tried=username[:150], success=True, ip=ip, user_agent=ua)
    key = new_token(user, request)
    return JsonResponse({"token": key, "user": me_payload(user, request)})


@api(methods=["POST"])
def logout(request):
    request.token.delete()
    return JsonResponse({"ok": True})


@api(methods=["GET", "PATCH"])
def me(request):
    u = request.user_obj
    if request.method == "PATCH":
        from .features import effective_features

        feats = effective_features(u)
        d = request.data
        if "display_name" in d or "about" in d:
            if not feats["change_profile"]:
                raise ApiError("Changing your profile is disabled for your account.", 403, "feature_disabled")
            if "display_name" in d:
                u.display_name = need(d, "display_name", "Name", 100)
            if "about" in d:
                u.about = (d.get("about") or "").strip()[:200]
        if "prefs" in d and isinstance(d["prefs"], dict):
            allowed = {"lang", "theme", "font", "size", "accent", "density", "bubble", "wallpaper", "sound", "enterToSend"}
            prefs = dict(u.prefs or {})
            for k, v in d["prefs"].items():
                if k not in allowed:
                    continue
                if k != "lang" and k != "sound" and k != "enterToSend" and not feats["change_theme"]:
                    continue
                if isinstance(v, (str, int, bool)) or v is None:
                    prefs[k] = v if not isinstance(v, str) else v[:60]
            u.prefs = prefs
        u.save()
    return JsonResponse({"user": me_payload(u, request)})


@api(methods=["POST"])
def me_avatar(request):
    from .features import effective_features

    if not effective_features(request.user_obj)["change_profile"]:
        raise ApiError("Changing your profile is disabled for your account.", 403, "feature_disabled")
    f = request.FILES.get("file")
    if not f:
        raise ApiError("No file uploaded.", 400, "required")
    if not (f.content_type or "").startswith("image/") or f.size > 5 * 1024 * 1024:
        raise ApiError("Please upload an image smaller than 5 MB.", 400, "bad_file")
    request.user_obj.avatar = f
    request.user_obj.save(update_fields=["avatar"])
    return JsonResponse({"user": me_payload(request.user_obj, request)})


@api(methods=["POST"])
def me_avatar_remove(request):
    request.user_obj.avatar = None
    request.user_obj.save(update_fields=["avatar"])
    return JsonResponse({"user": me_payload(request.user_obj, request)})


@api(methods=["POST"])
def change_password(request):
    u = request.user_obj
    cur = request.data.get("current_password") or ""
    new = request.data.get("new_password") or ""
    if not u.check_password(cur):
        raise ApiError("Current password is incorrect.", 400, "bad_password")
    if len(new) < 8:
        raise ApiError("New password must be at least 8 characters.", 400, "weak_password")
    if new == cur:
        raise ApiError("New password must be different from the current one.", 400, "same_password")
    u.set_password(new)
    u.must_change_password = False
    u.using_default_password = False
    u.save()
    u.tokens.exclude(key=request.token.key).delete()  # sign out other devices
    audit(u, "password_changed", u.username, self_service=True)
    return JsonResponse({"ok": True})


@api(methods=["GET"])
def devices(request):
    out = []
    for t in request.user_obj.tokens.order_by("-last_used"):
        out.append(
            {
                "id": t.key[:12],
                "device": t.device,
                "ip": t.ip,
                "created_at": t.created_at.isoformat(),
                "last_used": t.last_used.isoformat(),
                "current": t.key == request.token.key,
            }
        )
    return JsonResponse({"devices": out})


@api(methods=["DELETE"])
def device_revoke(request, device_id):
    t = request.user_obj.tokens.filter(key__startswith=device_id).first()
    if not t:
        raise ApiError("Device not found.", 404, "not_found")
    if t.key == request.token.key:
        raise ApiError("Use Sign out to end this session.", 400, "current_device")
    t.delete()
    return JsonResponse({"ok": True})


@api(methods=["GET"])
def users_directory(request):
    q = (request.GET.get("q") or "").strip()
    qs = User.objects.filter(is_active=True).exclude(pk=request.user_obj.pk)
    if q:
        from django.db.models import Q

        qs = qs.filter(Q(display_name__icontains=q) | Q(username__icontains=q) | Q(department__icontains=q) | Q(designation__icontains=q))
    qs = qs.order_by("display_name", "username")[:200]
    return JsonResponse({"users": [user_brief(u, request) for u in qs]})


@api(methods=["GET"])
def presence_list(request):
    from . import presence

    return JsonResponse({"online": presence.online_ids()})


def media(request, path):
    """Serve local uploads with safe headers and HTTP Range support (needed for video on iPhone)."""
    import mimetypes
    import re as _re

    from django.core.files.storage import default_storage
    from django.http import HttpResponse, StreamingHttpResponse

    if ".." in path or path.startswith("/"):
        raise Http404()
    if not default_storage.exists(path):
        raise Http404()
    mime, _ = mimetypes.guess_type(path)
    mime = mime or "application/octet-stream"
    inline = mime in SAFE_INLINE or mime.startswith("video/") or mime.startswith("audio/")
    size = default_storage.size(path)
    rng = request.META.get("HTTP_RANGE", "")
    m = _re.match(r"bytes=(\d*)-(\d*)$", rng.strip()) if rng else None

    def chunks(f, start, length, bs=64 * 1024):
        f.seek(start)
        left = length
        try:
            while left > 0:
                data = f.read(min(bs, left))
                if not data:
                    break
                left -= len(data)
                yield data
        finally:
            f.close()

    if m and size:
        a, b = m.group(1), m.group(2)
        if a == "" and b == "":
            m = None
        else:
            if a == "":
                start, end = max(0, size - int(b)), size - 1
            else:
                start, end = int(a), int(b) if b else size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                resp = HttpResponse(status=416)
                resp["Content-Range"] = f"bytes */{size}"
                return resp
            length = end - start + 1
            resp = StreamingHttpResponse(chunks(default_storage.open(path, "rb"), start, length), status=206, content_type=mime)
            resp["Content-Range"] = f"bytes {start}-{end}/{size}"
            resp["Content-Length"] = str(length)
    if not m:
        resp = FileResponse(default_storage.open(path, "rb"), content_type=mime)
    resp["Accept-Ranges"] = "bytes"
    resp["X-Content-Type-Options"] = "nosniff"
    resp["Cache-Control"] = "private, max-age=86400"
    if not inline:
        resp["Content-Disposition"] = "attachment"
    return resp
