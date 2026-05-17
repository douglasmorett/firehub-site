const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Busca o admin para usar como franchiseeId
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) { console.log("Admin não encontrado"); return; }
  
  console.log(`Usando franchisee: ${admin.name} (${admin.id})`);

  // Busca um produto existente para vincular aos itens
  let product = await p.menuProduct.findFirst({ where: { franchiseeId: admin.id } });
  if (!product) {
    product = await p.menuProduct.create({
      data: {
        franchiseeId: admin.id,
        name: "X-Burger Especial",
        description: "Hambúrguer artesanal com queijo, bacon e salada",
        price: 32.90,
        category: "Lanches",
        active: true,
      }
    });
    console.log("Produto criado:", product.name);
  }

  // Produto 2
  let product2 = await p.menuProduct.findFirst({ 
    where: { franchiseeId: admin.id, name: { not: product.name } } 
  });
  if (!product2) {
    product2 = await p.menuProduct.create({
      data: {
        franchiseeId: admin.id,
        name: "Coca-Cola 600ml",
        description: "Refrigerante gelado",
        price: 8.00,
        category: "Bebidas",
        active: true,
      }
    });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 30, 0, 0);

  // ═══════════════════════════════════════════════════════════
  // CENÁRIO 1: Pedido Agendado com Voucher
  // ═══════════════════════════════════════════════════════════
  const order1 = await p.customerOrder.create({
    data: {
      franchiseeId: admin.id,
      ifoodOrderId: `ifood-test-scheduled-${Date.now()}`,
      ifoodReference: "SCH-A1B2C3",
      source: "IFOOD",
      customerName: "Maria Silva Santos",
      customerPhone: "11987654321",
      customerAddress: "Rua das Flores, 123 - Centro, São Paulo - SP",
      deliveryType: "DELIVERY",
      paymentMethod: "Crédito - Visa",
      totalAmount: 73.80,
      status: "NOVO",
      scheduledDatetime: tomorrow,
      notes: "Pedido iFood #SCH-A1B2C3 | 📅 AGENDADO para " + tomorrow.toLocaleString("pt-BR") + " | 🎟️ Voucher: VOUCHER_ENTGRATIS: -R$10.00 | 💬 Obs. cliente: Sem cebola no hambúrguer por favor",
      items: {
        create: [
          { quantity: 2, price: 32.90, menuProductId: product.id },
          { quantity: 1, price: 8.00, menuProductId: product2.id },
        ]
      }
    }
  });
  console.log("✅ Cenário 1 criado - Pedido Agendado com Voucher");
  console.log("   orderId:", order1.id);

  // ═══════════════════════════════════════════════════════════
  // CENÁRIO 2: Pedido Manual com Cancelamento (será cancelado no vídeo)
  // ═══════════════════════════════════════════════════════════
  const order2 = await p.customerOrder.create({
    data: {
      franchiseeId: admin.id,
      ifoodOrderId: `ifood-test-manual-${Date.now()}`,
      ifoodReference: "MAN-D4E5F6",
      source: "IFOOD",
      customerName: "João Pedro Oliveira",
      customerPhone: "21976543210",
      customerAddress: "Av. Brasil, 456 - Copacabana, Rio de Janeiro - RJ",
      deliveryType: "DELIVERY",
      paymentMethod: "Cartão na entrega - Débito",
      totalAmount: 40.90,
      status: "NOVO",
      notes: "Pedido iFood #MAN-D4E5F6 | 💳 Pagamento na entrega com cartão de débito",
      items: {
        create: [
          { quantity: 1, price: 32.90, menuProductId: product.id },
          { quantity: 1, price: 8.00, menuProductId: product2.id },
        ]
      }
    }
  });
  console.log("✅ Cenário 2 criado - Pedido Manual (para cancelar)");
  console.log("   orderId:", order2.id);

  // ═══════════════════════════════════════════════════════════
  // CENÁRIO 3: Pedido para Retirada
  // ═══════════════════════════════════════════════════════════
  const order3 = await p.customerOrder.create({
    data: {
      franchiseeId: admin.id,
      ifoodOrderId: `ifood-test-takeout-${Date.now()}`,
      ifoodReference: "TKO-G7H8I9",
      source: "IFOOD",
      customerName: "Ana Carolina Souza",
      customerPhone: "11912345678",
      customerAddress: "",
      deliveryType: "RETIRADA",
      paymentMethod: "Crédito - Mastercard",
      totalAmount: 65.80,
      status: "NOVO",
      notes: "Pedido iFood #TKO-G7H8I9 | 🏪 RETIRADA NO LOCAL",
      items: {
        create: [
          { quantity: 2, price: 32.90, menuProductId: product.id },
        ]
      }
    }
  });
  console.log("✅ Cenário 3 criado - Pedido para Retirada");
  console.log("   orderId:", order3.id);

  // ═══════════════════════════════════════════════════════════
  // CENÁRIO 4: Cancelamento pela Plataforma
  // ═══════════════════════════════════════════════════════════
  const order4 = await p.customerOrder.create({
    data: {
      franchiseeId: admin.id,
      ifoodOrderId: `ifood-test-cancelled-${Date.now()}`,
      ifoodReference: "CAN-J0K1L2",
      source: "IFOOD",
      customerName: "Roberto Almeida Neto",
      customerPhone: "31998765432",
      customerAddress: "Rua Minas Gerais, 789 - Savassi, Belo Horizonte - MG",
      deliveryType: "DELIVERY",
      paymentMethod: "Crédito - Elo",
      totalAmount: 32.90,
      status: "CANCELADO",
      cancelledBy: "IFOOD",
      notes: "Pedido iFood #CAN-J0K1L2 | 🚫 Cancelado automaticamente pela plataforma iFood",
      items: {
        create: [
          { quantity: 1, price: 32.90, menuProductId: product.id },
        ]
      }
    }
  });
  console.log("✅ Cenário 4 criado - Cancelamento pela Plataforma");
  console.log("   orderId:", order4.id);

  // ═══════════════════════════════════════════════════════════
  // CENÁRIO 5: Pagamento em Dinheiro com Troco
  // ═══════════════════════════════════════════════════════════
  const order5 = await p.customerOrder.create({
    data: {
      franchiseeId: admin.id,
      ifoodOrderId: `ifood-test-cash-${Date.now()}`,
      ifoodReference: "CSH-M3N4O5",
      source: "IFOOD",
      customerName: "Fernanda Lima Costa",
      customerPhone: "41987651234",
      customerAddress: "Rua XV de Novembro, 321 - Centro, Curitiba - PR",
      deliveryType: "DELIVERY",
      paymentMethod: "Dinheiro",
      totalAmount: 73.80,
      status: "NOVO",
      changeAmount: 100.00,
      customerCpfCnpj: "123.456.789-00",
      notes: "Pedido iFood #CSH-M3N4O5 | 💵 Pagamento em DINHEIRO | 💰 Troco para R$100,00 | 🪪 CPF: 123.456.789-00 | 💬 Obs. cliente: Interfone 204, portão branco",
      items: {
        create: [
          { quantity: 2, price: 32.90, menuProductId: product.id },
          { quantity: 1, price: 8.00, menuProductId: product2.id },
        ]
      }
    }
  });
  console.log("✅ Cenário 5 criado - Dinheiro com Troco + CPF");
  console.log("   orderId:", order5.id);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📋 RESUMO DE ORDERIDS PARA O TICKET:");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Cenário 1 (Agendado+Voucher): ${order1.id}`);
  console.log(`Cenário 2 (Manual+Cancel):    ${order2.id}`);
  console.log(`Cenário 3 (Retirada):         ${order3.id}`);
  console.log(`Cenário 4 (Cancel Plataforma): ${order4.id}`);
  console.log(`Cenário 5 (Dinheiro+Troco):   ${order5.id}`);

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
