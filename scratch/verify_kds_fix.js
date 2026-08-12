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
  
  const { rows: items } = await pool.query(`
    SELECT o."ifoodReference", o."customerName", i.id, i.price, m.name as product_name
    FROM "CustomerOrder" o
    JOIN "CustomerOrderItem" i ON i."orderId" = o.id
    JOIN "MenuProduct" m ON i."menuProductId" = m.id
    WHERE o."ifoodReference" IN ('2153', '6958', '3021') OR o."customerName" LIKE '%Monica%' OR o."customerName" LIKE '%Cláudia%'
  `);

  console.log('Verified KDS items:');
  items.forEach(it => {
    console.log(`Order #${it.ifoodReference} (${it.customerName}) -> Product Name: "${it.product_name}" (Price: ${it.price})`);
  });

  await pool.end();
}

main().catch(console.error);
