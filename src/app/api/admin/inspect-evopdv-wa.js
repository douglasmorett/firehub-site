const fs = require('fs');
const path = require('path');

const files = [
  'C:\\Users\\Micro\\Documents\\evo pdv\\src\\components\\Settings.tsx',
  'C:\\Users\\Micro\\Documents\\evo pdv\\src\\components\\OnlineDashboard.tsx',
  'C:\\Users\\Micro\\Documents\\evo pdv\\landing-page\\api\\evolution-helper.js',
  'C:\\Users\\Micro\\Documents\\evo pdv\\landing-page\\api\\cakto-webhook.js',
  'C:\\Users\\Micro\\Documents\\evo pdv\\landing-page\\api\\cron-followup.js',
  'C:\\Users\\Micro\\Documents\\firecheck\\api\\index.js'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    const txt = fs.readFileSync(f, 'utf8');
    const lines = txt.split('\n');
    lines.forEach((l, idx) => {
      if (/whatsapp|telef|celular|trocar|instancia|evolution|qrcode|qr/i.test(l)) {
        console.log(`${path.basename(f)}:${idx + 1} -> ${l.trim()}`);
      }
    });
  }
});
