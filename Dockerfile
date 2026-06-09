# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable

# Native build deps for serialport bindings
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm exec prisma generate

COPY . .
RUN pnpm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY config ./config

EXPOSE 3000

# Note: serial (COM) port access requires --device passthrough on Linux hosts.
# On Windows hosts run the service natively (pnpm start:prod) instead of Docker.
CMD ["node", "dist/src/main.js"]
