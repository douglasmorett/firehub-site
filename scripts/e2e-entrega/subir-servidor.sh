#!/usr/bin/env bash
# Sobe o `next dev` do wt-pub na porta 3100 contra o banco DESCARTÁVEL.
#
# Pré-requisitos (ver scripts/e2e-entrega/LEIA-ME no "ambiente" do relatório):
#   1. `npx prisma dev --name e2e-entrega --detach` → URL postgres://…/template1?sslmode=disable
#   2. E2E_DB="<essa URL>&connection_limit=1&pgbouncer=true"
#   3. next.config.ts com `turbopack: { root: "C:/Users/Micro" },` logo após
#      `const nextConfig: NextConfig = {` (node_modules é junção) — reverter no fim
#      com `git checkout next.config.ts`.
#   4. NÃO pode existir .env nem .env.local nesta pasta.
set -euo pipefail
cd "$(dirname "$0")/../.."
if ls -a | grep -qE '^\.env(\.local)?$'; then echo "Existe .env/.env.local aqui — recusado."; exit 2; fi
: "${E2E_DB:?defina E2E_DB com a URL do prisma dev (com &connection_limit=1&pgbouncer=true)}"
case "$E2E_DB" in *localhost*|*127.0.0.1*) ;; *) echo "E2E_DB não é local — recusado."; exit 2;; esac
export DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB"
export NEXTAUTH_SECRET=e2e NEXTAUTH_URL=http://localhost:3100 COTACAO_SECRET=e2e
LOG="${E2E_LOG:-$TEMP/e2e-entrega-next.log}"
echo "log: $LOG"
exec npx next dev -p 3100 > "$LOG" 2>&1
