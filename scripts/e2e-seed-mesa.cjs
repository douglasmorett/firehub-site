// Dados de teste só para fotografar o módulo de mesa. Banco descartável (prisma dev).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) { console.error('só roda em banco local'); process.exit(1); }
(async () => {
  const email = 'e2e-mesa@teste.local';
  let loja = await p.user.findUnique({ where: { email } });
  if (!loja) {
    loja = await p.user.create({ data: { email, name: 'Gerente Teste', password: await bcrypt.hash('teste123', 10), slug: 'pizzaria-e2e', storeName: 'Pizzaria do Teste', role: 'FRANCHISEE', trialEndsAt: new Date(Date.now() + 30 * 864e5) } });
  }
  const lojaId = loja.id;
  await p.tableGuest.deleteMany({ where: { session: { franchiseeId: lojaId } } });
  await p.customerOrderItem.deleteMany({ where: { order: { franchiseeId: lojaId } } }).catch(() => {});
  await p.customerOrder.deleteMany({ where: { franchiseeId: lojaId } });
  await p.tableSession.deleteMany({ where: { franchiseeId: lojaId } });
  await p.table.deleteMany({ where: { franchiseeId: lojaId } });
  await p.menuProduct.deleteMany({ where: { franchiseeId: lojaId } });
  await p.waiter.deleteMany({ where: { franchiseeId: lojaId } });

  const cardapio = {
    'Pizzas': [['Pizza Calabresa Grande', 69.9], ['Pizza Margherita Grande', 72.9], ['Pizza Quatro Queijos com Borda de Catupiry', 84.9], ['Pizza Frango com Catupiry', 76.9], ['Pizza Portuguesa', 74.9], ['Pizza Broto Chocolate', 39.9]],
    'Lanches': [['X-Burguer', 29.9], ['X-Salada Bacon Duplo', 38.9], ['Hot Dog Completo', 22.0], ['Beirute de Filé', 45.0]],
    'Porções': [['Batata Frita com Cheddar e Bacon', 42.0], ['Calabresa Acebolada', 39.9], ['Frango à Passarinho', 44.9], ['Mandioca Frita', 29.9]],
    'Bebidas': [['Coca-Cola Lata 350ml', 7.0], ['Coca-Cola 2L', 16.0], ['Guaraná Antarctica Lata', 6.5], ['Água sem Gás 500ml', 4.5], ['Suco de Laranja 500ml', 12.0], ['Cerveja Heineken Long Neck', 12.9], ['Chopp Brahma 300ml', 10.9]],
    'Sobremesas': [['Petit Gâteau com Sorvete', 28.0], ['Pudim de Leite', 14.0], ['Açaí 500ml', 24.0]],
  };
  let ordem = 0; const produtos = [];
  for (const [categoria, itens] of Object.entries(cardapio)) {
    for (const [name, price] of itens) {
      produtos.push(await p.menuProduct.create({ data: { franchiseeId: lojaId, name, description: '', price, category: categoria, sortOrder: ordem++, isBeverage: categoria === 'Bebidas' } }));
    }
  }
  for (let n = 1; n <= 16; n++) {
    await p.table.create({ data: { franchiseeId: lojaId, number: n, label: n === 13 ? 'Varanda 1' : n === 14 ? 'Varanda 2' : n === 16 ? 'VIP' : null, sortOrder: n } });
  }
  await p.waiter.create({ data: { franchiseeId: lojaId, name: 'João Pedro', login: 'joao', passwordHash: await bcrypt.hash('garcom123', 12), credentialsUpdatedAt: new Date(Date.now() - 60000), commissionRate: 10 } });
  console.log(JSON.stringify({ lojaId, slug: loja.slug, produtos: produtos.length }));
})().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
