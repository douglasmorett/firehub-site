/**
 * Aba Projeção do admin: quanto o FireHub deve fechar de mensalidade no mês, e
 * quem precisa de uma ligação (parou de vender, teste acabando, cadastro sem
 * cardápio, cardápio pronto sem nunca vender).
 *
 * As contas ficam em lib/projecao-do-mes-regras.ts. A base de cada loja segue a
 * do boleto (lib/billing.ts): bruto (totalAmount + discountTotal), sem
 * CRIANDO_IA nem totem não pago, cancelado só desde a virada dos 2%, venda do
 * teste fora; loja isenta não paga; lojas extras de iFood/99 somam R$ 50.
 */
import { prisma } from "@/lib/prisma";
import {
  getCurrentYearMonth, intervaloDoMes, inicioDaCobranca, lojaIsenta,
  lojasExtrasDeMarketplace, detectarUsoDaLoja,
} from "@/lib/billing";
import { FIREHUB_PLAN, VIRADA_DOS_2_POR_CENTO } from "@/lib/firehub-billing";
import {
  DIA, DIAS_PARA_PARADA, chanceDePagar, diaNoFuso, faixaDaVenda, mesCheioNoRitmo,
  projetarMes, ritmoPorDia, somarDias, telefoneDoWhatsapp, totaisDaProjecao,
  type Faixa, type Situacao,
} from "@/lib/projecao-do-mes-regras";
import { entraNoFunil, montarCrescimento, type Boleto, type LojaNoCrescimento } from "@/lib/projecao-de-crescimento-regras";

const FUSO = "America/Sao_Paulo";
/** Sem pedido há este tanto de dias, a loja que vendia entra na lista de contato. */
export const DIAS_PARA_LIGAR = 3;
/** Quem parou há mais que isto já é outra conversa (some da lista "parou"). */
const DIAS_MAX_PARADA = 45;
/** O teste acaba em até este tanto de dias: lista de contato. */
const DIAS_DO_FIM_DO_TESTE = 5;
/** Meses antes do atual que o bloco "Mês que vem com crescimento" olha. */
const MESES_DE_HISTORICO = 6;

export type LinhaDaProjecao = {
  id: string; loja: string; whatsapp: string | null; vendedor: string | null;
  situacao: Situacao; faixa: Faixa; testeAte: string | null;
  vendidoNoMes: number; porDia: number; baseAteAgora: number; baseProjetada: number;
  mensalidade: number; extras: number; taxas: number; total: number;
  chance: number; porque: string;
  diasSemPedido: number | null;
};

type Contato = {
  id: string; loja: string; cidade: string | null; whatsapp: string | null; vendedor: string | null;
  cadastroHaDias: number; testeAte: string | null; isenta: boolean;
  /** "loja extra de X" — o dono já é cliente. */
  contaDe: string | null;
};

export async function montarProjecao(agora = new Date()) {
  const mes = getCurrentYearMonth(0, FUSO);
  const mesAnterior = getCurrentYearMonth(-1, FUSO);
  const mesSeguinte = getCurrentYearMonth(1, FUSO);
  const { monthStart, monthEnd } = intervaloDoMes(mes, FUSO);

  // Janela do ritmo: os 7 dias inteiros antes de hoje, no fuso de Brasília.
  const hoje = diaNoFuso(agora, FUSO);
  const inicioDaJanelaDia = somarDias(hoje, -7);
  const inicioDaJanela = intervaloDoDia(inicioDaJanelaDia);
  const fimDaJanela = intervaloDoDia(hoje);
  const desde = new Date(Math.min(monthStart.getTime(), inicioDaJanela.getTime()) - DIA);

  // As leituras não dependem umas das outras: todas de uma vez.
  const [lojas, integracoesForaDoSchema, atividade, porDiaDaLoja, ciclos] = await Promise.all([
    prisma.user.findMany({
      where: { role: "FRANCHISEE", ownerId: null },
      select: {
        id: true, name: true, storeName: true, email: true, city: true, storePhone: true,
        createdAt: true, trialEndsAt: true, planPercent: true, isFranqueadoHakim: true,
        ambassadorAccount: { select: { active: true } },
        ifoodConnected: true, food99Connected: true, jotajaConnected: true, chatbotConfig: true,
        accountGroupId: true, vendedor: { select: { name: true } },
      },
    }),
    // Colunas que nasceram em garantir-colunas.ts e não estão no schema do Prisma.
    prisma.$queryRaw<{ id: string; brendi: boolean | null; wabiz: boolean | null }[]>`
      SELECT id, "brendiConnected" AS brendi, "wabizConnected" AS wabiz FROM "User" WHERE role = 'FRANCHISEE'`
      .catch(() => []),
    // Primeiro e último pedido (não cancelado) de cada loja: o mesmo critério do
    // "Usando / Paradas / Nunca venderam" da Visão Geral (lib/atividade-da-loja.ts).
    prisma.$queryRaw<{ id: string; primeiro: Date | null; ultimo: Date | null }[]>`
      SELECT u.id,
        (SELECT MIN(o."createdAt") FROM "CustomerOrder" o WHERE o."franchiseeId" = u.id AND o.status <> 'CANCELADO') AS primeiro,
        (SELECT o."createdAt" FROM "CustomerOrder" o WHERE o."franchiseeId" = u.id AND o.status <> 'CANCELADO'
          ORDER BY o."createdAt" DESC LIMIT 1) AS ultimo
      FROM "User" u WHERE u.role = 'FRANCHISEE' AND u."ownerId" IS NULL`,
    // Venda de cada loja por dia (no fuso dela), na régua do boleto. `cobravel`
    // é a parte de depois do teste.
    prisma.$queryRaw<{ id: string; dia: string; bruto: number; cobravel: number }[]>`
      SELECT o."franchiseeId" AS id,
        to_char((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(u."storeTimezone", ${FUSO}), 'YYYY-MM-DD') AS dia,
        SUM(o."totalAmount" + COALESCE(o."discountTotal", 0))::float AS bruto,
        SUM(CASE WHEN u."trialEndsAt" IS NULL OR o."createdAt" >= u."trialEndsAt"
          THEN o."totalAmount" + COALESCE(o."discountTotal", 0) ELSE 0 END)::float AS cobravel
      FROM "CustomerOrder" o JOIN "User" u ON u.id = o."franchiseeId"
      WHERE o."createdAt" >= ${desde}
        AND o.status <> 'CRIANDO_IA'
        AND NOT (o.status = 'AGUARDANDO_PAGAMENTO' AND o."paymentPaidAt" IS NULL)
        AND (o.status <> 'CANCELADO' OR o."createdAt" >= ${VIRADA_DOS_2_POR_CENTO})
      GROUP BY 1, 2`,
    prisma.franchiseeBillingCycle.findMany({
      where: { yearMonth: mes },
      select: { franchiseeId: true, status: true, metaAdsFee: true, totemFee: true },
    }),
  ]);
  const porId = new Map(lojas.map((l) => [l.id, l]));
  const nomeDa = (l: { storeName: string | null; name: string | null; email: string }) => l.storeName || l.name || l.email;
  const outrasIntegracoes = new Map(integracoesForaDoSchema.map((l) => [l.id, { brendi: !!l.brendi, wabiz: !!l.wabiz }]));
  const atv = new Map(atividade.map((a) => [a.id, a]));
  const diasSem = (id: string) => {
    const u = atv.get(id)?.ultimo;
    return u ? Math.max(0, Math.floor((agora.getTime() - new Date(u).getTime()) / DIA)) : null;
  };
  const cicloDa = new Map(ciclos.map((c) => [c.franchiseeId, c]));

  const diaDaVirada = diaNoFuso(VIRADA_DOS_2_POR_CENTO, FUSO);
  type Soma = { mes: number; antes: number; depois: number; janela: number };
  const somas = new Map<string, Soma>();
  const vendaDoDia = new Map<string, number>();
  for (const r of porDiaDaLoja) {
    const s = somas.get(r.id) || { mes: 0, antes: 0, depois: 0, janela: 0 };
    if (r.dia.startsWith(mes)) {
      s.mes += r.bruto;
      if (r.dia < diaDaVirada) s.antes += r.cobravel; else s.depois += r.cobravel;
      vendaDoDia.set(r.dia, (vendaDoDia.get(r.dia) || 0) + r.bruto);
    }
    if (r.dia >= inicioDaJanelaDia && r.dia < hoje) s.janela += r.bruto;
    somas.set(r.id, s);
  }

  // ── Projeção, loja a loja ─────────────────────────────────────
  const linhas: LinhaDaProjecao[] = [];
  let ritmoDaPlataforma = 0;
  let mesSeguinteNoRitmo = 0;
  const porDiaDa = new Map<string, number>();
  for (const [id, s] of somas) {
    const l = porId.get(id);
    if (!l) continue;
    const primeiro = atv.get(id)?.primeiro ? new Date(atv.get(id)!.primeiro!) : null;
    const porDia = ritmoPorDia(s.janela, primeiro, inicioDaJanela, fimDaJanela);
    porDiaDa.set(id, porDia);
    ritmoDaPlataforma += porDia;
    if (lojaIsenta(l)) continue;
    mesSeguinteNoRitmo += mesCheioNoRitmo(porDia, mesSeguinte);

    const inicio = inicioDaCobranca(monthStart, monthEnd, l.trialEndsAt);
    const p = projetarMes({ mes, contaAntesDaVirada: s.antes, contaDepois: s.depois, porDia, inicioDaCobranca: inicio, agora, fimDoMes: monthEnd });
    if (p.mensalidade <= 0) continue;
    linhas.push(linhaDaLoja(l, {
      situacao: inicio && inicio <= agora ? "PAGANDO" : "TESTE_ACABA",
      vendidoNoMes: s.mes, porDia, ...p,
    }));
  }

  // Quem tem ciclo aberto, saiu do teste e não vendeu nada que conte: o
  // fechamento cobra o mínimo se a loja USOU o sistema (closeBillingCycle).
  const comVenda = new Set(linhas.map((x) => x.id));
  const soUso = await Promise.all(ciclos.map(async (c) => {
    const l = porId.get(c.franchiseeId);
    if (!l || c.status !== "OPEN" || lojaIsenta(l) || comVenda.has(l.id)) return null;
    const inicio = inicioDaCobranca(monthStart, monthEnd, l.trialEndsAt);
    if (!inicio) return null;
    const uso = await detectarUsoDaLoja(l.id, inicio, monthEnd);
    if (!uso.usou) return null;
    return linhaDaLoja(l, {
      situacao: "SO_USO", vendidoNoMes: somas.get(l.id)?.mes || 0, porDia: 0,
      baseAteAgora: 0, baseProjetada: 0, mensalidade: FIREHUB_PLAN.MIN_MONTHLY, porque: `usou: ${uso.motivos.slice(0, 2).join(", ")}`,
    });
  }));
  for (const x of soUso) if (x) linhas.push(x);

  // As lojas extras de iFood/99 do boleto, todas de uma vez.
  const extrasDa = new Map(await Promise.all(linhas.map(async (x) =>
    [x.id, (await lojasExtrasDeMarketplace(x.id, porId.get(x.id))).total] as const)));
  for (const x of linhas) {
    x.extras = extrasDa.get(x.id) || 0;
    x.total = x.mensalidade + x.extras + x.taxas;
  }

  /** A linha sem as lojas extras (somadas depois, em lote). */
  function linhaDaLoja(
    l: (typeof lojas)[number],
    d: { situacao: Situacao; vendidoNoMes: number; porDia: number; baseAteAgora: number; baseProjetada: number; mensalidade: number; porque?: string },
  ): LinhaDaProjecao {
    const extras = 0;
    const ciclo = cicloDa.get(l.id);
    const taxas = (ciclo?.metaAdsFee ?? 0) + (ciclo?.totemFee ?? 0);
    const faixa = faixaDaVenda(d.situacao === "SO_USO" ? 0 : d.baseProjetada);
    const diasSemPedido = diasSem(l.id);
    const c = chanceDePagar({ situacao: d.situacao, faixa, diasSemPedido });
    return {
      id: l.id, loja: nomeDa(l), whatsapp: telefoneDoWhatsapp(l.storePhone), vendedor: l.vendedor?.name || null,
      situacao: d.situacao, faixa, testeAte: l.trialEndsAt ? l.trialEndsAt.toISOString() : null,
      vendidoNoMes: d.vendidoNoMes, porDia: d.porDia, baseAteAgora: d.baseAteAgora, baseProjetada: d.baseProjetada,
      mensalidade: d.mensalidade, extras, taxas, total: d.mensalidade + extras + taxas,
      chance: c.chance, porque: d.porque ? `${c.porque} (${d.porque})` : c.porque, diasSemPedido,
    };
  }

  linhas.sort((a, b) => b.total - a.total || b.baseProjetada - a.baseProjetada);
  const totais = totaisDaProjecao(linhas);

  // ── Mês que vem com crescimento (lib/projecao-de-crescimento-regras.ts) ──
  // Uma leitura a mais: os boletos dos meses de histórico. O resto já está aqui.
  const meses = Array.from({ length: MESES_DE_HISTORICO + 1 }, (_, i) => getCurrentYearMonth(i - MESES_DE_HISTORICO, FUSO));
  const ciclosAntigos = await prisma.franchiseeBillingCycle.findMany({
    where: { yearMonth: { gte: meses[0], lt: mes }, status: { in: ["CLOSED", "PAID", "FORGIVEN"] } },
    select: { franchiseeId: true, yearMonth: true, status: true, amountDue: true, totalSales: true, asaasPaymentId: true },
  });
  const boletosDa = new Map<string, Boleto[]>();
  for (const c of ciclosAntigos) {
    // Boleto = mês fechado com mensalidade, ou perdoado pelo admin. PAID sem
    // boleto no Asaas é o "nada a cobrar" (teste, isenta).
    if (c.status !== "FORGIVEN" && c.amountDue <= 0) continue;
    const b = { mes: c.yearMonth, pago: c.status === "PAID" && !!c.asaasPaymentId, base: c.totalSales, valor: c.amountDue };
    boletosDa.set(c.franchiseeId, [...(boletosDa.get(c.franchiseeId) || []), b]);
  }
  const pagandoNoMes = new Map(linhas.filter((x) => x.situacao === "PAGANDO").map((x) => [x.id, x.baseProjetada]));
  const linhaDa = new Map(linhas.map((x) => [x.id, { total: x.total, chance: x.chance }]));
  const lojasNoCrescimento: LojaNoCrescimento[] = lojas
    .filter((l) => !lojaIsenta(l))
    .map((l) => ({
      id: l.id,
      doFunil: entraNoFunil({ id: l.id, isenta: false, accountGroupId: l.accountGroupId }),
      cadastro: l.createdAt, fimDoTeste: l.trialEndsAt,
      primeiroPedido: atv.get(l.id)?.primeiro ? new Date(atv.get(l.id)!.primeiro!) : null,
      ultimoPedido: atv.get(l.id)?.ultimo ? new Date(atv.get(l.id)!.ultimo!) : null,
      boletos: boletosDa.get(l.id) || [],
      previstoNoMes: pagandoNoMes.get(l.id) ?? null,
      noMes: linhaDa.get(l.id) ?? null,
      porDia: porDiaDa.get(l.id) || 0,
    }));

  // Vendas por dia do mês: o realizado até hoje e o ritmo daqui para frente.
  const dias: { dia: string; valor: number; tipo: "real" | "hoje" | "projetado" }[] = [];
  for (let d = `${mes}-01`; d.startsWith(mes); d = somarDias(d, 1)) {
    if (d < hoje) dias.push({ dia: d, valor: vendaDoDia.get(d) || 0, tipo: "real" });
    else if (d === hoje) dias.push({ dia: d, valor: vendaDoDia.get(d) || 0, tipo: "hoje" });
    else dias.push({ dia: d, valor: ritmoDaPlataforma, tipo: "projetado" });
  }
  const restoDeHoje = ritmoDaPlataforma * Math.max(0, (intervaloDoDia(somarDias(hoje, 1)).getTime() - agora.getTime()) / DIA);
  const vendasDoMes = {
    ateAgora: dias.filter((d) => d.tipo !== "projetado").reduce((s, d) => s + d.valor, 0),
    projetado: dias.reduce((s, d) => s + d.valor, 0) + restoDeHoje,
    porDia: ritmoDaPlataforma,
  };

  // ── Mês passado: o que foi cobrado e o que entrou ─────────────
  const [anteriores, produtos, ultimos30] = await Promise.all([prisma.franchiseeBillingCycle.findMany({
    where: { yearMonth: mesAnterior, status: { in: ["CLOSED", "PAID", "FORGIVEN"] } },
    select: { franchiseeId: true, status: true, amountDue: true, amountPending: true, paidValue: true, asaasPaymentId: true, asaasStatus: true },
  }),
  prisma.menuProduct.groupBy({ by: ["franchiseeId"], _count: { _all: true } }),
  prisma.$queryRaw<{ id: string; pedidos: bigint; valor: number }[]>`
    SELECT "franchiseeId" AS id, COUNT(*) AS pedidos, SUM("totalAmount" + COALESCE("discountTotal", 0))::float AS valor
    FROM "CustomerOrder"
    WHERE "createdAt" >= ${new Date(agora.getTime() - 30 * DIA)} AND status NOT IN ('CANCELADO', 'CRIANDO_IA')
    GROUP BY 1`,
  ]);
  const emAberto = anteriores
    .filter((c) => c.status === "CLOSED" && c.amountPending > 0)
    .map((c) => {
      const l = porId.get(c.franchiseeId);
      return {
        id: c.franchiseeId, loja: l ? nomeDa(l) : c.franchiseeId, valor: c.amountPending, asaas: c.asaasStatus,
        whatsapp: telefoneDoWhatsapp(l?.storePhone), diasSemPedido: diasSem(c.franchiseeId),
      };
    })
    .sort((a, b) => b.valor - a.valor);
  const pagos = anteriores.filter((c) => c.status === "PAID" && c.asaasPaymentId);
  const mesPassado = {
    mes: mesAnterior,
    recebido: pagos.reduce((s, c) => s + (c.paidValue ?? c.amountDue), 0),
    lojasPagas: pagos.length,
    emAberto: emAberto.reduce((s, c) => s + c.valor, 0),
    lojasEmAberto: emAberto,
    perdoadas: anteriores.filter((c) => c.status === "FORGIVEN").length,
  };

  const seguinte = intervaloDoMes(mesSeguinte, FUSO);
  const crescimento = montarCrescimento({
    lojas: lojasNoCrescimento, agora, mes, mesSeguinte, meses,
    inicioDoMes: monthStart, fimDoMes: monthEnd, inicioDoSeguinte: seguinte.monthStart, fimDoSeguinte: seguinte.monthEnd,
    previstoDoMes: { boletos: linhas.length, aposta: totais.aposta, seTodas: totais.seTodas },
    mesAnterior,
    mesPassado: { recebido: mesPassado.recebido, emAberto: mesPassado.emAberto, boletosEmAberto: emAberto.length, lojasPagas: mesPassado.lojasPagas },
    fuso: FUSO,
  });

  // ── Para ligar ────────────────────────────────────────────────
  const qtdProdutos = new Map(produtos.map((p) => [p.franchiseeId, p._count._all]));
  const u30 = new Map(ultimos30.map((u) => [u.id, u]));

  const contato = (l: (typeof lojas)[number]): Contato => {
    const conta = l.accountGroupId && l.accountGroupId !== l.id ? porId.get(l.accountGroupId) : null;
    return {
      id: l.id, loja: nomeDa(l), cidade: l.city, vendedor: l.vendedor?.name || null,
      whatsapp: telefoneDoWhatsapp(l.storePhone || conta?.storePhone),
      cadastroHaDias: Math.floor((agora.getTime() - l.createdAt.getTime()) / DIA),
      testeAte: l.trialEndsAt ? l.trialEndsAt.toISOString() : null, isenta: lojaIsenta(l),
      contaDe: conta ? nomeDa(conta) : null,
    };
  };

  const pararam = lojas
    .map((l) => ({ l, dias: diasSem(l.id) }))
    .filter(({ dias }) => dias !== null && dias >= DIAS_PARA_LIGAR && dias <= DIAS_MAX_PARADA)
    .map(({ l, dias }) => {
      const u = u30.get(l.id);
      return {
        ...contato(l), diasSemPedido: dias!, ultimoPedido: atv.get(l.id)!.ultimo!.toISOString(),
        pedidos30d: Number(u?.pedidos || 0), porSemana30d: ((u?.valor || 0) / 30) * 7,
        parada: dias! >= DIAS_PARA_PARADA,
      };
    })
    .sort((a, b) => b.porSemana30d - a.porSemana30d);

  const testeAcabando = lojas
    // Só quem já vendeu: quem nunca vendeu está nas listas de cardápio abaixo.
    .filter((l) => l.trialEndsAt && l.trialEndsAt > agora && l.trialEndsAt.getTime() - agora.getTime() <= DIAS_DO_FIM_DO_TESTE * DIA
      && !lojaIsenta(l) && !!atv.get(l.id)?.ultimo)
    .map((l) => ({
      ...contato(l), diasRestantes: Math.ceil((l.trialEndsAt!.getTime() - agora.getTime()) / DIA),
      vendidoNoMes: somas.get(l.id)?.mes || 0, diasSemPedido: diasSem(l.id), produtos: qtdProdutos.get(l.id) || 0,
    }))
    .sort((a, b) => a.diasRestantes - b.diasRestantes || b.vendidoNoMes - a.vendidoNoMes);

  const nuncaVenderam = lojas.filter((l) => !atv.get(l.id)?.ultimo && !lojaIsenta(l));
  const semCardapio = nuncaVenderam
    .filter((l) => !qtdProdutos.get(l.id))
    .map(contato)
    .sort((a, b) => a.cadastroHaDias - b.cadastroHaDias);

  const cardapioSemVenda = nuncaVenderam
    .filter((l) => (qtdProdutos.get(l.id) || 0) > 0)
    .map((l) => {
      const outras = outrasIntegracoes.get(l.id);
      const robo = (l.chatbotConfig as any) || {};
      const ligadas: string[] = [];
      if (l.ifoodConnected) ligadas.push("iFood");
      if (l.food99Connected) ligadas.push("99Food");
      if (outras?.brendi) ligadas.push("Brendi");
      if (l.jotajaConnected) ligadas.push("Jotajá");
      if (outras?.wabiz) ligadas.push("Wabiz");
      if (robo.connected === true || (robo.instanceName && robo.active !== false)) ligadas.push("Robô WhatsApp");
      const faltam = ["iFood", "99Food", "Robô WhatsApp"].filter((x) => !ligadas.includes(x));
      return { ...contato(l), produtos: qtdProdutos.get(l.id) || 0, ligadas, faltam };
    })
    .sort((a, b) => a.cadastroHaDias - b.cadastroHaDias);

  return {
    mes, mesAnterior, mesSeguinte, geradoEm: agora.toISOString(),
    totais, linhas, mesSeguinteNoRitmo, crescimento, vendasDoMes, dias, mesPassado,
    contatos: { pararam, testeAcabando, semCardapio, cardapioSemVenda },
    regras: { diasParaLigar: DIAS_PARA_LIGAR, diasParaParada: DIAS_PARA_PARADA, diasDoFimDoTeste: DIAS_DO_FIM_DO_TESTE },
  };
}

export type ProjecaoDoMes = Awaited<ReturnType<typeof montarProjecao>>;

/** Meia-noite de um "AAAA-MM-DD" em Brasília, como instante. */
function intervaloDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00-03:00`);
}
