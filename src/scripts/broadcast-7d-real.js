const fs = require('fs');
const path = require('path');
const https = require('https');

const envPath = path.join(__dirname, '../../.env.prod.real');
const envContent = fs.readFileSync(envPath, 'utf8');

let apiUrl = '';
let apiKey = '';
let dbUrl = '';

envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'EVOLUTION_API_URL') apiUrl = val;
    if (key === 'EVOLUTION_API_KEY') apiKey = val;
    if (key === 'DATABASE_URL') dbUrl = val;
  }
});

process.env.DATABASE_URL = dbUrl;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

async function run() {
  const user = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    select: { id: true, storeName: true, slug: true, chatbotConfig: true }
  });

  if (!user) {
    console.log('Usuário contatohakim@gmail.com não encontrado');
    process.exit(1);
  }

  console.log('Loja encontrada:', user.storeName, 'ID:', user.id);

  const instanceName = `firehub_${user.id.slice(-10)}`;
  const config = user.chatbotConfig || {};
  const coupon = config.coupon7d || 'VOLTEI10';
  const storeUrl = `https://firehubfood.com.br/loja/${user.slug}`;

  // Formatação amigável de mensagem de 7 dias chamando pelo nome
  const messageText = `Oi Rosangela, tudo bem? Sentimos sua falta! Tá sumida! 🍕\n\n` +
                      `Trouxemos 10% de desconto ou R$ 10,00 para você lanchar com a gente hoje!\n` +
                      `Use o cupom: *${coupon}* no nosso site:\n${storeUrl}`;

  console.log('\n--- MENSAGEM A ENVIAR ---');
  console.log(messageText);

  const postData = JSON.stringify({
    number: '5522998851680',
    text: messageText
  });

  const fullUrl = `${apiUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`;
  console.log('\nDISPARANDO PARA:', fullUrl);

  const urlObj = new URL(fullUrl);

  const req = https.request({
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
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
    console.error('ERRO NO ENVIO:', err);
    process.exit(1);
  });

  req.write(postData);
  req.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
