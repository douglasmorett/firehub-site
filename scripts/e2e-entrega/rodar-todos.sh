#!/usr/bin/env bash
# Roda a bateria E2E da entrega por km na ordem certa (E1 cadastra as faixas
# que os outros usam; E10 e E12 leem a saída do E3).
#
#   E2E_DB="postgres://…/template1?sslmode=disable&connection_limit=1&pgbouncer=true" \
#     bash scripts/e2e-entrega/rodar-todos.sh
#
# O servidor tem de estar de pé na 3100 (scripts/e2e-entrega/subir-servidor.sh)
# SEM OSRM_URL. Os extras R4/R5 pedem o servidor subido com
# OSRM_URL=http://127.0.0.1:9 (roteador fora) — ver o fim deste arquivo.
# Saídas (JSON + PNG) em scripts/e2e-entrega/saida/.
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${E2E_DB:?defina E2E_DB}"
case "$E2E_DB" in *localhost*|*127.0.0.1*) ;; *) echo "E2E_DB não é local — recusado."; exit 2;; esac
export DATABASE_URL="$E2E_DB" MSYS_NO_PATHCONV=1
D=scripts/e2e-entrega
node $D/semente.mjs
for s in e1-faixas-no-painel e1b-cartao-nao-pula e1c-validacao-no-servidor e2-simulador \
         e3-pedido-endereco-preciso e4-so-bairro-pino e5-endereco-inexistente; do
  echo "=== $s"; node $D/$s.mjs > $D/saida/$s.log 2>&1; tail -3 $D/saida/$s.log
done
# GPS: ponto com rua nomeada (principal) e ponto sem bairro no mapa.
E6_LAT=-22.8605 E6_LNG=-42.0225 E6_SAIDA=e6 node $D/e6-gps.mjs > $D/saida/e6.log 2>&1
E6_LAT=-22.8505 E6_LNG=-42.0375 E6_BAIRRO="Porto do Carro" E6_SAIDA=e6c node $D/e6-gps.mjs > $D/saida/e6c.log 2>&1
# Defeito D1: ponto real a ~1 km cujo reverse só traz "residential".
E6_LAT=-22.8455 E6_LNG=-42.0270 E6_SAIDA=e6a node $D/e6-gps.mjs > $D/saida/e6a.log 2>&1
for s in e7-fora-da-area e8-corrida-de-cotacoes e9-balcao e9b-balcao-aproximado-e-inexistente e10-corrigir-taxa; do
  echo "=== $s"; node $D/$s.mjs > $D/saida/$s.log 2>&1; tail -3 $D/saida/$s.log
done
# O limite por IP (40/min) precisa de balde vazio; e o E12 precisa do balde de novo.
sleep 65; node $D/e11-limite-da-cotacao.mjs > $D/saida/e11.log 2>&1; tail -12 $D/saida/e11.log
sleep 65; node $D/e12-token-de-outro-endereco.mjs > $D/saida/e12.log 2>&1; tail -5 $D/saida/e12.log
# Extras com o roteador fora (reinicie o servidor com OSRM_URL=http://127.0.0.1:9):
#   E6_LAT=-22.8625 E6_LNG=-42.0300 E6_SAIDA=r4 node $D/r4-roteador-fora.mjs
#   FATOR=<fator do log "[Taxa de entrega] distância ESTIMADA"> node $D/r5-limites-da-faixa.mjs
