require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const targetEmail = "contatohakim@gmail.com";
  
  // 1. Busca o usuário do Hakim
  let user = await prisma.user.findUnique({
    where: { email: targetEmail }
  });

  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  const activeOrders = await prisma.customerOrder.findMany({
    where: { ifoodOrderId: { not: null } },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  console.log(`📋 Atualizando sub-itens e telefone em ${activeOrders.length} pedido(s)...`);

  for (const o of activeOrders) {
    const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${o.ifoodOrderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) continue;

    const data = await res.json();
    const phone = data.customer?.phone;
    const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
    const localizer = phone?.localizer || phone?.phoneLocalizer || data.customer?.phoneLocalizer || data.customer?.localizer;
    const formattedPhone = localizer ? `${number} (ID: ${localizer})` : number;

    if (formattedPhone) {
      await prisma.customerOrder.update({
        where: { id: o.id },
        data: { customerPhone: formattedPhone }
      });
    }

    const ifoodItems = data.items || [];
    for (const dbItem of o.items) {
      const matchedIfoodItem = ifoodItems.find((i) => `ifood-${i.id}` === dbItem.menuProductId || i.name === dbItem.name);
      if (matchedIfoodItem) {
        const options = matchedIfoodItem.options || matchedIfoodItem.subItems || matchedIfoodItem.garnishItems || matchedIfoodItem.items || [];
        if (Array.isArray(options) && options.length > 0) {
          const comboSelections = JSON.stringify(options.map((s) => ({
            name: s.name || s.label || s.productName || "",
            quantity: s.quantity || 1,
            price: s.price || s.unitPrice || s.addition || 0
          })).filter(s => s.name));

          await prisma.customerOrderItem.update({
            where: { id: dbItem.id },
            data: { comboSelections }
          });
          console.log(`   ✨ Item "${matchedIfoodItem.name}" do pedido #${data.displayId || o.id} atualizado com ${options.length} sub-item(ns)!`);
        }
      }
    }
  }

  console.log("✅ Atualização concluída com sucesso!");
  await prisma.$disconnect();
}

main().catch(console.error);
