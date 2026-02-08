# iSchool AI Quality Dashboard — Deploy With Lovable Frontend

This repo contains an **Express + Socket.IO** backend in `ischool-dashboard/`.
Your Lovable-hosted frontend can connect to it over HTTPS via Nginx.

## 1) Run the backend (Node.js)

```bash
cd /path/to/repo/ischool-dashboard
npm install

# Default: listens on :3000
node server.js

# Recommended in production
pm2 start server.js --name ischool-dashboard
pm2 logs ischool-dashboard
```

### Environment variables

- `PORT` (default `3000`) — change the port if your Nginx config expects another one.
- `DISABLE_CORS` (default `0`) — set to `1` if Nginx is adding CORS headers (prevents duplicate headers).
- `CORS_ORIGIN` (default `*`) — only used when `DISABLE_CORS` is not set.

If you proxy to `127.0.0.1:4000`, run:

```bash
PORT=4000 DISABLE_CORS=1 pm2 restart ischool-dashboard --update-env
```

## 2) Nginx reverse proxy (HTTPS)

Example (adjust domain + port):

```nginx
server {
    listen 443 ssl;
    server_name 34.123.3.80.sslip.io;

    ssl_certificate /etc/letsencrypt/live/34.123.3.80.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/34.123.3.80.sslip.io/privkey.pem;

    # CORS (if you enable it here, set DISABLE_CORS=1 in Node)
    add_header Access-Control-Allow-Origin * always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, ngrok-skip-browser-warning" always;

    if ($request_method = OPTIONS) {
        return 204;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 3) Frontend connection (Lovable)

Your Lovable frontend can set the backend URL in either way:

- Query param (easy):
  - `https://your-frontend-domain/?backend=https://34.123.3.80.sslip.io`
- UI button:
  - Click **“🔌 Backend”** and paste the backend base URL.

The dashboard shows a **connection pill** in the header:
- Socket.IO connect/disconnect
- API health via `GET /api/queue/status` every 15s

## 4) Health + Socket.IO tests

```bash
# API health
curl -i https://34.123.3.80.sslip.io/api/queue/status

# Socket.IO handshake
curl -i "https://34.123.3.80.sslip.io/socket.io/?EIO=4&transport=polling"
```

## 5) Common issues

### Duplicate CORS headers
If Nginx is adding CORS headers and Node is also adding them, browsers may reject responses with:

`Access-Control-Allow-Origin header contains multiple values`

Fix:
- Keep CORS in **Nginx** → set `DISABLE_CORS=1` in the Node process.
- Or keep CORS in **Node** → remove the `add_header` lines from Nginx.

### Socket.IO not connecting
Make sure the Nginx `location /` block includes:

- `proxy_http_version 1.1;`
- `proxy_set_header Upgrade $http_upgrade;`
- `proxy_set_header Connection "upgrade";`

## 6) Folder structure (sessions)

The backend reads/writes session files under:

```
../Sessions/
  <TutorId>/
    video.mp4
    transcript.txt
    Quality_Report_RAG_<TutorId>.html
    Quality_Report_RAG_<TutorId>.json
```
