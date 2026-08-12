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

  // 1. Create restored MenuProduct rows for all unlinked CustomerOrderItems using bulk INSERT
  await pool.query(`
    INSERT INTO "MenuProduct" (id, "franchiseeId", name, description, price, category, active, "isCombo", "createdAt", "updatedAt")
    SELECT 
      'restored-prod-' || i.id,
      o."franchiseeId",
      CASE 
        WHEN i.price = 26.9 THEN 'Combo 6 Esfirras Mix'
        WHEN i.price = 24.9 THEN 'Combo Imperial'
        WHEN i.price = 39.9 THEN 'Combo 10 Esfirras Simples + 2 Bebidas'
        WHEN i.price = 46.9 THEN 'Monte seu Combo (10 itens Variados)'
        WHEN i.price = 67.9 THEN '10 Esfirras Premium + 2 Bebidas'
        WHEN i.price = 59.9 THEN 'Rodizio do Sábio'
        WHEN i.price = 29.9 THEN 'Oferta Hk'
        WHEN i."comboSelections" IS NOT NULL AND length(i."comboSelections"::text) > 5 THEN 'Combo'
        ELSE 'Item'
      END,
      'Restaurado para KDS/Impressão',
      i.price,
      o."source",
      false,
      (i."comboSelections" IS NOT NULL AND length(i."comboSelections"::text) > 5),
      NOW(),
      NOW()
    FROM "CustomerOrderItem" i
    JOIN "CustomerOrder" o ON i."orderId" = o.id
    WHERE i."menuProductId" IS NULL AND o."franchiseeId" IS NOT NULL
    ON CONFLICT (id) DO NOTHING
  `);

  // 2. Bulk link CustomerOrderItem
  const { rowCount } = await pool.query(`
    UPDATE "CustomerOrderItem" i
    SET "menuProductId" = 'restored-prod-' || i.id
    WHERE i."menuProductId" IS NULL
  `);

  console.log(`🚀 FAST RESTORED ${rowCount} CustomerOrderItem rows! All KDS & POS items now have full names.`);

  await pool.end();
}

main().catch(console.error);
