const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env.production.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      try {
        val = JSON.parse(val);
      } catch (e) {}
      process.env[key] = val;
    }
  });
}

// Instanciar o PrismaClient APÓS popular process.env.DATABASE_URL
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});
const https = require('https');

async function run() {
  const u = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    select: { id: true, storeName: true, slug: true, chatbotConfig: true }
  });

  if (!u) {
    console.log('ERRO: Loja contatohakim@gmail.com não encontrada');
    process.exit(1);
  }

  const targetFranchiseeId = u.id;
  const config = u.chatbotConfig || {};

  const coupon = config.coupon7d || 'VOLTEI10';
  const storeUrl = `https://firehubfood.com.br/loja/${u.slug}`;

  const messageText = `Oi Rosangela, tudo bem? Sentimos sua falta! Tá sumida! 🍕\n\n` +
                      `Trouxemos 10% de desconto ou R$ 10,00 para você lanchar com a gente hoje!\n` +
                      `Use o cupom: *${coupon}* no nosso site:\n${storeUrl}`;

  console.log('\n--- ENVIANDO MENSAGEM ---');
  console.log('Loja:', u.storeName);
  console.log('Texto:\n', messageText);

  const instanceName = `firehub_${targetFranchiseeId.slice(-10)}`;
  const postData = JSON.stringify({
    number: '5522998851680',
    text: messageText
  });

  const gatewayUrl = (process.env.EVOLUTION_API_URL || 'https://firehub-whatsapp-gateway-production.up.railway.app').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY || 'FIREHUB_GW_SECRET_2026';

  console.log('\nGATEWAY URL:', gatewayUrl);
  console.log('API KEY:', apiKey);
  console.log('INSTÂNCIA:', instanceName);

  const urlObj = new URL(`${gatewayUrl}/message/sendText/${instanceName}`);

  const req = https.request({
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey,
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('\nRESPOSTA DA EVOLUTION API (HTTP ' + res.statusCode + '):');
      console.log(data);
      process.exit(0);
    });
  });

  req.on('error', err => {
    console.error('ERRO NO DISPARO:', err);
    process.exit(1);
  });

  req.write(postData);
  req.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
