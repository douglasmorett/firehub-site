#!/usr/bin/env node
/**
 * Zera o `amountDue` dos ciclos de loja ISENTA que ficaram com valor gravado.
 *
 * Por que existe: ate 02/09/2026, `trackSaleForBilling` (src/lib/billing.ts)
 * zerava so o `amountPending` da loja isenta e gravava o `amountDue` cheio. O
 * painel de Custos le essas duas colunas — mostra `amountDue` como "Receita" e
 * `amountDue - amountPending` como "Pago" — entao a Hakim Centro aparecia com
 * Receita R$ 100,00 e "Pago: R$ 100,00" em verde, dinheiro que nunca foi
 * cobrado, somando no faturamento total e na margem media da plataforma.
 *
 * O codigo ja foi corrigido: agora grava `amountDue: 0` para loja isenta, igual
 * `closeMonth` sempre fez. Este script limpa o que ficou para tras. Sem ele, a
 * linha errada so se corrige sozinha no proximo pedido confirmado da loja.
 *
 * Substitui o src/scripts/zero-hakim-billing.ts, que cobria UM email fixo e
 * precisava de runner de TypeScript (nao existe no container). Aqui a regra de
 * isencao e a mesma de billing.ts e vale para todas as contas isentas.
 *
 * ── COMO RODAR ──────────────────────────────────────────────────────────────
 *   1) Dry-run (nao altera nada):
 *        docker exec -it <container-firehub> node scripts/corrigir-ciclos-isentos.js
 *   2) Aplicar:
 *        docker exec -it <container-firehub> node scripts/corrigir-ciclos-isentos.js --apply
 *
 * Idempotente: rodar de novo nao acha mais nada.
 */

const { PrismaClient } = require("@prisma/client");

const APPLY = process.argv.includes("--apply");

/**
 * Espelho de isExemptAccount + das condicoes de isencao de trackSaleForBilling
 * (src/lib/billing.ts). Mexeu la, mexa aqui — senao este script passa a limpar
 * conta que deveria pagar, ou deixa de limpar a que nao deve.
 */
const EMAILS_ISENTOS = [
  "contatohakim@gmail.com",
  "viniciusmenezes.ofc@gmail.com",
  ...(process.env.BYPASS_BILLING_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
];

const brl = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");

async function main() {
  const prisma = new PrismaClient();

  console.log(
    APPLY
      ? "MODO APLICAR — vai zerar o amountDue dos ciclos listados\n"
      : "DRY-RUN — apenas lista. Use --apply para valer.\n"
  );

  const isentas = await prisma.user.findMany({
    where: {
      OR: [
        { email: { in: EMAILS_ISENTOS, mode: "insensitive" } },
        { planPercent: 0 },
        { isFranqueadoHakim: true },
      ],
    },
    select: { id: true, email: true, storeName: true, planPercent: true, isFranqueadoHakim: true },
  });

  if (!isentas.length) {
    console.log("Nenhuma conta isenta encontrada.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Contas isentas: ${isentas.length}`);
  for (const u of isentas) {
    const motivo = EMAILS_ISENTOS.includes((u.email || "").toLowerCase())
      ? "lista de isentos"
      : u.planPercent === 0
      ? "planPercent 0"
      : "franqueado Hakim";
    console.log(`  - ${u.storeName || "(sem nome)"} <${u.email}>  [${motivo}]`);
  }
  console.log();

  const ids = isentas.map((u) => u.id);
  const nomePorId = new Map(isentas.map((u) => [u.id, u.storeName || u.email || u.id.slice(-6)]));

  // So o que esta ERRADO: ciclo de loja isenta com valor devido gravado.
  const ciclosErrados = await prisma.franchiseeBillingCycle.findMany({
    where: { franchiseeId: { in: ids }, OR: [{ amountDue: { gt: 0 } }, { amountPending: { gt: 0 } }] },
    select: { id: true, franchiseeId: true, yearMonth: true, amountDue: true, amountPending: true, status: true },
    orderBy: { yearMonth: "asc" },
  });

  if (!ciclosErrados.length) {
    console.log("Nenhum ciclo com valor gravado indevidamente. Nada a fazer.");
    await prisma.$disconnect();
    return;
  }

  let receitaFantasma = 0;
  console.log(`Ciclos com valor indevido: ${ciclosErrados.length}`);
  for (const c of ciclosErrados) {
    receitaFantasma += c.amountDue || 0;
    console.log(
      `  ${c.yearMonth}  ${nomePorId.get(c.franchiseeId)}  devido=${brl(c.amountDue)}  pendente=${brl(c.amountPending)}  status=${c.status}`
    );
  }
  console.log(`\nReceita fantasma somada no painel: ${brl(receitaFantasma)}`);

  if (APPLY) {
    const res = await prisma.franchiseeBillingCycle.updateMany({
      where: { id: { in: ciclosErrados.map((c) => c.id) } },
      data: { amountDue: 0, amountPending: 0 },
    });
    console.log(`\nCorrigidos: ${res.count} ciclos. O painel de Custos ja mostra o valor certo.`);
    console.log("O `status` foi mantido de proposito — quem fecha ciclo e o closeMonth, nao este script.");
  } else {
    console.log("\nNada foi alterado. Rode de novo com --apply para aplicar.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
