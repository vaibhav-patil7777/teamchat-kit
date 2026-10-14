import os
import re
from datetime import timedelta

from django.conf import settings
from django.db.models import Max
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from . import presence
from .api import ApiError, api, need
from .features import effective_features
from .models import AppSettings, Chat, Membership, Message, MessageDeletion, Reaction, Star, User
from .realtime import notify_users
from .services import (
    URL_RE,
    chat_payload,
    file_url,
    get_or_create_direct,
    guess_mime,
    kind_for_mime,
    message_payload,
    post_message,
    search_messages,
    user_brief,
    visible_messages,
)


def get_member(request, chat_id):
    m = Membership.objects.select_related("chat").filter(chat_id=chat_id, user=request.user_obj).first()
    if not m:
        raise ApiError("Chat not found.", 404, "not_found")
    return m


def require_group_admin(request, m):
    if m.chat.kind != "group":
        raise ApiError("This action is only for groups.", 400, "not_group")
    if not (m.is_admin or request.user_obj.is_app_admin):
        raise ApiError("Only group admins can do this.", 403, "forbidden")


def feats(request):
    return effective_features(request.user_obj)


def member_ids(chat):
    return list(Membership.objects.filter(chat=chat).values_list("user_id", flat=True))


def push_chat_update(request, chat, user_ids=None):
    """Tell every member to refresh this chat's info (each gets own view of it)."""
    for ms in Membership.objects.filter(chat=chat).select_related("user"):
        if user_ids is not None and ms.user_id not in user_ids:
            continue
        notify_users([ms.user_id], {"type": "chat_update", "chat": chat_payload(chat, ms.user, request)})


def system_message(request, chat, text):
    return post_message(request, chat, request.user_obj, kind="system", body=text)


# ------------------------------------------------------------------ chats

@api(methods=["GET"])
def chats_list(request):
    me = request.user_obj
    chats = Chat.objects.filter(memberships__user=me).distinct()
    items = [chat_payload(c, me, request) for c in chats]
    items.sort(key=lambda c: (not c["my"]["pinned"], c["ts"] or ""), reverse=False)
    pinned = [c for c in items if c["my"]["pinned"]]
    rest = [c for c in items if not c["my"]["pinned"]]
    pinned.sort(key=lambda c: c["ts"] or "", reverse=True)
    rest.sort(key=lambda c: c["ts"] or "", reverse=True)
    return JsonResponse({"chats": pinned + rest})


@api(methods=["POST"])
def chat_direct(request):
    me = request.user_obj
    uid = int(request.data.get("user_id") or 0)
    other = User.objects.filter(pk=uid, is_active=True).first()
    if not other or other.pk == me.pk:
        raise ApiError("User not found.", 404, "not_found")
    if not feats(request)["chat_direct"] and not (other.is_app_admin or me.is_app_admin):
        raise ApiError("Starting new chats is disabled for your account.", 403, "feature_disabled")
    chat, _ = get_or_create_direct(me, other)
    return JsonResponse({"chat": chat_payload(chat, me, request)})


@api(methods=["POST"], feature="create_groups")
def chat_group_create(request):
    me = request.user_obj
    name = need(request.data, "name", "Group name", 80)
    ids = {int(x) for x in (request.data.get("member_ids") or []) if str(x).isdigit()}
    ids.discard(me.pk)
    users = list(User.objects.filter(pk__in=ids, is_active=True))
    if not users:
        raise ApiError("Select at least one member.", 400, "required")
    chat = Chat.objects.create(kind="group", name=name, description=(request.data.get("description") or "")[:300], created_by=me)
    Membership.objects.create(chat=chat, user=me, is_admin=True)
    for u in users:
        Membership.objects.create(chat=chat, user=u)
    system_message(request, chat, f"{me.name} created group \"{name}\"")
    return JsonResponse({"chat": chat_payload(chat, me, request)})


@api(methods=["GET", "PATCH", "DELETE"])
def chat_detail(request, chat_id):
    m = get_member(request, chat_id)
    chat = m.chat
    me = request.user_obj
    if request.method == "GET":
        return JsonResponse({"chat": chat_payload(chat, me, request)})
    if request.method == "PATCH":
        require_group_admin(request, m)
        d = request.data
        if "name" in d:
            chat.name = need(d, "name", "Group name", 80)
        if "description" in d:
            chat.description = (d.get("description") or "")[:300]
        if "only_admins_post" in d:
            chat.only_admins_post = bool(d.get("only_admins_post"))
        chat.save()
        push_chat_update(request, chat)
        return JsonResponse({"chat": chat_payload(chat, me, request)})
    # DELETE
    require_group_admin(request, m)
    ids = member_ids(chat)
    chat.delete()
    notify_users(ids, {"type": "chat_removed", "chat_id": chat_id})
    return JsonResponse({"ok": True})


@api(methods=["POST"])
def chat_avatar(request, chat_id):
    m = get_member(request, chat_id)
    require_group_admin(request, m)
    f = request.FILES.get("file")
    if not f or not (f.content_type or "").startswith("image/") or f.size > 5 * 1024 * 1024:
        raise ApiError("Please upload an image smaller than 5 MB.", 400, "bad_file")
    m.chat.avatar = f
    m.chat.save(update_fields=["avatar"])
    push_chat_update(request, m.chat)
    return JsonResponse({"chat": chat_payload(m.chat, request.user_obj, request)})


@api(methods=["POST"])
def chat_members_add(request, chat_id):
    m = get_member(request, chat_id)
    require_group_admin(request, m)
    ids = {int(x) for x in (request.data.get("user_ids") or []) if str(x).isdigit()}
    added = []
    for u in User.objects.filter(pk__in=ids, is_active=True):
        _, created = Membership.objects.get_or_create(chat=m.chat, user=u)
        if created:
            added.append(u)
    if added:
        system_message(request, m.chat, f"{request.user_obj.name} added " + ", ".join(u.name for u in added))
        push_chat_update(request, m.chat)
    return JsonResponse({"chat": chat_payload(m.chat, request.user_obj, request)})


@api(methods=["DELETE"])
def chat_member_remove(request, chat_id, user_id):
    m = get_member(request, chat_id)
    chat = m.chat
    me = request.user_obj
    if chat.kind != "group":
        raise ApiError("This action is only for groups.", 400, "not_group")
    target = Membership.objects.select_related("user").filter(chat=chat, user_id=user_id).first()
    if not target:
        raise ApiError("Member not found.", 404, "not_found")
    if target.user_id != me.pk:
        require_group_admin(request, m)
    name = target.user.name
    ids_before = member_ids(chat)
    target.delete()
    if not Membership.objects.filter(chat=chat, is_admin=True).exists():
        nxt = Membership.objects.filter(chat=chat).order_by("joined_at").first()
        if nxt:
            nxt.is_admin = True
            nxt.save(update_fields=["is_admin"])
    if not Membership.objects.filter(chat=chat).exists():
        chat.delete()
    else:
        text = f"{name} left" if target.user_id == me.pk else f"{me.name} removed {name}"
        sm = Message.objects.create(chat=chat, sender=None, kind="system", body=text)
        notify_users(member_ids(chat), {"type": "message", "chat_id": chat.id, "message": message_payload(sm, request)})
        push_chat_update(request, chat)
    notify_users([user_id], {"type": "chat_removed", "chat_id": chat_id})
    return JsonResponse({"ok": True})


@api(methods=["POST"])
def chat_member_admin(request, chat_id, user_id):
    m = get_member(request, chat_id)
    require_group_admin(request, m)
    target = Membership.objects.filter(chat=m.chat, user_id=user_id).first()
    if not target:
        raise ApiError("Member not found.", 404, "not_found")
    target.is_admin = bool(request.data.get("is_admin"))
    target.save(update_fields=["is_admin"])
    push_chat_update(request, m.chat)
    return JsonResponse({"chat": chat_payload(m.chat, request.user_obj, request)})


@api(methods=["POST"])
def chat_settings(request, chat_id):
    m = get_member(request, chat_id)
    for k in ("muted", "pinned", "archived"):
        if k in request.data:
            if k == "archived" and m.chat.is_support:
                continue
            setattr(m, k, bool(request.data[k]))
    m.save()
    return JsonResponse({"chat": chat_payload(m.chat, request.user_obj, request)})


@api(methods=["POST"])
def chat_read(request, chat_id):
    m = get_member(request, chat_id)
    last = Message.objects.filter(chat_id=chat_id).aggregate(x=Max("id"))["x"] or 0
    upto = min(int(request.data.get("upto") or last), last)
    if upto > m.last_read_id:
        m.last_read_id = upto
        m.last_delivered_id = max(m.last_delivered_id, upto)
        m.save(update_fields=["last_read_id", "last_delivered_id"])
        notify_users(member_ids(m.chat), {"type": "read", "chat_id": chat_id, "user_id": request.user_obj.pk, "upto": upto})
    return JsonResponse({"ok": True})


@api(methods=["POST"])
def chat_clear(request, chat_id):
    m = get_member(request, chat_id)
    m.cleared_before_id = Message.objects.filter(chat_id=chat_id).aggregate(x=Max("id"))["x"] or 0
    m.last_read_id = m.cleared_before_id
    m.save(update_fields=["cleared_before_id", "last_read_id"])
    return JsonResponse({"chat": chat_payload(m.chat, request.user_obj, request)})


# ------------------------------------------------------------------ messages

@api(methods=["GET", "POST"])
def messages(request, chat_id):
    m = get_member(request, chat_id)
    me = request.user_obj
    if request.method == "GET":
        qs = visible_messages(chat_id, m, me)
        after = int(request.GET.get("after") or 0)
        before = int(request.GET.get("before") or 0)
        limit = max(1, min(100, int(request.GET.get("limit") or 40)))
        if after:
            rows = list(qs.filter(id__gt=after).order_by("id")[:300])
            has_more = False
        else:
            if before:
                qs = qs.filter(id__lt=before)
            rows = list(qs.order_by("-id")[: limit + 1])
            has_more = len(rows) > limit
            rows = list(reversed(rows[:limit]))
        starred = set(Star.objects.filter(user=me, message_id__in=[r.id for r in rows]).values_list("message_id", flat=True))
        out = []
        for r in rows:
            p = message_payload(r, request)
            p["starred"] = r.id in starred
            out.append(p)
        return JsonResponse({"messages": out, "has_more": has_more})

    # ---- POST: send
    chat, d, f = m.chat, request.data, feats(request)
    if chat.kind == "group" and chat.only_admins_post and not (m.is_admin or me.is_app_admin):
        raise ApiError("Only admins can send messages in this group.", 403, "admins_only")
    body = (d.get("body") or "").strip()
    upload = request.FILES.get("file")
    reply_id = int(d.get("reply_to_id") or 0) or None
    if reply_id and not f["reply_forward"]:
        raise ApiError("Replying is disabled for your account.", 403, "feature_disabled")
    reply = Message.objects.filter(pk=reply_id, chat=chat).first() if reply_id else None
    if len(body) > 4000:
        raise ApiError("Message is too long (max 4000 characters).", 400, "too_long")
    fields = {"body": body, "reply_to": reply}
    if upload:
        hint = d.get("hint")
        if not f["send_files"] and not (hint == "voice" and f["voice_notes"]):
            raise ApiError("Sharing files is disabled for your account.", 403, "feature_disabled")
        if hint == "voice" and not f["voice_notes"]:
            raise ApiError("Voice notes are disabled for your account.", 403, "feature_disabled")
        limit_mb = AppSettings.get().max_upload_mb
        if upload.size > limit_mb * 1024 * 1024:
            raise ApiError(f"File is too large. Maximum allowed size is {limit_mb} MB.", 413, "file_too_large")
        name = os.path.basename(upload.name)[:200] or "file"
        mime = guess_mime(name, upload.content_type)
        fields.update(
            kind=kind_for_mime(mime, hint), file=upload, file_name=name, file_size=upload.size, mime=mime,
            duration=int(d.get("duration") or 0) or None,
        )
    elif not body:
        raise ApiError("Message is empty.", 400, "required")
    msg = post_message(request, chat, me, **fields)
    return JsonResponse({"message": message_payload(msg, request)}, status=201)


def get_message(request, message_id):
    msg = Message.objects.select_related("chat", "sender").filter(pk=message_id).first()
    if not msg or not Membership.objects.filter(chat=msg.chat, user=request.user_obj).exists():
        raise ApiError("Message not found.", 404, "not_found")
    return msg


def refresh_payload(msg, request):
    msg = Message.objects.select_related("sender", "reply_to", "reply_to__sender").prefetch_related("reactions").get(pk=msg.pk)
    return message_payload(msg, request)


@api(methods=["PATCH", "DELETE"])
def message_detail(request, message_id):
    msg = get_message(request, message_id)
    me = request.user_obj
    f = feats(request)
    if request.method == "PATCH":
        if not f["edit_messages"]:
            raise ApiError("Editing is disabled for your account.", 403, "feature_disabled")
        if msg.sender_id != me.pk or msg.kind != "text" or msg.deleted:
            raise ApiError("You can only edit your own text messages.", 403, "forbidden")
        if timezone.now() - msg.created_at > timedelta(hours=settings.EDIT_WINDOW_HOURS):
            raise ApiError("This message is too old to edit.", 400, "too_old")
        body = need(request.data, "body", "Message", 4000)
        msg.body, msg.edited_at = body, timezone.now()
        msg.save(update_fields=["body", "edited_at"])
        notify_users(member_ids(msg.chat), {"type": "message_update", "chat_id": msg.chat_id, "message": refresh_payload(msg, request)})
        return JsonResponse({"message": refresh_payload(msg, request)})

    # DELETE
    if not f["delete_messages"]:
        raise ApiError("Deleting is disabled for your account.", 403, "feature_disabled")
    mode = request.GET.get("mode") or "me"
    if mode == "everyone":
        if msg.sender_id != me.pk and not me.is_app_admin:
            raise ApiError("You can only delete your own messages for everyone.", 403, "forbidden")
        if msg.file:
            name = msg.file.name
            others = Message.objects.filter(file=name).exclude(pk=msg.pk).exists()
            if not others:
                try:
                    msg.file.storage.delete(name)
                except Exception:
                    pass
        msg.deleted, msg.body, msg.file = True, "", None
        msg.file_name, msg.file_size, msg.mime = "", 0, ""
        msg.save()
        Star.objects.filter(message=msg).delete()
        notify_users(member_ids(msg.chat), {"type": "message_update", "chat_id": msg.chat_id, "message": refresh_payload(msg, request)})
    else:
        MessageDeletion.objects.get_or_create(user=me, message=msg)
        notify_users([me.pk], {"type": "message_hidden", "chat_id": msg.chat_id, "message_id": msg.pk})
    return JsonResponse({"ok": True})


def reactions_payload(msg):
    groups = {}
    for r in Reaction.objects.filter(message=msg):
        groups.setdefault(r.emoji, []).append(r.user_id)
    return [{"emoji": e, "user_ids": ids} for e, ids in groups.items()]


@api(methods=["POST"], feature="reactions")
def message_react(request, message_id):
    msg = get_message(request, message_id)
    emoji = need(request.data, "emoji", "Emoji", 16)
    cur = Reaction.objects.filter(message=msg, user=request.user_obj).first()
    if cur and cur.emoji == emoji:
        cur.delete()
    elif cur:
        cur.emoji = emoji
        cur.save(update_fields=["emoji"])
    else:
        Reaction.objects.create(message=msg, user=request.user_obj, emoji=emoji)
    reactions = reactions_payload(msg)
    notify_users(member_ids(msg.chat), {"type": "reactions", "chat_id": msg.chat_id, "message_id": msg.pk, "reactions": reactions})
    return JsonResponse({"reactions": reactions})


@api(methods=["POST"], feature="star_messages")
def message_star(request, message_id):
    msg = get_message(request, message_id)
    obj, created = Star.objects.get_or_create(user=request.user_obj, message=msg)
    if not created:
        obj.delete()
    return JsonResponse({"starred": created})


@api(methods=["GET"], feature="star_messages")
def starred_list(request):
    me = request.user_obj
    qs = (
        Star.objects.filter(user=me, message__deleted=False)
        .select_related("message", "message__sender", "message__chat", "message__reply_to", "message__reply_to__sender")
        .order_by("-id")[:100]
    )
    out = []
    for s in qs:
        p = message_payload(s.message, request)
        p["starred"] = True
        p["chat_name"] = chat_payload(s.message.chat, me, request)["name"]
        out.append(p)
    return JsonResponse({"messages": out})


@api(methods=["POST"], feature="reply_forward")
def message_forward(request):
    me = request.user_obj
    msg_ids = [int(x) for x in (request.data.get("message_ids") or []) if str(x).isdigit()]
    chat_ids = [int(x) for x in (request.data.get("chat_ids") or []) if str(x).isdigit()]
    if not msg_ids or not chat_ids:
        raise ApiError("Select messages and chats.", 400, "required")
    sources = [m for m in Message.objects.filter(pk__in=msg_ids, deleted=False).order_by("id") if Membership.objects.filter(chat=m.chat, user=me).exists()]
    count = 0
    for cid in chat_ids:
        mem = Membership.objects.select_related("chat").filter(chat_id=cid, user=me).first()
        if not mem:
            continue
        if mem.chat.kind == "group" and mem.chat.only_admins_post and not (mem.is_admin or me.is_app_admin):
            continue
        for s in sources:
            if s.kind == "system":
                continue
            fields = dict(kind=s.kind, body=s.body, forwarded=True, file_name=s.file_name, file_size=s.file_size, mime=s.mime, duration=s.duration)
            if s.file:
                fields["file"] = s.file.name
            post_message(request, mem.chat, me, **fields)
            count += 1
    return JsonResponse({"forwarded": count})


# ------------------------------------------------------------------ search / media / export

@api(methods=["GET"], feature="search")
def search(request):
    q = (request.GET.get("q") or "").strip()
    me = request.user_obj
    if len(q) < 2:
        return JsonResponse({"messages": [], "people": [], "chats": []})
    chat_id = int(request.GET.get("chat_id") or 0) or None
    msgs = []
    for r in search_messages(me, q, 40, chat_id):
        p = message_payload(r, request)
        p["chat_name"] = r.chat.name or ""
        msgs.append(p)
    people, chats = [], []
    if not chat_id:
        from django.db.models import Q

        for u in User.objects.filter(is_active=True).exclude(pk=me.pk).filter(Q(display_name__icontains=q) | Q(username__icontains=q))[:10]:
            people.append(user_brief(u, request))
        for c in Chat.objects.filter(memberships__user=me, kind="group", name__icontains=q).distinct()[:10]:
            chats.append(chat_payload(c, me, request))
    return JsonResponse({"messages": msgs, "people": people, "chats": chats})


@api(methods=["GET"])
def chat_media(request, chat_id):
    m = get_member(request, chat_id)
    kind = request.GET.get("type") or "media"
    qs = visible_messages(chat_id, m, request.user_obj).filter(deleted=False)
    if kind == "media":
        qs = qs.filter(kind__in=["image", "video"])
    elif kind == "docs":
        qs = qs.filter(kind__in=["file", "audio"])
    else:
        qs = qs.filter(body__icontains="http")
    out = []
    for r in qs.order_by("-id")[:120]:
        if kind == "links" and not URL_RE.search(r.body):
            continue
        out.append(message_payload(r, request))
    return JsonResponse({"messages": out})


@api(methods=["GET"], feature="export_chat")
def chat_export(request, chat_id):
    m = get_member(request, chat_id)
    chat = m.chat
    fmt = request.GET.get("format") or "txt"
    cp = chat_payload(chat, request.user_obj, request)
    rows = list(visible_messages(chat_id, m, request.user_obj).order_by("id"))
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", cp["name"]) or "chat"
    stamp = timezone.now().strftime("%Y%m%d")

    def line(r):
        who = r.sender.name if r.sender else "Deleted user"
        t = r.created_at.strftime("%Y-%m-%d %H:%M")
        if r.deleted:
            text = "This message was deleted"
        elif r.file:
            text = f"[{r.kind}: {r.file_name}] {r.body}".strip()
        else:
            text = r.body
        return t, who, text

    if fmt == "json":
        import json

        data = {
            "app": "TeamChat", "version": 1, "chat": {"name": cp["name"], "kind": chat.kind},
            "exported_at": timezone.now().isoformat(),
            "messages": [
                {"id": r.id, "sender": r.sender.name if r.sender else None, "kind": r.kind, "body": "" if r.deleted else r.body,
                 "file_name": r.file_name, "file_url": file_url(request, r.file) if not r.deleted else None,
                 "created_at": r.created_at.isoformat(), "edited": bool(r.edited_at), "deleted": r.deleted}
                for r in rows
            ],
        }
        resp = HttpResponse(json.dumps(data, ensure_ascii=False, indent=2), content_type="application/json; charset=utf-8")
        ext = "json"
    elif fmt == "html":
        import html as H

        items = "".join(
            f"<div class='m'><b>{H.escape(w)}</b> <span>{H.escape(t)}</span><p>{H.escape(x)}</p></div>" for t, w, x in map(line, rows)
        )
        page = (
            "<!doctype html><meta charset='utf-8'><title>" + H.escape(cp["name"]) + "</title>"
            "<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 12px;background:#f5f5f5}"
            ".m{background:#fff;border-radius:10px;padding:8px 12px;margin:8px 0;box-shadow:0 1px 2px #0002}"
            ".m span{color:#888;font-size:12px;margin-left:8px}.m p{margin:4px 0 0;white-space:pre-wrap}</style>"
            f"<h2>{H.escape(cp['name'])}</h2>{items}"
        )
        resp = HttpResponse(page, content_type="text/html; charset=utf-8")
        ext = "html"
    else:
        text = f"Chat export: {cp['name']}\n\n" + "\n".join(f"[{t}] {w}: {x}" for t, w, x in map(line, rows))
        resp = HttpResponse(text, content_type="text/plain; charset=utf-8")
        ext = "txt"
    resp["Content-Disposition"] = f'attachment; filename="{safe}_{stamp}.{ext}"'
    resp["Access-Control-Expose-Headers"] = "Content-Disposition"
    return resp
