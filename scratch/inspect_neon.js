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
  
  const { rows: products } = await pool.query(`SELECT id, name, category, "isCombo", active, "franchiseeId" FROM "MenuProduct" WHERE active = true ORDER BY category, name`);
  
  console.log(`Total active products in DB: ${products.length}`);
  
  const categories = {};
  products.forEach(p => {
    categories[p.category] = (categories[p.category] || 0) + 1;
  });

  console.log('Categories breakdown:', JSON.stringify(categories, null, 2));

  console.log('\nAll active products:');
  products.forEach(p => {
    console.log(`[${p.category}] - ${p.name} (Combo: ${p.isCombo})`);
  });

  await pool.end();
}

main().catch(console.error);
