# Self-Hosting Vibe Dash for Teams

This guide covers running Vibe Dash as a shared server so all your team's AI agents report to the same dashboard, and everyone on the team can view it in a browser.

---

## Quick start (Docker)

The fastest way to get a shared instance running:

```bash
git clone https://github.com/sgent/vibe-dash.git
cd vibe-dash
docker compose up -d
```

The dashboard is now available at `http://your-server:3001`.

Agents connect over the Streamable HTTP MCP transport:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://your-server:3001/mcp"
    }
  }
}
```

Data is stored in a Docker volume (`vibe-dash-data`) and persists across container restarts and upgrades.

---

## Architecture overview

```
Internet / LAN
      │
      ▼
  [Nginx / Caddy]  ──  TLS termination, basic auth (optional)
      │
      ▼
  [Vibe Dash :3001]  ──  Express + WebSocket + MCP
      │
      ▼
  [SQLite volume]  ──  /data/vibe-dash.db
```

Vibe Dash is a single Node.js process. It serves:
- `GET /` — React dashboard (built frontend assets)
- `/api/*` — REST endpoints for the UI
- `/ws` — WebSocket for real-time push to browsers
- `/mcp` — Streamable HTTP MCP transport (agents)
- `/sse` — Legacy SSE MCP transport

All four entry points share the same SQLite database file.

---

## Configuration

| Environment variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3001` | Port the server listens on |
| `VIBE_DASH_DB` | `./vibe-dash.db` | Database path — used by both the server process and the stdio MCP transport |

Override in `docker-compose.yml` under `environment`, or in a `.env` file.

---

## Installing without Docker

Requires **Node.js 20+**.

```bash
git clone https://github.com/sgent/vibe-dash.git
cd vibe-dash
npm install
npm start          # builds frontend + starts server on :3001
```

To run as a persistent background service, use systemd, pm2, or your OS service manager:

Build the frontend once, then run only the server on each start:

```bash
npm run build   # one-time — compiles the React frontend into dist/
```

**pm2:**
```bash
npm install -g pm2
pm2 start "npm run serve" --name vibe-dash   # starts server only; no rebuild on restart
pm2 save && pm2 startup
```

**systemd** (`/etc/systemd/system/vibe-dash.service`):
```ini
[Unit]
Description=Vibe Dash
After=network.target

[Service]
Type=simple
User=vibe-dash
WorkingDirectory=/opt/vibe-dash
ExecStart=npm run serve
Restart=on-failure
Environment=PORT=3001
Environment=VIBE_DASH_DB=/opt/vibe-dash/data/vibe-dash.db

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now vibe-dash
```

> `npm run serve` starts the server without rebuilding the frontend. Run `npm run build` manually after each upgrade.

---

## Reverse proxy + TLS

Never expose the Node.js process directly on port 443. Use a reverse proxy to terminate TLS and optionally enforce access control.

### Caddy (simplest — auto TLS)

```
vibe-dash.example.com {
    reverse_proxy localhost:3001
}
```

Caddy handles WebSocket upgrades and TLS automatically. No other config needed — it fetches and auto-renews a Let's Encrypt certificate.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name vibe-dash.example.com;

    ssl_certificate     /etc/letsencrypt/live/vibe-dash.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vibe-dash.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_read_timeout 3600s;   # keep WebSocket connections alive
    }
}

server {
    listen 80;
    server_name vibe-dash.example.com;
    return 301 https://$host$request_uri;
}
```

---

## Access control

Vibe Dash does not currently have built-in user authentication. Restrict access at the network or proxy layer:

### Option 1: VPN / private network (recommended)

Run Vibe Dash on a host only reachable via your team's VPN. No credentials to manage — if you're on the VPN, you're authorized. This is the simplest and most secure option for small teams.

### Option 2: Nginx basic auth

Suitable for teams that can't run a VPN. Adds HTTP basic auth in front of the dashboard and the `/api` REST endpoints.

**Create a password file:**
```bash
sudo apt install apache2-utils
htpasswd -c /etc/nginx/.htpasswd alice
htpasswd /etc/nginx/.htpasswd bob
```

**Add to your Nginx config:**
```nginx
location / {
    auth_basic           "Vibe Dash";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass         http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host       $host;
    proxy_read_timeout 3600s;
}
```

> **Note:** MCP agents connecting over Streamable HTTP (`/mcp`) also need to send the basic auth header. Check your agent's MCP client documentation for how to supply HTTP headers with remote MCP servers.

### Option 3: IP allowlist

If all agents run on known IP ranges (e.g., your office or CI runner CIDR):

```nginx
location / {
    allow 192.168.1.0/24;   # office network
    allow 10.0.0.0/8;       # VPN subnet
    deny  all;

    proxy_pass http://127.0.0.1:3001;
    # ... proxy headers as above
}
```

### Option 4: Cloudflare Access (zero-trust)

Put Vibe Dash behind Cloudflare Tunnel + Cloudflare Access. Team members authenticate with Google/GitHub SSO; Cloudflare handles auth before traffic reaches your server. No VPN, no password files. See the [Cloudflare Access docs](https://developers.cloudflare.com/cloudflare-one/applications/add-apps/self-hosted-apps/).

---

## Agent configuration for team deployments

Once Vibe Dash is behind a reverse proxy with a public hostname, agents connect via Streamable HTTP:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "https://vibe-dash.example.com/mcp"
    }
  }
}
```

If you enabled basic auth at the proxy, supply credentials via the URL. **Never commit credentials to git** — use an environment variable or your team's secrets manager instead:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "https://alice:${VIBE_DASH_PASSWORD}@vibe-dash.example.com/mcp"
    }
  }
}
```

Set `VIBE_DASH_PASSWORD` in your shell profile or CI secrets store; the MCP client interpolates it at runtime. Exact interpolation syntax varies by client — check your agent's documentation.

---

## Backup and restore

The entire Vibe Dash state is a single SQLite file.

**Docker volume backup:**
```bash
docker run --rm \
  -v vibe-dash-data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar czf /backups/vibe-dash-$(date +%Y%m%d).tar.gz /data
```

**Direct file backup:**
```bash
# While the server is running — SQLite WAL mode makes this safe
cp /opt/vibe-dash/data/vibe-dash.db backups/vibe-dash-$(date +%Y%m%d).db
```

**Restore:**
```bash
docker compose down
docker run --rm \
  -v vibe-dash-data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar xzf /backups/vibe-dash-20260401.tar.gz -C /
docker compose up -d
```

---

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Data in the volume is preserved. The server runs database migrations automatically on startup.

---

## Troubleshooting

**Container won't start:**
- Check logs: `docker compose logs -f`
- Ensure the data volume directory is writable

**WebSocket disconnects frequently:**
- Set `proxy_read_timeout 3600s` in Nginx (default 60s disconnects long-lived WS connections)
- If behind Cloudflare, enable "WebSockets" in your Cloudflare zone network settings

**Agents can't reach `/mcp`:**
- Verify the proxy passes all HTTP methods (`ALL /mcp` in Vibe Dash; Nginx passes all by default)
- Check that your proxy doesn't strip the `mcp-session-id` header

**Database locked errors:**
- Only one Vibe Dash process should write to the SQLite file
- If running multiple containers, mount the same volume to exactly one container; use the HTTP MCP transport for all agents instead of stdio
