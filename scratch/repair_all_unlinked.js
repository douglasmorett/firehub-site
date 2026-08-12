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

  // 1. Fix order #3021 specifically (Jarbas Miguel)
  // Link to 'Combo 6 Esfirras Mix' (id: 'cmrzcoe6d0053ju04j5p3rcl0')
  const { rowCount: count3021 } = await pool.query(`
    UPDATE "CustomerOrderItem" 
    SET "menuProductId" = 'cmrzcoe6d0053ju04j5p3rcl0'
    WHERE "orderId" = 'cmsqn8emx0004l404wndck1yy'
  `);
  console.log(`Updated Order #3021 items: ${count3021}`);

  // 2. Find all remaining unlinked CustomerOrderItem rows
  const { rows: unlinked } = await pool.query(`
    SELECT i.id, i."orderId", i.price, o."franchiseeId", o."source", i."comboSelections"
    FROM "CustomerOrderItem" i
    JOIN "CustomerOrder" o ON i."orderId" = o.id
    WHERE i."menuProductId" IS NULL
  `);

  console.log(`Found ${unlinked.length} unlinked CustomerOrderItem rows to repair.`);

  // Cache franchisee products by price
  const { rows: allProds } = await pool.query(`
    SELECT id, name, price, "franchiseeId" FROM "MenuProduct" WHERE active = true
  `);

  const prodByFranchiseeAndPrice = {};
  const prodByFranchiseeDefault = {};
  allProds.forEach(p => {
    if (!prodByFranchiseeAndPrice[p.franchiseeId]) prodByFranchiseeAndPrice[p.franchiseeId] = {};
    prodByFranchiseeAndPrice[p.franchiseeId][p.price] = p.id;
    if (!prodByFranchiseeDefault[p.franchiseeId]) prodByFranchiseeDefault[p.franchiseeId] = p.id;
  });

  let repairedCount = 0;
  let createdFallbackCount = 0;

  for (const item of unlinked) {
    const fId = item.franchiseeId;
    let targetProductId = prodByFranchiseeAndPrice[fId]?.[item.price];
    
    if (!targetProductId) {
      targetProductId = prodByFranchiseeDefault[fId];
    }

    if (!targetProductId && fId) {
      // Create a single inactive fallback product for this franchisee
      const fallbackId = `fallback-prod-${fId.slice(0, 10)}`;
      await pool.query(`
        INSERT INTO "MenuProduct" (id, "franchiseeId", name, description, price, category, active, "isCombo", "createdAt", "updatedAt")
        VALUES ($1, $2, 'Produto Cardápio', 'Produto restaurado de integração', $3, 'Outros', false, false, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [fallbackId, fId, item.price || 0]);
      targetProductId = fallbackId;
      createdFallbackCount++;
    }

    if (targetProductId) {
      await pool.query(`
        UPDATE "CustomerOrderItem" SET "menuProductId" = $1 WHERE id = $2
      `, [targetProductId, item.id]);
      repairedCount++;
    }
  }

  console.log(`Successfully repaired ${repairedCount} order items! Created ${createdFallbackCount} inactive fallbacks.`);

  await pool.end();
}

main().catch(console.error);
