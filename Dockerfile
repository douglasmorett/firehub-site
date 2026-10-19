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

# lib/prisma.ts e lib/auth.ts param na importação quando estas variáveis não
# existem, e o `next build` importa as rotas para coletar dados. O build não
# conecta no banco: na montagem do GitHub (.github/workflows/deploy.yml) chegam
# valores de mentira; quando o Coolify monta, ele passa os de verdade. ARG vale
# só nesta etapa — não chega à imagem final.
ARG DATABASE_URL
ARG NEXTAUTH_SECRET

# O commit (build-arg do .github/workflows/deploy.yml): vira o deploymentId do
# next.config.ts. Sem ele (Coolify montando sozinho) a montagem segue igual,
# só sem a proteção de versão misturada. Declarado aqui, depois do COPY, para
# não invalidar o cache das etapas de cima.
ARG GIT_SHA=""

# Build Next.js standalone (sem rodar prisma db push)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Modo Contingência: o supervisor que roda no computador da loja, num arquivo
# só (contingencia/supervisor, pacote próprio com o driver do Postgres).
# NODE_ENV=development como no `npm ci` do deps: o Coolify passa NODE_ENV=production
# na montagem e o npm ci pulava o esbuild (devDependency) — "exit code 127".
RUN cd contingencia/supervisor && NODE_ENV=development npm ci --no-audit --no-fund --include=dev && npm run build

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

# Modo Contingência: o supervisor e a lista ASSINADA do pacote que o
# Assistente baixa para o computador das lojas
# (scripts/contingencia/assinar-pacote.mjs). Por último, com tudo de /app já
# no lugar: a lista confere arquivo por arquivo o que esta imagem serve. A
# chave privada só existe no segredo do GitHub (CONTINGENCIA_CHAVE_PRIVADA) e
# chega aqui pelo BuildKit, só nesta etapa — não fica na imagem. Sem ela, a
# lista sai sem assinatura e nenhum Assistente instala a contingência.
COPY --from=builder /app/contingencia/supervisor/dist/supervisor.js ./contingencia/supervisor.js
COPY scripts/contingencia/assinar-pacote.mjs /tmp/assinar-pacote.mjs
RUN --mount=type=secret,id=contingencia_chave,required=false \
    node /tmp/assinar-pacote.mjs /app && rm /tmp/assinar-pacote.mjs

# Raiz padrao dos uploads quando UPLOADS_DIR nao esta definido. Em producao a
# variavel aponta para o volume do Coolify. Os dois diretorios precisam ser
# gravaveis pelo usuario nextjs: /app pertence ao root, entao sem isto o mkdir
# do primeiro upload falharia por permissao.
RUN mkdir -p /app/uploads /app/public/uploads \
    && chown -R nextjs:nodejs /app/uploads /app/public/uploads

# O commit também no container: /api/health e /api/vivo dizem qual versão
# respondeu (lib/instancia.ts). Por último, para não invalidar as camadas de
# cima a cada commit.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

USER nextjs

EXPOSE 3000

CMD ["sh", "./scripts/entrypoint.sh"]
