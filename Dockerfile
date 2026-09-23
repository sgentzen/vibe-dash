# Stage 1: build the React frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Lifecycle scripts are off so a compromised transitive dependency can't run
# arbitrary code at install time; only packages that genuinely need one get an
# explicit rebuild. This stage runs `vite build` and nothing else, and Vite 8
# bundles with rolldown rather than esbuild, so nothing here needs a rebuild.
# `scripts/check-install-scripts.mjs` fails CI if that stops being true.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:client

# Stage 2: production image
FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
# The runtime stage needs both: better-sqlite3's native addon for the database,
# and esbuild's platform binary, which the `tsx` entrypoint below depends on.
# Rebuilding esbuild also restores its version check against @esbuild/*.
# Note this still executes those two packages' install scripts, and
# better-sqlite3's fetches a prebuilt binary over the network — the hardening
# shrinks the trusted set from the whole tree to these two, it doesn't empty it.
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3 esbuild

# Copy built frontend assets and server source
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY shared ./shared

# Commit SHA and build timestamp, threaded through by docker-compose.yml's
# build.args (LIVE-3). The runtime image carries no .git directory, so
# server/version.ts cannot fall back to `git rev-parse` the way a native run
# does — these ARGs are the only way it can know either value. Left unset
# (e.g. a bare `docker build .` with no --build-arg) both ENV values are
# empty strings, and server/version.ts treats an empty string the same as
# unset, falling back to "unknown" rather than reporting a wrong answer.
ARG VIBE_DASH_COMMIT_SHA=""
ARG VIBE_DASH_BUILD_TIME=""
ENV VIBE_DASH_COMMIT_SHA=${VIBE_DASH_COMMIT_SHA} \
    VIBE_DASH_BUILD_TIME=${VIBE_DASH_BUILD_TIME}

# Default port; override with PORT env var
EXPOSE 3001

# DB is stored in a volume so data survives container restarts
VOLUME ["/data"]

# HOST=0.0.0.0 here is a container-internal default, not a change to the
# security boundary: the server itself now defaults to binding loopback only
# (SEC-4), which inside this container's own network namespace would make it
# unreachable even from docker-compose.yml's port publish. docker-compose.yml
# is what still keeps the boundary loopback-only on the HOST machine, by
# publishing "127.0.0.1:3001:3001" rather than "3001:3001" — see the comment
# there.
ENV NODE_ENV=production \
    VIBE_DASH_DB=/data/vibe-dash.db \
    PORT=3001 \
    HOST=0.0.0.0

# su-exec lets the entrypoint drop from root to `node` after fixing volume ownership
RUN apk add --no-cache su-exec && mkdir -p /data && chown -R node:node /app

# Stay root so the entrypoint can chown the mounted /data volume, then it drops
# to the unprivileged `node` user before exec'ing the server. This fixes
# pre-existing named volumes that a build-time chown can't reach (the volume
# mounts over the image's chowned directory).
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint -- root is required to chown /data; the entrypoint drops to `node` via su-exec
ENTRYPOINT ["docker-entrypoint.sh"]

# HEALTHCHECK lives in the image too, not only in docker-compose.yml (OPS-3):
# anyone running this image directly (a bare `docker run`, a different
# orchestrator) gets the same liveness probe compose users do. node, not
# curl: the runtime image installs neither curl nor wget, and node is already
# guaranteed to be present since it's what runs the server. Hits /api/health,
# not /api/projects — a liveness probe should not depend on the database
# layer having opened cleanly, and /api/health now reports version, commit
# and build time on top of `ok: true`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Server reads dist/ for static assets; vite build put them there already
# nosemgrep: dockerfile.security.missing-user.missing-user -- root is required to chown /data; the entrypoint drops to `node` via su-exec
CMD ["/app/node_modules/.bin/tsx", "server/index.ts"]
