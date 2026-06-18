# Stage 1: build the React frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build

# Stage 2: production image
FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend assets and server source
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY shared ./shared

# Default port; override with PORT env var
EXPOSE 3001

# DB is stored in a volume so data survives container restarts
VOLUME ["/data"]

ENV NODE_ENV=production \
    VIBE_DASH_DB=/data/vibe-dash.db \
    PORT=3001

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

# Server reads dist/ for static assets; vite build put them there already
# nosemgrep: dockerfile.security.missing-user.missing-user -- root is required to chown /data; the entrypoint drops to `node` via su-exec
CMD ["npx", "tsx", "server/index.ts"]
