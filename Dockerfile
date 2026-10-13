# SyncMídia — imagem de produção (TanStack Start SSR via Nitro preset node-server).
#
# Build (as VITE_* são fixadas no build — o app não lê URL do Supabase em runtime):
#   docker build \
#     --build-arg VITE_SUPABASE_URL=https://supabase.exemplo.com \
#     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key> \
#     -t syncmidia-app .
#
# O `deploy/docker-compose.yml` passa esses build-args a partir de `deploy/.env`.
#
# Instalação com Bun (o repo versiona `bun.lock`, sem package-lock.json —
# `npm ci` falharia) e build com Node/Vite, exatamente como o build local.

# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build

# Bun só para instalar dependências de forma determinística (--frozen-lockfile).
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Dependências primeiro (cache de camadas).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Restante do código.
COPY . .

# Build-args -> ambiente do build (Vite injeta em import.meta.env).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_NOTIFY_WEBHOOK_URL
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_NOTIFY_WEBHOOK_URL=${VITE_NOTIFY_WEBHOOK_URL}

RUN bun run build

FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# Saída do Nitro (server + public + node_modules de servidor).
COPY --from=build --chown=node:node /app/.output ./.output

USER node

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
