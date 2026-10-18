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
 *   • os ciclos de mensalidade dos meses da janela (colunas pequenas);
 *   • as assinaturas (Bill, App, Multimarcas, totem) — uma linha por loja;
 *   • recargas de disparo pagas na janela;
 *   • o perfil de agora (lib/perfil-da-loja, já com cache de 5 min);
 *   • a atividade do CRM (lib/crm/desempenho.ts — a MESMA conta do quadro
 *     "Desempenho da equipe", chamada duas vezes: período e anterior).
 *
 * A base (tudo acima menos o CRM) fica 10 minutos na memória, por tamanho de
 * janela: trocar de período ou abrir uma carteira não refaz as consultas.
 */
import { prisma } from "@/lib/prisma";
import { STATUS_FORA_DA_VENDA } from "@/lib/relatorios/base";
import { VALOR_IMPOSSIVEL } from "@/lib/relatorios/regua-da-venda";
import { getCurrentYearMonth, intervaloDoMes, lojaIsenta } from "@/lib/billing";
import {
  comissaoSobre, mensalidadeDoCiclo, mesesAntes, papelNaLoja,
  type CicloNasRegras, type LojaNasRegras, type ParceiroNasRegras,
} from "@/lib/parceiro/regras";
import { valorDoAssessorNoMes, PRECO_DO_ASSESSOR, type Periodo } from "@/lib/assessor/assinatura";
import { PRECOS_DO_APP, teveAppCompletoNoMes, valorDoAppNoMes, type TrechoDoApp } from "@/lib/app-da-loja/plano";
import { valorDoMultimarcasNoMes, type TrechoDoMultimarcas } from "@/lib/multimarcas/assinatura";
import { desempenhoDaEquipe, type DesempenhoDoVendedor } from "@/lib/crm/desempenho";
import { idsDeTodasAsLojas, resumosDasLojas } from "@/lib/perfil-da-loja/no-banco";
import type { ResumoDoPerfil } from "@/lib/perfil-da-loja/regras";
import {
  SERVICOS_VAZIOS, evolucaoDaCarteira, mesesAte, periodoDaAnalise, receitaDoMes, resumirCarteira,
  type AtividadeComercial, type CarteiraDaAnalise, type ChaveDoPeriodo, type CicloDaReceita, type LojaDaAnalise,
  type MesDaEvolucao, type MesDaLoja, type PeriodoDaAnalise, type ResumoDaCarteira, type ServicosDoMes, type UpsellDaLoja,
} from "@/lib/performance-das-carteiras/regras";

const PRECO_DO_TOTEM = 100;
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

/** A base da análise: tudo o que não depende do período escolhido. */
type Base = {
  agora: Date;
  mesCorrente: string;
  meses: string[];
  intervalos: Record<string, { inicio: Date; fim: Date }>;
  fracaoDoMesCorrente: number;
  lojas: LojaDoBanco[];
  parceiros: ParceiroDoBanco[];
  /** Por loja: os meses (vendas, GMV, receita, comissão de cada parceiro). */
  porLoja: Map<string, {
    meses: Record<string, Omit<MesDaLoja, "comissaoPrevista" | "comissaoRecebida"> & { comissao: Map<string, { prevista: number; recebida: number }> }>;
    gmvNoCorte: number; vendasNoCorte: number;
    primeiroPagamentoEm: string | null; bloqueadaAgora: boolean; upsell: UpsellDaLoja[]; isenta: boolean;
  }>;
  perfis: Map<string, ResumoDoPerfil>;
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
  // Um mês a mais no começo: a régua de "perdida" e a situação olham o mês anterior.
  const meses = mesesAte(mesCorrente, nMeses + 1);
  const intervalos: Base["intervalos"] = {};
  for (const ym of meses) {
    const i = intervaloDoMes(ym);
    intervalos[ym] = { inicio: i.monthStart, fim: i.monthEnd };
  }
  const atual = intervalos[mesCorrente];
  const fracaoDoMesCorrente = Math.min(1, Math.max(0.01, (agora.getTime() - atual.inicio.getTime()) / (atual.fim.getTime() - atual.inicio.getTime())));
  const mesPassado = mesesAntes(mesCorrente, 1);
  const corte = new Date(intervalos[mesPassado].inicio.getTime() + (intervalos[mesPassado].fim.getTime() - intervalos[mesPassado].inicio.getTime()) * fracaoDoMesCorrente);
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
    seguro("vendas por mês", () => prisma.$queryRaw<{ id: string; mes: string; vendas: number; gmv: number; vendas_corte: number; gmv_corte: number }[]>`
      SELECT o."franchiseeId" AS id,
        to_char(((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours', 'YYYY-MM') AS mes,
        (count(*) FILTER (WHERE o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL) + count(DISTINCT o."tableSessionId"))::int AS vendas,
        coalesce(sum(o."totalAmount"), 0)::float AS gmv,
        (count(*) FILTER (WHERE o."createdAt" < ${corte} AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)
          + count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" < ${corte}))::int AS vendas_corte,
        coalesce(sum(o."totalAmount") FILTER (WHERE o."createdAt" < ${corte}), 0)::float AS gmv_corte
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
    seguro("recargas de disparo", () => prisma.$queryRaw<{ id: string; valor: number; em: Date }[]>`
      SELECT "franchiseeId" AS id, valor::float AS valor, "pagaEm" AS em FROM "DisparoRecarga"
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
        id: a.id, active: a.active, temCarteira: !!a.asaasWalletId, commissionPercent: a.commissionPercent, parentAmbassadorId: a.parentAmbassadorId,
        parentAmbassador: pai ? { id: pai.id, active: pai.active, temCarteira: !!pai.asaasWalletId, level2Percent: pai.level2Percent ?? 3 } : null,
      } : null,
      vendedorId: l.vendedorId,
      vendedor: v ? { id: v.id, active: v.active, isVendedor: v.isVendedor, temCarteira: !!v.asaasWalletId, sellerPercent: v.sellerPercent } : null,
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
    const recargasDaLoja = recargasDe.get(l.id) || [];
    const ciclosDaLoja = new Map((ciclosDe.get(l.id) || []).map((c) => [c.yearMonth, c]));
    const vendasDaLoja = new Map((vendasDe.get(l.id) || []).map((v) => [v.mes, v]));
    const regrasDaLoja = lojaNasRegras(l);
    const papeis: { p: ParceiroDoBanco; percentual: number }[] = [];
    for (const pid of new Set([l.vendedorId, l.ambassadorId].filter(Boolean) as string[])) {
      const p = parceiroPorId.get(pid);
      const papel = p ? papelNaLoja(doBancoParaRegras(p), regrasDaLoja) : null;
      if (p && papel) papeis.push({ p, percentual: papel.percentual });
    }

    type MesesDaLoja = NonNullable<ReturnType<Base["porLoja"]["get"]>>["meses"];
    const mesesDaLoja: MesesDaLoja = {};
    for (const ym of meses) {
      const { inicio, fim } = intervalos[ym];
      const v = vendasDaLoja.get(ym);
      const ciclo = ciclosDaLoja.get(ym) || null;
      const appNoMes = valorDoAppNoMes(trechosApp, inicio, fim, agora);
      const servicos: ServicosDoMes = {
        ...SERVICOS_VAZIOS,
        app: appNoMes,
        bill: valorDoAssessorNoMes(periodosBill, b?.testeAte ?? null, inicio, fim, agora),
        // O app completo (Android + Apple) traz o Multimarcas de cortesia.
        multimarcas: teveAppCompletoNoMes(trechosApp, inicio, fim, agora) ? 0 : valorDoMultimarcasNoMes(trechosMm, mm?.testeAte ?? null, inicio, fim, agora),
        totem: totensDaLoja.filter((t) => t.active && new Date(t.createdAt).getTime() < fim.getTime()).length * PRECO_DO_TOTEM,
        disparo: c2(recargasDaLoja.filter((r) => { const t = new Date(r.em).getTime(); return t >= inicio.getTime() && t < fim.getTime(); }).reduce((s, r) => s + Number(r.valor), 0)),
      };
      const receita = receitaDoMes(ciclo, servicos, isenta);
      // Comissão de cada parceiro — a MESMA conta do portal (lib/parceiro/relatorio.ts):
      // % do papel sobre a mensalidade do ciclo; paga = sobre o líquido recebido.
      const m = mensalidadeDoCiclo(ciclo, ym, mesCorrente, agora);
      const comissao = new Map<string, { prevista: number; recebida: number }>();
      for (const { p, percentual } of papeis) {
        const base = m.situacao === "PAGA" ? m.pago : m.valor;
        comissao.set(p.id, { prevista: comissaoSobre(base, percentual), recebida: m.situacao === "PAGA" ? comissaoSobre(m.pago, percentual) : 0 });
      }
      mesesDaLoja[ym] = { vendas: v ? Number(v.vendas) : 0, gmv: v ? c2(Number(v.gmv)) : 0, receita, comissao };
    }

    // Bloqueada agora: boleto vencido com a data do bloqueio já passada.
    const bloqueadaAgora = (abertosDe.get(l.id) || []).some((c) => {
      const m = mensalidadeDoCiclo(c, c.yearMonth, mesCorrente, agora);
      return m.situacao === "VENCIDA" && !!m.bloqueiaEm && new Date(m.bloqueiaEm).getTime() <= agora.getTime();
    });

    // Upsell: quando cada serviço pago começou.
    const upsell: UpsellDaLoja[] = [];
    if (trechosApp[0]) upsell.push({ servico: "app", em: trechosApp[0].de, valorMensal: trechosApp[0].valor });
    if (periodosBill[0]) upsell.push({ servico: "bill", em: periodosBill[0].de, valorMensal: PRECO_DO_ASSESSOR });
    if (trechosMm[0]) upsell.push({ servico: "multimarcas", em: trechosMm[0].de, valorMensal: trechosMm[0].valor });
    for (const t of totensDaLoja) upsell.push({ servico: "totem", em: new Date(t.createdAt).toISOString(), valorMensal: PRECO_DO_TOTEM });
    const recargaMaisAntiga = [...recargasDaLoja].sort((a, b) => new Date(a.em).getTime() - new Date(b.em).getTime())[0];
    if (recargaMaisAntiga) upsell.push({ servico: "disparo", em: new Date(recargaMaisAntiga.em).toISOString(), valorMensal: 0 });
    // Tráfego: o primeiro mês da janela com taxa, depois de um mês sem.
    for (let i = 1; i < meses.length; i++) {
      const fee = ciclosDaLoja.get(meses[i])?.metaAdsFee ?? 0;
      const antes = ciclosDaLoja.get(meses[i - 1])?.metaAdsFee ?? 0;
      if (fee > 0 && antes <= 0) { upsell.push({ servico: "trafego", em: intervalos[meses[i]].inicio.toISOString(), valorMensal: fee }); break; }
    }

    const vPassado = vendasDaLoja.get(mesPassado);
    porLoja.set(l.id, {
      meses: mesesDaLoja,
      gmvNoCorte: vPassado ? c2(Number(vPassado.gmv_corte)) : 0,
      vendasNoCorte: vPassado ? Number(vPassado.vendas_corte) : 0,
      primeiroPagamentoEm: pagamentoDe.get(l.id) ? new Date(pagamentoDe.get(l.id)!).toISOString() : null,
      bloqueadaAgora,
      upsell,
      isenta,
    });
  }

  const base: Base = {
    agora, mesCorrente, meses, intervalos, fracaoDoMesCorrente, lojas, parceiros, porLoja,
    perfis: new Map(perfis.map((p) => [p.id, p])),
  };
  cacheDaBase.set(nMeses, { em: agora.getTime(), base });
  return base;
}

/**
 * A loja dentro de uma carteira. `dono` = o parceiro dono da carteira (a
 * comissão é a dele); null = a carteira "Todas" (comissão de todos os parceiros
 * da loja somada); "Sem vendedor" passa um id que não existe (comissão zero).
 */
function lojaDaAnalise(base: Base, l: LojaDoBanco, dono: string | null, desde: Date): LojaDaAnalise {
  const b = base.porLoja.get(l.id)!;
  const p = base.perfis.get(l.id);
  const meses: Record<string, MesDaLoja> = {};
  for (const [ym, m] of Object.entries(b.meses)) {
    const lista = dono === null ? [...m.comissao.values()] : [m.comissao.get(dono)].filter(Boolean) as { prevista: number; recebida: number }[];
    const soma = lista.reduce((s, x) => ({ prevista: s.prevista + x.prevista, recebida: s.recebida + x.recebida }), { prevista: 0, recebida: 0 });
    meses[ym] = { vendas: m.vendas, gmv: m.gmv, receita: m.receita, comissaoPrevista: c2(soma.prevista), comissaoRecebida: c2(soma.recebida) };
  }
  const vendas = p?.oportunidades.filter((o) => o.tipo === "VENDA") || [];
  return {
    id: l.id, nome: l.storeName || l.name || l.email, cidade: l.city, criadaEm: l.createdAt.toISOString(),
    testeAte: l.trialEndsAt ? l.trialEndsAt.toISOString() : null, desde: desde.toISOString(), isenta: b.isenta, meses,
    gmvAnteriorNoCorte: b.gmvNoCorte, vendasAnterioresNoCorte: b.vendasNoCorte, primeiroPagamentoEm: b.primeiroPagamentoEm,
    bloqueadaAgora: b.bloqueadaAgora, upsell: b.upsell,
    agora: p ? {
      status: p.status, diasSemVenda: p.diasSemVenda, valor30: p.valor30, valor30Anterior: p.valor30Anterior,
      oportunidadesDeVenda: vendas.length, potencialMensal: vendas.reduce((s, o) => s + (o.valorMensal || 0), 0),
      oportunidadesDeAdocao: p.oportunidades.length - vendas.length, produtos: p.oportunidades.map((o) => o.produto),
    } : null,
  };
}

/** As carteiras: cada vendedor/embaixador com lojas (ou vendedor da equipe) e "Sem vendedor". */
function carteirasDaBase(base: Base): CarteiraDaAnalise[] {
  const carteiras: CarteiraDaAnalise[] = [];
  for (const p of base.parceiros) {
    const comoVendedor = base.lojas.filter((l) => l.vendedorId === p.id);
    const indicadas = base.lojas.filter((l) => l.ambassadorId === p.id);
    if (!p.isVendedor && indicadas.length === 0) continue;
    const todas = new Map<string, LojaDaAnalise>();
    // Indicada desde o cadastro; na carteira desde a atribuição (sem data, desde o cadastro).
    for (const l of indicadas) todas.set(l.id, lojaDaAnalise(base, l, p.id, l.createdAt));
    for (const l of comoVendedor) if (!todas.has(l.id)) todas.set(l.id, lojaDaAnalise(base, l, p.id, l.vendedorAtribuidoEm && l.vendedorAtribuidoEm > l.createdAt ? l.vendedorAtribuidoEm : l.createdAt));
    carteiras.push({
      id: p.id, nome: p.name, ativo: p.active,
      papel: p.isVendedor ? (indicadas.length ? "VENDEDOR_E_EMBAIXADOR" : "VENDEDOR") : "EMBAIXADOR",
      lojas: [...todas.values()],
    });
  }
  carteiras.push({
    id: "sem", nome: "Sem vendedor", papel: "SEM_VENDEDOR", ativo: true,
    lojas: base.lojas.filter((l) => !l.vendedorId && !l.ambassadorId).map((l) => lojaDaAnalise(base, l, "__sem_vendedor__", l.createdAt)),
  });
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

async function crmDoPeriodo(periodo: PeriodoDaAnalise, base: Base) {
  const fimAtual = periodo.parcial ? base.agora : base.intervalos[periodo.meses[periodo.meses.length - 1]]?.fim;
  const iniAtual = base.intervalos[periodo.meses[0]]?.inicio;
  const iniAnt = base.intervalos[periodo.anteriores[0]]?.inicio;
  const fimAnt = periodo.chave === "mes" && iniAnt
    ? new Date(iniAnt.getTime() + (base.intervalos[periodo.anteriores[0]].fim.getTime() - iniAnt.getTime()) * base.fracaoDoMesCorrente)
    : base.intervalos[periodo.anteriores[periodo.anteriores.length - 1]]?.fim;
  if (!iniAtual || !fimAtual || !iniAnt || !fimAnt) return null;
  const [atual, anterior] = await Promise.all([
    desempenhoDaEquipe(iniAtual, fimAtual).catch(() => [] as DesempenhoDoVendedor[]),
    desempenhoDaEquipe(iniAnt, fimAnt).catch(() => [] as DesempenhoDoVendedor[]),
  ]);
  return { atual: new Map(atual.map((d) => [d.vendedorId, d])), anterior: new Map(anterior.map((d) => [d.vendedorId, d])) };
}

const mesesDaJanela = (p: PeriodoDaAnalise) => Math.max(12, p.meses.length * 2);

export type AnaliseDasCarteiras = {
  periodo: PeriodoDaAnalise;
  carteiras: ResumoDaCarteira[];
  total: ResumoDaCarteira;
  geradoEm: string;
};

/** O comparativo de todas as carteiras no período. */
export async function analiseDasCarteiras(chave: ChaveDoPeriodo, agora = new Date()): Promise<AnaliseDasCarteiras> {
  const periodo = periodoDaAnalise(chave, getCurrentYearMonth(0));
  const base = await montarBase(mesesDaJanela(periodo), agora);
  const crm = await crmDoPeriodo(periodo, base);
  const carteiras = carteirasDaBase(base);
  const resumo = (c: CarteiraDaAnalise) => resumirCarteira(
    c, periodo, base.intervalos, agora, base.fracaoDoMesCorrente, base.mesCorrente,
    crm && c.papel !== "EMBAIXADOR" && c.papel !== "SEM_VENDEDOR" ? { atual: doCrm(crm.atual.get(c.id)), anterior: doCrm(crm.anterior.get(c.id)) } : null,
  );
  const todas: CarteiraDaAnalise = {
    id: "todas", nome: "Todas as lojas", papel: "SEM_VENDEDOR", ativo: true,
    lojas: base.lojas.map((l) => lojaDaAnalise(base, l, null, l.createdAt)),
  };
  const somaCrm = crm ? {
    atual: somarCrm([...crm.atual.values()].map((d) => doCrm(d))),
    anterior: somarCrm([...crm.anterior.values()].map((d) => doCrm(d))),
  } : null;
  return {
    periodo,
    carteiras: carteiras.map(resumo),
    total: resumirCarteira(todas, periodo, base.intervalos, agora, base.fracaoDoMesCorrente, base.mesCorrente, somaCrm),
    geradoEm: agora.toISOString(),
  };
}

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

export type LinhaDaLojaNaCarteira = {
  id: string; nome: string; cidade: string | null; statusAgora: string | null; desde: string;
  vendas: number; gmv: number; gmvAnterior: number; variacaoGmv: number | null;
  previsto: number; recebido: number; emAberto: number; comissao: number;
  produtos: string[]; potencialMensal: number; upsell: string[]; bloqueada: boolean; isenta: boolean;
};

export type DetalheDaCarteira = {
  periodo: PeriodoDaAnalise;
  resumo: ResumoDaCarteira;
  evolucao: MesDaEvolucao[];
  /** Meses da evolução que são do período escolhido (os outros são o período anterior e o histórico). */
  mesesDoPeriodo: string[];
  mesesDoAnterior: string[];
  lojas: LinhaDaLojaNaCarteira[];
  geradoEm: string;
};

/** Uma carteira por dentro: evolução mês a mês e a lista de lojas com o período. */
export async function detalheDaCarteira(id: string, chave: ChaveDoPeriodo, agora = new Date()): Promise<DetalheDaCarteira | null> {
  const periodo = periodoDaAnalise(chave, getCurrentYearMonth(0));
  const base = await montarBase(mesesDaJanela(periodo), agora);
  const carteira = carteirasDaBase(base).find((c) => c.id === id);
  if (!carteira) return null;
  const crm = carteira.papel === "VENDEDOR" || carteira.papel === "VENDEDOR_E_EMBAIXADOR" ? await crmDoPeriodo(periodo, base) : null;
  const resumo = resumirCarteira(
    carteira, periodo, base.intervalos, agora, base.fracaoDoMesCorrente, base.mesCorrente,
    crm ? { atual: doCrm(crm.atual.get(id)), anterior: doCrm(crm.anterior.get(id)) } : null,
  );
  const mesesDoGrafico = base.meses.slice(-mesesDaJanela(periodo));
  const evolucao = evolucaoDaCarteira(carteira, mesesDoGrafico, base.intervalos, base.mesCorrente, base.fracaoDoMesCorrente);
  const ini = base.intervalos[periodo.meses[0]].inicio.getTime();
  const fim = periodo.parcial ? agora.getTime() : base.intervalos[periodo.meses[periodo.meses.length - 1]].fim.getTime();
  const lojas = carteira.lojas.map((l): LinhaDaLojaNaCarteira => {
    const soma = (ms: string[], corte: boolean) => ms.reduce((s, ym, i) => {
      const m = l.meses[ym];
      if (!m) return s;
      const ultimo = i === ms.length - 1;
      return {
        vendas: s.vendas + (corte && ultimo ? l.vendasAnterioresNoCorte : m.vendas),
        gmv: s.gmv + (corte && ultimo ? l.gmvAnteriorNoCorte : m.gmv),
        previsto: s.previsto + m.receita.previsto, recebido: s.recebido + m.receita.recebido, emAberto: s.emAberto + m.receita.emAberto,
        comissao: s.comissao + m.comissaoPrevista,
      };
    }, { vendas: 0, gmv: 0, previsto: 0, recebido: 0, emAberto: 0, comissao: 0 });
    const a = soma(periodo.meses, false);
    const ant = soma(periodo.anteriores, periodo.chave === "mes");
    return {
      id: l.id, nome: l.nome, cidade: l.cidade, statusAgora: l.agora?.status ?? null, desde: l.desde,
      vendas: a.vendas, gmv: c2(a.gmv), gmvAnterior: c2(ant.gmv), variacaoGmv: ant.gmv > 0 ? Math.round(((a.gmv - ant.gmv) / ant.gmv) * 100) : null,
      previsto: c2(a.previsto), recebido: c2(a.recebido), emAberto: c2(a.emAberto), comissao: c2(a.comissao),
      produtos: l.agora?.produtos ?? [], potencialMensal: c2(l.agora?.potencialMensal ?? 0),
      upsell: l.upsell.filter((u) => { const t = new Date(u.em).getTime(); return t >= ini && t < fim; }).map((u) => u.servico),
      bloqueada: l.bloqueadaAgora, isenta: l.isenta,
    };
  }).sort((x, y) => y.previsto - x.previsto || y.gmv - x.gmv);
  return {
    periodo, resumo, evolucao,
    mesesDoPeriodo: periodo.meses, mesesDoAnterior: periodo.anteriores,
    lojas, geradoEm: agora.toISOString(),
  };
}
