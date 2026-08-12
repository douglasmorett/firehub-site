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
  
  const { rows: orders } = await pool.query(`
    SELECT * FROM "CustomerOrder" 
    WHERE "ifoodOrderId" = '4df6b757-fb08-4550-bee7-a7d310b29c87' 
       OR "ifoodReference" = '3021' 
       OR "openDeliveryReference" = '3021'
  `);

  console.log('Order row:', JSON.stringify(orders, null, 2));

  if (orders.length > 0) {
    const { rows: items } = await pool.query(`
      SELECT * FROM "CustomerOrderItem" WHERE "orderId" = $1
    `, [orders[0].id]);
    console.log('Order items:', JSON.stringify(items, null, 2));
  }

  await pool.end();
}

main().catch(console.error);
