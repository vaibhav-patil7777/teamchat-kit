"""Tiny JSON-API helpers (no DRF)."""
import json
from datetime import timedelta
from functools import wraps

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .features import effective_features
from .models import AuthToken, AuditLog


class ApiError(Exception):
    def __init__(self, message, status=400, code="error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def client_ip(request):
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def authenticate(request):
    header = request.META.get("HTTP_AUTHORIZATION", "")
    key = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not key:
        return None, None
    try:
        tok = AuthToken.objects.select_related("user", "user__template").get(key=key)
    except AuthToken.DoesNotExist:
        return None, None
    if not tok.user.is_active:
        return None, None
    now = timezone.now()
    if now - tok.last_used > timedelta(minutes=2):
        AuthToken.objects.filter(pk=tok.pk).update(last_used=now)
    return tok.user, tok


def api(methods=("GET",), auth=True, admin=False, feature=None):
    def deco(fn):
        @csrf_exempt
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            if request.method not in methods:
                return JsonResponse({"error": "Method not allowed", "code": "method"}, status=405)
            request.user_obj = None
            request.token = None
            if auth:
                user, tok = authenticate(request)
                if not user:
                    return JsonResponse({"error": "Please sign in.", "code": "unauthorized"}, status=401)
                request.user_obj, request.token = user, tok
                if admin and not user.is_app_admin:
                    return JsonResponse({"error": "Admin access required.", "code": "forbidden"}, status=403)
                if feature and not effective_features(user).get(feature, False):
                    return JsonResponse(
                        {"error": "This feature is disabled for your account.", "code": "feature_disabled", "feature": feature},
                        status=403,
                    )
            request.data = {}
            if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.body:
                ctype = request.META.get("CONTENT_TYPE", "")
                if "application/json" in ctype:
                    try:
                        request.data = json.loads(request.body.decode("utf-8")) or {}
                    except (ValueError, UnicodeDecodeError):
                        return JsonResponse({"error": "Invalid JSON.", "code": "bad_json"}, status=400)
                else:
                    request.data = request.POST
            elif request.method == "POST":
                request.data = request.POST
            try:
                return fn(request, *args, **kwargs)
            except ApiError as e:
                return JsonResponse({"error": e.message, "code": e.code}, status=e.status)

        return wrapper

    return deco


def audit(actor, action, target="", **details):
    AuditLog.objects.create(actor=actor, action=action, target=str(target)[:200], details=details)


def need(data, key, label=None, max_len=None):
    v = data.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        raise ApiError(f"{label or key} is required.", 400, "required")
    if isinstance(v, str):
        v = v.strip()
        if max_len and len(v) > max_len:
            raise ApiError(f"{label or key} is too long (max {max_len}).", 400, "too_long")
    return v
