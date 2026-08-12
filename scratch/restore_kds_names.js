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

  // 1. Get all unlinked order items
  const { rows: unlinked } = await pool.query(`
    SELECT i.id, i."orderId", i.price, i."comboSelections", o."franchiseeId", o."source"
    FROM "CustomerOrderItem" i
    JOIN "CustomerOrder" o ON i."orderId" = o.id
    WHERE i."menuProductId" IS NULL
  `);

  console.log(`Restoring names for ${unlinked.length} unlinked order items...`);

  // Map of common price -> combo name or generic combo name
  const priceToName = {
    26.9: 'Combo 6 Esfirras Mix',
    24.9: 'Combo Imperial',
    39.9: 'Combo 10 Esfirras Simples + 2 Bebidas',
    46.9: 'Monte seu Combo (10 itens Variados)',
    67.9: '10 Esfirras Premium + 2 Bebidas',
    59.9: 'Rodizio do Sábio',
    29.9: 'Oferta Hk',
    19.9: 'Trio Hk'
  };

  let count = 0;
  for (const item of unlinked) {
    const isCombo = !!(item.comboSelections && String(item.comboSelections).length > 5);
    const inferredName = priceToName[item.price] || (isCombo ? 'Combo' : 'Item Integrado');
    const prodId = `restored-prod-${item.id}`;

    // Create inactive synthetic MenuProduct with accurate name
    await pool.query(`
      INSERT INTO "MenuProduct" (id, "franchiseeId", name, description, price, category, active, "isCombo", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'Produto auto-restaurado para KDS/Impressão', $4, $5, false, $6, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = false
    `, [prodId, item.franchiseeId, inferredName, item.price || 0, item.source || 'Outros', isCombo]);

    // Link item
    await pool.query(`
      UPDATE "CustomerOrderItem" SET "menuProductId" = $1 WHERE id = $2
    `, [prodId, item.id]);

    count++;
  }

  console.log(`✅ Successfully restored menu products and names for ${count} order items!`);

  await pool.end();
}

main().catch(console.error);
