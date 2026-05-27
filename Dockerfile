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

# Server reads dist/ for static assets; vite build put them there already
CMD ["npx", "tsx", "server/index.ts"]
