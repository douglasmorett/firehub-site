/**
 * O DRE DO FINANCEIRO — a conta inteira, pura (sem banco), para a tela
 * (app/store/financeiro/DREClient.tsx) e para o teste (scripts/teste-dre.ts)
 * lerem igual. Os pedidos e os números que só o servidor sabe (o acerto dos
 * entregadores, as mesas fechadas, os ciclos da mensalidade) chegam prontos de
 * lib/financeiro/periodo-do-financeiro.ts.
 *
 * ── Por que foi reescrito (auditoria de 11/10/2026) ─────────────────────────
 *
 * O DRE somava do jeito dele e cada linha errava num sentido:
 *   • o período era o relógio do navegador ("7 dias" = últimas 168 h, "Hoje"
 *     desde a meia-noite) e só tirava "CANCELADO": Ragnar, "7 dias", DRE
 *     R$ 67.904,20 × Relatórios R$ 54.867,76;
 *   • "pedidos" e ticket contavam cada rodada de mesa (Ragnar, outubro: 2.075
 *     "pedidos" e ticket R$ 48,75 × 1.695 vendas e R$ 59,68 na régua);
 *   • o custo dos entregadores somava `motoboyFee`, que ninguém grava (Hakim,
 *     setembro: R$ 0 × R$ 14.367,52 do fechamento dos motoboys);
 *   • a taxa de pagamento lia o texto cru e só a taxa geral — quem cadastrou
 *     por bandeira pagava R$ 0 —, e cobrava 0,5% do Pix na chave;
 *   • o desconto dado ao fechar a mesa não saía da receita;
 *   • os custos fixos de "90 dias" contavam um mês só;
 *   • a mensalidade era uma conta própria, sem mês nem teste;
 *   • e, sem custo cadastrado nem comissão de app, o "lucro" saía com margem
 *     de 85–97%.
 *
 * ── As regras daqui ─────────────────────────────────────────────────────────
 *
 * 1. PERÍODO = o dos Relatórios: dia operacional da loja (vira às 5h, no fuso
 *    dela), os mesmos atalhos (lib/relatorios/base.ts) e mais "90 dias".
 * 2. VALOR VENDIDO = régua única (lib/relatorios/regua-da-venda.ts): Σ total
 *    dos pedidos que são venda (`entraNaVenda`). VENDAS = atendimentos (a mesa
 *    conta uma vez), ticket = valor ÷ vendas. É o mesmo número dos Relatórios.
 * 3. RECEITA DA LOJA = valor vendido − taxa de entrega das corridas feitas
 *    pelo app (fica com o app) − desconto dado no fechamento da mesa + cupom
 *    que o app bancou (o app repassa à loja).
 * 4. CUSTOS que andam com a venda (margem de contribuição): CMV pelo custo
 *    cadastrado, comissão dos apps pelo percentual que A LOJA cadastra, taxa
 *    de pagamento pela forma do caixa (`formaDoPedido`) e pela média das
 *    bandeiras ativas, entregadores pelo acerto de cada um mais as diárias.
 * 5. Depois: mensalidade FireHub (o ciclo de verdade, rateado por dia),
 *    despesas lançadas e custos fixos (rateados mês a mês, sem teto).
 * 6. Sem custo cadastrado, sem comissão do app ou sem taxa da maquininha, o
 *    número NÃO é apresentado como lucro: vira "resultado incompleto", com o
 *    que falta escrito. Nada é inventado para tapar o buraco.
 * 7. Margens: todas sobre a RECEITA DA LOJA — uma base só. Eram três bases
 *    (receita bruta, receita sem frete) e o "EBITDA" vinha antes do aluguel e
 *    do salário; agora o nome é "margem de contribuição" e o resultado vem
 *    depois de tudo. A base é a receita (e não o valor vendido) porque o
 *    cupom pago pelo app entra nela: sobre o valor vendido, a margem de uma
 *    loja com muito cupom do iFood passava de 100%.
 */
import { atendimentosDaVenda, cent, reais, situacaoDoPedido, ticketMedio } from "@/lib/relatorios/regua-da-venda";
import { ROTULO_DO_TIPO, TIPOS_DE_VENDA, diasNoPeriodo, periodoDoAtalho, somarDias, type AtalhoDePeriodo, type TipoDeVenda } from "@/lib/relatorios/base";
import { canaisConhecidos, type ChaveDeCanal } from "@/lib/canal-do-pedido";
import type { ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";

// ── PERÍODO ─────────────────────────────────────────────────────────────────

export type AtalhoDoFinanceiro = AtalhoDePeriodo | "90d";

/** Os atalhos dos Relatórios, na mesma ordem, mais "90 dias". */
export const ATALHOS_DO_FINANCEIRO: { chave: AtalhoDoFinanceiro; rotulo: string }[] = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "7d", rotulo: "7 dias" },
  { chave: "15d", rotulo: "15 dias" },
  { chave: "30d", rotulo: "30 dias" },
  { chave: "90d", rotulo: "90 dias" },
  { chave: "mes", rotulo: "Este mês" },
  { chave: "mesAnterior", rotulo: "Mês anterior" },
];

/** O período de um atalho a partir de "hoje" (o dia operacional da loja). */
export function periodoDoFinanceiro(atalho: AtalhoDoFinanceiro, hoje: string): { de: string; ate: string } {
  if (atalho === "90d") return { de: somarDias(hoje, -89), ate: hoje };
  return periodoDoAtalho(atalho, hoje);
}

/** O atalho que corresponde ao período, para acender o botão certo. */
export function atalhoDoFinanceiro(de: string, ate: string, hoje: string): AtalhoDoFinanceiro | null {
  for (const a of ATALHOS_DO_FINANCEIRO) {
    const p = periodoDoFinanceiro(a.chave, hoje);
    if (p.de === de && p.ate === ate) return a.chave;
  }
  return null;
}

/** Teto da janela, o mesmo dos Relatórios (lib/relatorios/servidor.ts). */
export const MAX_DIAS_DO_FINANCEIRO = 400;
export const ATALHO_PADRAO: AtalhoDoFinanceiro = "7d";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** O período pedido na URL; torto ou ausente vira o padrão, nunca erro. */
export function lerPeriodo(de: string | null | undefined, ate: string | null | undefined, hoje: string): { de: string; ate: string } {
  if (!de || !DIA_RE.test(de)) return periodoDoFinanceiro(ATALHO_PADRAO, hoje);
  let fim = ate && DIA_RE.test(ate) ? ate : de;
  let ini = de;
  if (ini > fim) [ini, fim] = [fim, ini];
  if (diasNoPeriodo(ini, fim) > MAX_DIAS_DO_FINANCEIRO) ini = somarDias(fim, -(MAX_DIAS_DO_FINANCEIRO - 1));
  return { de: ini, ate: fim };
}

/** "11/10" ou "11/10/2026". */
export function diaCurto(dia: string, comAno = false): string {
  return comAno ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Dias que o mês "AAAA-MM" tem. */
export function diasDoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/**
 * Os meses que o período toca e quantos dias dele caem em cada um. É a base
 * dos dois rateios mensais (custos fixos e mensalidade): "90 dias" de 14/07 a
 * 11/10 é 18/31 de julho + agosto + setembro inteiros + 11/31 de outubro —
 * não "um mês só", que era o teto antigo (Pastel da Paulista, R$ 10.120/mês
 * de custo fixo: o DRE descontava R$ 10.120 em 90 dias).
 */
export function mesesDoPeriodo(de: string, ate: string): { mes: string; dias: number; diasDoMes: number }[] {
  const saida: { mes: string; dias: number; diasDoMes: number }[] = [];
  let mes = de.slice(0, 7);
  const ultimo = ate.slice(0, 7);
  for (let guarda = 0; guarda < 40 && mes <= ultimo; guarda++) {
    const total = diasDoMes(mes);
    const primeiroDia = `${mes}-01` > de ? `${mes}-01` : de;
    const ultimoDia = `${mes}-${String(total).padStart(2, "0")}` < ate ? `${mes}-${String(total).padStart(2, "0")}` : ate;
    if (primeiroDia <= ultimoDia) saida.push({ mes, dias: diasNoPeriodo(primeiroDia, ultimoDia), diasDoMes: total });
    const [a, m] = mes.split("-").map(Number);
    mes = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  }
  return saida;
}

const NOMES_DOS_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-09" → "set/2026". */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${NOMES_DOS_MESES[m - 1] || mes}/${a}`;
}

// ── O QUE O SERVIDOR MANDA ──────────────────────────────────────────────────

/** Um pedaço do pagamento: em que forma do caixa caiu e quanto. */
export type ParteDoPagamento = { forma: ChaveDaForma; valor: number };

/**
 * Um pedido do período, já com o que só o servidor sabe calcular (itens com
 * custo, forma de pagamento pela régua do caixa, entrega parceira, cupom do
 * app). Cancelados vêm junto — contam em "cancelamentos" e no extrato; o
 * rascunho do robô e o totem que não pagou não vêm.
 */
export type PedidoDoFinanceiro = {
  id: string;
  /** O número que o lojista vê (#12, o do iFood, o do 99). */
  numero: string;
  criadoEm: string;
  status: string;
  totalAmount: number;
  deliveryFee: number;
  tipo: TipoDeVenda;
  canal: ChaveDeCanal;
  marketplace: boolean;
  /** Corrida feita pelo entregador do app (lib/entrega-parceira.ts): a taxa de entrega fica com o app. */
  entregaDoApp: boolean;
  temEntregador: boolean;
  tableSessionId: string | null;
  parentOrderId: string | null;
  /** Valor dos itens (preço × quantidade, a régua do Itens vendidos). */
  itens: number;
  /** Quanto desse valor é de item cujo produto tem custo cadastrado. */
  itensComCusto: number;
  /** Σ custo × quantidade. */
  custo: number;
  /** Total ou item ≥ R$ 1 milhão (regua-da-venda.ts, temValorImpossivel): fora de toda soma. */
  impossivel: boolean;
  /** As partes do pagamento pela régua do caixa (lib/resumo-do-entregador.ts, partesDaEntrega). */
  pagamentos: ParteDoPagamento[];
  /** Taxa do pagamento online pelo site (o 1% do FireHub, `CustomerOrder.taxaOnline`). */
  taxaOnline: number;
  /** Cupom que o app bancou (formas-de-pagamento.ts, cupomDaPlataforma): o app repassa à loja. */
  cupomDoApp: number;
  // O que o Extrato mostra: o texto do pagamento, se foi Pix ou cartão pelo
  // site e quando o pagamento online foi confirmado.
  paymentMethod: string;
  pagarmeMethod: string | null;
  paymentPaidAt: string | null;
};

/** O que a loja pagou aos entregadores no período — a conta do fechamento dos motoboys. */
export type ResumoDosEntregadores = {
  /** Soma do que cada corrida rende (lib/ganho-do-entregador.ts). */
  porEntrega: number;
  /** Diária × dias trabalhados de cada entregador. */
  diarias: number;
  total: number;
  /** Corridas com entregador da loja (inclui as canceladas que ele levou). */
  corridas: number;
  corridasCanceladas: number;
  /** Dias-entregador pagos com diária. */
  diasDeDiaria: number;
  /** Corridas pagas por distância sem distância medida (entraram como R$ 0). */
  semDistancia: number;
  /** Corridas pagas pela taxa que o cliente pagou (sem acerto cadastrado). */
  pelaTaxaDoCliente: number;
  /** Não deu para apurar (erro no servidor). */
  erro: string | null;
};

/** As mesas FECHADAS no período (pelo fechamento), pela régua única. */
export type ResumoDasMesas = {
  fechadas: number;
  descontoNoFechamento: number;
  mesasComDesconto: number;
  taxaDeServico: number;
  gorjeta: number;
  /** As baixas das contas (a forma de pagamento da mesa mora na conta, não no pedido). */
  pagamentos: ParteDoPagamento[];
};

export type SituacaoDoCiclo = "fechado" | "pago" | "previsto" | "isento" | "teste" | "sem-cobranca";

/** Um mês da mensalidade que o período toca. */
export type CicloNoPeriodo = {
  mes: string;
  /** Mensalidade (percentual com mínimo e teto, depois do teste). */
  mensalidade: number;
  /** Lojas extras de marketplace (R$ 50 cada, lib/billing.ts). */
  lojasExtras: number;
  /** Tráfego pago e totem cobrados pelo FireHub no ciclo. */
  outrosServicos: number;
  /** mensalidade + lojas extras + outros serviços. */
  custo: number;
  situacao: SituacaoDoCiclo;
};

export type DadosDoPeriodo = {
  de: string;
  ate: string;
  hoje: string;
  tz: string;
  pedidos: PedidoDoFinanceiro[];
  entregadores: ResumoDosEntregadores;
  mesas: ResumoDasMesas;
  ciclos: CicloNoPeriodo[];
  isenta: boolean;
};

export type CustoFixo = { id: string; label: string; value: number };
export type DespesaDoPeriodo = { dia: string; categoria: string; valor: number };

// ── TAXA DE PAGAMENTO ───────────────────────────────────────────────────────

export type FormaComTaxa = "CREDITO" | "DEBITO" | "VALE" | "PIX" | "DINHEIRO";

const CHAVE_NA_CONFIG: Record<FormaComTaxa, string> = {
  CREDITO: "CREDITO", DEBITO: "DEBITO", VALE: "VOUCHER", PIX: "PIX", DINHEIRO: "DINHEIRO",
};

export const ROTULO_DA_TAXA: Record<FormaComTaxa, string> = {
  CREDITO: "Crédito (maquininha)",
  DEBITO: "Débito (maquininha)",
  VALE: "Vale-refeição / voucher",
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
};

/**
 * A taxa (%) de uma forma, pelo que a loja cadastrou em Minha Loja → Formas de
 * pagamento (`User.paymentFees`).
 *
 * Cartão e vale: a MÉDIA das bandeiras ativas — o pedido não diz a bandeira, e
 * a loja que cadastrou só por bandeira (Ragnar, Hakim) tem a taxa geral zero:
 * o DRE antigo lia só ela e cobrava R$ 0. Sem bandeira ativa, a taxa geral.
 * Sem nada cadastrado para a forma, `configurada: false` — o DRE avisa em vez
 * de chutar um número.
 *
 * Pix e dinheiro: só a taxa que a loja cadastrou. Pix na chave da própria loja
 * não tem taxa; o DRE antigo cobrava 0,5% de todo Pix.
 */
export function taxaDaForma(paymentFees: unknown, forma: FormaComTaxa): { pct: number; configurada: boolean; comoFoi: string } {
  const cfg = paymentFees && typeof paymentFees === "object" ? (paymentFees as Record<string, any>)[CHAVE_NA_CONFIG[forma]] : undefined;
  // Formato antigo: { PIX: 0.5, CREDITO: 2.99, ... }.
  if (typeof cfg === "number") return { pct: Math.max(0, cfg), configurada: true, comoFoi: "taxa cadastrada" };
  if (forma === "PIX" || forma === "DINHEIRO") {
    const pct = Math.max(0, Number(cfg?.rate) || 0);
    return { pct, configurada: true, comoFoi: pct > 0 ? "taxa cadastrada" : forma === "PIX" ? "Pix na chave da loja: sem taxa" : "sem taxa" };
  }
  if (!cfg || typeof cfg !== "object") return { pct: 0, configurada: false, comoFoi: "taxa não cadastrada" };
  const marcas = (Array.isArray(cfg.brands) ? cfg.brands : [])
    .filter((b: any) => b && b.active !== false && Number.isFinite(Number(b.rate)))
    .map((b: any) => Math.max(0, Number(b.rate)));
  if (marcas.length > 0) {
    const media = marcas.reduce((s: number, r: number) => s + r, 0) / marcas.length;
    return { pct: Math.round(media * 1000) / 1000, configurada: true, comoFoi: `média de ${marcas.length} ${marcas.length === 1 ? "bandeira ativa" : "bandeiras ativas"}` };
  }
  return { pct: Math.max(0, Number(cfg.rate) || 0), configurada: true, comoFoi: "taxa única cadastrada" };
}

// ── COMISSÃO DOS APPS ───────────────────────────────────────────────────────

/** Percentual de comissão + taxas que cada app cobra da loja, por canal. Mora em `User.financialGoals.comissaoDosApps`. */
export type ComissoesDosApps = Partial<Record<ChaveDeCanal, number>>;

/** Os canais que cobram comissão: os marketplaces (lib/canal-do-pedido.ts). */
export const CANAIS_COM_COMISSAO: { chave: ChaveDeCanal; nome: string }[] = canaisConhecidos()
  .filter((c) => c.ehMarketplace)
  .map((c) => ({ chave: c.chave, nome: c.nome }));

const NOME_DO_CANAL = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
export const nomeDoCanalNoDRE = (chave: string) => (chave === "SITE" ? "Site próprio" : NOME_DO_CANAL.get(chave) || chave);

/** Lê o que está gravado; percentual fora de 0–100 é descartado. */
export function lerComissoesDosApps(financialGoals: unknown): ComissoesDosApps {
  const bruto = financialGoals && typeof financialGoals === "object" ? (financialGoals as any).comissaoDosApps : null;
  const saida: ComissoesDosApps = {};
  if (!bruto || typeof bruto !== "object") return saida;
  for (const { chave } of CANAIS_COM_COMISSAO) {
    const v = Number((bruto as any)[chave]);
    if ((bruto as any)[chave] !== null && (bruto as any)[chave] !== undefined && (bruto as any)[chave] !== "" && Number.isFinite(v) && v >= 0 && v <= 100) {
      saida[chave] = v;
    }
  }
  return saida;
}

// ── O RESULTADO ─────────────────────────────────────────────────────────────

export type LinhaDeComissao = { canal: ChaveDeCanal; nome: string; base: number; pedidos: number; pct: number | null; valor: number };
export type LinhaDeTaxa = { chave: FormaComTaxa | "SITE"; rotulo: string; base: number; pct: number | null; valor: number; configurada: boolean; comoFoi: string };
export type LinhaDoMes = { mes: string; dias: number; diasDoMes: number; valorDoMes: number; valor: number; situacao?: SituacaoDoCiclo };

export type ResultadoDoDRE = {
  dias: number;
  // RECEITA
  valorVendido: number;
  vendas: number;
  lancamentos: number;
  mesasAtendidas: number;
  ticketMedio: number;
  porTipo: { tipo: TipoDeVenda; rotulo: string; vendas: number; valor: number }[];
  porCanal: { canal: ChaveDeCanal; nome: string; pedidos: number; valor: number }[];
  produtos: number;
  freteDaLoja: number;
  freteDoApp: number;
  cupomDoApp: number;
  descontoNaMesa: number;
  mesasComDesconto: number;
  receitaDaLoja: number;
  // CMV
  cmv: number;
  valorDosItens: number;
  valorDosItensComCusto: number;
  /** 0 a 1: quanto do valor dos itens tem custo cadastrado. */
  cobertura: number;
  lucroBruto: number;
  // CUSTOS QUE ANDAM COM A VENDA
  comissoes: LinhaDeComissao[];
  totalComissoes: number;
  taxas: LinhaDeTaxa[];
  totalTaxas: number;
  entregadores: ResumoDosEntregadores;
  entregasDaLoja: number;
  entregasSemEntregador: number;
  entregasDoApp: number;
  margemDeContribuicao: number;
  // DEPOIS
  mensalidade: { total: number; meses: LinhaDoMes[]; isenta: boolean };
  despesas: { total: number; porCategoria: [string, number][] };
  custosFixos: { totalMensal: number; total: number; mesesEquivalentes: number; meses: LinhaDoMes[]; itens: { id: string; label: string; valorMensal: number; valor: number }[] };
  resultado: number;
  /** Margens sobre a RECEITA DA LOJA (0 a 100) — uma base só. */
  margens: { bruta: number; contribuicao: number; resultado: number };
  cancelados: { pedidos: number; valor: number };
  servicoDasMesas: { taxa: number; gorjeta: number };
  /** O que falta para o resultado ser o lucro de verdade. Vazio = completo. */
  pendencias: string[];
  /** Observações que não invalidam a conta. */
  avisos: string[];
  completo: boolean;
};

/** Abaixo disto do valor dos itens com custo cadastrado, o lucro é incompleto. */
export const COBERTURA_MINIMA = 0.8;
/** Acima desta fração de entregas da loja sem entregador, o custo das entregas é incompleto. */
const ENTREGAS_SEM_ENTREGADOR_MAXIMO = 0.2;

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : 0);
const FORMAS_COM_TAXA: FormaComTaxa[] = ["CREDITO", "DEBITO", "VALE", "PIX", "DINHEIRO"];
const listaPt = (l: string[]) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`);

/** O pedido entra no DRE? A régua única: venda (nem cancelado, nem intenção) e valor possível. */
export function entraNoDRE(p: Pick<PedidoDoFinanceiro, "status" | "impossivel">): boolean {
  return situacaoDoPedido(p.status) === "venda" && !p.impossivel;
}

export function calcularDRE(e: {
  dados: DadosDoPeriodo;
  custosFixos: CustoFixo[];
  despesas: DespesaDoPeriodo[];
  comissoes: ComissoesDosApps;
  paymentFees: unknown;
}): ResultadoDoDRE {
  const { dados } = e;
  const { de, ate } = dados;
  const dias = diasNoPeriodo(de, ate);

  // ── RECEITA (a régua única) ────────────────────────────────────────────
  let cValor = 0, cFrete = 0, cFreteApp = 0, cCupomApp = 0;
  let cItens = 0, cItensComCusto = 0, cCusto = 0;
  let nCanc = 0, cCanc = 0;
  let entregasDaLoja = 0, entregasSemEntregador = 0, entregasDoApp = 0;
  const validos: PedidoDoFinanceiro[] = [];
  const porCanal = new Map<ChaveDeCanal, { pedidos: number; c: number; cItens: number }>();
  const basePorForma = new Map<FormaComTaxa, number>();
  let cSiteOnline = 0, cTaxaSite = 0;

  const somarForma = (forma: ChaveDaForma, valorEmCentavos: number) => {
    if ((FORMAS_COM_TAXA as string[]).includes(forma)) {
      basePorForma.set(forma as FormaComTaxa, (basePorForma.get(forma as FormaComTaxa) || 0) + valorEmCentavos);
    }
  };

  for (const p of dados.pedidos) {
    if (!entraNoDRE(p)) {
      if (situacaoDoPedido(p.status) === "cancelado" && !p.impossivel) { nCanc++; cCanc += cent(p.totalAmount); }
      continue;
    }
    validos.push(p);
    const total = cent(p.totalAmount);
    cValor += total;
    const frete = cent(p.deliveryFee);
    cFrete += frete;
    if (p.entregaDoApp) cFreteApp += frete;
    cCupomApp += cent(p.cupomDoApp);
    cItens += cent(p.itens);
    cItensComCusto += cent(p.itensComCusto);
    cCusto += cent(p.custo);

    const c = porCanal.get(p.canal) || { pedidos: 0, c: 0, cItens: 0 };
    c.pedidos++;
    c.c += total;
    // A comissão do app é sobre os itens; pedido antigo sem itens gravados vai
    // pelo total sem a taxa de entrega.
    c.cItens += p.itens > 0 ? cent(p.itens) : Math.max(0, total - frete);
    porCanal.set(p.canal, c);

    if (p.tipo === "DELIVERY") {
      if (p.entregaDoApp) entregasDoApp++;
      else {
        entregasDaLoja++;
        if (!p.temEntregador) entregasSemEntregador++;
      }
    }

    // Taxa de pagamento. A mesa paga na CONTA (as baixas vêm em dados.mesas);
    // o pedido pago no app não tem taxa daqui — ela está dentro da comissão do
    // app; o pago pelo site tem o 1% do FireHub gravado no pedido.
    if (p.tableSessionId) continue;
    let pagoNoSite = false;
    for (const parte of p.pagamentos) {
      if (parte.forma === "ONLINE") {
        if (!p.marketplace) { pagoNoSite = true; cSiteOnline += cent(parte.valor); }
        continue;
      }
      somarForma(parte.forma, cent(parte.valor));
    }
    if (pagoNoSite) cTaxaSite += cent(p.taxaOnline);
  }
  for (const parte of dados.mesas.pagamentos) somarForma(parte.forma, cent(parte.valor));

  const at = atendimentosDaVenda(validos.map((p) => ({
    id: p.id, createdAt: p.criadoEm, status: p.status, totalAmount: p.totalAmount,
    tableSessionId: p.tableSessionId, parentOrderId: p.parentOrderId,
  })));

  const porTipoMapa = new Map<TipoDeVenda, { vendas: number; c: number }>();
  for (const p of validos) {
    const t = porTipoMapa.get(p.tipo) || { vendas: 0, c: 0 };
    if (at.abre.has(p.id)) t.vendas++;
    t.c += cent(p.totalAmount);
    porTipoMapa.set(p.tipo, t);
  }
  const porTipo = TIPOS_DE_VENDA.filter((t) => porTipoMapa.has(t)).map((t) => ({
    tipo: t, rotulo: ROTULO_DO_TIPO[t], vendas: porTipoMapa.get(t)!.vendas, valor: reais(porTipoMapa.get(t)!.c),
  }));

  const valorVendido = reais(cValor);
  const descontoNaMesa = dados.mesas.descontoNoFechamento;
  const receitaDaLoja = reais(cValor - cFreteApp - cent(descontoNaMesa) + cCupomApp);

  // ── CMV ────────────────────────────────────────────────────────────────
  const cmv = reais(cCusto);
  const cobertura = cItens > 0 ? cItensComCusto / cItens : 1;
  const lucroBruto = reais(cent(receitaDaLoja) - cCusto);

  // ── COMISSÃO DOS APPS ──────────────────────────────────────────────────
  const comissoes: LinhaDeComissao[] = [];
  for (const { chave, nome } of CANAIS_COM_COMISSAO) {
    const c = porCanal.get(chave);
    if (!c || c.pedidos === 0) continue;
    const p = e.comissoes[chave];
    const definido = typeof p === "number" && Number.isFinite(p);
    comissoes.push({
      canal: chave, nome, base: reais(c.cItens), pedidos: c.pedidos,
      pct: definido ? p! : null,
      valor: definido ? reais(Math.round((c.cItens * p!) / 100)) : 0,
    });
  }
  const totalComissoes = reais(comissoes.reduce((s, l) => s + cent(l.valor), 0));

  // ── TAXAS DE PAGAMENTO ─────────────────────────────────────────────────
  const taxas: LinhaDeTaxa[] = [];
  for (const forma of FORMAS_COM_TAXA) {
    const base = basePorForma.get(forma) || 0;
    if (base <= 0) continue;
    const t = taxaDaForma(e.paymentFees, forma);
    taxas.push({
      chave: forma, rotulo: ROTULO_DA_TAXA[forma], base: reais(base),
      pct: t.configurada ? t.pct : null,
      valor: t.configurada ? reais(Math.round((base * t.pct) / 100)) : 0,
      configurada: t.configurada, comoFoi: t.comoFoi,
    });
  }
  if (cSiteOnline > 0) {
    taxas.push({
      chave: "SITE", rotulo: "Pago online pelo site", base: reais(cSiteOnline),
      pct: cSiteOnline > 0 ? Math.round((cTaxaSite / cSiteOnline) * 10000) / 100 : null,
      valor: reais(cTaxaSite), configurada: true,
      comoFoi: "taxa do FireHub gravada em cada pedido (a tarifa do Asaas sai no extrato do Asaas)",
    });
  }
  const totalTaxas = reais(taxas.reduce((s, l) => s + cent(l.valor), 0));

  // ── ENTREGADORES ───────────────────────────────────────────────────────
  const entregadores = dados.entregadores;

  const margemDeContribuicao = reais(
    cent(lucroBruto) - cent(totalComissoes) - cent(totalTaxas) - cent(entregadores.total),
  );

  // ── MENSALIDADE FIREHUB (o ciclo de verdade, rateado por dia) ───────────
  const cicloDe = new Map(dados.ciclos.map((c) => [c.mes, c]));
  const mesesDaMensalidade: LinhaDoMes[] = mesesDoPeriodo(de, ate).map((m) => {
    const c = cicloDe.get(m.mes);
    const valorDoMes = c ? c.custo : 0;
    return {
      mes: m.mes, dias: m.dias, diasDoMes: m.diasDoMes, valorDoMes,
      valor: reais(Math.round((cent(valorDoMes) * m.dias) / m.diasDoMes)),
      situacao: c?.situacao ?? (dados.isenta ? "isento" : "sem-cobranca"),
    };
  });
  const mensalidade = {
    total: reais(mesesDaMensalidade.reduce((s, m) => s + cent(m.valor), 0)),
    meses: mesesDaMensalidade,
    isenta: dados.isenta,
  };

  // ── DESPESAS LANÇADAS ──────────────────────────────────────────────────
  const despesasDoPeriodo = e.despesas.filter((d) => d.dia >= de && d.dia <= ate);
  const porCategoria = new Map<string, number>();
  for (const d of despesasDoPeriodo) porCategoria.set(d.categoria, (porCategoria.get(d.categoria) || 0) + cent(d.valor));
  const despesas = {
    total: reais(despesasDoPeriodo.reduce((s, d) => s + cent(d.valor), 0)),
    porCategoria: [...porCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, reais(v)] as [string, number]),
  };

  // ── CUSTOS FIXOS (rateio mês a mês, sem teto) ──────────────────────────
  const totalMensal = reais(e.custosFixos.reduce((s, c) => s + cent(c.value), 0));
  const mesesDosFixos: LinhaDoMes[] = mesesDoPeriodo(de, ate).map((m) => ({
    mes: m.mes, dias: m.dias, diasDoMes: m.diasDoMes, valorDoMes: totalMensal,
    valor: reais(Math.round((cent(totalMensal) * m.dias) / m.diasDoMes)),
  }));
  const fracaoDeMes = (m: { dias: number; diasDoMes: number }) => m.dias / m.diasDoMes;
  const mesesEquivalentes = mesesDosFixos.reduce((s, m) => s + fracaoDeMes(m), 0);
  const itensFixos = e.custosFixos.map((c) => ({
    id: c.id, label: c.label, valorMensal: c.value,
    valor: reais(mesesDosFixos.reduce((s, m) => s + Math.round((cent(c.value) * m.dias) / m.diasDoMes), 0)),
  }));
  const custosFixos = {
    totalMensal,
    total: reais(itensFixos.reduce((s, c) => s + cent(c.valor), 0)),
    mesesEquivalentes: Math.round(mesesEquivalentes * 1000) / 1000,
    meses: mesesDosFixos,
    itens: itensFixos,
  };

  const resultado = reais(
    cent(margemDeContribuicao) - cent(mensalidade.total) - cent(despesas.total) - cent(custosFixos.total),
  );

  // ── O QUE FALTA PARA SER LUCRO DE VERDADE ─────────────────────────────
  const pendencias: string[] = [];
  const avisos: string[] = [];
  if (cItens > 0 && cobertura < COBERTURA_MINIMA) {
    pendencias.push(`${Math.round((1 - cobertura) * 100)}% do valor dos itens vendidos está sem custo cadastrado`);
  }
  const semComissao = comissoes.filter((c) => c.pct === null).map((c) => c.nome);
  if (semComissao.length > 0) pendencias.push(`comissão ${semComissao.length === 1 ? "do" : "dos apps"} ${listaPt(semComissao)} não configurada`);
  const semTaxa = taxas.filter((t) => !t.configurada).map((t) => t.rotulo.toLowerCase());
  if (semTaxa.length > 0) pendencias.push(`taxa da maquininha não cadastrada (${listaPt(semTaxa)})`);
  if (entregadores.erro) pendencias.push("o custo dos entregadores não pôde ser apurado");
  if (entregasSemEntregador > 0) {
    const fracao = entregasDaLoja > 0 ? entregasSemEntregador / entregasDaLoja : 0;
    const frase = `${entregasSemEntregador} ${entregasSemEntregador === 1 ? "entrega da loja ficou" : "entregas da loja ficaram"} sem entregador atribuído — o custo delas não entra aqui`;
    if (fracao > ENTREGAS_SEM_ENTREGADOR_MAXIMO) pendencias.push(frase);
    else avisos.push(frase);
  }
  if (entregadores.semDistancia > 0) {
    avisos.push(`${entregadores.semDistancia} ${entregadores.semDistancia === 1 ? "corrida paga" : "corridas pagas"} por distância sem distância medida entraram como R$ 0,00 (como no fechamento dos motoboys)`);
  }
  if (mesesDaMensalidade.some((m) => m.situacao === "previsto")) {
    avisos.push("a mensalidade do mês em andamento é a previsão até agora — o valor final sai no fechamento do mês");
  }

  return {
    dias,
    valorVendido,
    vendas: at.vendas,
    lancamentos: at.lancamentos,
    mesasAtendidas: at.mesas,
    ticketMedio: ticketMedio(valorVendido, at.vendas),
    porTipo,
    porCanal: [...porCanal.entries()]
      .map(([canal, c]) => ({ canal, nome: nomeDoCanalNoDRE(canal), pedidos: c.pedidos, valor: reais(c.c) }))
      .sort((a, b) => b.valor - a.valor),
    produtos: reais(cValor - cFrete),
    freteDaLoja: reais(cFrete - cFreteApp),
    freteDoApp: reais(cFreteApp),
    cupomDoApp: reais(cCupomApp),
    descontoNaMesa,
    mesasComDesconto: dados.mesas.mesasComDesconto,
    receitaDaLoja,
    cmv,
    valorDosItens: reais(cItens),
    valorDosItensComCusto: reais(cItensComCusto),
    cobertura,
    lucroBruto,
    comissoes,
    totalComissoes,
    taxas,
    totalTaxas,
    entregadores,
    entregasDaLoja,
    entregasSemEntregador,
    entregasDoApp,
    margemDeContribuicao,
    mensalidade,
    despesas,
    custosFixos,
    resultado,
    margens: {
      bruta: pct(lucroBruto, receitaDaLoja),
      contribuicao: pct(margemDeContribuicao, receitaDaLoja),
      resultado: pct(resultado, receitaDaLoja),
    },
    cancelados: { pedidos: nCanc, valor: reais(cCanc) },
    servicoDasMesas: { taxa: dados.mesas.taxaDeServico, gorjeta: dados.mesas.gorjeta },
    pendencias,
    avisos,
    completo: pendencias.length === 0,
  };
}

// ── DE ONDE O DINHEIRO CHEGA (abas Extrato e Relatório) ─────────────────────

export const ROTULO_DO_RECEBIMENTO: Partial<Record<ChaveDaForma, string>> = {
  DINHEIRO: "Dinheiro", PIX: "Pix (na loja / na entrega)", CREDITO: "Crédito (maquininha)", DEBITO: "Débito (maquininha)",
  VALE: "Vale-refeição / voucher", FIADO: "Fiado / conta funcionário", OUTROS: "Forma não identificada",
};

/**
 * As vendas do período pelo caminho do dinheiro: recebido na loja (caixa, pela
 * régua do fechamento — a mesa pelas baixas da conta, sem o troco), pago no
 * app (chega pelo repasse do app) e pago online pelo site (cai na conta Asaas
 * da loja, com o 1% do FireHub).
 *
 * O "Faturamento Online" antigo só somava o gateway Mercado Pago, que nenhuma
 * loja usa: dava R$ 0,00 para todas (auditoria de 11/10/2026).
 */
export function recebimentosDoPeriodo(dados: Pick<DadosDoPeriodo, "pedidos" | "mesas">) {
  const naLoja = new Map<ChaveDaForma, number>();
  const noApp = new Map<ChaveDeCanal, number>();
  let cSitePix = 0, cSiteCartao = 0, cTaxaSite = 0, nSite = 0;
  let cEstornoSite = 0, nEstornoSite = 0;

  for (const p of dados.pedidos) {
    const doSite = !p.marketplace && p.pagamentos.some((x) => x.forma === "ONLINE");
    if (!entraNoDRE(p)) {
      // Pedido pago pelo site e depois cancelado: o dinheiro volta ao cliente.
      if (situacaoDoPedido(p.status) === "cancelado" && doSite && p.paymentPaidAt) { cEstornoSite += cent(p.totalAmount); nEstornoSite++; }
      continue;
    }
    if (p.tableSessionId) continue;
    for (const parte of p.pagamentos) {
      const c = cent(parte.valor);
      if (parte.forma === "ONLINE") {
        if (p.marketplace) noApp.set(p.canal, (noApp.get(p.canal) || 0) + c);
        else if (String(p.pagarmeMethod || "").toLowerCase() === "pix" || /pix/i.test(p.paymentMethod)) cSitePix += c;
        else cSiteCartao += c;
        continue;
      }
      naLoja.set(parte.forma, (naLoja.get(parte.forma) || 0) + c);
    }
    if (doSite) { cTaxaSite += cent(p.taxaOnline); nSite++; }
  }
  for (const parte of dados.mesas.pagamentos) {
    if (parte.forma === "ONLINE") continue;
    naLoja.set(parte.forma, (naLoja.get(parte.forma) || 0) + cent(parte.valor));
  }

  const ordem: ChaveDaForma[] = ["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VALE", "FIADO", "OUTROS"];
  const linhasDaLoja = ordem.filter((f) => (naLoja.get(f) || 0) > 0).map((f) => ({ forma: f, rotulo: ROTULO_DO_RECEBIMENTO[f] || f, valor: reais(naLoja.get(f)!) }));
  const linhasDoApp = [...noApp.entries()].sort((a, b) => b[1] - a[1]).map(([canal, c]) => ({ canal, nome: nomeDoCanalNoDRE(canal), valor: reais(c) }));
  const site = cSitePix + cSiteCartao;
  return {
    naLoja: { total: reais(linhasDaLoja.reduce((s, l) => s + cent(l.valor), 0)), linhas: linhasDaLoja },
    noApp: { total: reais(linhasDoApp.reduce((s, l) => s + cent(l.valor), 0)), linhas: linhasDoApp },
    site: {
      total: reais(site), pix: reais(cSitePix), cartao: reais(cSiteCartao), pedidos: nSite,
      taxaFireHub: reais(cTaxaSite),
      estornos: reais(cEstornoSite), pedidosEstornados: nEstornoSite,
      liquido: reais(site - cTaxaSite),
    },
  };
}

// ── O QUE SE MOSTRA EM VOLTA DO DRE ─────────────────────────────────────────

/** Referência do iFood quando a loja não cadastrou a dela: plano Entrega, 23% + 3,2% do pagamento online. */
export const COMISSAO_DE_REFERENCIA = 26;

/**
 * Quanto a loja deixou de pagar de comissão por vender pelos canais PRÓPRIOS
 * digitais (site e robô do WhatsApp) — a única venda que iria para o app se
 * não fosse por eles. Balcão, mesa e totem não entram (nunca seriam do app),
 * e a venda que JÁ é do app, obviamente, também não: o card antigo calculava
 * 26% de TODA a receita, e a Delícia de Casa, 100% iFood, "economizou"
 * R$ 14.397,62.
 */
export function economiaNosCanaisProprios(r: Pick<ResultadoDoDRE, "porCanal">, comissoes: ComissoesDosApps) {
  const proprios = r.porCanal.filter((c) => c.canal === "SITE" || c.canal === "WHATSAPP_IA");
  const base = reais(proprios.reduce((s, c) => s + cent(c.valor), 0));
  const daLoja = typeof comissoes.IFOOD === "number";
  const percentual = daLoja ? comissoes.IFOOD! : COMISSAO_DE_REFERENCIA;
  return { base, percentual, daLoja, valor: reais(Math.round((cent(base) * percentual) / 100)), pedidos: proprios.reduce((s, c) => s + c.pedidos, 0) };
}

/**
 * Quanto a loja precisa vender por mês para pagar os custos fixos, com a
 * margem de contribuição do período. Só quando o resultado é completo — com
 * custo ou comissão faltando a margem é inventada, e o número também seria.
 */
export function pontoDeEquilibrio(r: Pick<ResultadoDoDRE, "completo" | "valorVendido" | "margemDeContribuicao">, custosFixosMensais: number):
  | { ok: true; vendaMensal: number; margem: number }
  | { ok: false; motivo: "incompleto" | "sem-venda" | "margem-negativa" | "sem-custo-fixo" } {
  if (custosFixosMensais <= 0) return { ok: false, motivo: "sem-custo-fixo" };
  if (!r.completo) return { ok: false, motivo: "incompleto" };
  if (r.valorVendido <= 0) return { ok: false, motivo: "sem-venda" };
  const margem = r.margemDeContribuicao / r.valorVendido;
  if (margem <= 0) return { ok: false, motivo: "margem-negativa" };
  return { ok: true, vendaMensal: reais(Math.round((cent(custosFixosMensais) / margem))), margem: Math.round(margem * 10000) / 100 };
}
