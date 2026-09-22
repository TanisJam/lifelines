# syntax=docker/dockerfile:1

# Self-hosted Docker deploy (homelab, single long-running container behind Traefik).
# node:24-bookworm-slim: `node:sqlite` (used by src/server/db.ts) needs Node >=22.5 unflagged;
# 24 is the current LTS-track major and matches what's verified locally (Node v26) closely enough
# that the `DatabaseSync` API used here behaves identically — confirmed by running this exact base
# image during development (`docker run node:24-bookworm-slim node -e "require('node:sqlite')"`).
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN corepack enable

# --- deps: install with pnpm (via corepack, pinned by package.json's "packageManager") ----------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- builder: `next build` with output: "standalone" ---------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Never call the live Jev API during the image build — build-time rendering must not depend on
# network access or an API key; `next build` doesn't invoke the DecisionMaker anyway, but this
# keeps the build hermetic and matches how the app is actually run (DECISION_ENGINE chosen at
# runtime via `docker compose`'s env_file).
ENV DECISION_ENGINE=rules
RUN pnpm build

# --- runner: minimal standalone server, non-root ---------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /data \
    && chown -R nextjs:nodejs /data

# `output: "standalone"` (next.config.ts) traces only the files each route needs into
# `.next/standalone`, plus a minimal server.js; `public/` and `.next/static` are copied in
# manually per the self-hosting docs (they're excluded from the trace by design, meant for a CDN).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
