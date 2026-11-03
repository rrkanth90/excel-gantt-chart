# Fly.io image for the diary app in diary-app/. It sits at the repository
# root because Fly.io's "Launch from GitHub" builds from here.
# (diary-app/Dockerfile is the same build for running from inside that folder.)

# Build stage: has the compiler tools better-sqlite3 needs when no
# prebuilt binary can be downloaded for this platform.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY diary-app/package.json diary-app/package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: just Node, the installed packages and the app.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY diary-app/ .
# All entries, photos and backups live on this volume and survive upgrades.
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
