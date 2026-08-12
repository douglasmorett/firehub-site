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
  
  // 1. Inspect Order #3021
  const { rows: order3021 } = await pool.query(`
    SELECT o.id, o."franchiseeId", i.id as item_id, i.price, i."comboSelections"
    FROM "CustomerOrder" o
    JOIN "CustomerOrderItem" i ON i."orderId" = o.id
    WHERE o."ifoodReference" = '3021' OR o."openDeliveryReference" = '3021' OR o."notes" LIKE '%3021%'
  `);

  console.log('Order #3021 items:', order3021);

  // Check matching products for franchisee with price ~ 26.90
  if (order3021.length > 0) {
    const franchiseeId = order3021[0].franchiseeId;
    const { rows: matchingProds } = await pool.query(`
      SELECT id, name, price, category FROM "MenuProduct"
      WHERE "franchiseeId" = $1 AND (price = 26.90 OR name LIKE '%10 Esfirras%' OR name LIKE '%Combo%')
    `, [franchiseeId]);
    console.log('Matching products for franchisee:', matchingProds);
  }

  await pool.end();
}

main().catch(console.error);
