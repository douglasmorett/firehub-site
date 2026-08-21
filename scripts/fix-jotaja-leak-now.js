const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const dbUrl = "postgresql://neondb_owner:npg_9C4DXWRhvBUo@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require";
const sql = neon(dbUrl);

async function main() {
  console.log("=== EXECUTANDO FIX JOTAJA VIA NEON SERVERLESS (PORTA 443) ===");

  // 1. Buscar Hakim e Pastel da Paulista
  const hakimUsers = await sql`SELECT id, email, "storeName" FROM "User" WHERE email = 'contatohakim@gmail.com' LIMIT 1;`;
  const pastelUsers = await sql`SELECT id, email, "storeName" FROM "User" WHERE email = 'pasteldapaulistamacae21@gmail.com' LIMIT 1;`;

  const hakim = hakimUsers[0];
  const pastel = pastelUsers[0];

  console.log("Hakim:", hakim);
  console.log("Pastel da Paulista:", pastel);

  if (!hakim) {
    throw new Error("Hakim não encontrado!");
  }

  // 2. Atualizar Hakim: jotajaConnected = true, jotajaMerchantId = '14800'
  await sql`
    UPDATE "User"
    SET "jotajaConnected" = true,
        "jotajaMerchantId" = '14800'
    WHERE id = ${hakim.id};
  `;
  console.log("✅ Hakim atualizado com jotajaConnected = true e jotajaMerchantId = 14800");

  // 3. Limpar Pastel da Paulista: jotajaConnected = false, jotajaMerchantId = null
  if (pastel) {
    await sql`
      UPDATE "User"
      SET "jotajaConnected" = false,
          "jotajaMerchantId" = null,
          "jotajaClientId" = null,
          "jotajaClientSecret" = null
      WHERE id = ${pastel.id};
    `;
    console.log("✅ Pastel da Paulista desconectado do JotaJá");
  }

  // 4. Buscar pedidos a serem migrados
  let leakedOrders = [];
  if (pastel) {
    leakedOrders = await sql`
      SELECT id, "customerName", "openDeliveryReference", "totalAmount", "dailyOrderNumber", "franchiseeId"
      FROM "CustomerOrder"
      WHERE "franchiseeId" = ${pastel.id}
         OR "customerName" ILIKE '%PATRICK%'
         OR "openDeliveryReference" = '32857612';
    `;
  } else {
    leakedOrders = await sql`
      SELECT id, "customerName", "openDeliveryReference", "totalAmount", "dailyOrderNumber", "franchiseeId"
      FROM "CustomerOrder"
      WHERE "customerName" ILIKE '%PATRICK%'
         OR "openDeliveryReference" = '32857612';
    `;
  }

  console.log(`Encontrados ${leakedOrders.length} pedido(s) a migrar:`);

  // 5. Buscar o maior dailyOrderNumber para o Hakim hoje
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxOrderRes = await sql`
    SELECT MAX("dailyOrderNumber") as max_num
    FROM "CustomerOrder"
    WHERE "franchiseeId" = ${hakim.id}
      AND "createdAt" >= ${today.toISOString()};
  `;

  let currentMax = Number(maxOrderRes[0]?.max_num || 0);

  for (const order of leakedOrders) {
    currentMax += 1;
    await sql`
      UPDATE "CustomerOrder"
      SET "franchiseeId" = ${hakim.id},
          "dailyOrderNumber" = ${currentMax}
      WHERE id = ${order.id};
    `;

    console.log(`  -> Pedido #${order.id} (${order.customerName}) | Ref: ${order.openDeliveryReference} | R$ ${order.totalAmount}`);
    console.log(`     Transferido para Hakim com dailyOrderNumber = #${currentMax} (no final da fila sem colisão)`);
  }

  console.log("=== SUCESSO: TODOS OS PEDIDOS MIGRADOS E ISOLAMENTO RESTABELECIDO! ===");
}

main().catch(e => {
  console.error("ERRO:", e);
  process.exit(1);
});
