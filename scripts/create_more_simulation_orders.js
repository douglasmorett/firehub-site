require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const TAG = '[SIMULACAO_VIDEO]';

async function queryWithRetry(fn, retries = 5, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`⚠️ Tentativa ${i + 1} de conexão com o banco falhou, tentando novamente em ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

async function main() {
  console.log("🚀 Criando mais 4 pedidos de simulação detalhados para o Roteirizador e KDS...");

  const primaryFranchisees = await queryWithRetry(() =>
    prisma.user.findMany({
      where: {
        id: { in: ['cmpx96phr0000ujf0sb0qk5vr', 'cmo3fnu2b0000emekf687codx', 'cmornm4wd0000l804s0jy0eit'] }
      },
      select: { id: true, name: true, storeName: true }
    })
  );

  if (primaryFranchisees.length === 0) {
    console.error("Nenhum franqueado encontrado!");
    return;
  }

  const targetFranchiseeId = 'cmpx96phr0000ujf0sb0qk5vr';

  let products = await queryWithRetry(() =>
    prisma.menuProduct.findMany({
      where: { franchiseeId: targetFranchiseeId, active: true },
      take: 10
    })
  );

  if (products.length === 0) {
    products = await queryWithRetry(() => prisma.menuProduct.findMany({ take: 10 }));
  }

  const p1 = products[0] || { id: null, price: 24.90, name: "Esfirras de Carne" };
  const p2 = products[1] || { id: null, price: 9.98, name: "Esfirra 5 Queijos" };
  const p3 = products[2] || { id: null, price: 6.90, name: "Doguinho" };
  const p4 = products[3] || { id: null, price: 8.00, name: "Bebida Gelada" };

  const now = new Date();

  // 4 Novos Cenários com notas ricas e endereços geocodificáveis
  const extraScenarios = [
    {
      ifoodReference: "4412",
      source: "IFOOD",
      customerName: "Rodrigo Alves",
      customerPhone: "(22) 99911-2244",
      customerAddress: "Rua Nova Friburgo, 210 - Cidade Beira Mar, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "PIX (iFood Pago Online)",
      totalAmount: 74.50,
      deliveryFee: 6.00,
      status: "EM_PREPARO",
      kdsStage: "PRODUCTION",
      isRoutePriority: true,
      notes: `${TAG} Pedido iFood #4412 | 🏠 Ponto de ref: Em frente à praça do bairro, portão verde | 🔔 Favor tocar campainha 2 vezes`,
      items: [
        { quantity: 2, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 2, price: p2.price || 9.98, menuProductId: p2.id }
      ]
    },
    {
      ifoodReference: null,
      source: "ONLINE",
      customerName: "Juliana Paes",
      customerPhone: "(22) 99822-3355",
      customerAddress: "Rua das Camélias, 85 - Âncora, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Dinheiro",
      totalAmount: 48.00,
      deliveryFee: 5.00,
      changeAmount: 100.00,
      status: "PRONTO",
      kdsStage: "FINISHING",
      isRoutePriority: false,
      notes: `${TAG} 💵 Pagamento em DINHEIRO | 💰 Troco para R$ 100,00 (Levar R$ 52,00 de troco em notas) | 🐕 Cuidado: Cachorro no quintal`,
      items: [
        { quantity: 1, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 2, price: p3.price || 6.90, menuProductId: p3.id }
      ]
    },
    {
      openDeliveryReference: "8830",
      source: "JOTAJA",
      customerName: "Gabriel Siqueira",
      customerPhone: "(22) 99733-4466",
      customerAddress: "Av. Governador Roberto Silveira, 890 - Costazul, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Cartão de Crédito na Entrega",
      totalAmount: 128.90,
      deliveryFee: 7.00,
      status: "NOVO",
      kdsStage: "PRODUCTION",
      isRoutePriority: true,
      notes: `${TAG} Pedido Jotajá #8830 | 💳 LEVAR MAQUININHA (Crédito Visa 2x) | 🏢 Apt 302 - Deixar na portaria se demorar`,
      items: [
        { quantity: 4, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 2, price: p4.price || 8.00, menuProductId: p4.id }
      ]
    },
    {
      ifoodReference: null,
      source: "ONLINE",
      customerName: "Vanessa Camargo",
      customerPhone: "(22) 99644-5577",
      customerAddress: "Rua Teresópolis, 42 - Balneário Remanso, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "PIX Online (Pago)",
      totalAmount: 62.00,
      deliveryFee: 5.50,
      status: "EM_PREPARO",
      kdsStage: "PRODUCTION",
      isRoutePriority: true,
      notes: `${TAG} ⚡ ENTREGA EXPRESSA ROTA | 🎟️ Cupom CLIENTEVIP (-R$ 8,00) | 💬 Sem gelo nos sucos por favor`,
      items: [
        { quantity: 3, price: p2.price || 9.98, menuProductId: p2.id },
        { quantity: 1, price: p4.price || 8.00, menuProductId: p4.id }
      ]
    }
  ];

  const logFilePath = path.join(__dirname, 'video_simulation_orders_created.json');
  let existingIds = [];
  if (fs.existsSync(logFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
      existingIds = data.orderIds || [];
    } catch {}
  }

  const createdOrderIds = [...existingIds];

  for (const franchisee of primaryFranchisees) {
    console.log(`\nCriando 4 novos pedidos para: ${franchisee.name}...`);

    for (let i = 0; i < extraScenarios.length; i++) {
      const scenario = extraScenarios[i];
      const itemsData = scenario.items.map(item => {
        const itemObj = { quantity: item.quantity, price: item.price };
        if (item.menuProductId) itemObj.menuProductId = item.menuProductId;
        return itemObj;
      });

      const orderData = {
        franchiseeId: franchisee.id,
        source: scenario.source,
        ifoodOrderId: scenario.ifoodReference ? `sim-ifood-${franchisee.id}-${scenario.ifoodReference}-${Date.now()}` : null,
        ifoodReference: scenario.ifoodReference,
        openDeliveryOrderId: scenario.openDeliveryReference ? `sim-open-${franchisee.id}-${scenario.openDeliveryReference}-${Date.now()}` : null,
        openDeliveryReference: scenario.openDeliveryReference,
        customerName: scenario.customerName,
        customerPhone: scenario.customerPhone,
        customerAddress: scenario.customerAddress,
        deliveryType: scenario.deliveryType,
        paymentMethod: scenario.paymentMethod,
        totalAmount: scenario.totalAmount,
        deliveryFee: scenario.deliveryFee,
        changeAmount: scenario.changeAmount || null,
        status: scenario.status,
        kdsStage: scenario.kdsStage,
        isRoutePriority: scenario.isRoutePriority,
        notes: scenario.notes,
        createdAt: new Date(now.getTime() - ((i + 6) * 3 * 60 * 1000)),
        items: {
          create: itemsData
        }
      };

      const created = await queryWithRetry(() =>
        prisma.customerOrder.create({
          data: orderData,
          include: { items: true }
        })
      );

      createdOrderIds.push(created.id);
      console.log(`  [+${i+1}/4] Novo Pedido Criado: ${created.customerName} - ID: ${created.id} (Status: ${created.status})`);
    }
  }

  fs.writeFileSync(logFilePath, JSON.stringify({ createdAt: new Date().toISOString(), orderIds: createdOrderIds }, null, 2));

  console.log("\n=========================================================");
  console.log(`✨ 4 NOVOS PEDIDOS ADICIONADOS COM SUCESSO! Total acumulado: ${createdOrderIds.length}`);
  console.log("=========================================================");
}

main()
  .catch(e => {
    console.error("Erro na simulação:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
