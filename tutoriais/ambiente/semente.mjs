// Semente da LOJA FICTÍCIA dos tutoriais em vídeo.
//
// Os vídeos são vistos por todos os lojistas, então nada do que aparece na
// gravação pode ser de uma loja de verdade: cliente, telefone, endereço e
// faturamento são inventados aqui, e a gravação roda contra um banco LOCAL
// descartável (PGlite). Este script recusa qualquer outro banco.
//
// Uso:  node tutoriais/ambiente/semente.mjs
// (DATABASE_URL vem do .env.local da pasta — ver tutoriais/README.md)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fusoDaNoite } from "./relogio.mjs";

export const LOJA = { email: "demo@tutorial.local", senha: "tutorial123", slug: "sabor-da-praca", nome: "Sabor da Praça" };

function urlDoBanco() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const arquivo = path.join(process.cwd(), ".env.local");
  const linha = fs.existsSync(arquivo)
    ? fs.readFileSync(arquivo, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
    : null;
  return linha ? linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "") : "";
}

export function banco() {
  const url = urlDoBanco();
  if (!/@(localhost|127\.0\.0\.1):/.test(url)) {
    throw new Error("Recusado: DATABASE_URL não é um banco local. A semente dos tutoriais só roda no banco descartável.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const haMin = (m) => new Date(Date.now() - m * 60_000);

export async function semear(prisma) {
  // Banco do zero a cada gravação. Apagar só a loja não basta: cada gravação
  // deixa linhas em outras tabelas (fila de impressão, avisos, histórico) que
  // apontam para ela, e o delete esbarra nessas referências. Como o banco é
  // descartável e só existe para os tutoriais (banco() recusa qualquer outro),
  // esvaziam-se todas as tabelas de uma vez.
  const tabelas = await prisma.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'",
  );
  if (tabelas.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tabelas.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }

  const loja = await prisma.user.create({
    data: {
      name: "Sabor da Praça",
      email: LOJA.email,
      password: await bcrypt.hash(LOJA.senha, 10),
      role: "FRANCHISEE",
      city: "Cidade Exemplo",
      slug: LOJA.slug,
      storeName: LOJA.nome,
      storePhone: "11999990000",
      storeAddress: "Praça Central, 100 - Centro, Cidade Exemplo",
      storeHours: DIAS.map((day) => ({ day, open: "00:00", close: "23:59", active: true, shifts: [{ open: "00:00", close: "23:59" }] })),
      storeOpen: true,
      cashOpen: true,
      // Loja "antiga": sem a faixa de teste grátis no topo, que não é assunto de nenhum vídeo.
      trialEndsAt: new Date(Date.now() - 300 * 86_400_000),
      createdAt: new Date(Date.now() - 330 * 86_400_000),
      storeTimezone: fusoDaNoite(),
      onboardingData: { concluido: true, completed: true },
    },
  });
  const L = loja.id;

  await prisma.menuCategory.createMany({
    data: [
      { franchiseeId: L, name: "Lanches", emoji: "🍔", sortOrder: 0 },
      { franchiseeId: L, name: "Pizzas", emoji: "🍕", sortOrder: 1 },
      { franchiseeId: L, name: "Porções", emoji: "🍟", sortOrder: 2 },
      { franchiseeId: L, name: "Bebidas", emoji: "🥤", sortOrder: 3 },
    ],
  });

  const cardapio = [
    ["X-Burger", "Pão, hambúrguer de 150 g e queijo", 22, "Lanches", false],
    ["X-Bacon", "Pão, hambúrguer, queijo e bacon crocante", 27, "Lanches", false],
    ["X-Tudo", "Hambúrguer, ovo, bacon, presunto, queijo e salada", 32, "Lanches", false],
    ["Pizza Calabresa", "Grande, 8 fatias", 54, "Pizzas", false],
    ["Pizza Marguerita", "Grande, 8 fatias", 52, "Pizzas", false],
    ["Batata Frita", "Porção de 400 g", 18, "Porções", false],
    ["Coca-Cola lata", "350 ml", 7, "Bebidas", true],
    ["Guaraná 2 L", "Garrafa de 2 litros", 12, "Bebidas", true],
  ];
  const produtos = {};
  for (const [i, [name, description, price, category, isBeverage]] of cardapio.entries()) {
    produtos[name] = await prisma.menuProduct.create({
      data: { franchiseeId: L, name, description, price, category, sortOrder: i, isBeverage },
    });
  }

  const carlos = await prisma.motoboy.create({ data: { franchiseeId: L, name: "Carlos", phone: "11988880001", perDeliveryRate: 6 } });
  const rafael = await prisma.motoboy.create({ data: { franchiseeId: L, name: "Rafael", phone: "11988880002", perDeliveryRate: 6 } });

  await prisma.cashSession.create({ data: { franchiseeId: L, status: "OPEN", openingAmount: 100 } });

  const itens = (linhas) => ({
    create: linhas.map(([nome, quantity, notes]) => ({
      menuProductId: produtos[nome].id, productName: nome, quantity, price: produtos[nome].price, notes: notes || null,
    })),
  });
  const soma = (taxa, linhas) => linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, taxa);
  const entrega = { deliveryType: "DELIVERY", deliveryFee: 6, motoboyFee: 6 };

  // O quadro no começo do vídeo. A coluna Novos fica VAZIA de propósito: o
  // pedido novo chega durante a gravação (chegarPedidoNovo) e é nele que o
  // vídeo mostra o cartão e o aceite. Em cada coluna, o cartão do topo é o que
  // o roteiro usa — cartão do meio da coluna fica abaixo da dobra da tela.
  const pedidos = [
    // Finalizado (o mais recente fica no topo: o do iFood, para mostrar o selo do aplicativo)
    { n: 1, customerName: "Paula Ribeiro", customerPhone: "11977770001", status: "ENTREGUE", ...entrega, paymentMethod: "PIX",
      customerAddress: "Rua das Acácias, 120 - Centro", motoboyId: carlos.id, linhas: [["Pizza Calabresa", 1], ["Guaraná 2 L", 1]],
      createdAt: haMin(150), acceptedAt: haMin(148), dispatchedAt: haMin(120), deliveredAt: haMin(105) },
    { n: 2, customerName: "Diego Martins", customerPhone: "11977770002", status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "RETIRADA",
      paymentMethod: "Dinheiro", linhas: [["X-Bacon", 2], ["Coca-Cola lata", 2]], createdAt: haMin(130), acceptedAt: haMin(130), deliveredAt: haMin(115) },
    { n: 4, customerName: "Bia Almeida", customerPhone: "08007050050", status: "ENTREGUE", source: "IFOOD", ifoodOrderId: "tutorial-ifood-1", ifoodReference: "4821",
      ...entrega, paymentMethod: "DIGITAL_WALLET", customerAddress: "Rua do Sol, 300 - Centro", motoboyId: rafael.id,
      linhas: [["Pizza Marguerita", 1], ["Coca-Cola lata", 2]], createdAt: haMin(70), acceptedAt: haMin(69), dispatchedAt: haMin(45), deliveredAt: haMin(28) },
    // Cancelado
    { n: 3, customerName: "Sônia Araújo", customerPhone: "11977770003", status: "CANCELADO", ...entrega, paymentMethod: "DINHEIRO",
      customerAddress: "Av. Brasil, 890 - Jardim América", cancelledBy: "RESTAURANT", cancelReason: "Cliente desistiu",
      linhas: [["X-Burger", 1]], createdAt: haMin(110) },
    // Saiu para entrega
    { n: 5, customerName: "Lucas Ferreira", customerPhone: "11977770005", status: "SAIU_ENTREGA", ...entrega, paymentMethod: "CREDITO",
      customerAddress: "Rua Sete de Setembro, 45 - Vila Nova", motoboyId: carlos.id,
      linhas: [["X-Tudo", 1], ["Batata Frita", 1], ["Coca-Cola lata", 1]],
      createdAt: haMin(38), acceptedAt: haMin(37), dispatchedAt: haMin(14) },
    // Em produção: entrega no topo (motoboy e "Saiu"), retirada logo abaixo ("Pronto")
    { n: 6, customerName: "Carlos Mendes", customerPhone: "11977770006", status: "PREPARANDO", ...entrega, paymentMethod: "DINHEIRO", changeAmount: 100,
      customerAddress: "Rua das Palmeiras, 77 - Jardim América",
      linhas: [["X-Bacon", 2], ["Batata Frita", 1], ["Guaraná 2 L", 1]],
      createdAt: haMin(16), acceptedAt: haMin(15) },
    { n: 7, customerName: "Fernanda Lima", customerPhone: "11977770007", status: "ACEITO", source: "PRESENCIAL", deliveryType: "RETIRADA",
      paymentMethod: "Pix", linhas: [["X-Burger", 1], ["Coca-Cola lata", 1]], createdAt: haMin(9), acceptedAt: haMin(9) },
  ];

  for (const { n, linhas, ...d } of pedidos) {
    await prisma.customerOrder.create({
      data: {
        franchiseeId: L, source: "ONLINE", dailyOrderNumber: n,
        totalAmount: soma(d.deliveryFee || 0, linhas), items: itens(linhas), ...d,
      },
    });
  }
  return { loja, produtos };
}

/** O pedido que "chega" durante a gravação — é o que mostra a tela se atualizando sozinha. */
export async function chegarPedidoNovo(prisma) {
  const loja = await prisma.user.findUnique({ where: { email: LOJA.email } });
  const lista = await prisma.menuProduct.findMany({ where: { franchiseeId: loja.id } });
  const prod = Object.fromEntries(lista.map((p) => [p.name, p]));
  return prisma.customerOrder.create({
    data: {
      franchiseeId: loja.id, source: "ONLINE", dailyOrderNumber: 8, status: "NOVO",
      customerName: "Mariana Costa", customerPhone: "11977770008", deliveryType: "DELIVERY", deliveryFee: 6, motoboyFee: 6,
      customerAddress: "Rua das Flores, 210 - Centro", paymentMethod: "PIX",
      // A observação do PEDIDO é a que o cartão aberto mostra em cima dos itens.
      notes: "Sem cebola, por favor. Interfone 12.",
      totalAmount: 6 + prod["Pizza Calabresa"].price + prod["Guaraná 2 L"].price,
      items: { create: [
        { menuProductId: prod["Pizza Calabresa"].id, productName: "Pizza Calabresa", quantity: 1, price: prod["Pizza Calabresa"].price },
        { menuProductId: prod["Guaraná 2 L"].id, productName: "Guaraná 2 L", quantity: 1, price: prod["Guaraná 2 L"].price },
      ] },
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prisma = banco();
  semear(prisma)
    .then(({ loja }) => console.log(`Loja fictícia pronta: ${loja.storeName} (${LOJA.email} / ${LOJA.senha})`))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
