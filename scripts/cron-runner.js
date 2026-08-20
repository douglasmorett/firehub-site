#!/usr/bin/env node

/**
 * Cron Runner — substitui os Vercel Cron Jobs na DigitalOcean/Docker.
 * Roda como processo de background chamando endpoints HTTP locais.
 * Consome ~5MB RAM e zero CPU quando idle.
 */

const http = require('http');

const BASE_URL = process.env.CRON_BASE_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';

// ── Definição dos cron jobs ──────────────────────────────────────────
const jobs = [
  {
    name: 'ifood-poll',
    path: '/api/cron/ifood-poll',
    intervalMs: 60_000, // 1 minuto
  },
  {
    name: 'jotaja-poll',
    path: '/api/cron/jotaja-poll',
    intervalMs: 60_000, // 1 minuto
  },
  {
    name: 'gateway-keepalive',
    path: '/api/cron/gateway-keepalive',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    name: 'billing-close',
    path: '/api/cron/billing-close',
    intervalMs: 60 * 60_000, // 1 hora (verifica internamente se é dia 1 às 03h)
  },
  {
    name: 'meta-ads-sync',
    path: '/api/cron/meta-ads-sync',
    intervalMs: 6 * 60 * 60_000, // 6 horas
  },
];

// ── Função para chamar um endpoint ───────────────────────────────────
function callEndpoint(job) {
  return new Promise((resolve) => {
    const url = new URL(job.path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'GET',
      timeout: 55_000, // 55s timeout
      headers: {},
    };

    if (CRON_SECRET) {
      options.headers['Authorization'] = `Bearer ${CRON_SECRET}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          // Log sucinto — só loga erros pra não poluir
        } else {
          console.warn(`[cron-runner] ⚠️ ${job.name} retornou ${status}: ${body.slice(0, 200)}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      // Server pode não estar pronto ainda — silencioso
      if (err.code !== 'ECONNREFUSED') {
        console.warn(`[cron-runner] ❌ ${job.name} erro: ${err.message}`);
      }
      resolve();
    });

    req.on('timeout', () => {
      console.warn(`[cron-runner] ⏱️ ${job.name} timeout`);
      req.destroy();
      resolve();
    });

    req.end();
  });
}

// ── Aguardar servidor Next.js ficar pronto ───────────────────────────
function waitForServer(maxWaitMs = 120_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.request(
        { hostname: 'localhost', port: 3000, path: '/api/debug/env', method: 'GET', timeout: 3000 },
        (res) => {
          res.resume();
          console.log('[cron-runner] ✅ Servidor Next.js pronto!');
          resolve();
        }
      );
      req.on('error', () => {
        if (Date.now() - start > maxWaitMs) {
          console.warn('[cron-runner] ⚠️ Timeout esperando servidor, iniciando mesmo assim...');
          resolve();
        } else {
          setTimeout(check, 2000);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        setTimeout(check, 2000);
      });
      req.end();
    };
    check();
  });
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('[cron-runner] 🚀 Iniciando cron-runner com', jobs.length, 'jobs...');
  
  await waitForServer();

  // Agendar cada job com seu intervalo
  for (const job of jobs) {
    // Primeira execução com delay escalonado (evita thundering herd)
    const initialDelay = Math.random() * 10_000;
    
    setTimeout(() => {
      // Executar imediatamente
      callEndpoint(job);

      // Agendar repetição
      setInterval(() => {
        callEndpoint(job);
      }, job.intervalMs);
    }, initialDelay);

    console.log(`[cron-runner] ⏰ ${job.name} agendado a cada ${job.intervalMs / 1000}s`);
  }
}

main().catch(console.error);
