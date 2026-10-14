"""Polls, scheduled messages, status/stories, incoming webhooks."""
import secrets
from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .api import ApiError, api, audit, need
from .models import (AppSettings, Chat, Membership, Message, Poll, PollOption, PollVote, ScheduledMessage, Status, StatusView, Webhook)
from .realtime import notify_users
from .services import deliver_message, file_url, guess_mime, message_payload, poll_payload, user_brief
from .views_chat import get_member, member_ids

BG_COLORS = ["#128c7e", "#0a84c6", "#7048e8", "#d6336c", "#e8590c", "#2e7d32", "#364fc7", "#c92a2a"]


def can_post(m, user):
    c = m.chat
    return not (c.kind == "group" and c.only_admins_post and not (m.is_admin or user.is_app_admin))


# ------------------------------------------------------------------ polls

@api(methods=["POST"], feature="polls")
def poll_create(request, chat_id):
    m = get_member(request, chat_id)
    me = request.user_obj
    if not can_post(m, me):
        raise ApiError("Only admins can send messages in this group.", 403, "admins_only")
    question = need(request.data, "question", "Question", 300)
    raw = request.data.get("options") or []
    opts, seen = [], set()
    for o in raw:
        o = str(o).strip()[:200]
        if o and o.lower() not in seen:
            seen.add(o.lower())
            opts.append(o)
    if not 2 <= len(opts) <= 10:
        raise ApiError("A poll needs 2 to 10 different options.", 400, "bad_poll")
    msg = Message.objects.create(chat=m.chat, sender=me, kind="poll", body=question)
    poll = Poll.objects.create(message=msg, question=question, multiple=bool(request.data.get("multiple")))
    for i, o in enumerate(opts):
        PollOption.objects.create(poll=poll, text=o, position=i)
    msg = deliver_message(request, msg)
    return JsonResponse({"message": message_payload(msg, request)}, status=201)


def get_poll(request, poll_id):
    poll = Poll.objects.select_related("message", "message__chat").filter(pk=poll_id).first()
    if not poll or not Membership.objects.filter(chat=poll.message.chat, user=request.user_obj).exists():
        raise ApiError("Poll not found.", 404, "not_found")
    return poll


def push_poll(poll):
    notify_users(member_ids(poll.message.chat), {"type": "poll", "chat_id": poll.message.chat_id, "message_id": poll.message_id, "poll": poll_payload(poll)})


@api(methods=["POST"])
def poll_vote(request, poll_id):
    poll = get_poll(request, poll_id)
    if poll.closed:
        raise ApiError("This poll is closed.", 400, "poll_closed")
    ids = [int(x) for x in (request.data.get("option_ids") or []) if str(x).isdigit()]
    valid = list(poll.options.filter(pk__in=ids).values_list("pk", flat=True))
    if not poll.multiple:
        valid = valid[:1]
    PollVote.objects.filter(option__poll=poll, user=request.user_obj).delete()
    for oid in valid:
        PollVote.objects.create(option_id=oid, user=request.user_obj)
    push_poll(poll)
    return JsonResponse({"poll": poll_payload(poll)})


@api(methods=["POST"])
def poll_close(request, poll_id):
    poll = get_poll(request, poll_id)
    if poll.message.sender_id != request.user_obj.id and not request.user_obj.is_app_admin:
        raise ApiError("Only the poll creator or the admin can close it.", 403, "forbidden")
    poll.closed = True
    poll.save(update_fields=["closed"])
    push_poll(poll)
    return JsonResponse({"poll": poll_payload(poll)})


# ------------------------------------------------------------------ scheduled messages

def sched_payload(s):
    return {"id": s.id, "chat_id": s.chat_id, "chat_name": s.chat.name or "", "body": s.body, "send_at": s.send_at.isoformat(), "status": s.status}


@api(methods=["GET", "POST"], feature="schedule_messages")
def scheduled(request):
    me = request.user_obj
    if request.method == "POST":
        m = get_member(request, int(request.data.get("chat_id") or 0))
        if not can_post(m, me):
            raise ApiError("Only admins can send messages in this group.", 403, "admins_only")
        body = need(request.data, "body", "Message", 4000)
        when = parse_datetime(str(request.data.get("send_at") or ""))
        if not when:
            raise ApiError("Choose a valid date and time.", 400, "bad_time")
        if timezone.is_naive(when):
            when = timezone.make_aware(when, timezone.utc)
        now = timezone.now()
        if when < now + timedelta(seconds=5) or when > now + timedelta(days=366):
            raise ApiError("Pick a time between now and one year from now.", 400, "bad_time")
        ScheduledMessage.objects.create(chat=m.chat, sender=me, body=body, send_at=when)
    qs = ScheduledMessage.objects.filter(sender=me, status="pending").select_related("chat").order_by("send_at")
    if request.GET.get("chat_id"):
        qs = qs.filter(chat_id=int(request.GET["chat_id"]))
    return JsonResponse({"scheduled": [sched_payload(s) for s in qs]})


@api(methods=["DELETE"])
def scheduled_delete(request, sid):
    ScheduledMessage.objects.filter(pk=sid, sender=request.user_obj, status="pending").update(status="cancelled")
    return JsonResponse({"ok": True})


def run_due_scheduled():
    """Called by the background scheduler. Sends every due scheduled message exactly once."""
    from .services import post_message

    sent = 0
    for s in ScheduledMessage.objects.filter(status="pending", send_at__lte=timezone.now()).select_related("chat", "sender"):
        if ScheduledMessage.objects.filter(pk=s.pk, status="pending").update(status="sent") != 1:
            continue  # someone else claimed it
        m = Membership.objects.filter(chat=s.chat, user=s.sender).first()
        if not m or not s.sender.is_active or not can_post(m, s.sender):
            ScheduledMessage.objects.filter(pk=s.pk).update(status="failed")
            continue
        post_message(None, s.chat, s.sender, kind="text", body=s.body)
        sent += 1
    return sent


def cleanup_expired_status():
    old = Status.objects.filter(expires_at__lt=timezone.now() - timedelta(days=1))
    for st in old:
        if st.file:
            try:
                st.file.storage.delete(st.file.name)
            except Exception:
                pass
    old.delete()


# ------------------------------------------------------------------ status / stories

def status_item(st, me, request):
    return {
        "id": st.id, "kind": st.kind, "text": st.text, "bg": st.bg,
        "file": file_url(request, st.file) if st.file else None,
        "created_at": st.created_at.isoformat(), "expires_at": st.expires_at.isoformat(),
        "seen": st.user_id == me.id or getattr(st, "seen_by_me", False),
        "views": st.views.count() if st.user_id == me.id else None,
    }


@api(methods=["GET", "POST"], feature="status")
def status_list(request):
    me = request.user_obj
    if request.method == "POST":
        text = (request.data.get("text") or "").strip()[:700]
        up = request.FILES.get("file")
        bg = request.data.get("bg") if request.data.get("bg") in BG_COLORS else BG_COLORS[0]
        if up:
            mime = guess_mime(up.name, up.content_type)
            if not (mime.startswith("image/") and mime != "image/svg+xml") and not mime.startswith("video/"):
                raise ApiError("Status supports photos and videos only.", 400, "bad_file")
            if up.size > AppSettings.get().max_upload_mb * 1024 * 1024:
                raise ApiError("File is too large.", 413, "file_too_large")
            st = Status(user=me, kind="video" if mime.startswith("video/") else "image", text=text, file=up, mime=mime)
        else:
            if not text:
                raise ApiError("Write something or choose a photo.", 400, "required")
            st = Status(user=me, kind="text", text=text, bg=bg)
        st.expires_at = timezone.now() + timedelta(hours=24)
        st.save()
    now = timezone.now()
    seen_ids = set(StatusView.objects.filter(user=me).values_list("status_id", flat=True))
    groups = {}
    for st in Status.objects.filter(expires_at__gt=now, user__is_active=True).select_related("user").order_by("created_at"):
        st.seen_by_me = st.id in seen_ids
        g = groups.setdefault(st.user_id, {"user": user_brief(st.user, request), "items": []})
        g["items"].append(status_item(st, me, request))
    out = []
    for uid, g in groups.items():
        g["all_seen"] = all(i["seen"] for i in g["items"])
        g["latest"] = g["items"][-1]["created_at"]
        out.append(g)
    mine = groups.pop(me.id, None)
    out = [g for g in out if g["user"]["id"] != me.id]
    out.sort(key=lambda g: (g["all_seen"], ""), reverse=False)
    out.sort(key=lambda g: g["latest"], reverse=True)
    out.sort(key=lambda g: g["all_seen"])
    return JsonResponse({"mine": mine["items"] if mine else [], "others": out}, status=201 if request.method == "POST" else 200)


@api(methods=["POST"])
def status_view(request, sid):
    st = Status.objects.filter(pk=sid, expires_at__gt=timezone.now()).first()
    if not st:
        raise ApiError("Status not found.", 404, "not_found")
    if st.user_id != request.user_obj.id:
        StatusView.objects.get_or_create(status=st, user=request.user_obj)
    return JsonResponse({"ok": True})


@api(methods=["GET"])
def status_viewers(request, sid):
    st = Status.objects.filter(pk=sid).first()
    if not st or (st.user_id != request.user_obj.id and not request.user_obj.is_app_admin):
        raise ApiError("Status not found.", 404, "not_found")
    return JsonResponse({"viewers": [{"user": user_brief(v.user, request), "at": v.created_at.isoformat()} for v in st.views.select_related("user").order_by("-created_at")]})


@api(methods=["DELETE"])
def status_delete(request, sid):
    st = Status.objects.filter(pk=sid).first()
    if not st or (st.user_id != request.user_obj.id and not request.user_obj.is_app_admin):
        raise ApiError("Status not found.", 404, "not_found")
    if st.file:
        try:
            st.file.storage.delete(st.file.name)
        except Exception:
            pass
    st.delete()
    return JsonResponse({"ok": True})


# ------------------------------------------------------------------ webhooks

def hook_payload(w):
    return {"id": w.id, "name": w.name, "chat_id": w.chat_id, "chat_name": w.chat.name, "token": w.token, "active": w.active, "created_at": w.created_at.isoformat()}


@api(methods=["GET", "POST"], admin=True)
def webhooks(request):
    if request.method == "POST":
        chat = Chat.objects.filter(pk=int(request.data.get("chat_id") or 0), kind="group").first()
        if not chat:
            raise ApiError("Choose a group.", 400, "required")
        name = need(request.data, "name", "Name", 60)
        w = Webhook.objects.create(chat=chat, name=name, token=secrets.token_urlsafe(30), created_by=request.user_obj)
        audit(request.user_obj, "webhook_created", chat.name, name=name)
    return JsonResponse({"webhooks": [hook_payload(w) for w in Webhook.objects.select_related("chat").order_by("-created_at")]})


@api(methods=["DELETE"], admin=True)
def webhook_delete(request, hook_id):
    w = Webhook.objects.filter(pk=hook_id).first()
    if w:
        audit(request.user_obj, "webhook_deleted", w.chat.name, name=w.name)
        w.delete()
    return JsonResponse({"ok": True})


@api(methods=["POST"], auth=False)
def hook_receive(request, token):
    """Public endpoint: POST {"text": "...", "title": "optional"} -> message in the group."""
    w = Webhook.objects.select_related("chat").filter(token=token, active=True).first()
    if not w:
        raise ApiError("Unknown webhook.", 404, "not_found")
    text = str(request.data.get("text") or request.data.get("message") or "").strip()
    if not text:
        raise ApiError("'text' is required.", 400, "required")
    title = str(request.data.get("title") or "").strip()
    body = ((title + "\n") if title else "") + text
    msg = Message.objects.create(chat=w.chat, sender=None, kind="text", body=body[:4000], bot_name=w.name)
    deliver_message(None, msg)
    return JsonResponse({"ok": True, "message_id": msg.id}, status=201)
