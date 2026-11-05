#!/bin/sh
set -e

echo "[entrypoint] Iniciando FireHub..."

# Iniciar cron-runner em background
node /app/scripts/cron-runner.js &
CRON_PID=$!
echo "[entrypoint] cron-runner iniciado (PID: $CRON_PID)"

# Iniciar Next.js em foreground — com PROCESSOS_DO_SITE > 1, uma cópia por
# núcleo (scripts/varios-processos.js); sem a variável, um processo só.
if [ "${PROCESSOS_DO_SITE:-1}" -gt 1 ] 2>/dev/null; then
  exec node /app/scripts/varios-processos.js
fi
exec node server.js
