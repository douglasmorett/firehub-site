import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DREClient from "./DREClient";
import { garantirEstruturaDeDespesas } from "@/lib/garantir-colunas";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";
import { dadosDoPeriodoDoFinanceiro } from "@/lib/financeiro/periodo-do-financeiro";
import { lerComissoesDosApps, lerPeriodo, MAX_DIAS_DO_FINANCEIRO, type DadosDoPeriodo } from "@/lib/financeiro/dre";
import { getCurrentCycleView, type VisaoDoCiclo } from "@/lib/billing";
import { dataDaLoja } from "@/lib/fuso";
import { somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";

const ABAS = ["mensalidade", "extrato", "relatorio", "configuracoes", "dre", "custosfix", "pagamentos", "contasapagar", "notascompras"] as const;

export default async function StoreFinanceiroPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // De qual loja é o dinheiro: a do dono (funcionário → a loja do dono; ADMIN
  // → a loja ativa do seletor). Antes taxas, custos fixos e metas vinham da
  // linha de quem estava logado (lib/financeiro/contexto.ts).
  const r = await contextoDoFinanceiro((await cookies()).get("firehub_active_store")?.value);
  if (!r.ok) redirect(r.status === 401 ? "/login" : "/store");
  const ctx = r.valor;
  const lojaId = ctx.donoId;

  const sp = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // O período é o dos Relatórios: dia operacional da loja, no fuso dela.
  const { de, ate } = lerPeriodo(um(sp.de), um(sp.ate), ctx.hoje);
  const abaPedida = um(sp.tab);
  const aba = (ABAS as readonly string[]).includes(abaPedida || "") ? (abaPedida as (typeof ABAS)[number]) : "mensalidade";

  // A mensalidade (aba Mensalidade e a linha do DRE) é a do ciclo do servidor —
  // a mesma conta do boleto (lib/billing.ts). Vai pronta: a seção "#fatura",
  // para onde o aviso do topo manda, existe já no primeiro desenho da tela.
  const visaoDoCiclo: VisaoDoCiclo | null = await getCurrentCycleView(lojaId).catch((err) => {
    console.error("[Financeiro] Erro ao montar o ciclo da mensalidade:", err);
    return null;
  });

  let dados: DadosDoPeriodo | null = null;
  let erroDoPeriodo: string | null = null;
  try {
    dados = await dadosDoPeriodoDoFinanceiro({ lojaId, tz: ctx.tz, hoje: ctx.hoje, de, ate, isenta: ctx.isenta, visaoDoCiclo });
  } catch (err) {
    console.error("[Financeiro] Erro ao montar o período:", err);
    erroDoPeriodo = "Não foi possível carregar os números do período. Tente de novo.";
  }

  let produtosSemCusto: { id: string; name: string | null }[] = [];
  try {
    produtosSemCusto = await prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, active: true, OR: [{ cost: null }, { cost: 0 }] },
      select: { name: true, id: true },
    });
  } catch (err) {
    console.error("[Financeiro] Erro ao buscar produtos sem custo:", err);
  }

  // ── CONTAS A PAGAR ────────────────────────────────────────────────────────
  //
  // As datas viajam como "YYYY-MM-DD" já recortado, e não como ISO completo,
  // porque o vencimento é uma DATA, não um instante: mandar o timestamp faz o
  // navegador em UTC-3 exibir "vence dia 09" numa conta gravada para o dia 10.
  //
  // O "pago em" é diferente: é o INSTANTE do clique em "Já paguei" e vira dia
  // no fuso da LOJA. Recortado em UTC, a conta paga em 06/10 às 23:05 aparecia
  // "Pago em 07/10" (auditoria de 11/10/2026).
  let payables: any[] = [];
  try {
    payables = await prisma.payable.findMany({
      where: { franchiseeId: lojaId },
      orderBy: { dueDate: "asc" },
      select: {
        id: true, supplierName: true, value: true, status: true,
        dueDate: true, receivedDate: true, paidDate: true,
        barcode: true, category: true, paymentType: true,
      },
    });
  } catch (err) {
    console.error("[Financeiro] Erro ao buscar contas a pagar:", err);
  }

  const payablesSerialized = payables.map((p) => ({
    id: p.id,
    supplierName: p.supplierName,
    value: p.value,
    status: p.status,
    category: p.category,
    paymentType: p.paymentType || null,
    barcode: p.barcode || null,
    dueDate: p.dueDate.toISOString().slice(0, 10),
    receivedDate: p.receivedDate ? p.receivedDate.toISOString().slice(0, 10) : null,
    paidDate: p.paidDate ? dataDaLoja(ctx.tz, p.paidDate) : null,
  }));

  // ── DESPESAS LANÇADAS À MÃO ───────────────────────────────────────────────
  // O que não nasce do pedido nem é custo fixo (gás, embalagem, conserto). O
  // dia já é texto "YYYY-MM-DD"; vêm as do maior período que a tela aceita.
  let despesas: { id: string; dia: string; categoria: string; descricao: string | null; valor: number }[] = [];
  try {
    if (await garantirEstruturaDeDespesas()) {
      despesas = await prisma.despesaLancada.findMany({
        where: { franchiseeId: lojaId, dia: { gte: somarDias(ctx.hoje, -MAX_DIAS_DO_FINANCEIRO) } },
        orderBy: [{ dia: "desc" }, { createdAt: "desc" }],
        select: { id: true, dia: true, categoria: true, descricao: true, valor: true },
      });
    }
  } catch (err) {
    console.error("[Financeiro] Erro ao buscar despesas lançadas:", err);
  }

  const fixedCosts = (Array.isArray(ctx.dono.fixedCosts) ? (ctx.dono.fixedCosts as any[]) : [])
    .map((c) => ({ id: String(c?.id ?? ""), label: String(c?.label ?? ""), value: Number(c?.value) || 0 }))
    .filter((c) => c.label);

  return (
    <DREClient
      inicio={{ de, ate, hoje: ctx.hoje, tz: ctx.tz, aba }}
      dadosIniciais={dados}
      erroInicial={erroDoPeriodo}
      cicloInicial={visaoDoCiclo}
      papel={ctx.papel}
      paymentFees={(ctx.dono.paymentFees as any) || {}}
      storeName={ctx.dono.storeName || "Minha Loja"}
      produtosSemCusto={produtosSemCusto.map((p) => ({ id: p.id, name: p.name || "Sem nome" }))}
      initialFixedCosts={fixedCosts}
      comissoesIniciais={lerComissoesDosApps(ctx.dono.financialGoals)}
      initialRepasseConfig={(ctx.dono.repasseConfig as any) || {}}
      payables={payablesSerialized}
      initialDespesas={despesas}
    />
  );
}
