const fs = require('fs');
const path = require('path');
const https = require('https');

const envPath = path.join(__dirname, '../../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
});

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const u = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    select: { id: true, storeName: true, slug: true, chatbotConfig: true }
  });

  if (!u) {
    console.log('LOJA NÃO ENCONTRADA');
    process.exit(1);
  }

  console.log('LOJA ENCONTRADA:', u.storeName, u.id);

  const instanceName = `firehub_${u.id.slice(-10)}`;
  const config = u.chatbotConfig || {};
  const coupon = config.coupon7d || 'VOLTEI10';
  const storeUrl = `https://firehubfood.com.br/loja/${u.slug}`;

  // Mensagem oficial de 7 dias com nome da cliente e link da loja
  const msg = `Oi Rosangela, tudo bem? Sentimos sua falta! Tá sumida! 🍕\n\n` +
              `Trouxemos 10% de desconto para você lanchar com a gente hoje!\n` +
              `Use o cupom: *${coupon}* no nosso site:\n${storeUrl}`;

  console.log('\nENVIANDO MENSAGEM VIA EVOLUTION API:');
  console.log(msg);

  const postData = JSON.stringify({ number: '5522998851680', text: msg });
  const apiUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;

  console.log('\nINSTÂNCIA:', instanceName);
  console.log('ENDPOINT:', `${apiUrl}/message/sendText/${instanceName}`);

  const urlObj = new URL(`${apiUrl}/message/sendText/${instanceName}`);

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
  }, res => {
    let d = '';
    res.on('data', chunk => d += chunk);
    res.on('end', () => {
      console.log('\nRESULTADO DO ENVIO (HTTP ' + res.statusCode + '):');
      console.log(d);
      process.exit(0);
    });
  });

  req.on('error', e => {
    console.error('ERRO:', e);
    process.exit(1);
  });

  req.write(postData);
  req.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
