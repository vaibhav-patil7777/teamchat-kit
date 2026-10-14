import mimetypes
import re

from django.db.models import Q

from . import presence
from .features import effective_features
from .models import AppSettings, Chat, Membership, Message, Poll, Reaction
from .realtime import notify_users

URL_RE = re.compile(r"https?://\S+", re.I)


def file_url(request, f):
    if not f:
        return None
    try:
        url = f.url
    except ValueError:
        return None
    if url.startswith("http"):
        return url
    return request.build_absolute_uri(url) if request else url


def iso(dt):
    return dt.isoformat() if dt else None


def user_brief(u, request=None):
    if u is None:
        return {"id": None, "name": "Deleted user", "username": "", "avatar": None, "about": "", "role": "member", "online": False, "last_seen": None}
    return {
        "id": u.id,
        "name": u.name,
        "username": u.username,
        "avatar": file_url(request, u.avatar),
        "about": u.about,
        "role": u.role,
        "department": u.department,
        "designation": u.designation,
        "online": presence.is_online(u.id),
        "last_seen": iso(u.last_seen),
    }


def me_payload(u, request):
    d = user_brief(u, request)
    s = AppSettings.get()
    d.update(
        {
            "features": effective_features(u),
            "prefs": u.prefs or {},
            "must_change_password": u.must_change_password,
            "using_default_password": u.using_default_password,
            "app_name": s.app_name,
            "max_upload_mb": s.max_upload_mb,
        }
    )
    return d


def sender_label(m):
    return m.bot_name or (m.sender.name if m.sender else "Deleted user")


def poll_payload(poll):
    opts = []
    for o in poll.options.order_by("position", "id"):
        opts.append({"id": o.id, "text": o.text, "voters": list(o.votes.values_list("user_id", flat=True))})
    return {"id": poll.id, "question": poll.question, "multiple": poll.multiple, "closed": poll.closed, "options": opts}


def message_payload(m, request=None):
    groups = {}
    for r in m.reactions.all():
        groups.setdefault(r.emoji, []).append(r.user_id)
    reply = None
    if m.reply_to_id and m.reply_to:
        rt = m.reply_to
        reply = {
            "id": rt.id,
            "sender_id": rt.sender_id,
            "sender_name": rt.sender.name if rt.sender else "Deleted user",
            "kind": rt.kind,
            "body": "" if rt.deleted else rt.body[:160],
            "deleted": rt.deleted,
        }
    file = None
    if m.file and not m.deleted:
        file = {"url": file_url(request, m.file), "name": m.file_name, "size": m.file_size, "mime": m.mime, "duration": m.duration}
    return {
        "id": m.id,
        "chat_id": m.chat_id,
        "sender_id": m.sender_id,
        "sender_name": sender_label(m),
        "sender_avatar": file_url(request, m.sender.avatar) if m.sender else None,
        "kind": m.kind,
        "body": "" if m.deleted else m.body,
        "deleted": m.deleted,
        "forwarded": m.forwarded,
        "reply_to": reply,
        "file": file,
        "created_at": iso(m.created_at),
        "edited_at": iso(m.edited_at),
        "reactions": [{"emoji": e, "user_ids": ids} for e, ids in groups.items()],
        "starred": False,
        "poll": poll_payload(m.poll) if m.kind == "poll" and hasattr(m, "poll") else None,
    }


def visible_messages(chat_id, membership, user):
    return (
        Message.objects.filter(chat_id=chat_id, id__gt=membership.cleared_before_id)
        .exclude(deletions__user=user)
        .select_related("sender", "reply_to", "reply_to__sender")
        .prefetch_related("reactions")
    )


def chat_payload(chat, me, request=None, memberships=None):
    ms = memberships if memberships is not None else list(chat.memberships.select_related("user"))
    mine = next((x for x in ms if x.user_id == me.id), None)
    others = [x for x in ms if x.user_id != me.id]
    if chat.kind == "direct":
        other = others[0].user if others else None
        name = other.name if other else "Unknown"
        avatar = file_url(request, other.avatar) if other else None
        other_brief = user_brief(other, request) if other else None
    else:
        name, avatar, other_brief = chat.name, file_url(request, chat.avatar), None

    cleared = mine.cleared_before_id if mine else 0
    last = (
        Message.objects.filter(chat=chat, id__gt=cleared)
        .exclude(deletions__user=me)
        .select_related("sender")
        .order_by("-id")
        .first()
    )
    unread = (
        Message.objects.filter(chat=chat, id__gt=max(mine.last_read_id, cleared) if mine else 0)
        .exclude(sender=me)
        .exclude(deletions__user=me)
        .count()
    )
    last_payload = None
    if last:
        last_payload = {
            "id": last.id,
            "kind": last.kind,
            "body": "" if last.deleted else last.body[:120],
            "deleted": last.deleted,
            "sender_id": last.sender_id,
            "sender_name": sender_label(last),
            "file_name": last.file_name,
            "created_at": iso(last.created_at),
        }
    return {
        "id": chat.id,
        "kind": chat.kind,
        "name": name,
        "description": chat.description,
        "avatar": avatar,
        "other": other_brief,
        "is_support": chat.is_support,
        "only_admins_post": chat.only_admins_post,
        "created_by": chat.created_by_id,
        "created_at": iso(chat.created_at),
        "members": [
            {
                "user": user_brief(x.user, request),
                "is_admin": x.is_admin,
                "last_read_id": x.last_read_id,
                "last_delivered_id": x.last_delivered_id,
            }
            for x in ms
        ],
        "my": {
            "muted": mine.muted if mine else False,
            "pinned": mine.pinned if mine else False,
            "archived": mine.archived if mine else False,
            "is_admin": mine.is_admin if mine else False,
            "last_read_id": mine.last_read_id if mine else 0,
        },
        "last_message": last_payload,
        "unread": unread,
        "ts": iso(last.created_at if last else chat.created_at),
    }


def kind_for_mime(mime, hint=None):
    mime = (mime or "").lower()
    if hint == "voice" and mime.startswith("audio"):
        return "audio"
    if mime.startswith("image/") and mime != "image/svg+xml":
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return "file"


def guess_mime(name, given):
    if given and given != "application/octet-stream":
        return given.split(";")[0]
    g, _ = mimetypes.guess_type(name or "")
    return g or "application/octet-stream"


def deliver_message(request, msg):
    """Mark delivery state and push a stored message to every member of its chat."""
    chat, sender = msg.chat, msg.sender
    members = list(Membership.objects.filter(chat=chat))
    ids = [m.user_id for m in members]
    if sender:
        Membership.objects.filter(chat=chat, user=sender).update(last_read_id=msg.id, last_delivered_id=msg.id)
    online_others = [uid for uid in ids if (not sender or uid != sender.id) and presence.is_online(uid)]
    if online_others:
        Membership.objects.filter(chat=chat, user_id__in=online_others).update(last_delivered_id=msg.id)
    arch = Membership.objects.filter(chat=chat, archived=True)
    if sender:
        arch = arch.exclude(user=sender)
    arch.update(archived=False)
    msg = Message.objects.select_related("sender", "reply_to", "reply_to__sender").prefetch_related("reactions").get(pk=msg.pk)
    notify_users(ids, {"type": "message", "chat_id": chat.id, "message": message_payload(msg, request)})
    if online_others:
        notify_users(ids, {"type": "delivered", "chat_id": chat.id, "user_ids": online_others, "upto": msg.id})
    return msg


def post_message(request, chat, sender, **fields):
    msg = Message.objects.create(chat=chat, sender=sender, **fields)
    return deliver_message(request, msg)


def get_or_create_direct(a, b, system=False, created_by=None):
    key = f"{min(a.id, b.id)}_{max(a.id, b.id)}"
    chat = Chat.objects.filter(direct_key=key).first()
    if chat:
        return chat, False
    support = system or a.role == "admin" or b.role == "admin"
    chat = Chat.objects.create(kind="direct", direct_key=key, is_support=support, created_by=created_by or a)
    Membership.objects.create(chat=chat, user=a)
    Membership.objects.create(chat=chat, user=b)
    return chat, True


def search_messages(user, q, limit=40, chat_id=None):
    mem = Membership.objects.filter(user=user)
    if chat_id:
        mem = mem.filter(chat_id=chat_id)
    qs = Message.objects.none()
    for m in mem:
        part = (
            Message.objects.filter(chat_id=m.chat_id, id__gt=m.cleared_before_id, deleted=False)
            .filter(Q(body__icontains=q) | Q(file_name__icontains=q))
            .exclude(deletions__user=user)
        )
        qs = qs | part if qs.query.where else part
    return qs.select_related("sender", "chat", "reply_to", "reply_to__sender").prefetch_related("reactions").order_by("-id")[:limit]
