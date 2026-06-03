FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --omit=dev

FROM base AS build

RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public

RUN mkdir -p /app/logs && chown appuser:appgroup /app/logs

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

CMD ["node", "dist/server.js"]
