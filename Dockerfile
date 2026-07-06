# ── BrotBot – Production Dockerfile ──────────────────────────────────────────
#
# Multi-stage build using Next.js standalone output.
# Final image contains only the compiled server — no source files, no
# node_modules, no secrets. All secrets are injected at runtime via
# Coolify environment variables.
#
# Stages:
#   1. deps    — install production + dev dependencies
#   2. builder — compile the Next.js app
#   3. runner  — lean runtime image (~200 MB instead of ~1 GB)

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only the manifests first so Docker can cache this layer
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars that must be known at compile time.
# These are NOT secrets — they are the public-facing API surface.
# Real secrets (API keys) are injected at runtime only.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for container security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy only what Next.js standalone needs to run
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ assets (logo, etc.) — empty for now but keeps the pattern correct
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# pdf-parse is a serverExternalPackage (not bundled by webpack) so Next.js
# standalone does not auto-include it. Copy it explicitly so require("pdf-parse")
# resolves at runtime inside the container.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdf-parse ./node_modules/pdf-parse

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# ── Runtime secrets (injected by Coolify, never baked into the image) ─────────
# SUPABASE_URL          — Supabase Cloud project URL
# SUPABASE_ANON_KEY     — Supabase publishable key (read-only, chat only)
# OPENAI_API_KEY        — for text-embedding-3-large query embedding
# ANTHROPIC_API_KEY     — for Claude chat model
# ANTHROPIC_MODEL       — defaults to claude-haiku-4-5 if unset
# RAG_MATCH_COUNT       — number of context docs retrieved per query (default 7)
#
# NOT needed at runtime (migration-only):
# SUPABASE_SERVICE_ROLE_KEY

CMD ["node", "server.js"]
