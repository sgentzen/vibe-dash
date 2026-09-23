# Self-Hosting Vibe Dash for Teams

This guide covers running Vibe Dash as a shared server so all your team's AI agents report to the same dashboard, and everyone on the team can view it in a browser.

---

## Quick start (Docker)

The fastest way to get a shared instance running:

```bash
git clone https://github.com/sgentzen/vibe-dash.git
cd vibe-dash
docker compose up -d
```

The dashboard is now available **on the server itself** at `http://localhost:3001`.

It is not reachable from other machines yet, and that is deliberate: `docker-compose.yml`
publishes the port on loopback only, because Vibe Dash has no built-in authentication
(see [Access control](#access-control)). To reach it from the rest of your team,
put a reverse proxy in front of it and enforce access control there.

Once the proxy is in place, agents connect over the Streamable HTTP MCP transport:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "https://vibe-dash.example.com/mcp"
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

All four entry points share the same SQLite database file.

---

## Configuration

| Environment variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3001` | Port the server listens on |
| `HOST` | `127.0.0.1` | Interface the server binds. Vibe Dash has no built-in authentication, so this stays loopback-only unless you deliberately opt in with `HOST=0.0.0.0` — see [Access control](#access-control) before you do. The Docker image sets it to `0.0.0.0` internally; that is not a LAN exposure by itself, because `docker-compose.yml` still publishes the port on the host's loopback interface only. |
| `VIBE_DASH_ALLOWED_HOSTS` | unset | Comma-separated `host[:port]` values to accept in the `Host` header, in addition to `localhost`, `127.0.0.1` and `[::1]` on `PORT`. **Required if you put a reverse proxy in front of Vibe Dash** — without it, every proxied request is rejected with `421` because its `Host` is your public hostname, not `localhost`. Set it to that hostname, e.g. `VIBE_DASH_ALLOWED_HOSTS=vibe-dash.example.com`. Both `http://` and `https://` are then accepted as `Origin`. |
| `VIBE_DASH_DB` | `<git-root>/vibe-dash.db` | Database path — used by the server process, the stdio MCP transport and the CLI. Not relative to your working directory: left unset it resolves to the git root of the Vibe Dash install. The Docker image sets it to `/data/vibe-dash.db`. |
| `VIBE_DASH_ALLOW_SCHEMA_DRIFT` | unset | Bypasses the guard that refuses to open a database carrying migrations this build does not know. Only for deliberately running an older build against a migrated database. |
| `VIBE_DASH_OTLP_SERIES_CAP` | `10000` | Ceiling on distinct OTLP metric series. Only the creation of a new series is refused; nothing is ever deleted, so an established sender is unaffected. Raise it and restart if a flooded install needs to admit new senders. |
| `VIBE_DASH_CLAUDE_HOME` | `~/.claude/projects` | Where transcript ingestion looks for Claude Code session files. Point it at an empty directory to switch ingestion off. **Under Docker this must be a path *inside the container***: `docker-compose.yml` sets it to `/transcripts` and separately bind-mounts the real host directory there; see [Docker Compose and transcript ingestion](#docker-compose-and-transcript-ingestion) below. Without that mount the directory does not exist inside the container, observed cost silently reads $0.00, and `GET /api/ingest/status` reports `claudeHomeFound: false` (surfaced in the dashboard as a notice, not a silent gap). |
| `VIBE_DASH_TRANSCRIPTS_DIR` | `$HOME/.claude/projects` | Docker Compose only: the **host** directory bind-mounted read-only into the container at `/transcripts` (see below). Not read by the server itself; it only ever sees `VIBE_DASH_CLAUDE_HOME=/transcripts`. |

Override in `docker-compose.yml` under `environment`, or in a `.env` file.

### Docker Compose and transcript ingestion

`docker-compose.yml` mounts a host directory into the container read-only and
points `VIBE_DASH_CLAUDE_HOME` at it:

```yaml
volumes:
  - ${VIBE_DASH_TRANSCRIPTS_DIR:-$HOME/.claude/projects}:/transcripts:ro
environment:
  - VIBE_DASH_CLAUDE_HOME=/transcripts
```

This mount is required for observed cost under Docker. Without it, `~/.claude/projects`
does not exist inside the container at all, so transcript ingestion finds nothing,
`spend_today` reads `$0.00`, and the dashboard shows a "no transcript directory was
found" notice rather than a false all-clear.

The default (`$HOME/.claude/projects`) works out of the box on Linux and macOS,
where `$HOME` is a real environment variable. **Compose does not expand `~` in a
volume path**: the string is passed through to the Docker Engine literally,
which does not expand it either, and Windows has no equivalent
automatically-populated `HOME` variable in the environment `docker compose`
reads from. Windows users must set `VIBE_DASH_TRANSCRIPTS_DIR` explicitly, most
conveniently in a `.env` file next to `docker-compose.yml`:

```
# .env, Windows (Docker Desktop): forward slashes, even for a Windows path
VIBE_DASH_TRANSCRIPTS_DIR=C:/Users/<you>/.claude/projects
```

```
# .env, Linux or macOS: only needed if $HOME isn't right for some reason
VIBE_DASH_TRANSCRIPTS_DIR=/home/<you>/.claude/projects
```

Restart with `docker compose up -d` after changing `.env`; Compose does not
pick up `.env` changes in an already-running container.

---

## Installing without Docker

Requires **Node.js 20+**.

```bash
git clone https://github.com/sgentzen/vibe-dash.git
cd vibe-dash
npm install
npm start          # builds frontend + starts server on 127.0.0.1:3001
```

The server binds loopback only by default (`HOST=127.0.0.1`) — reachable from
this machine, not the rest of your network. Put a reverse proxy in front of it
for team access (below) rather than setting `HOST=0.0.0.0`: Vibe Dash has no
built-in authentication, so binding every interface hands an unauthenticated
read/write API, and every MCP tool, to anything that can reach this host.

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

`HOST` defaults to `127.0.0.1` whether or not pm2 sets it; add `HOST=0.0.0.0`
to pm2's environment only if you understand the [Access control](#access-control)
trade-off and are not fronting this with a reverse proxy.

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
Environment=HOST=127.0.0.1
Environment=VIBE_DASH_DB=/opt/vibe-dash/data/vibe-dash.db

[Install]
WantedBy=multi-user.target
```

`Environment=HOST=127.0.0.1` above is the default — spelled out so the unit
file stays correct as documentation even if that default ever changes.

```bash
systemctl enable --now vibe-dash
```

> `npm run serve` starts the server without rebuilding the frontend. Run `npm run build` manually after each upgrade.

---

## Reverse proxy + TLS

Never expose the Node.js process directly on port 443. Use a reverse proxy to terminate TLS and optionally enforce access control.

Whichever proxy you use, also set `VIBE_DASH_ALLOWED_HOSTS=vibe-dash.example.com`
(your real hostname) on the Vibe Dash process itself. The server validates the
`Host` header on every request to close the DNS-rebinding hole that a bare
loopback bind leaves open (see [Configuration](#configuration)); a proxied
request arrives with `Host: vibe-dash.example.com`, not `localhost`, and is
rejected with `421` unless that hostname is on the allow-list.

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

The server itself enforces the loopback boundary in code, not just by binding
address: it rejects any request whose `Host` header isn't `localhost`,
`127.0.0.1`, `[::1]` (on its own port) or an entry in `VIBE_DASH_ALLOWED_HOSTS`,
and rejects cross-site state-changing requests the same way, so a browser tab
on an unrelated site can't reach it via DNS rebinding even while it's running.
That is a floor, not a substitute for the options below — it stops the
specific network-layer attack, not general access.

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

After upgrading, check `GET /api/health` (or the version shown in the app's
keyboard-shortcuts overlay) to confirm the running container actually picked
up the new image. This is what LIVE-1/LIVE-3 exist to make visible, after an
instance was found running a build over a month stale with no way to tell
from the outside. Optionally set `VIBE_DASH_COMMIT_SHA` and
`VIBE_DASH_BUILD_TIME` as build args to have that identity be exact rather
than "unknown":

```bash
docker compose build \
  --build-arg VIBE_DASH_COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg VIBE_DASH_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker compose up -d
```

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

**`421` responses (`{"error":"Invalid Host header: ..."}`) behind a reverse proxy:**
- Set `VIBE_DASH_ALLOWED_HOSTS` to your public hostname on the Vibe Dash process — see [Reverse proxy + TLS](#reverse-proxy--tls). This is the most common setup mistake once a proxy is added.

**`403` responses (`{"error":"Invalid Origin header: ..."}`) or WebSocket connections refused from the browser:**
- Same cause as the `421` case above: the browser's `Origin` is your public hostname, which also needs to be in `VIBE_DASH_ALLOWED_HOSTS`.
