/**
 * Prova do Financeiro nos dados REAIS — SÓ LEITURA (SELECT). Nada é gravado.
 *
 *   npx tsx scripts/conferir-dre-no-banco.ts [caminho do .env]
 *
 * Roda as funções do servidor da tela (lib/financeiro/periodo-do-financeiro.ts
 * e lib/billing.ts, getCurrentCycleView) para as lojas da auditoria de
 * 11/10/2026 e confere, contra contas feitas aqui por fora:
 *   • valor vendido e vendas do DRE = régua dos Relatórios (resumoDeVendas);
 *   • previsão do boleto da aba Mensalidade = a conta do fechamento refeita
 *     em SQL (mensalidade + lojas extras + tráfego + totem);
 *   • faturas fechadas em aberto = os ciclos CLOSED com pendência.
 */
import { readFileSync } from "fs";

const arquivoEnv = process.argv[2] || "C:/Users/Micro/Documents/firehub-site/.env";
const url = readFileSync(arquivoEnv, "utf8").match(/^DATABASE_URL="?([^"\n]+)/m)?.[1];
if (!url) throw new Error("DATABASE_URL não achada em " + arquivoEnv);
process.env.DATABASE_URL = url;
// lib/auth.ts (puxado por lib/relatorios/servidor.ts) exige a variável só para carregar.
process.env.NEXTAUTH_SECRET ||= "so-para-carregar-o-modulo";

const LOJAS: Record<string, string> = {
  "Ragnar Burger": "cmtkosykk01jhk601arcsnu48",
  "Hakim Centro": "cmpx96phr0000ujf0sb0qk5vr",
  "Divinos burger": "cmudbzcus0008ka010pmo1e0w",
  "Delicias de Casa": "cmtlbmy6n0024qo01r551hq20",
  "Brazza Burguer": "cmt1hle8y0001ia04z3ss479k",
  "Frangoso - Trindade": "cmtpc4be5004xmr01fddzq4b9",
  "Pastel da Paulista": "cmt22p9ex001eln01r3bcr0kw",
  "Taurus": "cmtlzb0eq001rmt01g3cw6rqf",
  "NIK": "cmtn5q78c00ebte01zsqrggqx",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const R = (n: number) => `R$ ${r2(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let divergencias = 0;
const bate = (oQue: string, a: number, b: number, tol = 0.01) => {
  const ok = Math.abs(a - b) <= tol;
  if (!ok) divergencias++;
  return `${ok ? "✅" : "❌"} ${oQue}: ${typeof a === "number" && !Number.isInteger(a) || oQue.includes("R$") ? R(a) : a} × ${typeof b === "number" && !Number.isInteger(b) || oQue.includes("R$") ? R(b) : b}`;
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { dadosDoPeriodoDoFinanceiro } = await import("../src/lib/financeiro/periodo-do-financeiro");
  const { calcularDRE, lerComissoesDosApps, periodoDoFinanceiro } = await import("../src/lib/financeiro/dre");
  const { getCurrentCycleView, lojaIsenta, intervaloDoMes, getCurrentYearMonth } = await import("../src/lib/billing");
  const { hojeNaLoja } = await import("../src/lib/relatorios/base");
  const { janelaDoPeriodo, COLUNAS_DOS_FILTROS } = await import("../src/lib/relatorios/servidor");
  const { resumoDeVendas } = await import("../src/lib/relatorios/vendas");
  const { calcMensalidade, VIRADA_DOS_2_POR_CENTO } = await import("../src/lib/firehub-billing");

  for (const [nome, id] of Object.entries(LOJAS)) {
    const dono = await prisma.user.findUnique({
      where: { id },
      select: {
        storeTimezone: true, paymentFees: true, fixedCosts: true, financialGoals: true, trialEndsAt: true,
        ifoodConnected: true, food99Connected: true, email: true, planPercent: true, isFranqueadoHakim: true,
      },
    });
    if (!dono) { console.log(`\n${nome}: não achada`); continue; }
    const tz = dono.storeTimezone || "America/Sao_Paulo";
    const hoje = hojeNaLoja(tz);
    const isenta = lojaIsenta(dono);
    const custosFixos = (Array.isArray(dono.fixedCosts) ? (dono.fixedCosts as any[]) : []).map((c) => ({ id: String(c.id), label: String(c.label), value: Number(c.value) || 0 }));
    let despesas: { dia: string; categoria: string; valor: number }[] = [];
    try {
      despesas = await prisma.$queryRaw<{ dia: string; categoria: string; valor: number }[]>`SELECT dia, categoria, valor::float AS valor FROM "DespesaLancada" WHERE "franchiseeId" = ${id}`;
    } catch { /* tabela ausente */ }
    console.log(`\n════════ ${nome} · fuso ${tz} · hoje (operacional) ${hoje} · ${isenta ? "ISENTA" : "paga mensalidade"} · custo fixo/mês ${R(custosFixos.reduce((s, c) => s + c.value, 0))}`);

    const periodos = [
      { rotulo: "7 dias", ...periodoDoFinanceiro("7d", hoje) },
      { rotulo: "Este mês", ...periodoDoFinanceiro("mes", hoje) },
      { rotulo: "Setembro", de: "2026-09-01", ate: "2026-09-30" },
    ];
    for (const p of periodos) {
      const t0 = Date.now();
      const dados = await dadosDoPeriodoDoFinanceiro({ lojaId: id, tz, hoje, de: p.de, ate: p.ate, isenta });
      const ms = Date.now() - t0;
      const dre = calcularDRE({ dados, custosFixos, despesas, comissoes: lerComissoesDosApps(dono.financialGoals), paymentFees: dono.paymentFees });

      // A régua dos Relatórios, montada por fora: os pedidos da janela (todos
      // os status, como a rota do Vendas por período) e resumoDeVendas.
      const { inicio, fim } = janelaDoPeriodo(p.de, p.ate, tz);
      const brutos = await prisma.customerOrder.findMany({
        where: { franchiseeId: id, createdAt: { gte: inicio, lt: fim } },
        select: { ...COLUNAS_DOS_FILTROS, deliveryFee: true, parentOrderId: true, discountTotal: true, items: { select: { quantity: true, price: true } } },
      });
      const rel = resumoDeVendas(brutos as any, []);

      console.log(`\n  ── ${p.rotulo} (${p.de} a ${p.ate}) · ${dados.pedidos.length} pedidos lidos em ${ms} ms`);
      console.log(`  ${bate("valor vendido DRE × Relatórios (R$)", dre.valorVendido, rel.totalPedidos)} · ${bate("vendas", dre.vendas, rel.atendimentos, 0)} · ${bate("ticket (R$)", dre.ticketMedio, rel.ticketMedio)}`);
      console.log(`  vendas por tipo: ${dre.porTipo.map((t) => `${t.rotulo} ${t.vendas}`).join(" · ")} · lançamentos ${dre.lancamentos} (mesas ${dre.mesasAtendidas})`);
      console.log(`  frete: loja ${R(dre.freteDaLoja)} · corridas do app ${R(dre.freteDoApp)} (${dre.entregasDoApp}) · taxa de serviço do app ${R(dre.taxaDoApp)} (${dre.pedidosComTaxaDoApp}) · desconto no fechamento da mesa ${R(dre.descontoNaMesa)} (${dre.mesasComDesconto} mesas) · cupom do app ${R(dre.cupomDoApp)}`);
      console.log(`  receita da loja ${R(dre.receitaDaLoja)} · CMV ${R(dre.cmv)} (custo cadastrado em ${(dre.cobertura * 100).toFixed(1)}% do valor dos itens) · lucro bruto ${R(dre.lucroBruto)}`);
      console.log(`  comissões: ${dre.comissoes.map((c) => `${c.nome} ${c.pct === null ? "NÃO CONFIGURADA" : `${c.pct}% = ${R(c.valor)}`} (itens ${R(c.base)})`).join(" · ") || "sem venda de app"}`);
      console.log(`  taxas de pagamento ${R(dre.totalTaxas)}: ${dre.taxas.map((t) => `${t.rotulo} ${t.configurada ? `${t.pct}% (${t.comoFoi})` : "NÃO CADASTRADA"} sobre ${R(t.base)} = ${R(t.valor)}`).join(" · ")}`);
      console.log(`  entregadores ${R(dre.entregadores.total)} = corridas ${R(dre.entregadores.porEntrega)} (${dre.entregadores.corridas}) + diárias ${R(dre.entregadores.diarias)} (${dre.entregadores.diasDeDiaria} dias-entregador)${dre.entregadores.erro ? ` · ERRO ${dre.entregadores.erro}` : ""} · entregas da loja ${dre.entregasDaLoja}, sem entregador ${dre.entregasSemEntregador}`);
      console.log(`  mensalidade ${R(dre.mensalidade.total)}: ${dre.mensalidade.meses.map((m) => `${m.mes} ${m.situacao} ${R(m.valorDoMes)} × ${m.dias}/${m.diasDoMes}`).join(" + ")}`);
      console.log(`  custos fixos ${R(dre.custosFixos.total)} (${dre.custosFixos.mesesEquivalentes} meses) · despesas ${R(dre.despesas.total)} · margem de contribuição ${R(dre.margemDeContribuicao)} · RESULTADO ${R(dre.resultado)} (${dre.margens.resultado}%) · ${dre.completo ? "COMPLETO" : `INCOMPLETO: ${dre.pendencias.join("; ")}`}`);
    }

    // ── Mensalidade: tela × conta do fechamento refeita em SQL ───────────
    const v = await getCurrentCycleView(id);
    const ym = getCurrentYearMonth(0, tz);
    const { monthStart, monthEnd } = intervaloDoMes(ym, tz);
    const trial = dono.trialEndsAt ? new Date(dono.trialEndsAt) : null;
    const inicio = !trial ? monthStart : trial >= monthEnd ? null : trial > monthStart ? trial : monthStart;
    let previsto = 0, base = 0, antes = 0;
    if (!isenta && inicio) {
      const linhas = await prisma.$queryRaw<{ t: number; d: number; c: Date; st: string; pago: boolean }[]>`
        SELECT "totalAmount"::float AS t, COALESCE("discountTotal", 0)::float AS d, "createdAt" AS c, status AS st, ("paymentPaidAt" IS NOT NULL) AS pago
        FROM "CustomerOrder" WHERE "franchiseeId" = ${id} AND "createdAt" >= ${inicio} AND "createdAt" < ${monthEnd}`;
      for (const l of linhas) {
        if (l.st === "CRIANDO_IA") continue;
        if (l.st === "AGUARDANDO_PAGAMENTO" && !l.pago) continue;
        if (l.st === "CANCELADO" && new Date(l.c) < VIRADA_DOS_2_POR_CENTO) continue;
        base += l.t + l.d;
        if (new Date(l.c) < VIRADA_DOS_2_POR_CENTO) antes += l.t + l.d;
      }
      const ciclo = await prisma.franchiseeBillingCycle.findUnique({ where: { franchiseeId_yearMonth: { franchiseeId: id, yearMonth: ym } } });
      const ifood = await prisma.ifoodIntegration.count({ where: { userId: id, active: true } });
      const n99 = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Food99Store" WHERE "userId" = ${id} AND active = true AND connected = true`.catch(() => [{ n: BigInt(0) }]);
      const lojasIfood = Math.max(ifood, dono.ifoodConnected ? 1 : 0);
      const lojas99 = Number(n99[0]?.n ?? 0) || (dono.food99Connected ? 1 : 0);
      const extras = (Math.max(0, lojasIfood - 1) + Math.max(0, lojas99 - 1)) * 50;
      const emTeste = inicio > new Date();
      const mens = emTeste ? 0 : base > 0 ? calcMensalidade(base, true, ym, antes).mensalidade : (v.cobrancaPorUso?.valor ?? 0);
      const mensalidade = Math.max(ciclo?.amountDue ?? 0, mens);
      previsto = r2(Math.max(0, mensalidade - (ciclo?.amountOffset ?? 0)) + extras + (ciclo?.metaAdsFee ?? 0) + (ciclo?.totemFee ?? 0));
    }
    console.log(`\n  MENSALIDADE ${ym}: tela ${R(v.amountPending)} (mensalidade ${R(v.mensalidadePrevista ?? 0)} · ${R(v.vendasA1PorCento)} a 1% + ${R(v.totalSales - v.vendasA1PorCento)} a 2% · lojas extras ${R(v.lojasExtras.valor)} [iFood ${v.lojasExtras.lojasIfood}, 99 ${v.lojasExtras.lojas99}] · tráfego ${R(v.taxas.trafegoPago)} · totem ${R(v.taxas.totem)})`);
    console.log(`  ${bate("previsão da tela × conta do fechamento refeita (R$)", v.amountPending, previsto)} · base ${R(v.totalSales)} × ${R(base)}`);
    const abertas = await prisma.franchiseeBillingCycle.findMany({ where: { franchiseeId: id, status: "CLOSED", amountPending: { gt: 0 } }, select: { yearMonth: true, amountPending: true } });
    console.log(`  faturas fechadas em aberto na tela: ${v.faturasEmAberto.map((f) => `${f.yearMonth} ${R(f.valor)} vence ${f.venceEm}${f.vencida ? " (vencida)" : ""}${f.boletoUrl ? " · com link" : " · SEM link"}`).join(" | ") || "nenhuma"} · no banco: ${abertas.map((c) => `${c.yearMonth} ${R(c.amountPending)}`).join(" | ") || "nenhuma"}`);
  }

  console.log(divergencias === 0 ? "\nTudo bate." : `\n${divergencias} divergência(s).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
