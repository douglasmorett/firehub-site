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
  
  const { rows: dupes } = await pool.query(`
    SELECT name, category, "franchiseeId", COUNT(*) as count 
    FROM "MenuProduct" 
    GROUP BY name, category, "franchiseeId" 
    HAVING COUNT(*) > 1 
    ORDER BY count DESC
  `);

  console.log('Duplicates count:', dupes.length);
  dupes.forEach(d => console.log(`[${d.category}] ${d.name} -> ${d.count} copies (franchisee: ${d.franchiseeId})`));

  await pool.end();
}

main().catch(console.error);
