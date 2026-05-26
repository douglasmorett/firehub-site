const fs = require('fs');
const path = require('path');

// Read the key from .env.local
const envContent = fs.readFileSync(path.resolve(__dirname, '.env.local'), 'utf8');

// Extract just the key value, handling quotes
const match = envContent.match(/ASAAS_API_KEY=["']?(.+?)["']?\s*$/m);
if (!match) {
  console.error("ASAAS_API_KEY not found in .env.local");
  process.exit(1);
}

const rawKey = match[1].trim();
console.log("Raw key length:", rawKey.length);
console.log("Raw key starts:", rawKey.substring(0, 20));
console.log("Raw key ends:", rawKey.substring(rawKey.length - 20));
console.log("Starts with $:", rawKey.startsWith("$"));

// Generate base64
const b64 = Buffer.from(rawKey).toString("base64");
console.log("\nBase64 length:", b64.length);
console.log("Base64:", b64);

// Verify roundtrip
const decoded = Buffer.from(b64, "base64").toString("utf8");
console.log("\nRoundtrip match:", decoded === rawKey);
console.log("Decoded starts:", decoded.substring(0, 20));

// Generate stripped key (without $)
const stripped = rawKey.startsWith("$") ? rawKey.substring(1) : rawKey;
console.log("\nStripped key (no $) length:", stripped.length);
console.log("Stripped key starts:", stripped.substring(0, 20));

// Save both to files for the env setup script
fs.writeFileSync(path.resolve(__dirname, '.asaas-b64.txt'), b64, 'utf8');
fs.writeFileSync(path.resolve(__dirname, '.asaas-stripped.txt'), stripped, 'utf8');
console.log("\nSaved .asaas-b64.txt and .asaas-stripped.txt");
