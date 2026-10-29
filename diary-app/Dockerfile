FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# All entries, photos and backups live on this volume and survive upgrades.
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
