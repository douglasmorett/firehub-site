/**
 * A PERFORMANCE DAS CARTEIRAS — a parte que lê o banco. As contas estão em
 * lib/performance-das-carteiras/regras.ts (puras, testadas).
 *
 * ── Custo no Neon ───────────────────────────────────────────────────────────
 *
 * Uma rodada de consultas AGREGADAS para todas as lojas, qualquer que seja o
 * número de carteiras (a mesma linha do perfil da loja):
 *
 *   • vendas e faturamento por loja × mês (GROUP BY no banco, índice
 *     franchiseeId+createdAt) — uma linha por loja-mês;
 *   • vendas por loja nos DIAS exatos do período e do anterior (uma consulta);
 *   • os ciclos de mensalidade dos meses da janela (colunas pequenas);
 *   • as assinaturas (Bill, App, Multimarcas, totem) — uma linha por loja;
 *   • recargas de disparo pagas (valor, disparos e o custo da Meta gravado);
 *   • o perfil de agora (lib/perfil-da-loja, já com cache de 5 min);
 *   • a atividade do CRM (lib/crm/desempenho.ts — a MESMA conta do antigo
 *     "Desempenho da equipe", chamada duas vezes: período e anterior).
 *
 * A base mensal fica 10 minutos na memória por tamanho de janela, e as vendas
 * dos dias de cada período, 10 minutos por período.
 */
import { prisma } from "@/lib/prisma";
import { STATUS_FORA_DA_VENDA, hojeNaLoja } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { VALOR_IMPOSSIVEL } from "@/lib/relatorios/regua-da-venda";
import { getCurrentYearMonth, intervaloDoMes, lojaIsenta } from "@/lib/billing";
import {
  COMISSAO_DO_DISPARO_PCT, comissaoSobre, indicacaoDeEmbaixador, mensalidadeDoCiclo, mesesAntes, papelNaLoja, vendedorQueAtende,
  type CicloNasRegras, type LojaNasRegras, type ParceiroNasRegras,
} from "@/lib/parceiro/regras";
import { valorDoAssessorNoMes, PRECO_DO_ASSESSOR, type Periodo } from "@/lib/assessor/assinatura";
import { PRECOS_DO_APP, teveAppCompletoNoMes, valorDoAppNoMes, type TrechoDoApp } from "@/lib/app-da-loja/plano";
import { valorDoMultimarcasNoMes, type TrechoDoMultimarcas } from "@/lib/multimarcas/assinatura";
import { custoMeta } from "@/lib/disparo-oficial/regras";
import { desempenhoDaEquipe, type DesempenhoDoVendedor } from "@/lib/crm/desempenho";
import { idsDeTodasAsLojas, resumosDasLojas } from "@/lib/perfil-da-loja/no-banco";
import type { ResumoDoPerfil } from "@/lib/perfil-da-loja/regras";
import {
  SERVICOS_VAZIOS, custoDaDescricao, donosDaLoja, evolucaoDaCarteira, margemDaRecarga, mesesAte, periodoDaAnalise, receitaDoMes,
  regraDeComissao, resumirCarteira,
  type AtividadeComercial, type CarteiraDaAnalise, type ChaveDoPeriodo, type CicloDaReceita, type Contexto, type Janela,
  type LojaDaAnalise, type MesDaEvolucao, type MesDaLoja, type OrigemNaCarteira, type PeriodoDaAnalise, type ResumoDaCarteira,
  type ServicosDoMes, type UpsellDaLoja,
} from "@/lib/performance-das-carteiras/regras";

const PRECO_DO_TOTEM = 100;
const FUSO = "America/Sao_Paulo";
/** Até onde a análise volta (o intervalo livre não passa disto). */
export const MESES_DE_HISTORICO = 36;
const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

async function seguro<T>(nome: string, consulta: () => Promise<T[]>): Promise<T[]> {
  try {
    return await consulta();
  } catch (e) {
    console.warn(`[performance-das-carteiras] ${nome}: ${String((e as Error)?.message || e).slice(0, 180)}`);
    return [];
  }
}

type LojaDoBanco = {
  id: string; name: string | null; storeName: string | null; city: string | null; email: string; createdAt: Date; trialEndsAt: Date | null;
  planPercent: number | null; isFranqueadoHakim: boolean | null; vendedorId: string | null; ambassadorId: string | null; vendedorAtribuidoEm: Date | null;
};
type ParceiroDoBanco = {
  id: string; name: string; active: boolean; isVendedor: boolean; commissionPercent: number; level2Percent: number | null; sellerPercent: number;
  asaasWalletId: string | null; parentAmbassadorId: string | null;
};
type CicloDoBanco = CicloNasRegras & CicloDaReceita & { franchiseeId: string };
type MesDaBase = Omit<MesDaLoja, "comissaoPrevista" | "comissaoRecebida" | "comissaoDoDisparo"> & {
  /** Por parceiro: comissão sobre o boleto (prevista/recebida) e sobre a margem do disparo. */
  comissao: Map<string, { prevista: number; recebida: number; disparo: number }>;
};

type Base = {
  agora: Date;
  ctx: Contexto;
  meses: string[];
  lojas: LojaDoBanco[];
  parceiros: ParceiroDoBanco[];
  porLoja: Map<string, {
    meses: Record<string, MesDaBase>;
    /** % que cada parceiro leva desta loja (papelNaLoja, a regra do split). */
    percentuais: Map<string, number>;
    primeiroPagamentoEm: string | null; bloqueadaAgora: boolean; upsell: UpsellDaLoja[]; isenta: boolean;
  }>;
  perfis: Map<string, ResumoDoPerfil>;
  /** Alguma recarga sem o custo gravado (margem estimada com o custo atual). */
  disparoEstimado: boolean;
};

const SELECT_DO_CICLO = {
  franchiseeId: true, yearMonth: true, status: true, amountDue: true, amountPending: true, asaasPaymentId: true, asaasBoletoUrl: true,
  dueDate: true, closedAt: true, paidAt: true, paidValue: true, paidNetValue: true, asaasStatus: true, notes: true, metaAdsFee: true, totemFee: true,
} as const;

const cacheDaBase = new Map<number, { em: number; base: Base }>();
const CACHE_MS = 10 * 60_000;

async function montarBase(nMeses: number, agora: Date): Promise<Base> {
  const guardada = cacheDaBase.get(nMeses);
  if (guardada && agora.getTime() - guardada.em < CACHE_MS) return guardada.base;

  const mesCorrente = getCurrentYearMonth(0);
  const meses = mesesAte(mesCorrente, nMeses);
  const intervalos: Contexto["intervalos"] = {};
  for (const ym of meses) {
    const i = intervaloDoMes(ym);
    intervalos[ym] = { inicio: i.monthStart, fim: i.monthEnd };
  }
  const atual = intervalos[mesCorrente];
  const fracaoDoMesCorrente = Math.min(1, Math.max(0.01, (agora.getTime() - atual.inicio.getTime()) / (atual.fim.getTime() - atual.inicio.getTime())));
  const desde = intervalos[meses[0]].inicio;
  const fora = [...STATUS_FORA_DA_VENDA];

  const [lojas, parceiros] = await Promise.all([
    prisma.user.findMany({
      where: { role: "FRANCHISEE" },
      select: {
        id: true, name: true, storeName: true, city: true, email: true, createdAt: true, trialEndsAt: true, planPercent: true,
        isFranqueadoHakim: true, vendedorId: true, ambassadorId: true, vendedorAtribuidoEm: true,
      },
    }),
    prisma.ambassador.findMany({
      select: {
        id: true, name: true, active: true, isVendedor: true, commissionPercent: true, level2Percent: true, sellerPercent: true,
        asaasWalletId: true, parentAmbassadorId: true,
      },
    }),
  ]);
  const ids = lojas.map((l) => l.id);

  const [vendas, ciclos, emAberto, pagamentos, bill, app, multimarcas, totens, recargas, perfis] = await Promise.all([
    // Vendas por loja × mês, na régua dos relatórios; o mês é o do dia OPERACIONAL (vira às 5h, Brasília).
    seguro("vendas por mês", () => prisma.$queryRaw<{ id: string; mes: string; vendas: number; gmv: number }[]>`
      SELECT o."franchiseeId" AS id,
        to_char(((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours', 'YYYY-MM') AS mes,
        (count(*) FILTER (WHERE o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL) + count(DISTINCT o."tableSessionId"))::int AS vendas,
        coalesce(sum(o."totalAmount"), 0)::float AS gmv
      FROM "CustomerOrder" o
      WHERE o."franchiseeId" = ANY(${ids}) AND o."createdAt" >= ${desde} AND o."createdAt" < ${agora}
        AND o.status <> ALL(${fora}) AND o."reposicao" IS NULL AND o."totalAmount" < ${VALOR_IMPOSSIVEL}
      GROUP BY 1, 2`),
    seguro("ciclos", () => prisma.franchiseeBillingCycle.findMany({ where: { franchiseeId: { in: ids }, yearMonth: { in: meses } }, select: SELECT_DO_CICLO })),
    seguro("boletos em aberto", () => prisma.franchiseeBillingCycle.findMany({ where: { franchiseeId: { in: ids }, status: "CLOSED", amountPending: { gt: 0 } }, select: SELECT_DO_CICLO })),
    seguro("primeiro pagamento", () => prisma.$queryRaw<{ id: string; em: Date }[]>`
      SELECT "franchiseeId" AS id, min("paidAt") AS em FROM "FranchiseeBillingCycle"
      WHERE "franchiseeId" = ANY(${ids}) AND status = 'PAID' AND "paidAt" IS NOT NULL AND "asaasPaymentId" IS NOT NULL GROUP BY 1`),
    seguro("Bill", () => prisma.$queryRaw<{ id: string; testeAte: Date | null; periodos: unknown }[]>`
      SELECT "franchiseeId" AS id, "testeAte", periodos FROM "AssessorAssinatura" WHERE "franchiseeId" = ANY(${ids})`),
    seguro("App", () => prisma.$queryRaw<{ id: string; trechos: unknown }[]>`
      SELECT "franchiseeId" AS id, trechos FROM "AppDaLojaPlano" WHERE "franchiseeId" = ANY(${ids})`),
    seguro("Multimarcas", () => prisma.$queryRaw<{ id: string; testeAte: Date | null; trechos: unknown }[]>`
      SELECT "franchiseeId" AS id, "testeAte", trechos FROM "MultimarcasAssinatura" WHERE "franchiseeId" = ANY(${ids})`),
    seguro("totens", () => prisma.totemLicense.findMany({ where: { franchiseeId: { in: ids } }, select: { franchiseeId: true, active: true, createdAt: true } })),
    seguro("recargas de disparo", () => prisma.$queryRaw<{ id: string; valor: number; disparos: number; descricao: string | null; em: Date }[]>`
      SELECT "franchiseeId" AS id, valor::float AS valor, disparos::int AS disparos, descricao, "pagaEm" AS em FROM "DisparoRecarga"
      WHERE "franchiseeId" = ANY(${ids}) AND status = 'PAGA' AND tipo <> 'AJUSTE' AND "pagaEm" IS NOT NULL`),
    resumosDasLojas(await idsDeTodasAsLojas(), agora).catch(() => [] as ResumoDoPerfil[]),
  ]);

  const parceiroPorId = new Map(parceiros.map((p) => [p.id, p]));
  const doBancoParaRegras = (p: ParceiroDoBanco): ParceiroNasRegras => ({
    id: p.id, active: p.active, temCarteira: !!p.asaasWalletId, isVendedor: p.isVendedor,
    commissionPercent: p.commissionPercent, level2Percent: p.level2Percent ?? 3, sellerPercent: p.sellerPercent,
  });
  const lojaNasRegras = (l: LojaDoBanco): LojaNasRegras => {
    const a = l.ambassadorId ? parceiroPorId.get(l.ambassadorId) : null;
    const pai = a?.parentAmbassadorId ? parceiroPorId.get(a.parentAmbassadorId) : null;
    const v = l.vendedorId ? parceiroPorId.get(l.vendedorId) : null;
    return {
      ambassadorId: l.ambassadorId,
      ambassador: a ? {
        id: a.id, active: a.active, temCarteira: !!a.asaasWalletId, commissionPercent: a.commissionPercent, isVendedor: a.isVendedor, parentAmbassadorId: a.parentAmbassadorId,
        parentAmbassador: pai ? { id: pai.id, active: pai.active, temCarteira: !!pai.asaasWalletId, level2Percent: pai.level2Percent ?? 3 } : null,
      } : null,
      vendedorId: l.vendedorId,
      vendedor: v ? { id: v.id, active: v.active, isVendedor: v.isVendedor, temCarteira: !!v.asaasWalletId, sellerPercent: v.sellerPercent, commissionPercent: v.commissionPercent } : null,
    };
  };

  const agrupa = <T extends { id?: string; franchiseeId?: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) { const k = (x.id ?? x.franchiseeId)!; m.set(k, [...(m.get(k) || []), x]); }
    return m;
  };
  const vendasDe = agrupa(vendas);
  const ciclosDe = agrupa(ciclos as CicloDoBanco[]);
  const abertosDe = agrupa(emAberto as CicloDoBanco[]);
  const totensDe = agrupa(totens);
  const recargasDe = agrupa(recargas);
  const pagamentoDe = new Map(pagamentos.map((p) => [p.id, p.em]));
  const billDe = new Map(bill.map((b) => [b.id, b]));
  const appDe = new Map(app.map((a) => [a.id, a]));
  const mmDe = new Map(multimarcas.map((m) => [m.id, m]));
  const custoAtual = custoMeta();
  let disparoEstimado = false;

  const lerApp = (bruto: unknown): TrechoDoApp[] => (Array.isArray(bruto) ? bruto : [])
    .filter((t: any) => t && typeof t.de === "string" && (t.plataformas in PRECOS_DO_APP))
    .map((t: any) => ({ de: t.de, ate: typeof t.ate === "string" ? t.ate : null, plataformas: t.plataformas, valor: Number(t.valor) > 0 ? Number(t.valor) : PRECOS_DO_APP[t.plataformas as keyof typeof PRECOS_DO_APP] }));
  const lerPeriodos = (bruto: unknown): Periodo[] => (Array.isArray(bruto) ? bruto : [])
    .filter((p: any) => p && typeof p.de === "string").map((p: any) => ({ ...p, ate: typeof p.ate === "string" ? p.ate : null }));
  const lerMm = (bruto: unknown): TrechoDoMultimarcas[] => (Array.isArray(bruto) ? bruto : [])
    .filter((t: any) => t && typeof t.de === "string").map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || 0 }));

  const porLoja: Base["porLoja"] = new Map();
  for (const l of lojas) {
    const isenta = lojaIsenta({ email: l.email, planPercent: l.planPercent, isFranqueadoHakim: l.isFranqueadoHakim });
    const trechosApp = lerApp(appDe.get(l.id)?.trechos);
    const b = billDe.get(l.id);
    const periodosBill = lerPeriodos(b?.periodos);
    const mm = mmDe.get(l.id);
    const trechosMm = lerMm(mm?.trechos);
    const totensDaLoja = totensDe.get(l.id) || [];
    const recargasDaLoja = (recargasDe.get(l.id) || []).map((r) => {
      const custo = custoDaDescricao(r.descricao);
      const m = margemDaRecarga({ valor: Number(r.valor), disparos: Number(r.disparos), custoPorDisparo: custo }, custoAtual);
      if (m.estimada) disparoEstimado = true;
      return { em: new Date(r.em), ...m };
    });
    const ciclosDaLoja = new Map((ciclosDe.get(l.id) || []).map((c) => [c.yearMonth, c]));
    const vendasDaLoja = new Map((vendasDe.get(l.id) || []).map((v) => [v.mes, v]));
    const regrasDaLoja = lojaNasRegras(l);
    // O % que o split paga a cada parceiro desta loja — a regra de verdade (papelNaLoja:
    // embaixador que indicou + vendedor que ATENDE). Conta pausada não recebe nada.
    const percentuais = new Map<string, number>();
    for (const pid of new Set([l.vendedorId, l.ambassadorId].filter(Boolean) as string[])) {
      const p = parceiroPorId.get(pid);
      const papel = p ? papelNaLoja(doBancoParaRegras(p), regrasDaLoja) : null;
      if (p && papel && p.active) percentuais.set(p.id, papel.percentual);
    }
    // Disparo: 3% da margem para o vendedor que atende, ativo (splitDaRecarga).
    const dono = vendedorQueAtende(regrasDaLoja);
    const donoDoDisparo = dono && dono.ativo ? dono.parceiroId : null;

    const mesesDaLoja: Record<string, MesDaBase> = {};
    for (const ym of meses) {
      const { inicio, fim } = intervalos[ym];
      const v = vendasDaLoja.get(ym);
      const ciclo = ciclosDaLoja.get(ym) || null;
      const doMes = recargasDaLoja.filter((r) => r.em.getTime() >= inicio.getTime() && r.em.getTime() < fim.getTime());
      const servicos: ServicosDoMes = {
        ...SERVICOS_VAZIOS,
        app: valorDoAppNoMes(trechosApp, inicio, fim, agora),
        bill: valorDoAssessorNoMes(periodosBill, b?.testeAte ?? null, inicio, fim, agora),
        // O app completo (Android + Apple) traz o Multimarcas de cortesia.
        multimarcas: teveAppCompletoNoMes(trechosApp, inicio, fim, agora) ? 0 : valorDoMultimarcasNoMes(trechosMm, mm?.testeAte ?? null, inicio, fim, agora),
        totem: totensDaLoja.filter((t) => t.active && new Date(t.createdAt).getTime() < fim.getTime()).length * PRECO_DO_TOTEM,
        disparo: c2(doMes.reduce((s, r) => s + r.margem, 0)),
        disparoBruto: c2(doMes.reduce((s, r) => s + r.bruto, 0)),
      };
      const receita = receitaDoMes(ciclo, servicos, isenta);
      // A comissão do boleto — a MESMA conta do portal (lib/parceiro/relatorio.ts): % do papel
      // sobre o valor do ciclo; paga = sobre o líquido recebido. E a do disparo, sobre a margem.
      const m = mensalidadeDoCiclo(ciclo, ym, mesCorrente, agora);
      const comissao = new Map<string, { prevista: number; recebida: number; disparo: number }>();
      for (const [pid, pct] of percentuais) {
        comissao.set(pid, {
          prevista: comissaoSobre(m.situacao === "PAGA" ? m.pago : m.valor, pct),
          recebida: m.situacao === "PAGA" ? comissaoSobre(m.pago, pct) : 0,
          disparo: pid === donoDoDisparo ? Math.floor(servicos.disparo * COMISSAO_DO_DISPARO_PCT) / 100 : 0,
        });
      }
      mesesDaLoja[ym] = { vendas: v ? Number(v.vendas) : 0, gmv: v ? c2(Number(v.gmv)) : 0, receita, comissao };
    }

    const bloqueadaAgora = (abertosDe.get(l.id) || []).some((c) => {
      const m = mensalidadeDoCiclo(c, c.yearMonth, mesCorrente, agora);
      return m.situacao === "VENCIDA" && !!m.bloqueiaEm && new Date(m.bloqueiaEm).getTime() <= agora.getTime();
    });

    const upsell: UpsellDaLoja[] = [];
    if (trechosApp[0]) upsell.push({ servico: "app", em: trechosApp[0].de, valorMensal: trechosApp[0].valor });
    if (periodosBill[0]) upsell.push({ servico: "bill", em: periodosBill[0].de, valorMensal: PRECO_DO_ASSESSOR });
    if (trechosMm[0]) upsell.push({ servico: "multimarcas", em: trechosMm[0].de, valorMensal: trechosMm[0].valor });
    for (const t of totensDaLoja) upsell.push({ servico: "totem", em: new Date(t.createdAt).toISOString(), valorMensal: PRECO_DO_TOTEM });
    const primeiraRecarga = [...recargasDaLoja].sort((x, y) => x.em.getTime() - y.em.getTime())[0];
    if (primeiraRecarga) upsell.push({ servico: "disparo", em: primeiraRecarga.em.toISOString(), valorMensal: 0 });
    for (let i = 1; i < meses.length; i++) {
      const fee = ciclosDaLoja.get(meses[i])?.metaAdsFee ?? 0;
      const antes = ciclosDaLoja.get(meses[i - 1])?.metaAdsFee ?? 0;
      if (fee > 0 && antes <= 0) { upsell.push({ servico: "trafego", em: intervalos[meses[i]].inicio.toISOString(), valorMensal: fee }); break; }
    }

    porLoja.set(l.id, {
      meses: mesesDaLoja, percentuais,
      primeiroPagamentoEm: pagamentoDe.get(l.id) ? new Date(pagamentoDe.get(l.id)!).toISOString() : null,
      bloqueadaAgora, upsell, isenta,
    });
  }

  const base: Base = {
    agora, meses, lojas, parceiros, porLoja, disparoEstimado,
    ctx: { intervalos, agora, mesCorrente, fracaoDoMesCorrente },
    perfis: new Map(perfis.map((p) => [p.id, p])),
  };
  cacheDaBase.set(nMeses, { em: agora.getTime(), base });
  return base;
}

/** Vendas de cada loja nos dias exatos do período e do anterior (uma consulta). */
const cacheDasFaixas = new Map<string, { em: number; valor: Map<string, LojaDaAnalise["faixa"]> }>();
async function faixasDasLojas(base: Base, j: { atual: Janela; anterior: Janela }): Promise<Map<string, LojaDaAnalise["faixa"]>> {
  const chave = `${j.atual.inicio.toISOString()}|${j.atual.fim.toISOString()}|${j.anterior.inicio.toISOString()}|${j.anterior.fim.toISOString()}`;
  const guardado = cacheDasFaixas.get(chave);
  if (guardado && base.agora.getTime() - guardado.em < CACHE_MS) return guardado.valor;
  const ids = base.lojas.map((l) => l.id);
  const fora = [...STATUS_FORA_DA_VENDA];
  const fim = new Date(Math.min(j.atual.fim.getTime(), base.agora.getTime()));
  const linhas = await seguro("vendas do período", () => prisma.$queryRaw<{ id: string; v: number; g: number; va: number; ga: number }[]>`
    SELECT o."franchiseeId" AS id,
      (count(*) FILTER (WHERE o."createdAt" >= ${j.atual.inicio} AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)
        + count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" >= ${j.atual.inicio}))::int AS v,
      coalesce(sum(o."totalAmount") FILTER (WHERE o."createdAt" >= ${j.atual.inicio}), 0)::float AS g,
      (count(*) FILTER (WHERE o."createdAt" < ${j.anterior.fim} AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)
        + count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" < ${j.anterior.fim}))::int AS va,
      coalesce(sum(o."totalAmount") FILTER (WHERE o."createdAt" < ${j.anterior.fim}), 0)::float AS ga
    FROM "CustomerOrder" o
    WHERE o."franchiseeId" = ANY(${ids})
      AND ((o."createdAt" >= ${j.atual.inicio} AND o."createdAt" < ${fim}) OR (o."createdAt" >= ${j.anterior.inicio} AND o."createdAt" < ${j.anterior.fim}))
      AND o.status <> ALL(${fora}) AND o."reposicao" IS NULL AND o."totalAmount" < ${VALOR_IMPOSSIVEL}
    GROUP BY 1`);
  const valor = new Map(linhas.map((l) => [l.id, { atual: { vendas: Number(l.v), gmv: c2(Number(l.g)) }, anterior: { vendas: Number(l.va), gmv: c2(Number(l.ga)) } }]));
  cacheDasFaixas.set(chave, { em: base.agora.getTime(), valor });
  if (cacheDasFaixas.size > 30) cacheDasFaixas.delete(cacheDasFaixas.keys().next().value!);
  return valor;
}

const FAIXA_VAZIA: LojaDaAnalise["faixa"] = { atual: { vendas: 0, gmv: 0 }, anterior: { vendas: 0, gmv: 0 } };

/** A loja dentro de uma carteira. `dono` null = a carteira "Todas" (comissão de todos os parceiros somada). */
function lojaDaAnalise(base: Base, faixas: Map<string, LojaDaAnalise["faixa"]>, l: LojaDoBanco, dono: string | null, origem: OrigemNaCarteira, desde: Date): LojaDaAnalise {
  const b = base.porLoja.get(l.id)!;
  const p = base.perfis.get(l.id);
  const meses: Record<string, MesDaLoja> = {};
  for (const [ym, m] of Object.entries(b.meses)) {
    const lista = dono === null ? [...m.comissao.values()] : [m.comissao.get(dono)].filter(Boolean) as { prevista: number; recebida: number; disparo: number }[];
    const s = lista.reduce((t, x) => ({ prevista: t.prevista + x.prevista, recebida: t.recebida + x.recebida, disparo: t.disparo + x.disparo }), { prevista: 0, recebida: 0, disparo: 0 });
    meses[ym] = { vendas: m.vendas, gmv: m.gmv, receita: m.receita, comissaoPrevista: c2(s.prevista), comissaoRecebida: c2(s.recebida), comissaoDoDisparo: c2(s.disparo) };
  }
  const vendas = p?.oportunidades.filter((o) => o.tipo === "VENDA") || [];
  return {
    id: l.id, nome: l.storeName || l.name || l.email, cidade: l.city, criadaEm: l.createdAt.toISOString(),
    testeAte: l.trialEndsAt ? l.trialEndsAt.toISOString() : null, desde: desde.toISOString(), isenta: b.isenta,
    origem, percentual: dono ? (b.percentuais.get(dono) ?? null) : null, meses,
    faixa: faixas.get(l.id) || FAIXA_VAZIA,
    primeiroPagamentoEm: b.primeiroPagamentoEm, bloqueadaAgora: b.bloqueadaAgora, upsell: b.upsell,
    agora: p ? {
      status: p.status, diasSemVenda: p.diasSemVenda, valor30: p.valor30, valor30Anterior: p.valor30Anterior,
      oportunidadesDeVenda: vendas.length, potencialMensal: vendas.reduce((t, o) => t + (o.valorMensal || 0), 0),
      oportunidadesDeAdocao: p.oportunidades.length - vendas.length, produtos: p.oportunidades.map((o) => o.produto),
    } : null,
  };
}

/**
 * As carteiras pela regra do Douglas (regras.ts, `donosDaLoja`): loja do link
 * de um vendedor é só dele; atribuída é do vendedor atribuído; indicada por
 * embaixador que não vende aparece também nas indicações dele.
 */
function carteirasDaBase(base: Base, faixas: Map<string, LojaDaAnalise["faixa"]>): CarteiraDaAnalise[] {
  const parceiro = new Map(base.parceiros.map((p) => [p.id, p]));
  const ehVendedor = (id: string) => !!parceiro.get(id)?.isVendedor;
  const ehEmbaixador = (id: string) => { const p = parceiro.get(id); return !!p && indicacaoDeEmbaixador(p); };
  const lojasDe = new Map<string, LojaDaAnalise[]>();
  for (const l of base.lojas) {
    for (const d of donosDaLoja(l, ehVendedor, ehEmbaixador)) {
      const desde = d.origem === "ATRIBUIDA" && l.vendedorAtribuidoEm && l.vendedorAtribuidoEm > l.createdAt ? l.vendedorAtribuidoEm : l.createdAt;
      const dono = d.carteira === "sem" ? "__sem_vendedor__" : d.carteira;
      lojasDe.set(d.carteira, [...(lojasDe.get(d.carteira) || []), lojaDaAnalise(base, faixas, l, dono, d.origem, desde)]);
    }
  }
  const carteiras: CarteiraDaAnalise[] = [];
  for (const p of base.parceiros) {
    const lojas = lojasDe.get(p.id) || [];
    if (!p.isVendedor && lojas.length === 0) continue;
    carteiras.push({
      id: p.id, nome: p.name, ativo: p.active, papel: p.isVendedor ? "VENDEDOR" : "EMBAIXADOR",
      regra: regraDeComissao(p), lojas,
    });
  }
  carteiras.push({ id: "sem", nome: "Sem vendedor", papel: "SEM_VENDEDOR", ativo: true, regra: null, lojas: lojasDe.get("sem") || [] });
  return carteiras;
}

const crmVazio = (): AtividadeComercial => ({
  leads: 0, conversas: 0, mensagens: 0, tempoAtePrimeiroContatoMin: null, esperando: 0, demosMarcadas: 0, demosFeitas: 0, demosFaltou: 0,
  proximasDemos: 0, cadastros: 0, clientes: 0, perdidos: 0,
});
const doCrm = (d: DesempenhoDoVendedor | undefined): AtividadeComercial => (d ? {
  leads: d.recebidos, conversas: d.conversas, mensagens: d.mensagens, tempoAtePrimeiroContatoMin: d.tempoAtePrimeiroContatoMin, esperando: d.esperando,
  demosMarcadas: d.demosMarcadas, demosFeitas: d.demosFeitas, demosFaltou: d.demosFaltou, proximasDemos: d.proximasDemos,
  cadastros: d.cadastros, clientes: d.clientes, perdidos: d.perdidos,
} : crmVazio());

function somarCrm(xs: AtividadeComercial[]): AtividadeComercial {
  const t = crmVazio();
  let somaTempo = 0, comTempo = 0;
  for (const x of xs) {
    t.leads += x.leads; t.conversas += x.conversas; t.mensagens += x.mensagens; t.esperando += x.esperando;
    t.demosMarcadas += x.demosMarcadas; t.demosFeitas += x.demosFeitas; t.demosFaltou += x.demosFaltou; t.proximasDemos += x.proximasDemos;
    t.cadastros += x.cadastros; t.clientes += x.clientes; t.perdidos += x.perdidos;
    if (x.tempoAtePrimeiroContatoMin !== null) { somaTempo += x.tempoAtePrimeiroContatoMin; comTempo++; }
  }
  t.tempoAtePrimeiroContatoMin = comTempo ? Math.round(somaTempo / comTempo) : null;
  return t;
}

async function crmDoPeriodo(j: { atual: Janela; anterior: Janela }, agora: Date) {
  const fimAtual = new Date(Math.min(j.atual.fim.getTime(), agora.getTime()));
  const [atual, anterior] = await Promise.all([
    desempenhoDaEquipe(j.atual.inicio, fimAtual).catch(() => [] as DesempenhoDoVendedor[]),
    desempenhoDaEquipe(j.anterior.inicio, j.anterior.fim).catch(() => [] as DesempenhoDoVendedor[]),
  ]);
  return { atual: new Map(atual.map((d) => [d.vendedorId, d])), anterior: new Map(anterior.map((d) => [d.vendedorId, d])) };
}

export type ExtraDoPeriodo = { mes?: string; de?: string; ate?: string };

/** O período, as janelas em instantes e a base com meses suficientes (pelo menos 12 para o gráfico). */
async function prepararPeriodo(chave: ChaveDoPeriodo, extra: ExtraDoPeriodo, agora: Date) {
  const hoje = hojeNaLoja(FUSO, agora);
  // O intervalo livre não volta além do histórico guardado.
  const limite = `${mesesAntes(hoje.slice(0, 7), MESES_DE_HISTORICO - 2)}-01`;
  const corrigido: ExtraDoPeriodo = { ...extra, de: extra.de && extra.de < limite ? limite : extra.de, mes: extra.mes && extra.mes < limite.slice(0, 7) ? limite.slice(0, 7) : extra.mes };
  const periodo = periodoDaAnalise(chave, hoje, corrigido);
  const janelas = {
    atual: janelaDoPeriodo(periodo.de, periodo.ate, FUSO),
    anterior: janelaDoPeriodo(periodo.deAnterior, periodo.ateAnterior, FUSO),
  };
  // Meses desde o mês antes do período anterior até hoje (a régua de "perdida" olha o mês anterior).
  const primeiro = mesesAntes(periodo.anteriores[0], 1);
  const [a1, m1] = primeiro.split("-").map(Number), [a2, m2] = hoje.slice(0, 7).split("-").map(Number);
  const nMeses = Math.min(MESES_DE_HISTORICO, Math.max(13, (a2 - a1) * 12 + (m2 - m1) + 1));
  const base = await montarBase(nMeses, agora);
  const faixas = await faixasDasLojas(base, janelas);
  return { periodo, janelas, base, faixas };
}

export type AnaliseDasCarteiras = {
  periodo: PeriodoDaAnalise;
  carteiras: ResumoDaCarteira[];
  total: ResumoDaCarteira;
  disparoEstimado: boolean;
  custoMetaAtual: number;
  geradoEm: string;
};

/** O comparativo de todas as carteiras no período. */
export async function analiseDasCarteiras(chave: ChaveDoPeriodo, extra: ExtraDoPeriodo = {}, agora = new Date()): Promise<AnaliseDasCarteiras> {
  const { periodo, janelas, base, faixas } = await prepararPeriodo(chave, extra, agora);
  const crm = await crmDoPeriodo(janelas, agora);
  const carteiras = carteirasDaBase(base, faixas);
  const todas: CarteiraDaAnalise = {
    id: "todas", nome: "Todas as lojas", papel: "SEM_VENDEDOR", ativo: true, regra: null,
    lojas: base.lojas.map((l) => lojaDaAnalise(base, faixas, l, null, "SEM", l.createdAt)),
  };
  return {
    periodo,
    carteiras: carteiras.map((c) => resumirCarteira(c, periodo, janelas, base.ctx,
      c.papel === "VENDEDOR" ? { atual: doCrm(crm.atual.get(c.id)), anterior: doCrm(crm.anterior.get(c.id)) } : null)),
    total: resumirCarteira(todas, periodo, janelas, base.ctx, {
      atual: somarCrm([...crm.atual.values()].map((d) => doCrm(d))),
      anterior: somarCrm([...crm.anterior.values()].map((d) => doCrm(d))),
    }),
    disparoEstimado: base.disparoEstimado,
    custoMetaAtual: custoMeta(),
    geradoEm: agora.toISOString(),
  };
}

export type LinhaDaLojaNaCarteira = {
  id: string; nome: string; cidade: string | null; statusAgora: string | null; desde: string;
  origem: OrigemNaCarteira; percentual: number | null;
  vendas: number; gmv: number; gmvAnterior: number; variacaoGmv: number | null;
  previsto: number; recebido: number; emAberto: number; boleto: number;
  comissao: number; comissaoRecebida: number; disparoBruto: number; disparoMargem: number; comissaoDoDisparo: number;
  produtos: string[]; potencialMensal: number; upsell: string[]; bloqueada: boolean; isenta: boolean;
};

export type DetalheDaCarteira = {
  periodo: PeriodoDaAnalise;
  resumo: ResumoDaCarteira;
  evolucao: MesDaEvolucao[];
  mesesDoPeriodo: string[];
  mesesDoAnterior: string[];
  lojas: LinhaDaLojaNaCarteira[];
  disparoEstimado: boolean;
  custoMetaAtual: number;
  geradoEm: string;
};

/** Uma carteira por dentro: evolução mês a mês e a lista de lojas com o período. */
export async function detalheDaCarteira(id: string, chave: ChaveDoPeriodo, extra: ExtraDoPeriodo = {}, agora = new Date()): Promise<DetalheDaCarteira | null> {
  const { periodo, janelas, base, faixas } = await prepararPeriodo(chave, extra, agora);
  const carteira = carteirasDaBase(base, faixas).find((c) => c.id === id);
  if (!carteira) return null;
  const crm = carteira.papel === "VENDEDOR" ? await crmDoPeriodo(janelas, agora) : null;
  const resumo = resumirCarteira(carteira, periodo, janelas, base.ctx,
    crm ? { atual: doCrm(crm.atual.get(id)), anterior: doCrm(crm.anterior.get(id)) } : null);
  // Do começo do período anterior até hoje (pelo menos 12 meses).
  const desdeDoGrafico = [periodo.anteriores[0], mesesAntes(base.ctx.mesCorrente, 11)].sort()[0];
  const mesesDoGrafico = base.meses.filter((ym) => ym >= desdeDoGrafico);
  const evolucao = evolucaoDaCarteira(carteira, mesesDoGrafico, base.ctx);
  return {
    periodo, resumo, evolucao, mesesDoPeriodo: periodo.meses, mesesDoAnterior: periodo.anteriores,
    lojas: linhasDasLojas(carteira, periodo, janelas, base.ctx),
    disparoEstimado: base.disparoEstimado, custoMetaAtual: custoMeta(), geradoEm: agora.toISOString(),
  };
}

/** As lojas da carteira no período (a tabela do detalhe) — usa as mesmas contas do resumo, loja a loja. */
export function linhasDasLojas(carteira: CarteiraDaAnalise, periodo: PeriodoDaAnalise, janelas: { atual: Janela; anterior: Janela }, ctx: Contexto): LinhaDaLojaNaCarteira[] {
  return carteira.lojas.map((l): LinhaDaLojaNaCarteira => {
    const r = resumirCarteira({ ...carteira, lojas: [l] }, periodo, janelas, ctx, null);
    const a = r.atual;
    return {
      id: l.id, nome: l.nome, cidade: l.cidade, statusAgora: l.agora?.status ?? null, desde: l.desde,
      origem: l.origem, percentual: l.percentual,
      vendas: a.vendas, gmv: a.gmv, gmvAnterior: r.anterior.gmv, variacaoGmv: r.variacao.gmv,
      previsto: a.receita.previsto, recebido: a.receita.recebido, emAberto: a.receita.emAberto, boleto: a.receita.boleto,
      comissao: a.comissaoPrevista, comissaoRecebida: a.comissaoRecebida,
      disparoBruto: a.receita.disparoBruto, disparoMargem: a.receita.servicos.disparo, comissaoDoDisparo: a.comissaoDoDisparo,
      produtos: l.agora?.produtos ?? [], potencialMensal: c2(l.agora?.potencialMensal ?? 0),
      upsell: l.upsell.filter((u) => { const t = new Date(u.em).getTime(); return t >= janelas.atual.inicio.getTime() && t < janelas.atual.fim.getTime(); }).map((u) => u.servico),
      bloqueada: l.bloqueadaAgora, isenta: l.isenta,
    };
  }).sort((x, y) => y.previsto - x.previsto || y.gmv - x.gmv);
}
