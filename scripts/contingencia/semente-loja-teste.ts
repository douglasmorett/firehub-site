/**
 * Loja de teste do Modo Contingência — só para o banco LOCAL da prova
 * (Obsidian: Projetos/FireHub - Modo Contingência.md, fase 0).
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres \
 *     npx tsx scripts/contingencia/semente-loja-teste.ts
 *
 * Recusa rodar contra qualquer banco que não seja local: a loja de teste não
 * pode nascer na produção por engano.
 *
 * Entra com contingencia@teste.local / teste123 (painel) e joao / 1234 (garçom,
 * /garcom/loja-teste-contingencia). A impressão automática nasce DESLIGADA:
 * o computador da prova tem um Assistente de verdade, ligado a uma impressora
 * de verdade.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
  console.error("DATABASE_URL não é local. Esta semente só roda no banco da prova.");
  process.exit(1);
}

const EMAIL = "contingencia@teste.local";
const SLUG = "loja-teste-contingencia";

async function main() {
  const prisma = new PrismaClient();
  try {
    const existente = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
    if (existente) {
      console.log(`Loja de teste já existe (${existente.id}).`);
      return;
    }
    const loja = await prisma.user.create({
      data: {
        name: "Loja Teste Contingência",
        email: EMAIL,
        password: await bcrypt.hash("teste123", 10),
        role: "FRANCHISEE",
        slug: SLUG,
        storeName: "LOJA TESTE CONTINGÊNCIA",
        printerConfig: { autoprint: false, printers: [] },
        // Caixa aberto: sem ele o garçom não abre mesa.
        cashOpen: true,
      },
    });
    for (const [i, nome] of ["Pizzas", "Bebidas"].entries()) {
      await prisma.menuCategory.create({ data: { name: nome, franchiseeId: loja.id, sortOrder: i } as any });
    }
    const produtos = [
      { name: "Pizza Calabresa G", description: "Calabresa e cebola", price: 59.9, category: "Pizzas" },
      { name: "Pizza Mussarela G", description: "Mussarela e orégano", price: 54.9, category: "Pizzas" },
      { name: "Coca-Cola 2L", description: "Refrigerante", price: 14, category: "Bebidas" },
    ];
    for (const p of produtos) await prisma.menuProduct.create({ data: { ...p, franchiseeId: loja.id } });
    for (let n = 1; n <= 4; n++) await prisma.table.create({ data: { franchiseeId: loja.id, number: n } });
    const garcom = await prisma.waiter.create({ data: { franchiseeId: loja.id, name: "João" } });
    // login e passwordHash nascem por SQL (garantir-colunas.ts, INSTRUCOES_MESA).
    await prisma.$executeRawUnsafe(
      `UPDATE "Waiter" SET "login" = $1, "passwordHash" = $2 WHERE id = $3`,
      "joao",
      await bcrypt.hash("1234", 10),
      garcom.id,
    );
    await prisma.cashSession.create({ data: { franchiseeId: loja.id, openingAmount: 100 } });
    console.log(`Loja de teste criada: ${loja.id} (${EMAIL} / teste123; garçom joao / 1234).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
