// Semente do banco DESCARTÁVEL para o E2E da entrega por km (Divinos E2E).
//
// Uso (NUNCA com o banco de produção):
//   DATABASE_URL="<URL que o `npx prisma dev` imprime>&connection_limit=1&pgbouncer=true" \
//     node scripts/e2e-entrega/semente.mjs
//
// Recria a loja do zero: apaga pedidos, produtos, categorias e caixa da loja
// "divinos-e2e" e grava de novo. As faixas de entrega ficam VAZIAS de
// propósito: o cenário E1 cadastra pela tela.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL || "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Recusado: DATABASE_URL não é local. Este script só roda no banco descartável.");
  process.exit(2);
}

const prisma = new PrismaClient();
const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const storeHours = DIAS.map((day) => ({ day, open: "00:00", close: "23:59", active: true, shifts: [{ open: "00:00", close: "23:59" }] }));

async function main() {
  const email = "e2e@teste.dev";
  const antigo = await prisma.user.findUnique({ where: { email } });
  if (antigo) {
    const id = antigo.id;
    await prisma.customerOrderItem.deleteMany({ where: { order: { franchiseeId: id } } });
    await prisma.customerOrder.deleteMany({ where: { franchiseeId: id } });
    await prisma.menuProduct.deleteMany({ where: { franchiseeId: id } });
    await prisma.menuCategory.deleteMany({ where: { franchiseeId: id } });
    await prisma.cashMovement.deleteMany({ where: { cashSession: { franchiseeId: id } } }).catch(() => {});
    await prisma.cashSession.deleteMany({ where: { franchiseeId: id } });
    await prisma.dailyOrderCounter.deleteMany({ where: { franchiseeId: id } }).catch(() => {});
    await prisma.user.delete({ where: { id } });
  }
  const loja = await prisma.user.create({
    data: {
      name: "Divinos E2E",
      email,
      password: await bcrypt.hash("teste123", 10),
      role: "FRANCHISEE",
      city: "Cabo Frio",
      slug: "divinos-e2e",
      storeName: "Divinos E2E",
      storePhone: "22999990000",
      storeAddress: "Tv Liberdade 11, Vila Monte Alegre, Cabo Frio - RJ",
      storeLatLng: { lat: -22.854033, lng: -42.0296526 },
      storeHours,
      storeOpen: true,
      cashOpen: true,
      deliveryZoneType: "ROTA",
      deliveryZones: [],
      deliveryConfig: { repasseDoEntregador: { separado: true, marketplace: "TABELA" }, freeShippingActive: false },
      trialEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      onboardingData: { concluido: true, completed: true },
    },
  });
  await prisma.menuCategory.createMany({
    data: [
      { franchiseeId: loja.id, name: "Lanches", emoji: "🍔", sortOrder: 0 },
      { franchiseeId: loja.id, name: "Bebidas", emoji: "🥤", sortOrder: 1 },
    ],
  });
  await prisma.menuProduct.createMany({
    data: [
      { franchiseeId: loja.id, name: "X-Burger", description: "Pão, carne e queijo", price: 20, category: "Lanches", sortOrder: 0 },
      { franchiseeId: loja.id, name: "Refri", description: "Lata 350 ml", price: 7, category: "Bebidas", isBeverage: true, sortOrder: 1 },
    ],
  });
  await prisma.cashSession.create({ data: { franchiseeId: loja.id, status: "OPEN", openingAmount: 0 } });
  console.log(JSON.stringify({ id: loja.id, slug: loja.slug }));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
