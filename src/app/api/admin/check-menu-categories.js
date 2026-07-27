require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const dbUrl = process.env.DATABASE_URL.replace("&channel_binding=require", "").replace("?channel_binding=require", "");
const client = new Client({ connectionString: dbUrl });

async function main() {
  await client.connect();

  const categoriesRes = await client.query(`
    SELECT category, COUNT(*) as total
    FROM "MenuProduct"
    GROUP BY category
    ORDER BY total DESC
  `);

  console.log("Categorias no banco de dados:", categoriesRes.rows);

  const ifoodJunk = await client.query(`
    SELECT id, name, category, price, "imageUrl"
    FROM "MenuProduct"
    WHERE category ILIKE '%ifood%' OR category ILIKE '%jotaja%' OR category ILIKE '%online%'
    LIMIT 20
  `);

  console.log("Exemplo de itens importados das integrações (iFood/Jotajá):", ifoodJunk.rows);
}

main().catch(console.error).finally(() => client.end());
