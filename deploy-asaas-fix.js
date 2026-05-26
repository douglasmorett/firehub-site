const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const b64Key = fs.readFileSync(path.resolve(__dirname, '.asaas-b64.txt'), 'utf8').trim();
const strippedKey = fs.readFileSync(path.resolve(__dirname, '.asaas-stripped.txt'), 'utf8').trim();

console.log("B64 key length:", b64Key.length);
console.log("Stripped key length:", strippedKey.length);

function runVercel(args, input) {
  console.log(`\n> npx vercel ${args.join(' ')}`);
  const opts = { encoding: 'utf8', stdio: input ? ['pipe', 'pipe', 'pipe'] : 'inherit' };
  if (input) opts.input = input;
  const result = spawnSync('npx.cmd', ['vercel', ...args], opts);
  if (input) {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }
  return result.status;
}

// Step 1: Remove old variables (ignore errors if they don't exist)
console.log("=== STEP 1: Removing old env vars ===");
runVercel(['env', 'rm', 'ASAAS_API_KEY', 'production', '-y']);
runVercel(['env', 'rm', 'ASAAS_API_KEY_B64', 'production', '-y']);

// Step 2: Add ASAAS_API_KEY (without leading $, immune to Vercel interpolation)
console.log("\n=== STEP 2: Adding ASAAS_API_KEY (without $) ===");
const addKeyResult = runVercel(['env', 'add', 'ASAAS_API_KEY', 'production'], strippedKey);
console.log("Add ASAAS_API_KEY result:", addKeyResult);

// Step 3: Add ASAAS_API_KEY_B64 (base64 encoded, double insurance)  
console.log("\n=== STEP 3: Adding ASAAS_API_KEY_B64 ===");
const addB64Result = runVercel(['env', 'add', 'ASAAS_API_KEY_B64', 'production'], b64Key);
console.log("Add ASAAS_API_KEY_B64 result:", addB64Result);

// Step 4: Verify
console.log("\n=== STEP 4: Verifying ===");
runVercel(['env', 'ls', 'production']);

// Step 5: Deploy to production
console.log("\n=== STEP 5: Deploying to production ===");
runVercel(['--prod', '--yes']);

console.log("\n=== DONE ===");
