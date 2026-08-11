const tls = require('tls');

const socket = tls.connect(443, 'www.firehubfood.com.br', { servername: 'www.firehubfood.com.br', rejectUnauthorized: false }, () => {
  const cert = socket.getPeerCertificate();
  console.log('Subject:', cert.subject);
  console.log('Issuer:', cert.issuer);
  console.log('Valid From:', cert.valid_from);
  console.log('Valid To:', cert.valid_to);
  console.log('Days Remaining:', (new Date(cert.valid_to) - new Date()) / (1000 * 60 * 60 * 24));
  socket.end();
});

socket.on('error', (err) => {
  console.error('TLS Error:', err);
});
