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
  console.log("🚀 Iniciando criação dos 6 pedidos de simulação para gravação de vídeo...");

  // Identificar franqueados principais
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

  // Buscar produtos do cardápio para vincular aos itens dos pedidos
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

  // Definição dos 6 cenários
  const simulationScenarios = [
    {
      ifoodReference: "7821",
      source: "IFOOD",
      customerName: "Camila Rodrigues",
      customerPhone: "(22) 98877-6655",
      customerAddress: "Rua Rego Barros, 150 - Centro, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Crédito (iFood Pago Online)",
      totalAmount: 68.90,
      deliveryFee: 5.00,
      status: "EM_PREPARO",
      kdsStage: "PRODUCTION",
      isRoutePriority: true,
      notes: `${TAG} Pedido iFood #7821 | 🚨 URGENTE - Cliente ligou pedindo agilidade no preparo`,
      items: [
        { quantity: 2, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 1, price: p2.price || 9.98, menuProductId: p2.id },
        { quantity: 1, price: p4.price || 8.00, menuProductId: p4.id }
      ]
    },
    {
      ifoodReference: null,
      source: "ONLINE",
      customerName: "Eduardo Ferreira",
      customerPhone: "(22) 99712-3456",
      customerAddress: "Av. Amaral Peixoto, 4500 - Costazul, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Dinheiro",
      totalAmount: 85.50,
      deliveryFee: 6.00,
      changeAmount: 100.00,
      status: "NOVO",
      kdsStage: "PRODUCTION",
      isRoutePriority: false,
      notes: `${TAG} 💵 Pagamento em dinheiro | Troco para R$ 100,00 (Levar R$ 14,50 de troco)`,
      items: [
        { quantity: 2, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 3, price: p3.price || 6.90, menuProductId: p3.id }
      ]
    },
    {
      openDeliveryReference: "3409",
      source: "JOTAJA",
      customerName: "Marcela Souza",
      customerPhone: "(22) 99234-5678",
      customerAddress: "Rua Campo de Albacora, 88 - Recreio, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Cartão de Débito na Entrega",
      totalAmount: 54.00,
      deliveryFee: 5.00,
      status: "PRONTO",
      kdsStage: "FINISHING",
      isRoutePriority: false,
      notes: `${TAG} Pedido Jotajá #3409 | 💳 Levar maquininha de cartão de débito`,
      items: [
        { quantity: 1, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 2, price: p2.price || 9.98, menuProductId: p2.id }
      ]
    },
    {
      ifoodReference: null,
      source: "PRESENCIAL",
      customerName: "Bruno Castro (Balcão)",
      customerPhone: "(22) 98111-2233",
      customerAddress: "Balcão / Retirada no Local",
      deliveryType: "RETIRADA",
      paymentMethod: "PIX Online",
      totalAmount: 42.90,
      deliveryFee: 0.00,
      status: "EM_PREPARO",
      kdsStage: "PRODUCTION",
      isRoutePriority: false,
      notes: `${TAG} 🏪 Cliente aguardando na loja para retirada`,
      items: [
        { quantity: 2, price: p3.price || 6.90, menuProductId: p3.id },
        { quantity: 1, price: p1.price || 24.90, menuProductId: p1.id }
      ]
    },
    {
      ifoodReference: null,
      source: "ONLINE",
      customerName: "Lucas Mendes",
      customerPhone: "(22) 99888-7766",
      customerAddress: "Rua Bangu, 310 - Jardim Marilea, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Cartão de Crédito - Mastercard",
      totalAmount: 92.00,
      deliveryFee: 7.00,
      status: "NOVO",
      kdsStage: "PRODUCTION",
      isRoutePriority: false,
      notes: `${TAG} 🎟️ Cupom PRIMEIRACOMPRA (-R$ 10,00) | 💬 Obs: Caprichar no molho especial`,
      items: [
        { quantity: 3, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 2, price: p2.price || 9.98, menuProductId: p2.id }
      ]
    },
    {
      ifoodReference: "9102",
      source: "IFOOD",
      customerName: "Fernanda Oliveira",
      customerPhone: "(22) 99654-9876",
      customerAddress: "Rua Santa Catarina, 75 - Extensão do Bosque, Rio das Ostras - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Crédito (iFood Pago Online)",
      totalAmount: 115.00,
      deliveryFee: 6.00,
      status: "PRONTO",
      kdsStage: "FINISHING",
      isRoutePriority: true,
      notes: `${TAG} Pedido iFood #9102 | 📦 Pedido Família - Embalagem dupla`,
      items: [
        { quantity: 4, price: p1.price || 24.90, menuProductId: p1.id },
        { quantity: 2, price: p4.price || 8.00, menuProductId: p4.id }
      ]
    }
  ];

  const createdOrderIds = [];

  for (const franchisee of primaryFranchisees) {
    console.log(`\nCriando 6 pedidos para o franqueado: ${franchisee.name} (${franchisee.storeName || franchisee.id})...`);

    for (let i = 0; i < simulationScenarios.length; i++) {
      const scenario = simulationScenarios[i];
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
        createdAt: new Date(now.getTime() - (i * 3 * 60 * 1000)), // 3 minutos de diferença entre cada
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
      console.log(`  [${i+1}/6] Pedido Criado: ${created.customerName} - ID: ${created.id} (Status: ${created.status})`);
    }
  }

  // Salva o log de IDs em um arquivo JSON para que o cancelamento posterior seja 100% preciso
  const logFilePath = path.join(__dirname, 'video_simulation_orders_created.json');
  fs.writeFileSync(logFilePath, JSON.stringify({ createdAt: new Date().toISOString(), orderIds: createdOrderIds }, null, 2));

  console.log("\n=========================================================");
  console.log(`✨ SIMULAÇÃO CONCLUÍDA COM SUCESSO! Total de pedidos inseridos: ${createdOrderIds.length}`);
  console.log(`📁 IDs dos pedidos salvos em: ${logFilePath}`);
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
