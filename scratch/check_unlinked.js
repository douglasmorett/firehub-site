const fs = require('fs');
const path = require('path');
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

const envPath = path.join(__dirname, '..', '.env.local');
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    if (line.startsWith('DATABASE_URL=')) {
      dbUrl = line.replace('DATABASE_URL=', '').trim().replace(/^["']|["']$/g, '');
    }
  }
}

neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: dbUrl });
  
  const { rows: unlinked } = await pool.query(`
    SELECT i.id, i."orderId", i.price, i.quantity, i."comboSelections", o."customerName", o."source", o."ifoodReference", o."openDeliveryReference"
    FROM "CustomerOrderItem" i
    JOIN "CustomerOrder" o ON i."orderId" = o.id
    WHERE i."menuProductId" IS NULL
  `);

  console.log(`Total unlinked CustomerOrderItem rows: ${unlinked.length}`);
  unlinked.slice(0, 20).forEach(u => {
    console.log(`Order Ref: ${u.openDeliveryReference || u.ifoodReference} (${u.source}) | Customer: ${u.customerName} | Price: ${u.price} | ComboSels: ${JSON.stringify(u.comboSelections)}`);
  });

  await pool.end();
}

main().catch(console.error);
