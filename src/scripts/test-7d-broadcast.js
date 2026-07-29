const fs = require('fs');
const env = fs.readFileSync('.env.development.local', 'utf8');
env.split('\n').forEach(line => {
  const idx = line.indexOf('=');
  if (idx > 0) {
    const k = line.substring(0, idx).trim();
    let v = line.substring(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.substring(1, v.length - 1);
    }
    process.env[k] = v;
  }
});

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const u = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    select: { id: true, storeName: true, slug: true, chatbotConfig: true }
  });
  console.log('LOJA:', JSON.stringify(u, null, 2));

  if (u) {
    const https = require('https');
    const targetFranchiseeId = u.id;
    const config = u.chatbotConfig || {};
    const coupon = config.coupon7d || 'VOLTEI10';
    const benefitText = '10% de desconto';
    const storeUrl = `https://firehubfood.com.br/loja/${u.slug}`;

    const messageText = `Oi! Que saudades de você, tá sumida(o)! 🍕\n\n` +
                        `Trouxe R$ 10,00 de desconto ou 10% OFF para você lanchar com a gente hoje: *${benefitText}*!\n` +
                        `Use o cupom: *${coupon}* no nosso site:\n${storeUrl}`;

    console.log('\nMENSAGEM A SER ENVIADA VIA GATEWAY:');
    console.log(messageText);

    const instanceName = `firehub_${targetFranchiseeId.slice(-10)}`;
    console.log('\nNOME DA INSTÂNCIA:', instanceName);

    const postData = JSON.stringify({
      number: '5522998851680',
      text: messageText
    });

    const gatewayUrl = (process.env.EVOLUTION_API_URL || 'https://firehub-whatsapp-gateway-production.up.railway.app').replace(/\/$/, '');
    const apiKey = process.env.EVOLUTION_API_KEY || 'FIREHUB_GW_SECRET_2026';

    console.log('ENDPOINT:', `${gatewayUrl}/message/sendText/${instanceName}`);

    const urlObj = new URL(`${gatewayUrl}/message/sendText/${instanceName}`);

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
        console.log('\nRESPOSTA DA EVOLUTION (STATUS ' + res.statusCode + '):');
        console.log(data);
      });
    });

    req.on('error', err => console.error('ERRO NO DISPARO:', err));
    req.write(postData);
    req.end();
  }
}

run();
