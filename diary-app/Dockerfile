# Build stage: has the compiler tools better-sqlite3 needs when no
# prebuilt binary can be downloaded for this platform.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: just Node, the installed packages and the app.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# All entries, photos and backups live on this volume and survive upgrades.
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
