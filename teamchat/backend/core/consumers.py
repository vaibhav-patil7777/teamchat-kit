from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import Max
from django.utils import timezone

from . import presence
from .models import AuthToken, Membership, Message, User


@database_sync_to_async
def _user_for_token(key):
    if not key:
        return None
    tok = AuthToken.objects.select_related("user").filter(key=key).first()
    if tok and tok.user.is_active:
        return {"id": tok.user.id, "name": tok.user.name}
    return None


@database_sync_to_async
def _mark_delivered(uid):
    """Everything waiting for this user counts as delivered once they connect."""
    changed = []
    for m in Membership.objects.filter(user_id=uid):
        last = Message.objects.filter(chat_id=m.chat_id).aggregate(x=Max("id"))["x"] or 0
        if last > m.last_delivered_id:
            m.last_delivered_id = last
            m.save(update_fields=["last_delivered_id"])
            changed.append((m.chat_id, last, list(Membership.objects.filter(chat_id=m.chat_id).values_list("user_id", flat=True))))
    return changed


@database_sync_to_async
def _member_ids(uid, chat_id):
    ids = list(Membership.objects.filter(chat_id=chat_id).values_list("user_id", flat=True))
    return ids if uid in ids else []


@database_sync_to_async
def _mark_read(uid, chat_id, upto):
    m = Membership.objects.filter(chat_id=chat_id, user_id=uid).first()
    if not m:
        return None
    last = Message.objects.filter(chat_id=chat_id).aggregate(x=Max("id"))["x"] or 0
    upto = min(int(upto or last), last)
    if upto > m.last_read_id:
        m.last_read_id, m.last_delivered_id = upto, max(m.last_delivered_id, upto)
        m.save(update_fields=["last_read_id", "last_delivered_id"])
        return upto, list(Membership.objects.filter(chat_id=chat_id).values_list("user_id", flat=True))
    return None


@database_sync_to_async
def _touch_last_seen(uid):
    User.objects.filter(pk=uid).update(last_seen=timezone.now())


class MainConsumer(AsyncJsonWebsocketConsumer):
    user = None

    async def connect(self):
        qs = parse_qs(self.scope.get("query_string", b"").decode())
        user = await _user_for_token((qs.get("token") or [""])[0])
        await self.accept()
        if not user:
            await self.send_json({"type": "error", "error": "auth"})
            await self.close(code=4001)
            return
        self.user = user
        await self.channel_layer.group_add(f"user_{user['id']}", self.channel_name)
        await self.channel_layer.group_add("everyone", self.channel_name)
        first = presence.connect(user["id"])
        await self.send_json({"type": "ready", "online": presence.online_ids()})
        if first:
            await self.channel_layer.group_send("everyone", {"type": "push", "payload": {"type": "presence", "user_id": user["id"], "online": True}})
        for chat_id, upto, ids in await _mark_delivered(user["id"]):
            for uid in ids:
                await self.channel_layer.group_send(
                    f"user_{uid}", {"type": "push", "payload": {"type": "delivered", "chat_id": chat_id, "user_ids": [user["id"]], "upto": upto}}
                )

    async def disconnect(self, code):
        if not self.user:
            return
        uid = self.user["id"]
        await self.channel_layer.group_discard(f"user_{uid}", self.channel_name)
        await self.channel_layer.group_discard("everyone", self.channel_name)
        if presence.disconnect(uid):
            await _touch_last_seen(uid)
            await self.channel_layer.group_send(
                "everyone", {"type": "push", "payload": {"type": "presence", "user_id": uid, "online": False, "last_seen": timezone.now().isoformat()}}
            )

    async def receive_json(self, content, **kwargs):
        if not self.user or not isinstance(content, dict):
            return
        t = content.get("type")
        uid = self.user["id"]
        if t == "ping":
            await self.send_json({"type": "pong"})
        elif t == "typing":
            chat_id = int(content.get("chat_id") or 0)
            for other in await _member_ids(uid, chat_id):
                if other != uid:
                    await self.channel_layer.group_send(
                        f"user_{other}",
                        {"type": "push", "payload": {"type": "typing", "chat_id": chat_id, "user_id": uid, "name": self.user["name"]}},
                    )
        elif t == "read":
            res = await _mark_read(uid, int(content.get("chat_id") or 0), content.get("upto"))
            if res:
                upto, ids = res
                for other in ids:
                    await self.channel_layer.group_send(
                        f"user_{other}",
                        {"type": "push", "payload": {"type": "read", "chat_id": int(content["chat_id"]), "user_id": uid, "upto": upto}},
                    )

    async def push(self, event):
        payload = event["payload"]
        await self.send_json(payload)
        if payload.get("type") == "force_logout":
            await self.close(code=4002)
