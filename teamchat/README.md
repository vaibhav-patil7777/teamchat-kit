# TeamChat: admin-managed team messaging (Django + Channels + PWA)

Real-time team chat where **only the admin creates accounts**. Users cannot register themselves.
Works as a website and as an installable app (PWA) on phone and desktop.
English, Hindi and Marathi.

## What is built (v1)

**Access control**
- Sign-in only. No public registration. The admin creates each user and hands over the username and password.
- Admin sign-in is created automatically: username `Vaibhav777`, password `Vaibhav@1455` (change it after first sign-in).
- Admin can reset a password or change a username. The user is signed out instantly and signs in with the new details.
- Disable / enable / delete accounts (disabled users are signed out immediately).
- Account lock after 5 wrong passwords (10 minutes). Admin can unlock.
- Optional "must change password at first sign-in".
- Signed-in devices list. User or admin can sign out any device.
- Every user has a pinned **Admin** chat to message the admin at any time.

**Admin panel** (`#/admin`)
- Dashboard with live counters, 14-day chart, top users, recent sign-ins
- Users: create (auto-generated password), search, filter, edit, reset password, disable, delete
- **Permissions:** 17 features can be switched on or off per user, or through role templates
- Groups overview (view members, add or remove, delete), announcements to everyone or selected users
- Audit log of every admin action, storage usage per user, app settings (name, upload limit, welcome message)

**Chat**
- Real-time one-to-one and group chat, typing indicator, online / last seen
- Sent / delivered / read ticks, unread badges
- Reply, forward, edit, delete (for me / for everyone), emoji reactions, star messages
- Photos, videos, documents, voice notes, drag and drop, paste screenshots, upload progress, image viewer
- Group photo, description, group admins, add or remove members, "only admins can send"
- Pin, mute, archive, clear chat, search (inside a chat and global), export chat (TXT / HTML / JSON)

**IT team tools**
- **Polls** (live voting), **scheduled messages** (sent automatically), **status / stories** (24 hours, seen-by list)
- **Webhooks:** CI, monitoring or backup tools can post alerts into a group (admin creates the URL)
- **Tickets:** create a ticket (or turn any chat message into one), priority, status (open / in progress / resolved / closed),
  assignee, comments, live updates, "assigned to you" alert, filters and search
- **Quick replies:** save answers once, type `/shortcut` in any chat and press Tab or Enter

**Look and feel**
- 9 themes, accent colour picker, 12 fonts, 4 text sizes, wallpapers, bubble style, density
- Preferences are saved on the server, so they follow the user to every device
- Fully responsive (phone, tablet, desktop), top bar, sidebar, bottom navigation, refresh keeps your page
- Installable PWA, offline app shell

**Not built yet:** chat import, tasks board, on-call roster, uptime monitor, push notifications when the app is closed. Voice/video calls are out of scope.

## Run on your computer (Windows)

1. Install **Python 3.11 or 3.12** from https://www.python.org/downloads/ and tick **"Add python.exe to PATH"**.
2. Unzip this folder, open it in VS Code, open a terminal and run:

```
.\setup.bat
.\start.bat
```

3. Open **http://localhost:8000** and sign in as `Vaibhav777` / `Vaibhav@1455`.

No database setup is needed locally (it uses a SQLite file). One command runs the website, API and WebSocket.

Mac / Linux: `./setup.sh` then `./start.sh`.

## First steps as admin

1. Sign in, open **Users** in the left menu, click **Add user**.
2. Enter name and username (leave password empty to auto-generate). Copy the credentials and send them to the user.
3. Open **Permissions** to create role templates, or open a user to switch features on or off.
4. Open the app in a second browser window (private window) and sign in as the new user to try chatting.

## Folder structure

```
teamchat/
|-- backend/       Django + Channels (API, WebSocket, admin logic)  -> host on Render
|   |-- config/    settings, urls, asgi
|   `-- core/      models, views, consumers
|-- frontend/      Static HTML/CSS/JS app (PWA)                      -> host on Netlify
|-- render.yaml    Render blueprint (optional)
|-- DEPLOY.md      Free hosting guide: Neon + Render + Netlify
|-- setup.bat / start.bat
```

## Tested

- Backend API (about 125 checks), real WebSocket events, admin permissions, tickets and quick replies: run end to end on SQLite
  and on PostgreSQL with production settings.
- UI: 40 automated flow checks (sign-in, admin creates user, permissions, forced password change, chat, tickets, language,
  theme, font) plus screenshots in desktop and phone size reviewed in headless Chrome (see `docs/screenshots`).
- Not verified: real phones (especially iPhone Safari), voice recording on every browser, and the actual Render / Netlify / S3
  deployments. Check those on your side and report anything that looks off.

## Troubleshooting

| Problem | Fix |
|---|---|
| `python` not recognised | Reinstall Python and tick "Add to PATH", then open a new terminal |
| Port 8000 busy | Edit `start.bat`: change `8000` to `8001` |
| Pip install fails | Run `python -m pip install --upgrade pip`, then `.\setup.bat` again |
| Forgot admin password | `cd backend`, `venv\Scripts\activate`, `python manage.py create_admin --reset-password` |
| Chat shows "Offline" | The server window must stay open |
