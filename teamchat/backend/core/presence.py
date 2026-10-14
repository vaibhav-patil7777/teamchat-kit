"""Process-local online presence (fine for a single server process)."""
from collections import defaultdict

_online = defaultdict(int)


def connect(user_id):
    _online[user_id] += 1
    return _online[user_id] == 1


def disconnect(user_id):
    if _online[user_id] > 0:
        _online[user_id] -= 1
    if _online[user_id] == 0:
        _online.pop(user_id, None)
        return True
    return False


def is_online(user_id):
    return _online.get(user_id, 0) > 0


def online_ids():
    return [uid for uid, n in _online.items() if n > 0]
