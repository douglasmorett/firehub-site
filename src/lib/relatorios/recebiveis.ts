/**
 * OS RECEBÍVEIS — quando o dinheiro de cada venda cai na conta, e quanto cai.
 * A base do Fluxo de caixa e do Contas a receber (/store/relatorios/…).
 *
 * Pedido do Douglas (07/11/2026), para o Alex (Hambúrgueria Avenida), que veio
 * do SWFast: o SWF tem "Receitas" (contas a receber com taxa % e líquido) e o
 * Fluxo de caixa com "a receber previsto". O FireHub tinha o a PAGAR (contas,
 * recorrentes, despesas lançadas) e nenhum a receber. Aqui ele nasce DA VENDA,
 * sem o lojista digitar nada:
 *
 *   • na loja (gaveta, maquininha, Pix da loja): cada parte do pagamento na
 *     forma do fechamento de caixa (formas-de-pagamento.ts — pagamentosDoPedido
 *     e, na mesa, baixasDaConta, já sem o troco), menos a taxa que a loja
 *     cadastrou em Minha loja → Formas de pagamento (financeiro/dre.ts,
 *     taxaDaForma — a mesma taxa do DRE), no prazo da forma;
 *   • no app (iFood, 99, Keeta…): o REPASSE estimado de plataformas.ts (o que o
 *     app recebeu + cupom do app − comissão cadastrada − entrega e taxa de
 *     serviço do app), no prazo do app. O que o motoboy DA LOJA cobrou na porta
 *     já está com a loja: entra na forma dele, não no repasse;
 *   • no site/app da loja pago online: no prazo "Site", sem taxa (a taxa do
 *     gateway não está cadastrada em lugar nenhum — a tela diz).
 *
 * Fiado, forma própria da loja e forma não identificada NÃO são recebíveis:
 * ficam contados à parte (`fora`), para o lojista saber que existem.
 *
 * ── Os prazos ───────────────────────────────────────────────────────────────
 *
 * Nenhuma tela cadastrava em quantos dias cada forma cai. Aqui mora a
 * configuração, em `User.financialGoals.prazosDeRecebimento` (o Json da
 * configuração financeira que já existe, o da comissão dos apps — nunca em
 * `paymentFees`, que vai para o cardápio público). Sem nada cadastrado vale o
 * PADRÃO (crédito D+30, débito D+1, Pix e dinheiro D+0, app D+7), e a tela diz
 * "previsto pelo prazo padrão — ajuste em Prazos de recebimento".
 *
 * Cartão, vale, app e site caem em DIA ÚTIL: o que vence no sábado ou no
 * domingo cai na segunda (feriado não entra). Dinheiro e Pix caem no dia.
 *
 * Puro: recebe pedidos e mesas já buscados (lib/relatorios/recebiveis-servidor.ts busca).
 */
import { canaisConhecidos, type ChaveDeCanal } from "@/lib/canal-do-pedido";
import { canalDoRelatorio, naLoja, somarDias } from "@/lib/relatorios/base";
import { cent, ehReposicao, reais, situacaoDoPedido, temValorImpossivel } from "@/lib/relatorios/regua-da-venda";
import { baixasDaConta, pagamentosDoPedido, type ChaveDaForma, type MesaParaFormas } from "@/lib/relatorios/formas-de-pagamento";
import { ehMarketplace, nomeDaPlataforma, plataformasERepasses, type PedidoDaPlataforma } from "@/lib/relatorios/plataformas";
import { taxaDaForma, type ComissoesDosApps, type FormaComTaxa } from "@/lib/financeiro/dre";
import { infoDaEntrega } from "@/lib/entrega-parceira";

// ── OS PRAZOS ───────────────────────────────────────────────────────────────

/** As formas da loja que viram recebível, mais o pago online no site/app próprio. */
export type FormaDoRecebivel = "DINHEIRO" | "PIX" | "DEBITO" | "CREDITO" | "VALE" | "SITE";

export const FORMAS_DO_RECEBIVEL: { chave: FormaDoRecebivel; rotulo: string; padrao: number; diaUtil: boolean }[] = [
  { chave: "DINHEIRO", rotulo: "Dinheiro", padrao: 0, diaUtil: false },
  { chave: "PIX", rotulo: "Pix", padrao: 0, diaUtil: false },
  { chave: "DEBITO", rotulo: "Débito (maquininha)", padrao: 1, diaUtil: true },
  { chave: "CREDITO", rotulo: "Crédito (maquininha)", padrao: 30, diaUtil: true },
  { chave: "VALE", rotulo: "Vale-refeição", padrao: 30, diaUtil: true },
  { chave: "SITE", rotulo: "Pago online no site/app da loja", padrao: 1, diaUtil: true },
];

/** O app costuma pagar por semana: D+7 é o meio do caminho até o contrato da loja dizer outro. */
export const PRAZO_PADRAO_DO_APP = 7;
/** Mais que isso é digitação errada (um "300" no lugar de "30"). */
export const PRAZO_MAXIMO = 120;

/** Os marketplaces, os mesmos da comissão (financeiro/dre.ts, CANAIS_COM_COMISSAO). */
export const APPS_DO_RECEBIVEL: { chave: ChaveDeCanal; rotulo: string }[] = canaisConhecidos()
  .filter((c) => c.ehMarketplace)
  .map((c) => ({ chave: c.chave, rotulo: c.nome }));

export type PrazosDeRecebimento = {
  /** chave (forma ou canal do app) → dias corridos até cair. */
  dias: Record<string, number>;
  /** As chaves que a loja cadastrou; o resto está no padrão. */
  cadastradas: string[];
};

const PADRAO = new Map<string, number>([
  ...FORMAS_DO_RECEBIVEL.map((f) => [f.chave as string, f.padrao] as [string, number]),
  ...APPS_DO_RECEBIVEL.map((a) => [a.chave as string, PRAZO_PADRAO_DO_APP] as [string, number]),
]);

/** As chaves que o prazo aceita — para a rota recusar o resto. */
export const CHAVES_DO_PRAZO = [...PADRAO.keys()];

/** Lê `financialGoals.prazosDeRecebimento`; o que vier torto cai no padrão. */
export function lerPrazosDeRecebimento(financialGoals: unknown): PrazosDeRecebimento {
  const bruto = financialGoals && typeof financialGoals === "object" ? (financialGoals as any).prazosDeRecebimento : null;
  const dias: Record<string, number> = {};
  const cadastradas: string[] = [];
  for (const [chave, padrao] of PADRAO) {
    const v = bruto && typeof bruto === "object" ? (bruto as any)[chave] : undefined;
    const n = Number(v);
    if (v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n >= 0 && n <= PRAZO_MAXIMO) {
      dias[chave] = n;
      cadastradas.push(chave);
    } else {
      dias[chave] = padrao;
    }
  }
  return { dias, cadastradas };
}

const DIA_UTIL = new Set<string>([
  ...FORMAS_DO_RECEBIVEL.filter((f) => f.diaUtil).map((f) => f.chave as string),
  ...APPS_DO_RECEBIVEL.map((a) => a.chave as string),
]);

/** O dia em que cai: venda + prazo, e no dia útil seguinte quando a forma só cai em dia útil. */
export function diaQueCai(diaDaVenda: string, prazo: number, chave: string): string {
  let dia = somarDias(diaDaVenda, prazo);
  if (DIA_UTIL.has(chave)) {
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    if (dow === 6) dia = somarDias(dia, 2);
    else if (dow === 0) dia = somarDias(dia, 1);
  }
  return dia;
}

// ── O RECEBÍVEL ─────────────────────────────────────────────────────────────

export type Recebivel = {
  /** O dia operacional da venda (a mesa: o dia em que fechou). */
  diaDaVenda: string;
  /** O dia em que deve cair na conta. */
  dia: string;
  /** Forma (DINHEIRO…SITE) ou canal do app (IFOOD…). */
  chave: string;
  rotulo: string;
  tipo: "LOJA" | "APP";
  /** Partes de pagamento (loja) ou vendas (app). */
  quantidade: number;
  bruto: number;
  /** % da taxa (loja) ou da comissão (app); null = não cadastrada. */
  taxaPct: number | null;
  taxa: number;
  liquido: number;
  prazo: number;
  /** O prazo é o padrão (a loja não cadastrou). */
  prazoPadrao: boolean;
};

export type ResultadoDosRecebiveis = {
  recebiveis: Recebivel[];
  /** O que não vira dinheiro na conta: fiado, forma própria, não identificado. */
  fora: { chave: "FIADO" | "PROPRIA" | "OUTROS"; rotulo: string; quantidade: number; valor: number }[];
  /** Apps com venda e sem comissão cadastrada: o repasse entrou sem descontar a comissão. */
  semComissao: string[];
  /** Formas com venda e sem taxa cadastrada: entraram sem descontar taxa. */
  semTaxa: string[];
};

const ROTULO_DA_FORMA = new Map(FORMAS_DO_RECEBIVEL.map((f) => [f.chave as string, f.rotulo]));
const DA_FORMA_DO_CAIXA: Partial<Record<ChaveDaForma, FormaDoRecebivel>> = {
  DINHEIRO: "DINHEIRO", PIX: "PIX", DEBITO: "DEBITO", CREDITO: "CREDITO", VALE: "VALE", ONLINE: "SITE",
};
const ROTULO_DO_FORA = { FIADO: "Fiado / conta funcionário", PROPRIA: "Formas próprias da loja", OUTROS: "Forma não identificada" } as const;

/**
 * Os recebíveis das vendas, agrupados por (dia da venda, dia que cai, forma).
 * `pedidos` precisam das colunas de plataformas.ts (COLUNAS_DO_PEDIDO) e do
 * detalhe do cupom quando houver; `mesas` são as contas FECHADAS, com as baixas.
 */
export function recebiveisDasVendas(
  pedidos: PedidoDaPlataforma[],
  mesas: MesaParaFormas[],
  opcoes: { tz: string | null | undefined; prazos: PrazosDeRecebimento; paymentFees: unknown; comissoes: ComissoesDosApps },
): ResultadoDosRecebiveis {
  const { tz, prazos } = opcoes;
  /** (diaDaVenda|chave) → centavos e quantidade, das partes recebidas na loja. */
  const naLojaAcc = new Map<string, { diaDaVenda: string; chave: FormaDoRecebivel; c: number; q: number }>();
  const fora = { FIADO: { q: 0, c: 0 }, PROPRIA: { q: 0, c: 0 }, OUTROS: { q: 0, c: 0 } };
  const doAppPorDia = new Map<string, PedidoDaPlataforma[]>();

  const daLoja = (diaDaVenda: string, forma: ChaveDaForma, centavos: number) => {
    if (centavos <= 0) return;
    const chave = DA_FORMA_DO_CAIXA[forma];
    if (!chave) {
      const f = fora[forma as keyof typeof fora] || fora.OUTROS;
      f.q++; f.c += centavos;
      return;
    }
    const k = `${diaDaVenda}|${chave}`;
    const a = naLojaAcc.get(k) || { diaDaVenda, chave, c: 0, q: 0 };
    a.c += centavos; a.q++;
    naLojaAcc.set(k, a);
  };

  for (const p of pedidos) {
    // A régua de venda do Formas de pagamento: reposição, valor impossível,
    // cancelado e intenção não geram dinheiro; o pedido de mesa paga na conta.
    if (ehReposicao(p) || temValorImpossivel(p) || situacaoDoPedido(p.status) !== "venda") continue;
    if (p.tableSessionId) continue;
    const dia = naLoja(p.createdAt, tz).dia;
    const canal = canalDoRelatorio(p as any);
    const marketplace = ehMarketplace(canal);
    if (marketplace) {
      const lista = doAppPorDia.get(dia) || [];
      lista.push(p);
      doAppPorDia.set(dia, lista);
    }
    // No app, o pago no app e o cobrado pelo entregador DO APP vão no repasse
    // (a mesma divisão do plataformas.ts); o resto está com a loja.
    const entregaDoApp = marketplace && String(p.deliveryType || "").toUpperCase() !== "PICKUP" && infoDaEntrega(p).parceira;
    for (const parte of pagamentosDoPedido(p)) {
      if (marketplace && (parte.forma === "ONLINE" || entregaDoApp)) continue;
      daLoja(dia, parte.forma, parte.centavos);
    }
  }

  // A conta de mesa: as baixas, já sem o troco, no dia em que fechou.
  for (const m of mesas) {
    const dia = naLoja(m.fechadaEm, tz).dia;
    let consumo = 0;
    for (const o of m.pedidos) if (situacaoDoPedido(o.status) === "venda" && !temValorImpossivel(o)) consumo += cent(o.totalAmount);
    const { baixas } = baixasDaConta({ pagamentos: m.pagamentos, totalPago: m.totalPago, servico: cent(m.taxaDeServico || 0), gorjeta: cent(m.gorjeta || 0), consumo });
    for (const b of baixas) daLoja(dia, b.forma, b.centavos);
  }

  const recebiveis: Recebivel[] = [];
  const semTaxa = new Set<string>();
  const taxas = new Map<FormaDoRecebivel, { pct: number; configurada: boolean }>();
  const taxaDe = (f: FormaDoRecebivel) => {
    if (f === "SITE") return { pct: 0, configurada: true };
    if (!taxas.has(f)) taxas.set(f, taxaDaForma(opcoes.paymentFees, f as FormaComTaxa));
    return taxas.get(f)!;
  };

  for (const a of naLojaAcc.values()) {
    const t = taxaDe(a.chave);
    if (!t.configurada) semTaxa.add(ROTULO_DA_FORMA.get(a.chave) || a.chave);
    const taxa = Math.round((a.c * t.pct) / 100);
    const prazo = prazos.dias[a.chave];
    recebiveis.push({
      diaDaVenda: a.diaDaVenda, dia: diaQueCai(a.diaDaVenda, prazo, a.chave), chave: a.chave, rotulo: ROTULO_DA_FORMA.get(a.chave) || a.chave,
      tipo: "LOJA", quantidade: a.q, bruto: reais(a.c), taxaPct: t.configurada ? t.pct : null, taxa: reais(taxa), liquido: reais(a.c - taxa),
      prazo, prazoPadrao: !prazos.cadastradas.includes(a.chave),
    });
  }

  // O repasse de cada app, dia de venda a dia de venda, pela conta de plataformas.ts.
  const semComissao = new Set<string>();
  for (const [dia, lista] of doAppPorDia) {
    const r = plataformasERepasses(lista, { de: dia, ate: dia, tz, comissoes: opcoes.comissoes, idsDoApp: new Set() });
    for (const l of r.canais) {
      if (!l.marketplace) continue;
      // O que o app deve antes da comissão: o que ele recebeu + o cupom dele −
      // a entrega e a taxa de serviço que ficam com ele.
      const brutoC = cent(l.recebidoPeloApp) + cent(l.cupomDoApp) - cent(l.freteDoApp) - cent(l.taxaDoApp);
      const liquidoC = l.repasse == null ? brutoC : cent(l.repasse);
      if (l.repasse == null) semComissao.add(l.nome);
      if (brutoC === 0 && liquidoC === 0) continue;
      const prazo = prazos.dias[l.canal] ?? PRAZO_PADRAO_DO_APP;
      recebiveis.push({
        diaDaVenda: dia, dia: diaQueCai(dia, prazo, l.canal), chave: l.canal, rotulo: nomeDaPlataforma(l.canal),
        tipo: "APP", quantidade: l.vendas, bruto: reais(brutoC), taxaPct: l.comissaoPct, taxa: reais(brutoC - liquidoC), liquido: reais(liquidoC),
        prazo, prazoPadrao: !prazos.cadastradas.includes(l.canal),
      });
    }
  }

  recebiveis.sort((x, y) => x.dia.localeCompare(y.dia) || x.diaDaVenda.localeCompare(y.diaDaVenda) || x.chave.localeCompare(y.chave));
  return {
    recebiveis,
    fora: (Object.keys(fora) as (keyof typeof fora)[])
      .filter((k) => fora[k].c > 0)
      .map((k) => ({ chave: k, rotulo: ROTULO_DO_FORA[k], quantidade: fora[k].q, valor: reais(fora[k].c) })),
    semComissao: [...semComissao],
    semTaxa: [...semTaxa],
  };
}

// ── O CONTAS A RECEBER ──────────────────────────────────────────────────────

export type LinhaDoAReceber = { chave: string; rotulo: string; tipo: "LOJA" | "APP"; quantidade: number; bruto: number; taxaPct: number | null; taxa: number; liquido: number; prazo: number; prazoPadrao: boolean };

export type ResultadoDoAReceber = {
  /** Um por dia do período, com zero no dia sem nada. */
  dias: { dia: string; diaSemana: number; bruto: number; taxa: number; liquido: number; jaCaiu: boolean; porChave: { chave: string; rotulo: string; liquido: number }[] }[];
  porForma: LinhaDoAReceber[];
  total: { bruto: number; taxa: number; liquido: number; jaCaiu: number; aCair: number };
  /** As linhas por (dia que cai, forma), para a planilha e para abrir o dia. */
  linhas: Recebivel[];
};

/**
 * Os recebíveis que caem entre `de` e `ate` (o mesmo recebível pode ser de
 * uma venda de antes do período). `jaCaiu` = o dia já passou (antes de hoje).
 */
export function contasAReceber(recebiveis: Recebivel[], periodo: { de: string; ate: string; hoje: string }): ResultadoDoAReceber {
  const doPeriodo = recebiveis.filter((r) => r.dia >= periodo.de && r.dia <= periodo.ate);
  const n = Math.max(1, Math.round((Date.parse(`${periodo.ate}T12:00:00Z`) - Date.parse(`${periodo.de}T12:00:00Z`)) / 86400000) + 1);
  const dias = Array.from({ length: n }, (_, i) => {
    const dia = somarDias(periodo.de, i);
    return { dia, diaSemana: new Date(`${dia}T12:00:00Z`).getUTCDay(), b: 0, t: 0, l: 0, porChave: new Map<string, { rotulo: string; c: number }>() };
  });
  const indice = new Map(dias.map((d, i) => [d.dia, i]));
  const porForma = new Map<string, { r: Recebivel; q: number; b: number; t: number; l: number }>();
  for (const r of doPeriodo) {
    const d = dias[indice.get(r.dia)!];
    d.b += cent(r.bruto); d.t += cent(r.taxa); d.l += cent(r.liquido);
    const k = d.porChave.get(r.chave) || { rotulo: r.rotulo, c: 0 };
    k.c += cent(r.liquido);
    d.porChave.set(r.chave, k);
    const f = porForma.get(r.chave) || { r, q: 0, b: 0, t: 0, l: 0 };
    f.q += r.quantidade; f.b += cent(r.bruto); f.t += cent(r.taxa); f.l += cent(r.liquido);
    porForma.set(r.chave, f);
  }
  const ordem = (x: LinhaDoAReceber) => (x.tipo === "LOJA" ? FORMAS_DO_RECEBIVEL.findIndex((f) => f.chave === x.chave) : 100);
  const linhasPorForma: LinhaDoAReceber[] = [...porForma.values()].map(({ r, q, b, t, l }) => ({
    chave: r.chave, rotulo: r.rotulo, tipo: r.tipo, quantidade: q, bruto: reais(b), taxaPct: r.taxaPct, taxa: reais(t), liquido: reais(l), prazo: r.prazo, prazoPadrao: r.prazoPadrao,
  })).sort((x, y) => ordem(x) - ordem(y) || y.liquido - x.liquido);
  const soma = (f: (d: (typeof dias)[number]) => number, so?: (d: (typeof dias)[number]) => boolean) => reais(dias.filter((d) => !so || so(d)).reduce((s, d) => s + f(d), 0));
  return {
    dias: dias.map((d) => ({
      dia: d.dia, diaSemana: d.diaSemana, bruto: reais(d.b), taxa: reais(d.t), liquido: reais(d.l), jaCaiu: d.dia < periodo.hoje,
      porChave: [...d.porChave.entries()].map(([chave, k]) => ({ chave, rotulo: k.rotulo, liquido: reais(k.c) })).sort((a, b) => b.liquido - a.liquido),
    })),
    porForma: linhasPorForma,
    total: {
      bruto: soma((d) => d.b), taxa: soma((d) => d.t), liquido: soma((d) => d.l),
      jaCaiu: soma((d) => d.l, (d) => d.dia < periodo.hoje), aCair: soma((d) => d.l, (d) => d.dia >= periodo.hoje),
    },
    linhas: doPeriodo,
  };
}
