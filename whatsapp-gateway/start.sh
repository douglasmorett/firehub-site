#!/bin/sh
# Limpar NODE_OPTIONS que o Railway injeta (--optimize-for-size é rejeitado pelo Node 20)
unset NODE_OPTIONS
exec node --expose-gc --max-old-space-size=450 server.js
