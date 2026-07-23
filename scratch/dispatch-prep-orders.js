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

  // Busca todos os pedidos do usuário em PREPARANDO
  const prepOrders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id, status: "PREPARANDO" }
  });

  console.log(`🚀 Despachando ${prepOrders.length} pedido(s) em preparo...`);

  for (const o of prepOrders) {
    console.log(`\n📦 Despachando Pedido #${o.ifoodOrderId?.slice(-6) || o.id.slice(-6)} (${o.customerName})...`);

    // Atualiza status local para SAIU_ENTREGA
    await prisma.customerOrder.update({
      where: { id: o.id },
      data: { status: "SAIU_ENTREGA", ifoodDriverStatus: "DISPATCHED" }
    });

    // Notifica o iFood via API de dispatch (se for pedido do iFood)
    if (o.ifoodOrderId && token) {
      try {
        const dispatchRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${o.ifoodOrderId}/dispatch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });
        console.log(`   📡 Resposta do iFood Dispatch: HTTP ${dispatchRes.status}`);
      } catch (err) {
        console.error(`   ⚠️ Erro ao enviar dispatch para o iFood:`, err.message);
      }
    }
  }

  console.log(`\n✅ Todos os pedidos em preparo foram movidos para "Saiu para Entrega"!`);
  await prisma.$disconnect();
}

main().catch(console.error);
