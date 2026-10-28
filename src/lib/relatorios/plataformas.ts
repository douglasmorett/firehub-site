/**
 * Plataformas e repasses — cada canal de venda (iFood, 99Food, Keeta, site
 * próprio, app da loja…) com o que vendeu em cada forma de pagamento, quem
 * recebeu o dinheiro e quanto o app tem que repassar à loja.
 *
 * Pedido do Douglas (27/10/2026): "hoje ou na semana, iFood, 99, Keeta, site
 * próprio, aplicativo próprio — quanto foi de débito, crédito, Pix, e quanto
 * eu tenho que receber de repasse, pela comissão que eu cadastrei".
 *
 * Nada aqui é régua nova; é o encontro de réguas que já existem:
 *   • a forma de cada parte do pagamento é a do caixa (formas-de-pagamento.ts,
 *     pagamentosDoPedido). No pago online, o texto gravado ainda diz o tipo
 *     ("Crédito (Pago Online)", lib/payment-parser.ts), e é por ele que o
 *     online também se abre em crédito, débito e Pix;
 *   • o cupom que o app bancou é o do caixa (cupomDaPlataforma) e o que a loja
 *     bancou é o do relatório Descontos (descontoDoPedido);
 *   • a comissão é a que a loja cadastrou em Financeiro → Configurações, sobre
 *     os itens — a mesma linha do DRE (financeiro/dre.ts);
 *   • a taxa de entrega da corrida feita pelo app e a taxa de serviço do app
 *     ficam com o app (as linhas freteDoApp e taxaDoApp do DRE).
 *
 * O REPASSE do marketplace é uma ESTIMATIVA, e a tela diz isso:
 *     o que o app recebeu do cliente (pago no app + o que o entregador DO APP
 *     cobrou na porta) + cupom que o app bancou − comissão − taxa de entrega
 *     da corrida do app − taxa de serviço do app.
 * Pedido pago na porta ao motoboy da loja: o dinheiro já está com a loja, e a
 * comissão dele sai do repasse — por isso o repasse pode dar menos que o
 * "pago no app" (e até negativo numa semana só de dinheiro).
 *
 * Canais próprios (site, app da loja, robô): não há repasse de app. O pago
 * online cai na conta da loja pelo gateway, menos o 1% do FireHub
 * (`taxaOnline`, só quando o split saiu).
 *
 * Mesa, balcão e totem ficam fora: não são plataforma (estão no Formas de
 * pagamento e no fechamento de caixa).
 *
 * Puro: a rota busca (api/store/relatorios/plataformas).
 */
import { canaisConhecidos, type ChaveDeCanal } from "@/lib/canal-do-pedido";
import { canalDoRelatorio, diasNoPeriodo, naLoja, somarDias } from "@/lib/relatorios/base";
import { atendimentosDaVenda, cent, reais, situacaoDoPedido, temValorImpossivel, totalDosItens } from "@/lib/relatorios/regua-da-venda";
import { cupomDaPlataforma, formaDoTexto, pagamentosDoPedido, type ChaveDaForma, type PedidoParaFormas } from "@/lib/relatorios/formas-de-pagamento";
import { descontoDoPedido, outrasTaxasDoPedido } from "@/lib/relatorios/vendas";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import type { ComissoesDosApps } from "@/lib/financeiro/dre";

// ── AS FORMAS DA TELA ───────────────────────────────────────────────────────

export type FormaDaPlataforma = "CREDITO" | "DEBITO" | "PIX" | "DINHEIRO" | "VALE" | "OUTROS";
export const FORMAS_DA_PLATAFORMA: { chave: FormaDaPlataforma; rotulo: string }[] = [
  { chave: "CREDITO", rotulo: "Crédito" },
  { chave: "DEBITO", rotulo: "Débito" },
  { chave: "PIX", rotulo: "Pix" },
  { chave: "DINHEIRO", rotulo: "Dinheiro" },
  { chave: "VALE", rotulo: "Vale-refeição" },
  { chave: "OUTROS", rotulo: "Outros / sem tipo" },
];

const DA_FORMA_DO_CAIXA: Partial<Record<ChaveDaForma, FormaDaPlataforma>> = {
  CREDITO: "CREDITO", DEBITO: "DEBITO", PIX: "PIX", DINHEIRO: "DINHEIRO", VALE: "VALE",
};

/**
 * O tipo do pago online. O caixa junta todo online numa linha ("vem pelo
 * repasse"); aqui o texto gravado diz o tipo. O site pelo Pagar.me antigo
 * guarda o tipo em `pagarmeMethod`. Sem nenhum dos dois: "sem tipo".
 */
export function formaDoOnline(texto: string, pagarmeMethod?: string | null): FormaDaPlataforma {
  const pelaEscrita = DA_FORMA_DO_CAIXA[formaDoTexto(texto)];
  if (pelaEscrita) return pelaEscrita;
  const pm = String(pagarmeMethod || "").toLowerCase();
  if (pm.includes("pix")) return "PIX";
  if (pm.includes("debit")) return "DEBITO";
  if (pm.includes("credit")) return "CREDITO";
  return "OUTROS";
}

// ── OS CANAIS DA TELA ───────────────────────────────────────────────────────

/** "APP" = o aplicativo da própria loja (pedido do site feito dentro do app). */
export type CanalDaPlataforma = ChaveDeCanal | "APP";

const CANAIS = new Map(canaisConhecidos().map((c) => [c.chave as string, c]));
/** Venda de salão: não é plataforma. */
const DO_SALAO = new Set(["MESA", "PDV", "TOTEM"]);

export function nomeDaPlataforma(c: string): string {
  if (c === "APP") return "App da loja";
  if (c === "SITE") return "Site próprio";
  if (c === "WHATSAPP_IA") return "Robô do WhatsApp";
  return CANAIS.get(c)?.nome || c;
}
export const ehMarketplace = (c: string) => Boolean(CANAIS.get(c)?.ehMarketplace);

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

/** As colunas que a rota busca além das dos filtros (lib/relatorios/servidor.ts). */
export const COLUNAS_DO_PEDIDO = {
  paymentMethod: true, paymentMethods: true, paymentPaidAt: true, gatewayProvider: true, pagarmeMethod: true,
  deliveryFee: true, discountTotal: true, discountIfood: true, discountMerchant: true, parentOrderId: true,
  openDeliveryReference: true, deliveryBy: true, ifoodDriverName: true, ifoodDriverStatus: true, taxaOnline: true,
  items: { select: { quantity: true, price: true } },
} as const;

export type PedidoDaPlataforma = PedidoParaFormas & {
  franchiseeId: string;
  deliveryFee?: number | null;
  pagarmeMethod?: string | null;
  taxaOnline?: unknown;
  [k: string]: unknown;
};

/** O 1% do FireHub só conta quando o split saiu (a régua de financeiro/periodo-do-financeiro.ts). */
const SPLIT_COBRADO = new Set(["ENVIADO", "PENDING", "AWAITING_CREDIT", "PROCESSING", "DONE"]);
function taxaOnlineCobrada(p: PedidoDaPlataforma): number {
  const t = p.taxaOnline as { split?: unknown; valor?: unknown } | null | undefined;
  if (!p.paymentPaidAt || !t || !SPLIT_COBRADO.has(String(t.split || "").toUpperCase())) return 0;
  return Number(t.valor) || 0;
}

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type CelulaDaForma = {
  forma: FormaDaPlataforma;
  rotulo: string;
  /** Pago no app/site, antes de chegar à loja. */
  online: number;
  /** Pago na porta (ao motoboy da loja ou ao do app). */
  naEntrega: number;
  total: number;
  pagamentos: number;
};

export type LinhaDaPlataforma = {
  canal: CanalDaPlataforma;
  nome: string;
  marketplace: boolean;
  /** Vendas da régua única (o acréscimo não conta de novo). */
  vendas: number;
  valor: number;
  ticketMedio: number;
  /** Do valor de todas as plataformas, 0–100. */
  pct: number;
  formas: CelulaDaForma[];
  /** Pago no app/site. */
  online: number;
  /** Pago na entrega. */
  naEntrega: number;
  /** Quem ficou com o dinheiro do cliente. */
  recebidoPeloApp: number;
  recebidoPelaLoja: number;
  // Descontos
  cupomDoApp: number;
  cupomDaLoja: number;
  // O que o app desconta
  /** Valor dos itens — a base da comissão (o DRE usa a mesma). */
  baseDaComissao: number;
  /** % cadastrado; null = não cadastrado (só marketplace). */
  comissaoPct: number | null;
  comissao: number;
  freteDoApp: number;
  corridasDoApp: number;
  taxaDoApp: number;
  /** Canal próprio: o 1% do pagamento online. */
  taxaOnline: number;
  /**
   * Marketplace: o que o app tem de depositar (null sem a comissão cadastrada).
   * Canal próprio: o pago online que cai na conta, menos a taxa online.
   */
  repasse: number | null;
  porDia: number[];
};

export type SemanaDoRepasse = {
  /** Segunda e domingo, "YYYY-MM-DD" (cortados ao período). */
  de: string;
  ate: string;
  /** canal → repasse estimado (null sem comissão). Só marketplaces. */
  porCanal: { canal: CanalDaPlataforma; nome: string; vendas: number; valor: number; repasse: number | null }[];
  total: number;
};

export type ResultadoDasPlataformas = {
  dias: string[];
  canais: LinhaDaPlataforma[];
  total: {
    vendas: number; valor: number; ticketMedio: number;
    online: number; naEntrega: number;
    /** Σ dos repasses dos marketplaces com comissão cadastrada. */
    repasseDosApps: number;
    /** Σ do que cai na conta pelos canais próprios. */
    onlineDosProprios: number;
    comissao: number; cupomDoApp: number; cupomDaLoja: number; freteDoApp: number; taxaDoApp: number;
    formas: CelulaDaForma[];
  };
  semanas: SemanaDoRepasse[];
  /** Marketplaces com venda e sem comissão cadastrada. */
  semComissao: string[];
  /** Venda de salão do recorte (fora desta tela). */
  doSalao: { vendas: number; valor: number };
};

// ── A CONTA ─────────────────────────────────────────────────────────────────

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : 0);

/** A segunda-feira da semana do dia. */
function segundaDe(dia: string): string {
  const dow = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(dia, -((dow + 6) % 7));
}

type Acc = {
  vendas: number; c: number;
  formas: Map<FormaDaPlataforma, { online: number; naEntrega: number; pagamentos: number }>;
  online: number; naEntrega: number; peloApp: number; pelaLoja: number;
  cupomApp: number; cupomLoja: number; base: number; frete: number; corridas: number; taxaApp: number; taxaOnline: number;
  porDia: number[];
};

const novo = (n: number): Acc => ({
  vendas: 0, c: 0, formas: new Map(), online: 0, naEntrega: 0, peloApp: 0, pelaLoja: 0,
  cupomApp: 0, cupomLoja: 0, base: 0, frete: 0, corridas: 0, taxaApp: 0, taxaOnline: 0, porDia: new Array(n).fill(0),
});

function celulas(acc: Acc): CelulaDaForma[] {
  return FORMAS_DA_PLATAFORMA.map((f) => {
    const x = acc.formas.get(f.chave) || { online: 0, naEntrega: 0, pagamentos: 0 };
    return { forma: f.chave, rotulo: f.rotulo, online: reais(x.online), naEntrega: reais(x.naEntrega), total: reais(x.online + x.naEntrega), pagamentos: x.pagamentos };
  });
}

/** O repasse em centavos (null = marketplace sem comissão cadastrada). */
function repasseEmCentavos(canal: string, acc: Acc, comissoes: ComissoesDosApps): number | null {
  if (!ehMarketplace(canal)) return acc.online - acc.taxaOnline;
  const p = comissoes[canal as ChaveDeCanal];
  if (typeof p !== "number") return null;
  return acc.peloApp + acc.cupomApp - Math.round((acc.base * p) / 100) - acc.frete - acc.taxaApp;
}

export function plataformasERepasses(
  pedidos: PedidoDaPlataforma[],
  opcoes: { de: string; ate: string; tz: string | null | undefined; comissoes: ComissoesDosApps; idsDoApp: Set<string> },
): ResultadoDasPlataformas {
  const n = Math.max(1, diasNoPeriodo(opcoes.de, opcoes.ate));
  const dias = Array.from({ length: n }, (_, i) => somarDias(opcoes.de, i));
  const indiceDoDia = new Map(dias.map((d, i) => [d, i]));
  const at = atendimentosDaVenda(pedidos);

  const porCanal = new Map<string, Acc>();
  const porSemana = new Map<string, Map<string, Acc>>();
  const salao = { vendas: 0, c: 0 };

  for (const p of pedidos) {
    if (situacaoDoPedido(p.status) !== "venda" || temValorImpossivel(p)) continue;
    const base = canalDoRelatorio(p as any);
    if (p.tableSessionId || DO_SALAO.has(base)) {
      salao.c += cent(p.totalAmount);
      if (at.abre.has(p.id)) salao.vendas++;
      continue;
    }
    const canal = opcoes.idsDoApp.has(p.id) ? "APP" : base;
    const marketplace = ehMarketplace(canal);
    const dia = naLoja(p.createdAt, opcoes.tz).dia;
    const semana = segundaDe(dia);
    if (!porSemana.has(semana)) porSemana.set(semana, new Map());
    const daSemana = porSemana.get(semana)!;
    if (!porCanal.has(canal)) porCanal.set(canal, novo(n));
    if (!daSemana.has(canal)) daSemana.set(canal, novo(n));

    const total = cent(p.totalAmount);
    const entregaDoApp = marketplace && String(p.deliveryType || "").toUpperCase() !== "PICKUP" && infoDaEntrega(p).parceira;
    const frete = entregaDoApp ? Math.max(0, cent(p.deliveryFee)) : 0;
    const itens = cent(totalDosItens(p as any));
    const desc = descontoDoPedido(p as any);
    const cupomApp = marketplace ? cent(cupomDaPlataforma(p)) : 0;
    const taxaApp = marketplace ? Math.max(0, cent(outrasTaxasDoPedido(p as any))) : 0;
    const partes = pagamentosDoPedido(p);
    const pagoNoSite = !marketplace && partes.some((x) => x.forma === "ONLINE");
    const taxaOnline = pagoNoSite ? cent(taxaOnlineCobrada(p)) : 0;
    const i = indiceDoDia.get(dia);

    for (const acc of [porCanal.get(canal)!, daSemana.get(canal)!]) {
      if (at.abre.has(p.id)) acc.vendas++;
      acc.c += total;
      if (i !== undefined) acc.porDia[i] += total;
      // A comissão é sobre os itens; pedido antigo sem itens, sobre o total sem a entrega (o DRE).
      acc.base += itens > 0 ? itens : Math.max(0, total - cent(p.deliveryFee));
      acc.cupomApp += cupomApp;
      acc.cupomLoja += cent(desc.loja);
      acc.frete += frete;
      if (entregaDoApp) acc.corridas++;
      acc.taxaApp += taxaApp;
      acc.taxaOnline += taxaOnline;
      for (const parte of partes) {
        const online = parte.forma === "ONLINE";
        const forma = online ? formaDoOnline(parte.texto, p.pagarmeMethod) : DA_FORMA_DO_CAIXA[parte.forma] || "OUTROS";
        const f = acc.formas.get(forma) || { online: 0, naEntrega: 0, pagamentos: 0 };
        if (online) { f.online += parte.centavos; acc.online += parte.centavos; }
        else { f.naEntrega += parte.centavos; acc.naEntrega += parte.centavos; }
        f.pagamentos++;
        acc.formas.set(forma, f);
        // Quem ficou com o dinheiro: no marketplace, o pago no app e o que o
        // entregador DO APP cobrou na porta estão com o app; no resto, com a loja.
        if (marketplace && (online || entregaDoApp)) acc.peloApp += parte.centavos;
        else acc.pelaLoja += parte.centavos;
      }
    }
  }

  const cTotal = [...porCanal.values()].reduce((s, a) => s + a.c, 0);
  const canais: LinhaDaPlataforma[] = [...porCanal.entries()].map(([canal, a]) => {
    const marketplace = ehMarketplace(canal);
    const p = opcoes.comissoes[canal as ChaveDeCanal];
    const comissaoPct = marketplace ? (typeof p === "number" ? p : null) : null;
    const rep = repasseEmCentavos(canal, a, opcoes.comissoes);
    return {
      canal: canal as CanalDaPlataforma, nome: nomeDaPlataforma(canal), marketplace,
      vendas: a.vendas, valor: reais(a.c), ticketMedio: a.vendas ? reais(a.c / a.vendas) : 0, pct: pct(a.c, cTotal),
      formas: celulas(a),
      online: reais(a.online), naEntrega: reais(a.naEntrega), recebidoPeloApp: reais(a.peloApp), recebidoPelaLoja: reais(a.pelaLoja),
      cupomDoApp: reais(a.cupomApp), cupomDaLoja: reais(a.cupomLoja),
      baseDaComissao: reais(a.base), comissaoPct, comissao: comissaoPct != null ? reais(Math.round((a.base * comissaoPct) / 100)) : 0,
      freteDoApp: reais(a.frete), corridasDoApp: a.corridas, taxaDoApp: reais(a.taxaApp), taxaOnline: reais(a.taxaOnline),
      repasse: rep == null ? null : reais(rep),
      porDia: a.porDia.map(reais),
    };
  }).sort((x, y) => Number(y.marketplace) - Number(x.marketplace) || y.valor - x.valor);

  // O total das formas, somando as células de todos os canais.
  const todas = novo(n);
  for (const a of porCanal.values()) {
    for (const [k, f] of a.formas) {
      const t = todas.formas.get(k) || { online: 0, naEntrega: 0, pagamentos: 0 };
      t.online += f.online; t.naEntrega += f.naEntrega; t.pagamentos += f.pagamentos;
      todas.formas.set(k, t);
    }
  }
  const soma = (k: keyof LinhaDaPlataforma, so?: (l: LinhaDaPlataforma) => boolean) =>
    reais(canais.filter((l) => !so || so(l)).reduce((s, l) => s + cent(l[k] as number), 0));
  const vendas = canais.reduce((s, l) => s + l.vendas, 0);

  const semanas: SemanaDoRepasse[] = [...porSemana.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([seg, mapa]) => {
    const linhas = [...mapa.entries()].filter(([c]) => ehMarketplace(c)).map(([c, a]) => {
      const rep = repasseEmCentavos(c, a, opcoes.comissoes);
      return { canal: c as CanalDaPlataforma, nome: nomeDaPlataforma(c), vendas: a.vendas, valor: reais(a.c), repasse: rep == null ? null : reais(rep) };
    }).sort((x, y) => y.valor - x.valor);
    const dom = somarDias(seg, 6);
    return {
      de: seg < opcoes.de ? opcoes.de : seg, ate: dom > opcoes.ate ? opcoes.ate : dom,
      porCanal: linhas, total: reais(linhas.reduce((s, l) => s + cent(l.repasse ?? 0), 0)),
    };
  }).filter((s) => s.porCanal.length > 0);

  return {
    dias,
    canais,
    total: {
      vendas, valor: reais(cTotal), ticketMedio: vendas ? reais(cTotal / vendas) : 0,
      online: soma("online"), naEntrega: soma("naEntrega"),
      repasseDosApps: soma("repasse", (l) => l.marketplace && l.repasse != null),
      onlineDosProprios: soma("repasse", (l) => !l.marketplace),
      comissao: soma("comissao"), cupomDoApp: soma("cupomDoApp"), cupomDaLoja: soma("cupomDaLoja"),
      freteDoApp: soma("freteDoApp"), taxaDoApp: soma("taxaDoApp"),
      formas: celulas(todas),
    },
    semanas,
    semComissao: canais.filter((l) => l.marketplace && l.comissaoPct == null).map((l) => l.nome),
    doSalao: { vendas: salao.vendas, valor: reais(salao.c) },
  };
}
