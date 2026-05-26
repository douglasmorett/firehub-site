const { checkAsaasOverdue } = require('./src/lib/asaas');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const result = await checkAsaasOverdue('65886157000101');
  console.log("RESULT:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
