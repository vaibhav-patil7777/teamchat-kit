import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


def upload_path(instance, filename):
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[1][:10].lower()
    d = timezone.now().strftime("%Y/%m")
    return f"uploads/{d}/{uuid.uuid4().hex}{ext}"


def avatar_path(instance, filename):
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[1][:6].lower()
    return f"avatars/{uuid.uuid4().hex}{ext}"


class PermissionTemplate(models.Model):
    """A named bundle of feature flags (a 'role template')."""

    name = models.CharField(max_length=60, unique=True)
    description = models.CharField(max_length=200, blank=True)
    flags = models.JSONField(default=dict)

    def __str__(self):
        return self.name


class User(AbstractUser):
    ROLE_CHOICES = [("admin", "Admin"), ("member", "Member")]

    display_name = models.CharField(max_length=100, blank=True)
    avatar = models.FileField(upload_to=avatar_path, null=True, blank=True)
    about = models.CharField(max_length=200, blank=True, default="Hey there! I am using TeamChat.")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="member")
    department = models.CharField(max_length=80, blank=True)
    designation = models.CharField(max_length=80, blank=True)
    must_change_password = models.BooleanField(default=False)
    using_default_password = models.BooleanField(default=False)
    template = models.ForeignKey(PermissionTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="users")
    feature_overrides = models.JSONField(default=dict, blank=True)
    prefs = models.JSONField(default=dict, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    failed_logins = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="created_users")

    @property
    def name(self):
        return self.display_name or self.username

    @property
    def is_app_admin(self):
        return self.role == "admin"


class AuthToken(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tokens")
    device = models.CharField(max_length=120, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_used = models.DateTimeField(default=timezone.now)


class LoginEvent(models.Model):
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, related_name="login_events")
    username_tried = models.CharField(max_length=150, blank=True)
    success = models.BooleanField(default=False)
    reason = models.CharField(max_length=60, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_entries")
    action = models.CharField(max_length=60)
    target = models.CharField(max_length=200, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)


class AppSettings(models.Model):
    app_name = models.CharField(max_length=60, default="TeamChat")
    max_upload_mb = models.PositiveIntegerField(default=100)
    welcome_message = models.CharField(max_length=300, blank=True, default="")

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Chat(models.Model):
    KIND_CHOICES = [("direct", "Direct"), ("group", "Group")]

    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    name = models.CharField(max_length=80, blank=True)
    description = models.CharField(max_length=300, blank=True)
    avatar = models.FileField(upload_to=avatar_path, null=True, blank=True)
    is_support = models.BooleanField(default=False)  # user <-> admin pinned chat
    only_admins_post = models.BooleanField(default=False)
    direct_key = models.CharField(max_length=40, null=True, blank=True, unique=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="chats_created")
    created_at = models.DateTimeField(default=timezone.now)


class Membership(models.Model):
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    is_admin = models.BooleanField(default=False)
    muted = models.BooleanField(default=False)
    pinned = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)
    last_read_id = models.BigIntegerField(default=0)
    last_delivered_id = models.BigIntegerField(default=0)
    cleared_before_id = models.BigIntegerField(default=0)
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("chat", "user")]


class Message(models.Model):
    KIND_CHOICES = [("text", "Text"), ("image", "Image"), ("video", "Video"), ("audio", "Audio"), ("file", "File"), ("system", "System")]

    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="messages_sent")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default="text")
    body = models.TextField(blank=True)
    reply_to = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies")
    forwarded = models.BooleanField(default=False)
    file = models.FileField(upload_to=upload_path, null=True, blank=True, max_length=300)
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.BigIntegerField(default=0)
    mime = models.CharField(max_length=120, blank=True)
    duration = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted = models.BooleanField(default=False)
    bot_name = models.CharField(max_length=60, blank=True)  # set for webhook / bot messages

    class Meta:
        indexes = [models.Index(fields=["chat", "id"])]


class MessageDeletion(models.Model):
    """'Delete for me'."""

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="deletions")

    class Meta:
        unique_together = [("user", "message")]


class Reaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    emoji = models.CharField(max_length=16)

    class Meta:
        unique_together = [("message", "user")]


class Star(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="stars")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="stars")

    class Meta:
        unique_together = [("user", "message")]


class Ticket(models.Model):
    STATUS = [("open", "Open"), ("in_progress", "In progress"), ("resolved", "Resolved"), ("closed", "Closed")]
    PRIORITY = [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("urgent", "Urgent")]

    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=STATUS, default="open", db_index=True)
    priority = models.CharField(max_length=8, choices=PRIORITY, default="medium")
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="tickets_created")
    assignee = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets_assigned")
    chat = models.ForeignKey(Chat, null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets")
    source_message = models.ForeignKey(Message, null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True, blank=True)


class TicketComment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    body = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)


class Snippet(models.Model):
    """Quick reply: type /shortcut in a chat to insert the text."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="snippets")
    shortcut = models.CharField(max_length=30)
    text = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "shortcut")]


class Poll(models.Model):
    message = models.OneToOneField(Message, on_delete=models.CASCADE, related_name="poll")
    question = models.CharField(max_length=300)
    multiple = models.BooleanField(default=False)
    closed = models.BooleanField(default=False)


class PollOption(models.Model):
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name="options")
    text = models.CharField(max_length=200)
    position = models.PositiveSmallIntegerField(default=0)


class PollVote(models.Model):
    option = models.ForeignKey(PollOption, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(User, on_delete=models.CASCADE)

    class Meta:
        unique_together = [("option", "user")]


class ScheduledMessage(models.Model):
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="scheduled")
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="scheduled_messages")
    body = models.TextField()
    send_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=10, default="pending", db_index=True)  # pending / sent / cancelled / failed
    created_at = models.DateTimeField(default=timezone.now)


class Status(models.Model):
    """24-hour status / story."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="statuses")
    kind = models.CharField(max_length=8, default="text")  # text / image / video
    text = models.TextField(blank=True)
    bg = models.CharField(max_length=16, blank=True)
    file = models.FileField(upload_to=upload_path, null=True, blank=True, max_length=300)
    mime = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    expires_at = models.DateTimeField(db_index=True)


class StatusView(models.Model):
    status = models.ForeignKey(Status, on_delete=models.CASCADE, related_name="views")
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("status", "user")]


class Webhook(models.Model):
    """Incoming webhook: external tools (CI, monitoring) can post into a group."""

    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="webhooks")
    name = models.CharField(max_length=60)
    token = models.CharField(max_length=64, unique=True)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(default=timezone.now)
