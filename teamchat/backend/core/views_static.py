"""Serve the frontend folder (handy for local use). On Netlify the frontend is hosted separately."""
from django.conf import settings
from django.http import Http404
from django.views.static import serve


def frontend(request, path=""):
    root = settings.FRONTEND_DIR
    if not settings.SERVE_FRONTEND or not root.exists():
        raise Http404()
    path = path.strip("/") or "index.html"
    if not (root / path).is_file():
        path = "index.html"
    resp = serve(request, path, document_root=str(root))
    if path in ("sw.js", "index.html") or path.startswith("js/") or path.startswith("css/"):
        resp["Cache-Control"] = "no-cache"
    return resp
