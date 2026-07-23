require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  console.log("🔑 Token iFood obtido com sucesso!");

  // 1. Busca eventos
  const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    headers: { Authorization: `Bearer ${token}` }
  });

  const eventsText = await res.text();
  const events = eventsText ? JSON.parse(eventsText) : [];
  console.log(`📋 Encontrados ${events.length} evento(s) na fila.`);

  const eventFranchisee = await prisma.user.findFirst({
    where: { email: "contatohakim@gmail.com" }
  });

  if (!eventFranchisee) {
    console.error("❌ Franqueado contatohakim@gmail.com não encontrado!");
    return;
  }

  const processedEventIds = [];

  for (const event of events) {
    const { code, orderId } = event;
    if (!orderId) continue;

    console.log(`📦 Processando evento: ${code} - ${event.fullCode} (orderId: ${orderId})`);

    const exists = await prisma.customerOrder.findFirst({
      where: { ifoodOrderId: orderId }
    });

    if (!exists) {
      // Buscar detalhes do pedido
      const orderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!orderRes.ok) {
        console.error(`❌ Erro ao buscar detalhes do pedido ${orderId}: ${orderRes.status}`);
        continue;
      }

      const orderData = await orderRes.json();

      const items = (orderData.items ?? []).map((i) => {
        const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
        const comboSels = Array.isArray(subItemsList) && subItemsList.length > 0
          ? JSON.stringify(subItemsList.map((s) => ({
              name: s.name || s.label || s.productName || "",
              quantity: s.quantity || 1,
              price: s.price || s.unitPrice || s.addition || 0
            })).filter((s) => s.name))
          : null;

        return {
          price: i.unitPrice ?? i.price ?? 0,
          quantity: i.quantity ?? 1,
          comboSelections: comboSels,
          menuProduct: {
            connectOrCreate: {
              where: { id: `ifood-${i.id}` },
              create: {
                id: `ifood-${i.id}`,
                franchiseeId: eventFranchisee.id,
                name: i.name ?? "Item iFood",
                description: "",
                price: i.unitPrice ?? i.price ?? 0,
                category: "iFood",
                active: true,
              },
            },
          },
        };
      });

      const total = typeof orderData.total === "object"
        ? (orderData.total?.subTotal ?? 0) + (orderData.total?.deliveryFee ?? 0) - (orderData.total?.benefits ?? 0)
        : orderData.totalAmount ?? orderData.total ?? 0;

      const deliveryFee = typeof orderData.total === "object"
        ? orderData.total?.deliveryFee ?? 0
        : orderData.delivery?.deliveryFee ?? 0;

      const paymentList = orderData.payments?.methods ?? orderData.payments ?? [];
      const cashPayment = paymentList.find((p) =>
        p.method === "CASH" || p.name?.toLowerCase().includes("dinheir")
      );
      const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
      const payMethodName = paymentList[0]?.method ?? "iFood Online";

      const phone = orderData.customer?.phone;
      const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
      const localizer = phone?.localizer || phone?.phoneLocalizer || orderData.customer?.phoneLocalizer || orderData.customer?.localizer;
      const formattedPhone = localizer ? `${number} (ID: ${localizer})` : number;

      await prisma.customerOrder.create({
        data: {
          franchiseeId: eventFranchisee.id,
          ifoodOrderId: orderId,
          ifoodReference: orderData.displayId ?? null,
          ifoodDriverStatus: orderData.orderTiming === "TAKEOUT" ? null : "REQUESTED",
          source: "IFOOD",
          customerName: orderData.customer?.name ?? "Cliente iFood",
          customerPhone: formattedPhone,
          customerAddress: orderData.delivery?.deliveryAddress?.formattedAddress ?? "",
          deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
          paymentMethod: cashPayment ? "Dinheiro" : payMethodName,
          totalAmount: total,
          deliveryFee: deliveryFee,
          changeAmount: changeAmount,
          status: "NOVO",
          items: { create: items },
        },
      });

      console.log(`🎉 Pedido iFood #${orderData.displayId} (${orderData.customer?.name}) criado com SUCESSO!`);
    } else {
      console.log(`ℹ️ Pedido #${exists.ifoodReference || orderId} já existe no DB (status: ${exists.status})`);
    }

    processedEventIds.push({ id: event.id });
  }

  // Confirmar eventos para o iFood limpar da fila
  if (processedEventIds.length > 0) {
    const ackRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(processedEventIds),
    });
    console.log(`✅ Acknowledgment enviado para ${processedEventIds.length} eventos (status ${ackRes.status})`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
