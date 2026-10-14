from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def notify_users(user_ids, payload):
    """Push a JSON payload to every open socket of the given users (sync context)."""
    layer = get_channel_layer()
    send = async_to_sync(layer.group_send)
    for uid in set(user_ids):
        send(f"user_{uid}", {"type": "push", "payload": payload})


def broadcast_all(payload):
    layer = get_channel_layer()
    async_to_sync(layer.group_send)("everyone", {"type": "push", "payload": payload})
