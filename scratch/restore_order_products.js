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
  
  // 1. Get order #3021 or recent orders
  const { rows: orders } = await pool.query(`
    SELECT o.id, o."openDeliveryReference", o."ifoodReference", o."customerName", o."createdAt", o."franchiseeId", o.notes
    FROM "CustomerOrder" o
    WHERE o.id = '3021' OR o."openDeliveryReference" = '3021' OR o."ifoodReference" = '3021' OR o."ifoodOrderId" LIKE '%3021%' OR o."createdAt" > NOW() - INTERVAL '2 hours'
    ORDER BY o."createdAt" DESC
  `);

  console.log('Found recent orders:', orders.length);
  for (const o of orders) {
    console.log(`Order ID: ${o.id} | Ref: ${o.openDeliveryReference || o.ifoodReference} | Customer: ${o.customerName} | Notes: ${o.notes}`);
    
    const { rows: items } = await pool.query(`
      SELECT i.id, i."menuProductId", i.quantity, i.price, i."comboSelections", m.name as product_name
      FROM "CustomerOrderItem" i
      LEFT JOIN "MenuProduct" m ON i."menuProductId" = m.id
      WHERE i."orderId" = $1
    `, [o.id]);

    console.log(`  Items (${items.length}):`);
    items.forEach(it => {
      console.log(`    - Item ID: ${it.id} | MenuProductId: ${it.menuProductId} | Name: ${it.product_name || 'NULL/MISSING'} | ComboSelections: ${JSON.stringify(it.comboSelections)}`);
    });
  }

  await pool.end();
}

main().catch(console.error);
