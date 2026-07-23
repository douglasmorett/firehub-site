require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const clientId = process.env.IFOOD_CLIENT_ID;
const clientSecret = process.env.IFOOD_CLIENT_SECRET;

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "contatohakim@gmail.com" } });
  if (!user) { console.error("Usuário não encontrado!"); return; }

  // 1. Obtém token iFood
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  if (!token) {
    console.error("❌ Erro ao obter token:", authData);
    return;
  }

  // Busca todos os pedidos do usuário
  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id, ifoodOrderId: { not: null } }
  });

  console.log(`🔍 Atualizando status reais de ${orders.length} pedidos no iFood...`);

  let updatedCount = 0;

  for (const o of orders) {
    if (!o.ifoodOrderId) continue;
    try {
      const orderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${o.ifoodOrderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!orderRes.ok) continue;

      const ifoodData = await orderRes.json();
      // Mapeia o status do iFood para os status do FireHub
      // Status possíveis no iFood: PLACED, CONFIRMED, START_PREPARATION / PREPARATION_STARTED, READY_FOR_PICKUP, DISPATCHED, CONCLUDED, CANCELLED
      const rawStatus = (ifoodData.status || "").toUpperCase();

      let mappedStatus = o.status;
      if (rawStatus === "PLACED") mappedStatus = "NOVO";
      else if (rawStatus === "CONFIRMED") mappedStatus = "ACEITO";
      else if (rawStatus === "START_PREPARATION" || rawStatus === "PREPARATION_STARTED" || rawStatus === "IN_PREPARATION" || rawStatus === "READY_FOR_PICKUP") mappedStatus = "PREPARANDO";
      else if (rawStatus === "DISPATCHED" || rawStatus === "TAKEOUT_READY_FOR_PICKUP") mappedStatus = "SAIU_ENTREGA";
      else if (rawStatus === "CONCLUDED") mappedStatus = "ENTREGUE";
      else if (rawStatus === "CANCELLED" || rawStatus === "CANCELLATION_REQUESTED") mappedStatus = "CANCELADO";

      console.log(`Pedido #${ifoodData.displayId || o.ifoodOrderId.slice(-6)} | iFood Status: "${rawStatus}" -> FireHub Status: "${mappedStatus}" (Anterior: "${o.status}")`);

      await prisma.customerOrder.update({
        where: { id: o.id },
        data: { status: mappedStatus }
      });

      updatedCount++;
    } catch (e) {
      console.error(`Erro ao atualizar pedido ${o.ifoodOrderId}:`, e.message);
    }
  }

  console.log(`\n🎉 ${updatedCount} pedidos atualizados com os status reais do iFood!`);
  await prisma.$disconnect();
}

main().catch(console.error);
