#!/bin/sh
set -e

echo "[entrypoint] Iniciando FireHub..."

# Iniciar cron-runner em background
node /app/scripts/cron-runner.js &
CRON_PID=$!
echo "[entrypoint] cron-runner iniciado (PID: $CRON_PID)"

# Iniciar Next.js em foreground
exec node server.js
