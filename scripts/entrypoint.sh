#!/bin/sh
set -e

echo "[entrypoint] Iniciando FireHub..."

# ── SCHEMA DO BANCO ─────────────────────────────────────────────────────────
# O `prisma db push` mora no script de build do package.json, mas o Dockerfile
# não usa aquele script — o build da imagem é `next build` puro. Resultado: até
# aqui, coluna nova no schema.prisma NUNCA chegava sozinha ao banco. Quem
# lembrasse rodava à mão; quem não lembrasse subia um app consultando coluna
# inexistente, e o erro só aparecia na primeira requisição do cliente.
#
# Roda no start, onde a DATABASE_URL existe. É idempotente: sem diferença entre
# schema e banco, não faz nada.
#
# Sem --accept-data-loss de propósito. Mudança aditiva (coluna nova, tabela
# nova) passa direto; mudança destrutiva PRECISA falhar aqui em vez de apagar
# dados de produção em silêncio. Por isso o `|| :` — o push é abafado e o app
# sobe assim mesmo: um schema que não aplicou é problema para resolver com o
# log na mão, não motivo para deixar a loja fora do ar no meio do jantar.
echo "[entrypoint] Aplicando schema do Prisma..."
if npx --no-install prisma db push --skip-generate 2>&1; then
  echo "[entrypoint] Schema em dia."
else
  echo "[entrypoint] AVISO: 'prisma db push' falhou (veja o erro acima)."
  echo "[entrypoint] Isso costuma ser mudança destrutiva, que exige decisão humana."
  echo "[entrypoint] Subindo a aplicação mesmo assim para não derrubar a loja."
fi

# Iniciar cron-runner em background
node /app/scripts/cron-runner.js &
CRON_PID=$!
echo "[entrypoint] cron-runner iniciado (PID: $CRON_PID)"

# Iniciar Next.js em foreground
exec node server.js
