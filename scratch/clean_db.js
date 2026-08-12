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
  
  const junkCategories = ['IFOOD', 'iFood', 'Jotajá', 'JOTAJA', 'Jotaja', 'ONLINE', 'COMPLEMENTO', 'COMPLEMENTOS', 'OPCIONAL', 'OPCIONAIS', 'ADICIONAL', 'ADICIONAIS', 'INSUMO', 'INSUMOS', 'OCULTO'];
  
  // Find junk products
  const { rows: junkProducts } = await pool.query(
    `SELECT id, name, category FROM "MenuProduct" 
     WHERE UPPER(category) = ANY($1) 
        OR name LIKE 'IFOOD |%' 
        OR name LIKE 'JOTAJÁ |%' 
        OR name LIKE 'JOTAJA |%' 
        OR name LIKE 'COMBOS |%' 
        OR name LIKE 'Produto (R$%'`,
    [junkCategories.map(c => c.toUpperCase())]
  );

  console.log(`Found ${junkProducts.length} junk integration products in database.`);
  junkProducts.forEach(p => console.log(` - [${p.category}] ${p.name} (id: ${p.id})`));

  if (junkProducts.length > 0) {
    const junkIds = junkProducts.map(p => p.id);
    
    // 1. Unlink CustomerOrderItem
    const unlinkRes = await pool.query(
      `UPDATE "CustomerOrderItem" SET "menuProductId" = NULL WHERE "menuProductId" = ANY($1)`,
      [junkIds]
    );
    console.log(`Unlinked ${unlinkRes.rowCount} CustomerOrderItem references.`);

    // 2. Delete ProductRecipe items referencing these junk products
    const delRecipes = await pool.query(
      `DELETE FROM "ProductRecipe" WHERE "menuProductId" = ANY($1)`,
      [junkIds]
    );
    console.log(`Deleted ${delRecipes.rowCount} ProductRecipe references.`);

    // 3. Delete ComboGroupItems referencing these junk products
    const delComboGroupItems = await pool.query(
      `DELETE FROM "ComboGroupItem" WHERE "menuProductId" = ANY($1)`,
      [junkIds]
    );
    console.log(`Deleted ${delComboGroupItems.rowCount} ComboGroupItem references.`);

    // 4. Delete products
    const delProducts = await pool.query(
      `DELETE FROM "MenuProduct" WHERE id = ANY($1)`,
      [junkIds]
    );
    console.log(`Deleted ${delProducts.rowCount} junk MenuProduct rows.`);

    // 5. Delete junk MenuCategory
    const delCats = await pool.query(
      `DELETE FROM "MenuCategory" WHERE UPPER(name) = ANY($1)`,
      [junkCategories.map(c => c.toUpperCase())]
    );
    console.log(`Deleted ${delCats.rowCount} junk MenuCategory rows.`);
  }

  await pool.end();
}

main().catch(console.error);
