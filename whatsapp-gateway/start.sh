#!/bin/sh
# Limpar NODE_OPTIONS que o Railway injeta (--optimize-for-size e rejeitado pelo Node 20)
# ATENCAO: este arquivo TEM que ficar com quebra de linha LF — com CRLF o sh do
# Alpine morre em "unset: NODE_OPTIONS: bad variable name" e o container entra
# em crash-loop (aconteceu em 28/08/2026, derrubou o gateway no deploy).
unset NODE_OPTIONS
exec node --expose-gc --max-old-space-size=450 server.js
