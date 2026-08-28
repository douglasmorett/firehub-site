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
    // Brendi fala o mesmo Open Delivery do JotaJá, e o polling é a via
    // PRIMÁRIA (o webhook é só acelerador de latência): é este ciclo de 60s
    // que garante o pedido mesmo com o push mudo. Enquanto nenhuma loja tiver
    // brendiConnected=true a rota responde vazio — custo zero.
    name: 'brendi-poll',
    path: '/api/cron/brendi-poll',
    intervalMs: 60_000, // 1 minuto
  },
  {
    name: 'gateway-keepalive',
    path: '/api/cron/gateway-keepalive',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    name: 'health-check',
    path: '/api/cron/health-check',
    intervalMs: 5 * 60_000, // 5 minutos — monitora saúde + alerta WhatsApp
  },
  {
    // De hora em hora só para pegar cedo o insumo que acabou de cair no mínimo.
    // Quem segura a repetição é a própria rota: um aviso por insumo a cada 24h
    // e nada fora do horário comercial da loja.
    name: 'estoque-alerta',
    path: '/api/cron/estoque-alerta',
    intervalMs: 60 * 60_000, // 1 hora
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
  {
    // Traz de volta quem sumiu (7, 15 e 30 dias sem pedir).
    //
    // A tela do lojista prometia esse disparo "automaticamente" desde sempre,
    // com os interruptores ligados — e não existia job nenhum para executá-lo:
    // ninguém nunca recebeu. De hora em hora aqui só para pegar o começo do
    // horário comercial; a própria rota garante UM disparo por loja por dia e
    // não envia nada fora das 10h–20h.
    name: 'recuperacao-clientes',
    path: '/api/cron/recuperacao-clientes',
    intervalMs: 60 * 60_000, // 1 hora
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
          // Log sucinto de sucesso para confirmar que o cron está rodando
          const ts = new Date().toISOString().slice(11, 19);
          console.log(`[cron-runner] ✅ ${ts} ${job.name} ok (${status})`);
        } else if (status === 401) {
          console.error(`[cron-runner] 🔒 ${job.name} REJEITADO com 401 — CRON_SECRET ${CRON_SECRET ? 'está definido mas pode estar errado' : 'NÃO ESTÁ DEFINIDO (chamadas locais devem funcionar)'}`);
        } else {
          console.warn(`[cron-runner] ⚠️ ${job.name} retornou ${status}: ${body.slice(0, 200)}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      // Server pode não estar pronto ainda — silencioso para ECONNREFUSED
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
        // Sonda de prontidao: /api/health. Antes usava /api/debug/env, que
        // vazava dados das lojas e agora responde 404 em producao.
        { hostname: 'localhost', port: 3000, path: '/api/health', method: 'GET', timeout: 3000 },
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
  console.log(`[cron-runner] 🔑 CRON_SECRET: ${CRON_SECRET ? 'definido (' + CRON_SECRET.length + ' chars)' : 'NÃO DEFINIDO — chamadas locais usam bypass'}`);
  console.log(`[cron-runner] 🌐 BASE_URL: ${BASE_URL}`);
  
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
