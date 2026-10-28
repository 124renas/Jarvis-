# Production image: builds the PWA and runs the API server.
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Mount a persistent volume at /data so accounts, chats and notes survive redeploys.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data COOKIE_SECURE=1 TRUST_PROXY=1
EXPOSE 8787
CMD ["npm", "start"]
