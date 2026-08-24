# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# Step 1: Install ALL dependencies (dev + prod)
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Forçar instalação de TODAS as dependências (dev incluso)
# Ignora qualquer NODE_ENV externo
RUN NODE_ENV=development npm ci

# Step 2: Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js standalone (sem rodar prisma db push)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Step 3: Production runner (imagem final leve)
FROM base AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static assets and standalone bundle
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy cron-runner and entrypoint
COPY --chown=nextjs:nodejs scripts/cron-runner.js ./scripts/cron-runner.js
COPY --chown=nextjs:nodejs scripts/entrypoint.sh ./scripts/entrypoint.sh
RUN chmod +x ./scripts/entrypoint.sh

# Raiz padrao dos uploads quando UPLOADS_DIR nao esta definido. Em producao a
# variavel aponta para o volume do Coolify. Os dois diretorios precisam ser
# gravaveis pelo usuario nextjs: /app pertence ao root, entao sem isto o mkdir
# do primeiro upload falharia por permissao.
RUN mkdir -p /app/uploads /app/public/uploads \
    && chown -R nextjs:nodejs /app/uploads /app/public/uploads

USER nextjs

EXPOSE 3000

CMD ["sh", "./scripts/entrypoint.sh"]
