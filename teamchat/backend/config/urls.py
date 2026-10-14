from django.urls import path, re_path

from core import views_admin as A
from core import views_auth as U
from core import views_chat as C
from core import views_tickets as TK
from core import views_extra as X
from core.views_static import frontend

urlpatterns = [
    path("api/health", U.health),
    path("api/public", U.public_info),
    # auth & profile
    path("api/auth/login", U.login),
    path("api/auth/logout", U.logout),
    path("api/auth/change-password", U.change_password),
    path("api/me", U.me),
    path("api/me/avatar", U.me_avatar),
    path("api/me/avatar/remove", U.me_avatar_remove),
    path("api/me/devices", U.devices),
    path("api/me/devices/<str:device_id>", U.device_revoke),
    path("api/users", U.users_directory),
    path("api/presence", U.presence_list),
    # chats
    path("api/chats", C.chats_list),
    path("api/chats/direct", C.chat_direct),
    path("api/chats/group", C.chat_group_create),
    path("api/chats/<int:chat_id>", C.chat_detail),
    path("api/chats/<int:chat_id>/avatar", C.chat_avatar),
    path("api/chats/<int:chat_id>/members", C.chat_members_add),
    path("api/chats/<int:chat_id>/members/<int:user_id>", C.chat_member_remove),
    path("api/chats/<int:chat_id>/members/<int:user_id>/admin", C.chat_member_admin),
    path("api/chats/<int:chat_id>/settings", C.chat_settings),
    path("api/chats/<int:chat_id>/read", C.chat_read),
    path("api/chats/<int:chat_id>/clear", C.chat_clear),
    path("api/chats/<int:chat_id>/messages", C.messages),
    path("api/chats/<int:chat_id>/media", C.chat_media),
    path("api/chats/<int:chat_id>/export", C.chat_export),
    path("api/messages/forward", C.message_forward),
    path("api/messages/<int:message_id>", C.message_detail),
    path("api/messages/<int:message_id>/react", C.message_react),
    path("api/messages/<int:message_id>/star", C.message_star),
    path("api/starred", C.starred_list),
    path("api/search", C.search),
    # polls, scheduled messages, status, webhooks
    path("api/chats/<int:chat_id>/polls", X.poll_create),
    path("api/polls/<int:poll_id>/vote", X.poll_vote),
    path("api/polls/<int:poll_id>/close", X.poll_close),
    path("api/scheduled", X.scheduled),
    path("api/scheduled/<int:sid>", X.scheduled_delete),
    path("api/status", X.status_list),
    path("api/status/<int:sid>/view", X.status_view),
    path("api/status/<int:sid>/viewers", X.status_viewers),
    path("api/status/<int:sid>", X.status_delete),
    path("api/admin/webhooks", X.webhooks),
    path("api/admin/webhooks/<int:hook_id>", X.webhook_delete),
    path("api/hooks/<str:token>", X.hook_receive),
    # tickets + quick replies
    path("api/tickets", TK.tickets),
    path("api/tickets/<int:ticket_id>", TK.ticket_detail),
    path("api/tickets/<int:ticket_id>/comments", TK.ticket_comment),
    path("api/snippets", TK.snippets),
    path("api/snippets/<int:snippet_id>", TK.snippet_delete),
    # admin
    path("api/admin/stats", A.stats),
    path("api/admin/users", A.users),
    path("api/admin/users/<int:user_id>", A.user_detail),
    path("api/admin/users/<int:user_id>/reset-password", A.user_reset_password),
    path("api/admin/users/<int:user_id>/sign-out", A.user_sign_out),
    path("api/admin/users/<int:user_id>/devices/<str:device_id>", A.user_device_revoke),
    path("api/admin/templates", A.templates),
    path("api/admin/templates/<int:template_id>", A.template_detail),
    path("api/admin/groups", A.groups),
    path("api/admin/groups/<int:chat_id>", A.group_detail),
    path("api/admin/groups/<int:chat_id>/members", A.group_member_add),
    path("api/admin/groups/<int:chat_id>/members/<int:user_id>", A.group_member_remove),
    path("api/admin/audit", A.audit_log),
    path("api/admin/settings", A.app_settings),
    path("api/admin/storage", A.storage),
    path("api/admin/announce", A.announce),
    # media + frontend
    re_path(r"^media/(?P<path>.+)$", U.media),
    re_path(r"^(?P<path>.*)$", frontend),
]
