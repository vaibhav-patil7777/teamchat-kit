from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone

from .api import ApiError, api, need
from .models import Chat, Membership, Message, Snippet, Ticket, TicketComment, User
from .realtime import broadcast_all, notify_users
from .services import file_url, message_payload, user_brief

STATUSES = [s for s, _ in Ticket.STATUS]
PRIORITIES = [p for p, _ in Ticket.PRIORITY]


def mini(u, request):
    if not u:
        return None
    return {"id": u.id, "name": u.name, "username": u.username, "avatar": file_url(request, u.avatar)}


def ticket_payload(t, request, comments=False):
    d = {
        "id": t.id, "title": t.title, "description": t.description, "status": t.status, "priority": t.priority,
        "created_by": mini(t.created_by, request), "assignee": mini(t.assignee, request),
        "chat_id": t.chat_id, "source_message_id": t.source_message_id,
        "created_at": t.created_at.isoformat(), "updated_at": t.updated_at.isoformat(),
        "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
        "comment_count": getattr(t, "cc", None) if getattr(t, "cc", None) is not None else t.comments.count(),
    }
    if comments:
        d["comments"] = [
            {"id": c.id, "author": mini(c.author, request), "body": c.body, "created_at": c.created_at.isoformat()}
            for c in t.comments.select_related("author").order_by("id")
        ]
    return d


def get_ticket(tid):
    t = Ticket.objects.select_related("created_by", "assignee").filter(pk=tid).first()
    if not t:
        raise ApiError("Ticket not found.", 404, "not_found")
    return t


def can_manage(user, t):
    return user.is_app_admin or t.created_by_id == user.id or t.assignee_id == user.id


@api(methods=["GET", "POST"], feature="tickets")
def tickets(request):
    me = request.user_obj
    if request.method == "GET":
        qs = Ticket.objects.select_related("created_by", "assignee").annotate(cc=Count("comments"))
        counts = {s: Ticket.objects.filter(status=s).count() for s in STATUSES}
        status = request.GET.get("status")
        if status in STATUSES:
            qs = qs.filter(status=status)
        elif status == "active":
            qs = qs.filter(status__in=["open", "in_progress"])
        if request.GET.get("mine"):
            qs = qs.filter(Q(created_by=me) | Q(assignee=me))
        q = (request.GET.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(description__icontains=q))
        order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
        items = sorted(qs.order_by("-updated_at")[:300], key=lambda t: (t.status in ("resolved", "closed"), order.get(t.priority, 2)))
        return JsonResponse({"tickets": [ticket_payload(t, request) for t in items], "counts": counts})

    d = request.data
    title = need(d, "title", "Title", 160)
    priority = d.get("priority") if d.get("priority") in PRIORITIES else "medium"
    assignee = None
    if d.get("assignee_id"):
        assignee = User.objects.filter(pk=d["assignee_id"], is_active=True).first()
        if not assignee:
            raise ApiError("Assignee not found.", 404, "not_found")
    chat = msg = None
    if d.get("message_id"):
        msg = Message.objects.select_related("chat").filter(pk=d["message_id"]).first()
        if not msg or not Membership.objects.filter(chat=msg.chat, user=me).exists():
            raise ApiError("Message not found.", 404, "not_found")
        chat = msg.chat
    t = Ticket.objects.create(
        title=title, description=(d.get("description") or "")[:5000], priority=priority, created_by=me,
        assignee=assignee, chat=chat, source_message=msg,
    )
    if chat:
        sm = Message.objects.create(chat=chat, sender=None, kind="system", body=f"{me.name} created ticket #{t.id}: {title}")
        ids = list(Membership.objects.filter(chat=chat).values_list("user_id", flat=True))
        notify_users(ids, {"type": "message", "chat_id": chat.id, "message": message_payload(sm, request)})
    broadcast_all({"type": "ticket", "ticket_id": t.id, "event": "created", "by": me.id, "assignee_id": assignee.id if assignee else None, "title": title})
    return JsonResponse({"ticket": ticket_payload(t, request, comments=True)}, status=201)


@api(methods=["GET", "PATCH", "DELETE"], feature="tickets")
def ticket_detail(request, ticket_id):
    me = request.user_obj
    t = get_ticket(ticket_id)
    if request.method == "GET":
        return JsonResponse({"ticket": ticket_payload(t, request, comments=True)})
    if request.method == "DELETE":
        if not me.is_app_admin:
            raise ApiError("Only the admin can delete tickets.", 403, "forbidden")
        t.delete()
        broadcast_all({"type": "ticket", "ticket_id": ticket_id, "event": "deleted", "by": me.id})
        return JsonResponse({"ok": True})
    if not can_manage(me, t):
        raise ApiError("Only the creator, the assignee or the admin can change this ticket.", 403, "forbidden")
    d = request.data
    if "title" in d:
        t.title = need(d, "title", "Title", 160)
    if "description" in d:
        t.description = (d["description"] or "")[:5000]
    if d.get("priority") in PRIORITIES:
        t.priority = d["priority"]
    if "assignee_id" in d:
        t.assignee = User.objects.filter(pk=d["assignee_id"], is_active=True).first() if d["assignee_id"] else None
    if d.get("status") in STATUSES and d["status"] != t.status:
        t.status = d["status"]
        t.resolved_at = timezone.now() if t.status in ("resolved", "closed") else None
    t.updated_at = timezone.now()
    t.save()
    broadcast_all({"type": "ticket", "ticket_id": t.id, "event": "updated", "by": me.id, "assignee_id": t.assignee_id, "title": t.title, "status": t.status})
    return JsonResponse({"ticket": ticket_payload(t, request, comments=True)})


@api(methods=["POST"], feature="tickets")
def ticket_comment(request, ticket_id):
    t = get_ticket(ticket_id)
    body = need(request.data, "body", "Comment", 4000)
    TicketComment.objects.create(ticket=t, author=request.user_obj, body=body)
    t.updated_at = timezone.now()
    t.save(update_fields=["updated_at"])
    broadcast_all({"type": "ticket", "ticket_id": t.id, "event": "comment", "by": request.user_obj.id, "assignee_id": t.assignee_id, "title": t.title})
    return JsonResponse({"ticket": ticket_payload(t, request, comments=True)}, status=201)


# ---------------------------------------------------------------- quick replies

@api(methods=["GET", "POST"])
def snippets(request):
    me = request.user_obj
    if request.method == "POST":
        import re

        sc = need(request.data, "shortcut", "Shortcut", 30).lstrip("/").lower()
        if not re.fullmatch(r"[a-z0-9_-]{1,30}", sc):
            raise ApiError("Shortcut may contain letters, numbers, - and _ only.", 400, "bad_shortcut")
        text = need(request.data, "text", "Text", 2000)
        obj, _ = Snippet.objects.update_or_create(user=me, shortcut=sc, defaults={"text": text})
    items = [{"id": s.id, "shortcut": s.shortcut, "text": s.text} for s in Snippet.objects.filter(user=me).order_by("shortcut")]
    return JsonResponse({"snippets": items})


@api(methods=["DELETE"])
def snippet_delete(request, snippet_id):
    Snippet.objects.filter(pk=snippet_id, user=request.user_obj).delete()
    return JsonResponse({"ok": True})
