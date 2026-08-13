// test_webhook.js
const http = require('http');

const payload = {
  event: 'messages.upsert',
  instance: 'firehub_cmpx96phr0000ujf0sb0qk5vr',
  data: {
    key: { remoteJid: '5522999999999@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Oi chatbot' },
    pushName: 'Tester'
  }
};

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/webhook/whatsapp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});

req.on('error', e => console.error(e));
req.write(JSON.stringify(payload));
req.end();
