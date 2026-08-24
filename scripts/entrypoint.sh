#!/bin/sh
set -e

echo "[entrypoint] Iniciando FireHub..."

# ── SCHEMA DO BANCO ─────────────────────────────────────────────────────────
# O `prisma db push` mora no script de build do package.json, mas o Dockerfile
# não usa aquele script — o build da imagem é `next build` puro. Resultado: até
# aqui, coluna nova no schema.prisma NUNCA chegava sozinha ao banco. Quem
# lembrasse rodava à mão; quem não lembrasse subia um app consultando coluna
# inexistente.
#
# Roda no start, onde a DATABASE_URL existe. É idempotente: sem diferença entre
# schema e banco, não faz nada.
#
# Chamado pelo caminho do arquivo, não por `npx`: o standalone do Next tem um
# package.json mínimo que não lista o prisma, e o `npx --no-install` não achava
# o binário em node_modules/.bin. A falha custou um 500 em produção no cardápio
# inteiro — vide o `exit 1` logo abaixo.
PRISMA_CLI="/app/node_modules/prisma/build/index.js"

if [ ! -f "$PRISMA_CLI" ]; then
  echo "[entrypoint] ERRO: CLI do Prisma não está na imagem ($PRISMA_CLI)."
  echo "[entrypoint] Sem ele não há como garantir que o banco tem o schema desta versão."
  exit 1
fi

echo "[entrypoint] Aplicando schema do Prisma..."

# Sem --accept-data-loss de propósito: mudança aditiva (coluna nova, tabela
# nova) passa direto, mudança destrutiva PRECISA falhar em vez de apagar dados
# de produção em silêncio.
#
# E a falha DERRUBA o start, de propósito. A versão anterior deste script
# abafava o erro e subia a aplicação assim mesmo, "para não deixar a loja fora
# do ar" — o efeito foi o oposto: o Prisma consulta as colunas que o schema
# desta build declara, então sem elas TODA leitura de cardápio vira 500. Um
# container que não sobe faz o Coolify manter no ar o container anterior, que
# funciona. Morrer aqui é o que mantém a loja vendendo.
if ! node "$PRISMA_CLI" db push --skip-generate; then
  echo "[entrypoint] ERRO: 'prisma db push' falhou — veja o erro acima."
  echo "[entrypoint] Encerrando de propósito: sem o schema aplicado, esta versão"
  echo "[entrypoint] só serviria erro. O container anterior continua atendendo."
  exit 1
fi

echo "[entrypoint] Schema em dia."

# Iniciar cron-runner em background
node /app/scripts/cron-runner.js &
CRON_PID=$!
echo "[entrypoint] cron-runner iniciado (PID: $CRON_PID)"

# Iniciar Next.js em foreground
exec node server.js
