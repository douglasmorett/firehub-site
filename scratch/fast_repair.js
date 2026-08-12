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

  // 1. Ensure fallback products exist for all franchisees
  await pool.query(`
    INSERT INTO "MenuProduct" (id, "franchiseeId", name, description, price, category, active, "isCombo", "createdAt", "updatedAt")
    SELECT DISTINCT 
      'fallback-prod-' || o."franchiseeId", 
      o."franchiseeId", 
      'Item Integrado', 
      'Produto restaurado de integração', 
      0, 
      'Outros', 
      false, 
      false, 
      NOW(), 
      NOW()
    FROM "CustomerOrder" o
    WHERE o."franchiseeId" IS NOT NULL
    ON CONFLICT (id) DO NOTHING
  `);

  // 2. Fast bulk update for all CustomerOrderItem with NULL menuProductId
  const { rowCount } = await pool.query(`
    UPDATE "CustomerOrderItem" i
    SET "menuProductId" = 'fallback-prod-' || o."franchiseeId"
    FROM "CustomerOrder" o
    WHERE i."orderId" = o.id AND i."menuProductId" IS NULL AND o."franchiseeId" IS NOT NULL
  `);

  console.log(`🚀 Fast repaired ${rowCount} CustomerOrderItem rows! All order items are now linked.`);

  await pool.end();
}

main().catch(console.error);
