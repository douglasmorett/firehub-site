// scratch/test-jotaja-poll.js — Testa o endpoint de polling JotaJá na produção
require('dotenv').config();
const https = require('https');

const BASE = 'https://firehubfood.com.br';
const CRON_SECRET = process.env.CRON_SECRET || '';

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        ...headers,
        'Accept': 'application/json',
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function main() {
  console.log('=== TESTE DO ENDPOINT JOTAJÁ-POLL NA PRODUÇÃO ===\n');
  console.log(`CRON_SECRET local: ${CRON_SECRET ? '✅ ' + CRON_SECRET.substring(0, 5) + '...' : '❌ NÃO DEFINIDO'}`);
  
  // Testar sem autenticação
  console.log('\n1. Teste SEM auth:');
  try {
    const r1 = await httpGet(`${BASE}/api/cron/jotaja-poll`);
    console.log(`   Status: ${r1.status}`);
    console.log(`   Body: ${r1.body.substring(0, 300)}`);
  } catch (e) {
    console.log(`   ERRO: ${e.message}`);
  }

  // Testar COM autenticação (se CRON_SECRET estiver definido)
  if (CRON_SECRET) {
    console.log('\n2. Teste COM auth (Bearer CRON_SECRET):');
    try {
      const r2 = await httpGet(`${BASE}/api/cron/jotaja-poll`, {
        'Authorization': `Bearer ${CRON_SECRET}`,
      });
      console.log(`   Status: ${r2.status}`);
      console.log(`   Body: ${r2.body.substring(0, 500)}`);
    } catch (e) {
      console.log(`   ERRO: ${e.message}`);
    }
  }

  // Testar servidor em geral
  console.log('\n3. Health check:');
  try {
    const r3 = await httpGet(`${BASE}/api/debug/env`);
    console.log(`   Status: ${r3.status}`);
    console.log(`   Body: ${r3.body.substring(0, 200)}`);
  } catch (e) {
    console.log(`   ERRO: ${e.message}`);
  }
}

main().catch(console.error);
