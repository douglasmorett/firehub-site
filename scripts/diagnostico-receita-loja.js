#!/usr/bin/env node
/**
 * Por que a coluna "Receita" do painel de Custos mostra R$ 0 para uma loja que
 * aparece com dezenas de pedidos reais no mesmo mes?
 *
 * Sao DOIS motivos possiveis, e este script separa um do outro:
 *
 * 1) O CICLO NUNCA NASCEU (o caso grave).
 *    "Receita" e o `amountDue` do FranchiseeBillingCycle, e o ciclo do mes so e
 *    criado por `trackSaleForBilling` (src/lib/billing.ts). Essa funcao e
 *    chamada em apenas dois caminhos: o checkout do cardapio digital
 *    (POST /api/customer-order) e a troca de status pelo painel
 *    (POST /api/customer-order/status). Pedido que nasce por iFood, 99Food,
 *    Jotaja, totem, balcao, mesa, API /v1/orders ou pelo robo do WhatsApp e
 *    gravado direto no banco e NAO passa por nenhum dos dois. Loja que so vende
 *    por integracao termina o mes sem ciclo nenhum — Receita R$ 0,00 no painel,
 *    e o cron /api/cron/billing-close so fecha ciclo que JA EXISTE.
 *
 * 2) OS PEDIDOS NAO ENTRARAM NA BASE DE CALCULO.
 *    O "N pedidos" do painel vem de um groupBy sem filtro de status
 *    (src/app/api/admin/usage-costs/route.ts): conta cancelado, rascunho da IA
 *    (CRIANDO_IA) e pedido parado em AGUARDANDO_PAGAMENTO sem pagamento. O
 *    faturamento usa VENDAS_QUE_CONTAM, que exclui os tres.
 *
 * O script mostra pedido por status, por origem, quanto entrou na base de
 * calculo e o que o ciclo do mes gravou. So le — nao altera nada.
 *
 * ── COMO RODAR ──────────────────────────────────────────────────────────────
 *   node scripts/diagnostico-receita-loja.js jmingordo@gmail.com
 *   node scripts/diagnostico-receita-loja.js jmingordo@gmail.com 2026-09
 *
 * Precisa do DATABASE_URL de producao — na pratica, rodar dentro do container:
 *   docker exec -it <container-firehub> node scripts/diagnostico-receita-loja.js <email>
 */

const { PrismaClient } = require("@prisma/client");

const EMAIL = process.argv[2];
const YEAR_MONTH = process.argv[3];

if (!EMAIL) {
  console.error("uso: node scripts/diagnostico-receita-loja.js <email-da-loja> [YYYY-MM]");
  process.exit(1);
}

const brl = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");

/**
 * Mesma base de calculo de src/lib/billing.ts. Se mudar la, mude aqui — o valor
 * deste script so vale enquanto ele contar igual ao que cobra.
 */
const VENDAS_QUE_CONTAM = {
  status: { notIn: ["CANCELADO", "CRIANDO_IA"] },
  NOT: { status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null },
};

async function main() {
  const prisma = new PrismaClient();

  const loja = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: {
      id: true, email: true, storeName: true, role: true, ownerId: true,
      planPercent: true, trialEndsAt: true, isFranqueadoHakim: true,
      storeTimezone: true,
    },
  });
  if (!loja) {
    console.error(`Nenhum usuario com o email ${EMAIL}`);
    process.exit(1);
  }

  const agora = new Date();
  const ym = YEAR_MONTH || `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

  // O painel monta o intervalo em UTC; o billing monta no fuso da loja. A
  // diferenca de 3h so muda pedido feito na virada do mes, mas e por isso que os
  // dois numeros podem discordar em 1o e ultimo dia.
  const inicioUtc = new Date(`${ym}-01T00:00:00.000Z`);
  const fimUtc = new Date(inicioUtc);
  fimUtc.setUTCMonth(fimUtc.getUTCMonth() + 1);

  console.log(`\n${loja.storeName || "(sem nome)"}  <${loja.email}>`);
  console.log(`  id: ${loja.id}   role: ${loja.role}   ownerId: ${loja.ownerId || "-"}`);
  console.log(`  planPercent: ${loja.planPercent}   isFranqueadoHakim: ${loja.isFranqueadoHakim}`);
  console.log(
    `  trialEndsAt: ${loja.trialEndsAt ? loja.trialEndsAt.toISOString().slice(0, 10) : "-"}` +
      (loja.trialEndsAt && loja.trialEndsAt > agora ? "  (EM TESTE)" : "")
  );
  console.log(`  mes analisado: ${ym}\n`);

  // ── Todo pedido do mes, por status ──
  const porStatus = await prisma.customerOrder.groupBy({
    by: ["status"],
    where: { franchiseeId: loja.id, createdAt: { gte: inicioUtc, lt: fimUtc } },
    _count: { id: true },
    _sum: { totalAmount: true },
  });

  const totalLinhas = porStatus.reduce((s, p) => s + p._count.id, 0);
  console.log(`PEDIDOS NO MES (o numero que o painel mostra ao lado do email): ${totalLinhas}`);
  for (const p of porStatus.sort((a, b) => b._count.id - a._count.id)) {
    console.log(`  ${String(p._count.id).padStart(4)}  ${p.status.padEnd(24)} ${brl(p._sum.totalAmount)}`);
  }

  // ── Por origem: e aqui que aparece o pedido de integracao ──
  const porOrigem = await prisma.customerOrder.groupBy({
    by: ["source"],
    where: { franchiseeId: loja.id, createdAt: { gte: inicioUtc, lt: fimUtc } },
    _count: { id: true },
    _sum: { totalAmount: true },
  });

  console.log(`\nPOR ORIGEM (source)`);
  for (const o of porOrigem.sort((a, b) => b._count.id - a._count.id)) {
    console.log(`  ${String(o._count.id).padStart(4)}  ${String(o.source).padEnd(24)} ${brl(o._sum.totalAmount)}`);
  }

  // ── Só o que a cobranca considera venda ──
  const contam = await prisma.customerOrder.aggregate({
    where: { franchiseeId: loja.id, ...VENDAS_QUE_CONTAM, createdAt: { gte: inicioUtc, lt: fimUtc } },
    _count: { id: true },
    _sum: { totalAmount: true },
  });

  console.log(`\nDESSES, VIRARAM VENDA (VENDAS_QUE_CONTAM): ${contam._count.id}`);
  console.log(`  faturamento na base de calculo: ${brl(contam._sum.totalAmount)}`);
  const descartados = totalLinhas - contam._count.id;
  if (descartados > 0) {
    console.log(`  descartados: ${descartados} (cancelado, rascunho da IA ou aguardando pagamento sem pagar)`);
  }

  // ── O que o ciclo do mes realmente gravou ──
  const ciclo = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId: loja.id, yearMonth: ym } },
  });

  console.log("\nCICLO DE COBRANCA DO MES");
  if (!ciclo) {
    console.log("  NAO EXISTE.");
    if (contam._sum.totalAmount > 0) {
      console.log(`  ATENCAO: a loja faturou ${brl(contam._sum.totalAmount)} em vendas que contam e mesmo`);
      console.log("  assim nao tem ciclo. Isso e o motivo 1 do cabecalho: os pedidos entraram por um");
      console.log("  caminho que nao chama trackSaleForBilling (integracao, totem, balcao, mesa, robo).");
      console.log("  Sem ciclo, o cron billing-close nao fecha nada e a loja nao e cobrada.");
    } else {
      console.log("  A loja nao teve venda que conta no mes, entao o ciclo nem chegou a ser criado.");
    }
  } else {
    console.log(`  status:        ${ciclo.status}`);
    console.log(`  totalSales:    ${brl(ciclo.totalSales)}`);
    console.log(`  amountDue:     ${brl(ciclo.amountDue)}   <- e ISTO que o painel chama de "Receita"`);
    console.log(`  amountPending: ${brl(ciclo.amountPending)}`);
    console.log(`  "Pago" exibido: ${brl(Math.max(0, (ciclo.amountDue || 0) - (ciclo.amountPending || 0)))}`);

    const diff = Math.abs((ciclo.totalSales || 0) - (contam._sum.totalAmount || 0));
    if (diff > 0.01) {
      console.log(`  ATENCAO: totalSales do ciclo (${brl(ciclo.totalSales)}) esta defasado do que o banco`);
      console.log(`  mostra agora (${brl(contam._sum.totalAmount)}). Entraram vendas depois do ultimo`);
      console.log("  trackSaleForBilling — tipico de pedido de integracao, que nao redispara o calculo.");
    }
    if (ciclo.amountPending === 0 && ciclo.amountDue > 0) {
      console.log("  ATENCAO: pendente zerado com valor devido > 0 — conta isenta aparece como PAGA no painel.");
    }
  }

  console.log();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
