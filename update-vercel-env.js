const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Extract the key directly from .env.local
const envContent = fs.readFileSync(path.resolve(__dirname, '.env.local'), 'utf8');
const match = envContent.match(/ASAAS_API_KEY=["']?([^"'\r\n]+)["']?/);
if (!match) {
  console.error("No ASAAS_API_KEY found in .env.local!");
  process.exit(1);
}

let key = match[1];
// Strip the leading '$'
if (key.startsWith('$')) {
  key = key.substring(1);
}

console.log("Stripped key ready (length " + key.length + ")");

try {
  console.log("Removing old ASAAS_API_KEY from production...");
  execSync('npx vercel env rm ASAAS_API_KEY production -y', { stdio: 'inherit' });
} catch (e) {
  console.log("Old key might not exist or failed to remove, proceeding...");
}

try {
  console.log("Adding new ASAAS_API_KEY without leading $...");
  // Node.js process spawn to avoid shell newline issues
  const { spawnSync } = require('child_process');
  const addProc = spawnSync('npx.cmd', ['vercel', 'env', 'add', 'ASAAS_API_KEY', 'production'], {
    input: key,
    encoding: 'utf8'
  });
  console.log(addProc.stdout);
  if (addProc.stderr) console.error(addProc.stderr);
} catch (e) {
  console.error("Error adding key:", e);
}

console.log("Running production deploy to apply new variables...");
try {
  execSync('npx vercel --prod --yes', { stdio: 'inherit' });
  console.log("Deploy finished!");
} catch (e) {
  console.error("Error deploying:", e);
}
