require('dotenv').config();
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Get Hakim user ID
  const { rows: users } = await pool.query(`SELECT id, "ownerId" FROM "User" WHERE email LIKE '%contatohakim%' LIMIT 1`);
  if (!users || users.length === 0) {
    console.error("Usuário Hakim não encontrado!");
    await pool.end();
    return;
  }

  const franchiseeId = users[0].ownerId || users[0].id;

  // 2. Copy image to public/uploads
  const srcImg = 'C:\\Users\\Micro\\.gemini\\antigravity\\brain\\277517b7-eeca-407e-8e8d-6e77ad9d79a3\\.user_uploaded\\media__1784939036982.png';
  const destDir = path.join(__dirname, '..', 'public', 'uploads');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destImg = path.join(destDir, 'batata_frita.png');
  fs.copyFileSync(srcImg, destImg);
  console.log("Imagem copiada para:", destImg);

  const imageUrl = '/uploads/batata_frita.png';

  // 3. Check existing product
  const { rows: existing } = await pool.query(
    `SELECT id FROM "MenuProduct" WHERE "franchiseeId" = $1 AND LOWER(name) = 'batata frita' LIMIT 1`,
    [franchiseeId]
  );

  if (existing && existing.length > 0) {
    const prodId = existing[0].id;
    await pool.query(
      `UPDATE "MenuProduct" SET name = 'Batata Frita', category = 'Acompanhamentos', description = $1, price = 9.90, "imageUrl" = $2, active = true, "activePDV" = true, "activeDelivery" = true, "isCombo" = false, "isBeverage" = false, "updatedAt" = NOW() WHERE id = $3`,
      ['Huum.. Uma batatinha.. Deu água na boca só de pensar', imageUrl, prodId]
    );
    console.log("✅ Produto Batata Frita ATUALIZADO no banco!", prodId);
  } else {
    const prodId = 'mp_batata_frita_' + Date.now();
    await pool.query(
      `INSERT INTO "MenuProduct" (id, "franchiseeId", name, category, description, price, "imageUrl", active, "activePDV", "activeDelivery", "isCombo", "isBeverage", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Batata Frita', 'Acompanhamentos', $3, 9.90, $4, true, true, true, false, false, NOW(), NOW())`,
      [prodId, franchiseeId, 'Huum.. Uma batatinha.. Deu água na boca só de pensar', imageUrl]
    );
    console.log("✅ Produto Batata Frita CRIADO com sucesso no banco!", prodId);
  }

  await pool.end();
}

main().catch(console.error);
