"""Feature flags that an admin can switch ON/OFF per user (or via a role template)."""

FEATURES = [
    "chat_direct",      # start one-to-one chats with other users
    "create_groups",    # create groups
    "send_files",       # share photos, videos, documents
    "voice_notes",      # record and send voice notes
    "reactions",        # emoji reactions
    "reply_forward",    # reply to and forward messages
    "edit_messages",    # edit own messages
    "delete_messages",  # delete own messages (for me / for everyone)
    "star_messages",    # star / bookmark messages
    "search",           # global search
    "tickets",          # create and track support tickets
    "polls",            # create polls in chats
    "schedule_messages",# schedule messages to be sent later
    "status",           # post status / stories
    "export_chat",      # export chat history
    "change_profile",   # change name, photo, about
    "change_theme",     # change theme, font, wallpaper
]

DEFAULT_FLAGS = {k: True for k in FEATURES}


def effective_features(user):
    if user.role == "admin":
        return dict(DEFAULT_FLAGS)
    flags = dict(DEFAULT_FLAGS)
    if user.template_id:
        for k, v in (user.template.flags or {}).items():
            if k in flags:
                flags[k] = bool(v)
    for k, v in (user.feature_overrides or {}).items():
        if k in flags:
            flags[k] = bool(v)
    return flags
