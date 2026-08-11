const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const lines = envContent.split(/\r?\n/);

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) continue;

  const eqIdx = line.indexOf('=');
  if (eqIdx === -1) continue;

  const key = line.substring(0, eqIdx).trim();
  let val = line.substring(eqIdx + 1).trim();

  // Strip quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.substring(1, val.length - 1);
  }

  if (key === 'NEXTAUTH_URL') {
    val = 'https://firehubfood.com.br';
  }

  if (key === 'ASAAS_API_KEY' && val.startsWith('$')) {
    val = val.substring(1);
  }

  console.log(`Adding ${key}...`);

  // Remove old if exists
  spawnSync('npx.cmd', ['vercel', 'env', 'rm', key, 'production', '-y'], { encoding: 'utf8', shell: true });

  // Add new
  const proc = spawnSync('npx.cmd', ['vercel', 'env', 'add', key, 'production'], {
    input: val,
    encoding: 'utf8',
    shell: true
  });
  if (proc.error) console.error(proc.error);
  else console.log(proc.stdout || proc.stderr);
}

console.log('Finished pushing env vars to Vercel!');
