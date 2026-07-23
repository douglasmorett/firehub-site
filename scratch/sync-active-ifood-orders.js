require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const clientId = process.env.IFOOD_CLIENT_ID;
const clientSecret = process.env.IFOOD_CLIENT_SECRET;
const merchantId = "6a5fb96d-68bd-46af-ada4-456a9a160787";

async function main() {
  // Encontra o usuário responsável no banco
  const franchisee = await prisma.user.findFirst({
    where: { ifoodMerchantId: merchantId }
  }) || await prisma.user.findFirst();

  if (!franchisee) {
    console.error("❌ Nenhum usuário encontrado no banco.");
    return;
  }
  console.log("👤 Usuário associado:", franchisee.email, "(ID:", franchisee.id + ")");

  // 1. Obtém token iFood
  console.log("🔑 Obtendo token iFood...");
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
  console.log("✅ Token OK!");

  // 2. Poll events
  console.log("📥 Buscando eventos no iFood...");
  const pollRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (pollRes.status !== 200 && pollRes.status !== 204) {
    console.error("❌ Erro no Polling:", pollRes.status, await pollRes.text());
    return;
  }

  const events = pollRes.status === 200 ? await pollRes.json() : [];
  console.log(`📋 ${events.length} evento(s) encontrado(s).`);

  const orderIdsToFetch = new Set();
  for (const ev of events) {
    if (ev.orderId) orderIdsToFetch.add(ev.orderId);
  }

  // Adiciona também IDs de pedidos recentes conhecidos do iFood
  const knownRecentOrders = [
    "9a53a75d-24f0-4262-8bd2-ac5b32d39e85",
    "e38f03c3-494f-4194-a03b-f1bddb39d8d1",
    "ec047bd1-80e6-4088-987d-b53b78532ddd",
    "e5507d2b-361e-4395-a7ec-a58faba376fa"
  ];
  for (const id of knownRecentOrders) orderIdsToFetch.add(id);

  console.log(`📦 Processando ${orderIdsToFetch.size} pedido(s)...`);

  for (const orderId of orderIdsToFetch) {
    try {
      // Verifica se já existe
      const existing = await prisma.customerOrder.findFirst({
        where: { ifoodOrderId: orderId }
      });

      console.log(`\n🔍 Buscando detalhes do pedido ${orderId}...`);
      const orderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!orderRes.ok) {
        console.log(`   ⚠️ HTTP ${orderRes.status} para o pedido ${orderId}:`, await orderRes.text());
        continue;
      }

      const o = await orderRes.json();
      console.log(`   ✅ Pedido #${o.displayId || orderId.slice(-6)} | Cliente: ${o.customer?.name} | Total: R$ ${o.total?.orderAmount || o.totalPrice}`);

      const items = (o.items || []).map(i => ({
        price: i.unitPrice || i.price || 0,
        quantity: i.quantity || 1,
        menuProduct: {
          connectOrCreate: {
            where: { id: `ifood-${i.id}` },
            create: {
              id: `ifood-${i.id}`,
              franchiseeId: franchisee.id,
              name: i.name || "Item iFood",
              description: "",
              price: i.unitPrice || i.price || 0,
              category: "iFood",
              active: true
            }
          }
        }
      }));

      const total = typeof o.total === "object"
        ? (o.total?.orderAmount ?? o.total?.subTotal ?? 0)
        : (o.totalPrice ?? o.total ?? 0);

      const payMethod = o.payments?.methods?.[0]?.method || "iFood Online";

      if (existing) {
        console.log(`   ℹ️ Pedido ${orderId} já existe no banco. Atualizando status...`);
        await prisma.customerOrder.update({
          where: { id: existing.id },
          data: {
            status: o.status === "PLACED" ? "NOVO" : o.status === "CONFIRMED" ? "ACEITO" : o.status === "DISPATCHED" ? "SAIU_ENTREGA" : "ENTREGUE"
          }
        });
      } else {
        const createdOrder = await prisma.customerOrder.create({
          data: {
            franchiseeId: franchisee.id,
            ifoodOrderId: orderId,
            ifoodReference: o.displayId || undefined,
            source: "IFOOD",
            customerName: o.customer?.name || "Cliente iFood",
            customerPhone: o.customer?.phone?.number || "",
            customerAddress: o.delivery?.deliveryAddress?.formattedAddress || "",
            deliveryType: o.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
            paymentMethod: payMethod,
            totalAmount: total,
            deliveryFee: o.total?.deliveryFee || 0,
            status: "NOVO",
            notes: `Pedido iFood #${(o.displayId || orderId.slice(-6)).toUpperCase()}`,
            items: { create: items }
          }
        });
        console.log(`   ✨ Pedido CRIADO COM SUCESSO no banco! ID: ${createdOrder.id}`);
      }
    } catch (e) {
      console.error(`   ❌ Erro ao importar pedido ${orderId}:`, e.message);
    }
  }

  // Acknowledge eventos recebidos se houver
  if (events.length > 0) {
    const processed = events.map(e => ({ id: e.id, orderId: e.orderId, eventType: e.fullCode || e.code }));
    await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(processed)
    });
    console.log(`\n✅ ${processed.length} evento(s) confirmados (acknowledged) no iFood.`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
