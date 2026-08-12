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
  
  // Find active orders for Hakim
  const { rows: orders } = await pool.query(`
    SELECT o.id, o."ifoodReference", o."openDeliveryReference", o."customerName", o.status, o."kdsStage", o.notes
    FROM "CustomerOrder" o
    WHERE o.status != 'ENTREGUE' AND o.status != 'CANCELADO'
    ORDER BY o."createdAt" DESC
  `);

  console.log(`Active KDS orders count: ${orders.length}`);
  for (const o of orders) {
    console.log(`Order Ref: ${o.openDeliveryReference || o.ifoodReference} | Customer: ${o.customerName} | Status: ${o.status} | KDSStage: ${o.kdsStage}`);
    
    const { rows: items } = await pool.query(`
      SELECT i.id, i."menuProductId", i.quantity, i.price, i."comboSelections", m.name as product_name
      FROM "CustomerOrderItem" i
      LEFT JOIN "MenuProduct" m ON i."menuProductId" = m.id
      WHERE i."orderId" = $1
    `, [o.id]);

    items.forEach(it => {
      console.log(`  - Item ID: ${it.id} | MenuProductId: ${it.menuProductId} | Name: ${it.product_name || 'NULL/MISSING'} | Selections: ${JSON.stringify(it.comboSelections)}`);
    });
  }

  await pool.end();
}

main().catch(console.error);
