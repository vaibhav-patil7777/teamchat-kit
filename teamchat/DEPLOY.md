# Free hosting guide: Neon (database) + Render (backend) + Netlify (frontend)

| Part | Where | Cost |
|---|---|---|
| Frontend + PWA (`frontend/`) | Netlify | free |
| Backend + WebSocket (`backend/`) | Render web service | free |
| Database | Neon Postgres | free |
| Uploaded files | S3-compatible storage (Cloudflare R2 / Backblaze B2) | free tier |

Free plans change often. Check the current limits on each site before you rely on them.

## Know these limits first

- **Render free** spins down after about 15 minutes without traffic and takes about a minute to wake up. It has no
  permanent disk, so uploaded files must go to external storage (step 4). It may also restart at any time. The app
  reconnects by itself.
- **Neon free** pauses its compute when idle and has a monthly compute-hours limit and small storage. Keep the
  keep-alive ping (step 5) away from the database so it does not use up your hours.
- This is "free, best effort". It is fine for a small team. For critical use, move to a paid Render plan or a VPS.

## 1. Database: Neon

1. Create a project at https://neon.com and copy the connection string
   (`postgresql://user:password@host/db?sslmode=require`).

## 2. Backend: Render

1. Push this project to GitHub.
2. Render dashboard: **New > Blueprint** and pick the repo (it reads `render.yaml`), or **New > Web Service** with
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt && python manage.py collectstatic --noinput`
   - Start command: `python manage.py migrate && python manage.py create_admin --if-missing && daphne -b 0.0.0.0 -p $PORT config.asgi:application`
3. Environment variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | your Neon connection string |
| `SECRET_KEY` | a long random string |
| `DEBUG` | `0` |
| `ADMIN_USERNAME` | `Vaibhav777` |
| `ADMIN_PASSWORD` | **a new strong password** (do not keep the one from this chat) |
| `SERVE_FRONTEND` | `0` |
| `CORS_ORIGINS` | your Netlify URL (add after step 3) |

4. After deploy open `https://YOUR-SERVICE.onrender.com/api/health`. You should see `{"ok": true}`.

The admin account is created on first start from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## 3. Frontend: Netlify

1. Edit `frontend/js/config.js`:

```js
const PROD = {
  API_BASE: "https://YOUR-SERVICE.onrender.com/api",
  WS_URL:   "wss://YOUR-SERVICE.onrender.com/ws/"
};
```

2. Go to https://app.netlify.com/drop and drag the **`frontend`** folder in (or connect the repo with publish directory `frontend`).
3. Copy the Netlify URL into the `CORS_ORIGINS` variable on Render, then redeploy.

## 4. File storage (needed on Render)

Without this, uploaded photos and files disappear when Render restarts.

1. Create a bucket on Cloudflare R2 or Backblaze B2 and get the S3 access key, secret and endpoint.
2. Use `requirements-s3.txt` as the install file (Render build command: `pip install -r requirements-s3.txt ...`).
3. Add these variables on Render:

| Name | Value |
|---|---|
| `S3_BUCKET` | bucket name |
| `S3_ENDPOINT_URL` | the S3 endpoint URL of your provider |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | your keys |
| `S3_REGION` | `auto` (R2) or your region |
| `S3_PUBLIC_BASE_URL` | optional public domain of the bucket (then links are permanent) |

This S3 path is written but I have not run it against a real bucket. Test an upload right after setting it up.

## 5. Keep the free server awake (optional)

Use a free uptime monitor (for example UptimeRobot) to call `https://YOUR-SERVICE.onrender.com/api/health` every
10 to 14 minutes. That endpoint does not touch the database. Check Render's current rules about pings first.

## 6. Install on phones (PWA)

PWA install needs HTTPS, which Netlify gives you.
- **Android Chrome:** open the Netlify URL, menu, **Install app**
- **iPhone Safari:** Share, **Add to Home Screen**
- **Windows / Mac Chrome or Edge:** install icon in the address bar

## Security checklist before real use

- Change the admin password. The default is written in this project and in the chat where you shared it.
- Set `CORS_ORIGINS` to your Netlify URL only.
- Uploaded files use long random names. Anyone who has a link can open it, so do not share links outside the team.
- There is no end-to-end encryption. Traffic is protected by HTTPS / WSS.
- Single server process: the in-memory channel layer works for one Render instance. For more instances set `REDIS_URL`
  and `pip install channels-redis`.
