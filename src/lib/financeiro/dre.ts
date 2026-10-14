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
 *    pelo app (fica com o app) − taxa de serviço que o app cobra do cliente
 *    (a sobra da conta do pedido de app: total − itens − entrega + desconto)
 *    − desconto dado no fechamento da mesa + cupom que o app bancou (o app
 *    repassa à loja).
 * 4. CUSTOS que andam com a venda (margem de contribuição): CMV pela contagem
 *    do estoque, senão pela ficha técnica, senão pelo custo digitado (ver "O
 *    CMV", mais abaixo), comissão dos apps pelo percentual que A LOJA cadastra, taxa
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
import { ROTULO_DO_TIPO, TIPOS_DE_VENDA, diasNoPeriodo, naLoja, periodoDoAtalho, somarDias, type AtalhoDePeriodo, type TipoDeVenda } from "@/lib/relatorios/base";
import { canaisConhecidos, type ChaveDeCanal } from "@/lib/canal-do-pedido";
import { calcMensalidade, VIRADA_DOS_2_POR_CENTO } from "@/lib/firehub-billing";
import type { ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import type { CmvDoTrecho } from "@/lib/cmv/cmv-real";
import type { FaltaDoItem, MotivoSemCusto } from "@/lib/financeiro/custo-pela-ficha";

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

/**
 * O período pedido na URL; torto ou ausente vira o padrão, nunca erro. Não
 * passa de hoje: dia que ainda não aconteceu só somaria custo fixo e
 * mensalidade sem venda nenhuma.
 */
export function lerPeriodo(de: string | null | undefined, ate: string | null | undefined, hoje: string): { de: string; ate: string } {
  if (!de || !DIA_RE.test(de)) return periodoDoFinanceiro(ATALHO_PADRAO, hoje);
  let fim = ate && DIA_RE.test(ate) ? ate : de;
  let ini = de;
  if (ini > fim) [ini, fim] = [fim, ini];
  if (fim > hoje) fim = hoje;
  if (ini > fim) ini = fim;
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
  /**
   * Quanto desse valor tem custo pelas fontes 2 e 3 do CMV (ficha técnica ×
   * custo do insumo no dia, ou o custo digitado no produto). Ver "O CMV".
   */
  itensComCusto: number;
  /** Σ custo desses itens (ficha + custo digitado). */
  custo: number;
  /** A parte de `itensComCusto`/`custo` que saiu da ficha técnica. Ausente = tudo pelo custo digitado. */
  itensPelaFicha?: number;
  custoPelaFicha?: number;
  /** Total ou item ≥ R$ 1 milhão (regua-da-venda.ts, temValorImpossivel): fora de toda soma. */
  impossivel: boolean;
  /** As partes do pagamento pela régua do caixa (lib/resumo-do-entregador.ts, partesDaEntrega). */
  pagamentos: ParteDoPagamento[];
  /** Taxa do pagamento online pelo site (o 1% do FireHub, `CustomerOrder.taxaOnline`). */
  taxaOnline: number;
  /** Cupom que o app bancou (formas-de-pagamento.ts, cupomDaPlataforma): o app repassa à loja. */
  cupomDoApp: number;
  /**
   * Pedido de app: o que o cliente pagou além de itens + entrega − desconto
   * (lib/relatorios/vendas.ts, outrasTaxasDoPedido, só a parte positiva) — a
   * taxa de serviço do app (R$ 0,99 a 2,49 no iFood), que fica com o app. No
   * 99Food gravado pelo preço cheio, é o desconto que entrou em dobro no
   * total. Zero nos outros canais.
   */
  taxaDoApp: number;
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
  /** Não deu para ler as mesas (erro no servidor): o desconto e as baixas ficam de fora. */
  erro?: string | null;
};

/**
 * fechado/pago = mês fechado (o boleto); projetado = mês em andamento (a
 * previsão do mês inteiro pelo ritmo de vendas); previsto = mês que acabou e
 * o fechamento ainda não rodou (a conta do fechamento).
 */
export type SituacaoDoCiclo = "fechado" | "pago" | "projetado" | "previsto" | "isento" | "teste" | "sem-cobranca";

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

/** Um item vendido sem custo e o que falta para ter (lib/financeiro/custo-pela-ficha.ts). */
export type ItemSemCusto = { nome: string; valor: number; faltas: FaltaDoItem[] };

/** O CMV pela contagem do estoque no período (lib/financeiro/cmv-do-financeiro.ts). */
export type CmvRealDoPeriodo = {
  /** Contagens fechadas até o fim do período, de qualquer tipo. */
  contagens: number;
  ultimaCompleta: string | null;
  /** A contagem completa que abre o período, quando há (com ou sem a que fecha). */
  abertura: string | null;
  /** Entre duas contagens COMPLETAS dentro do período (lib/cmv/cmv-real.ts, janelaCompletaDoPeriodo). */
  trecho: CmvDoTrecho | null;
  falta: null | "NENHUMA_CONTAGEM" | "SO_UMA_CONTAGEM";
  /** Insumos contados (quantidade > 0) sem custo nas duas contagens: entram com R$ 0. */
  semCustoNaContagem: string[];
};

/** O que o servidor manda para o CMV. Ausente (dado antigo) = só o custo que veio em cada pedido. */
export type CmvDoServidor = {
  real: CmvRealDoPeriodo | null;
  /** A loja tem ficha técnica gravada em algum produto. */
  usaFicha: boolean;
  /** A loja tem insumos no estoque. */
  usaEstoque: boolean;
  /** A semana do CMV da loja (lib/cmv/semana-do-cmv.ts): o dia da semana em que começa e o que ela fecha. */
  semana: { comecaEm: number; fecha: number; diaDaContagem: number };
  /** Os itens sem custo de cada dia operacional, juntados pelo nome. */
  semCustoPorDia: Record<string, ItemSemCusto[]>;
  /** O desperdício de cada dia operacional (ver "O DESPERDÍCIO" em cmvDoPeriodo). Ausente = dado antigo. */
  desperdicioPorDia?: Record<string, DesperdicioDoDia>;
  /** Não deu para ler a contagem ou as fichas: o CMV fica só com o que veio no pedido. */
  erro?: string | null;
};

/**
 * O desperdício de um dia: pedidos cancelados DEPOIS de sair da produção
 * (lib/desperdicio-do-cancelado.ts), pelo custo dos itens (ficha × custo do
 * insumo no dia, senão o custo digitado — a mesma conta dos vendidos), e o
 * lançado no estoque (aba Desperdício, Movimentar › Perda, FireCheck).
 */
export type DesperdicioDoDia = {
  cancelados: number;
  pedidosCancelados: number;
  /** Valor (preço) dos itens dos cancelados já produzidos que ficaram sem custo. */
  canceladosSemCusto: number;
  lancado: number;
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
  cmv?: CmvDoServidor;
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
  /** Taxa de serviço (e sobras) que o app cobra do cliente e fica com ele. */
  taxaDoApp: number;
  pedidosComTaxaDoApp: number;
  cupomDoApp: number;
  descontoNaMesa: number;
  mesasComDesconto: number;
  receitaDaLoja: number;
  // CMV
  cmv: number;
  valorDosItens: number;
  /** Valor dos itens com custo: os dos dias da contagem + os que têm ficha ou custo digitado. */
  valorDosItensComCusto: number;
  /** 0 a 1: quanto do valor dos itens tem custo (por qualquer das três fontes). */
  cobertura: number;
  /** De onde o CMV saiu e o que falta. */
  cmvDetalhe: CmvDoDRE;
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

// ── O CMV ───────────────────────────────────────────────────────────────────
//
// O DRE abria "Resultado incompleto — 100% do valor dos itens vendidos está
// sem custo cadastrado" no Hakim Centro (11/10/2026): só sabia ler o custo
// digitado em cada produto (`MenuProduct.cost`), que ninguém preenche. A loja
// já conta o estoque e lança as compras (CMV real, lib/cmv) e tem as fichas
// técnicas. O Douglas: "não quero CMV teórico" e "só preciso que os números
// deem certo". A ordem das fontes, dia a dia:
//
//   1. CONTAGEM (o real): estoque da contagem completa que abre + compras −
//      estoque da que fecha (lib/cmv/cmv-real.ts, janelaCompletaDoPeriodo).
//      Vale para os dias entre as duas contagens, inteiros.
//   2. FICHA TÉCNICA × custo do insumo no dia (lib/financeiro/custo-pela-ficha.ts),
//      item a item, nos dias que a contagem não cobre.
//   3. CUSTO DIGITADO no produto, só onde não há ficha.
//
// COBERTURA PARCIAL (a regra mais conservadora, decidida aqui): a contagem
// vale só para os dias que ela cobre por inteiro — o trecho entre duas
// contagens COMPLETAS que caem dentro do período. Nada de ratear o CMV de uma
// semana de contagem entre os dias de dentro e de fora do período: isso seria
// uma estimativa vestida de número real. Os outros dias vão pelas fontes 2 e
// 3, e o resultado só é completo se ELAS cobrirem ≥ 80% do valor dos itens
// DESSES dias (COBERTURA_MINIMA) — medido só sobre os dias de fora, para um
// dia sem custo nenhum não se esconder atrás de seis dias de contagem. Para o
// período inteiro sair da contagem, ele tem de ser a semana do CMV da loja
// (lib/cmv/semana-do-cmv.ts): a tela diz qual é.
//
// Sem custo nunca é R$ 0 calado: o item fica "sem custo", conta contra a
// cobertura e a tela diz o nome e o que fazer (lançar a compra do insumo,
// fazer a ficha, digitar o custo, acertar o nome que o app manda).

export type FonteDoCmv = "CONTAGEM" | "CONTAGEM_E_FICHA" | "FICHA" | "CADASTRO" | "NENHUMA";

/** O que falta, com o lugar de resolver. `bloqueia` = sem isso o resultado não é o lucro. */
export type FaltaDoCmv = {
  chave: "CONTAGEM" | "CONTAGEM_SEM_CUSTO" | "COMPRAS" | "FICHA" | "CUSTO_NO_PRODUTO" | "NOME_DO_APP";
  texto: string;
  href: string;
  rotulo: string;
  bloqueia: boolean;
};

export type CmvDoDRE = {
  fonte: FonteDoCmv;
  /** "CMV real pela contagem de 13/10 a 19/10", "pela ficha técnica e o custo das compras"... */
  titulo: string;
  real: null | {
    de: string; ate: string;
    /** O dia que a contagem de abertura fecha (véspera do primeiro dia coberto). */
    abertura: string;
    estoqueInicial: number; compras: number; estoqueFinal: number; cmv: number;
    /** Valor vendido sem a taxa de entrega nos dias da contagem. */
    vendas: number;
    pct: number | null;
  };
  ficha: { custo: number; itens: number };
  cadastro: { custo: number; itens: number };
  /** Valor dos itens dos dias que a contagem não cobre (todos, sem contagem). */
  itensFora: number;
  /** 0 a 1: quanto desse valor tem custo pela ficha ou pelo produto. */
  coberturaFora: number;
  semCusto: { valor: number; itens: ItemSemCusto[] };
  /**
   * O desperdício do período. `noCmv` é a parte somada ao CMV acima (dias
   * fora da contagem); `naContagem` já está dentro do CMV pela contagem — o
   * que foi para o lixo saiu do estoque contado.
   */
  desperdicio: {
    cancelados: { valor: number; pedidos: number; semCusto: number; noCmv: number };
    lancado: { valor: number; noCmv: number };
    naContagem: number;
  };
  faltas: FaltaDoCmv[];
  completo: boolean;
};

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const listaCurta = (nomes: string[], n = 5) => (nomes.length <= n ? listaPt(nomes) : `${nomes.slice(0, n).join(", ")} e mais ${nomes.length - n}`);

function cmvDoPeriodo(validos: PedidoDoFinanceiro[], dados: DadosDoPeriodo): {
  detalhe: CmvDoDRE; cCmv: number; cComCusto: number; pendencias: string[]; avisos: string[];
} {
  const info = dados.cmv;
  const real = info?.real ?? null;
  const trecho = real?.trecho ?? null;
  const dentro = (dia: string) => trecho != null && dia >= trecho.de && dia <= trecho.ate;

  let cItensReal = 0, cVendasReal = 0, cItensFora = 0, cComCustoFora = 0, cCustoFora = 0, cItensFicha = 0, cCustoFicha = 0;
  for (const p of validos) {
    const dia = naLoja(p.criadoEm, dados.tz).dia;
    if (dentro(dia)) {
      cItensReal += cent(p.itens);
      cVendasReal += cent(p.totalAmount) - cent(p.deliveryFee);
      continue;
    }
    cItensFora += cent(p.itens);
    cComCustoFora += cent(p.itensComCusto);
    cCustoFora += cent(p.custo);
    cItensFicha += cent(p.itensPelaFicha || 0);
    cCustoFicha += cent(p.custoPelaFicha || 0);
  }
  const cReal = trecho ? cent(trecho.cmv) : 0;
  const coberturaFora = cItensFora > 0 ? cComCustoFora / cItensFora : 1;

  // ── O DESPERDÍCIO ────────────────────────────────────────────────────────
  // Pedido cancelado depois de produzido e o que foi lançado como perda são
  // custo de mercadoria sem venda. Nos dias da contagem ele já está no CMV
  // real (saiu do estoque contado); nos outros, o CMV vem dos itens VENDIDOS
  // (ficha ou custo digitado) e o desperdício entra somado a ele.
  let cDespCancelados = 0, cDespSemCusto = 0, cDespLancado = 0, cDespNaContagem = 0, pedidosDesp = 0;
  let cCanceladosNoCmv = 0, cLancadoNoCmv = 0;
  for (const [dia, d] of Object.entries(info?.desperdicioPorDia || {})) {
    if (dia < dados.de || dia > dados.ate) continue;
    const c = cent(d.cancelados), l = cent(d.lancado);
    cDespCancelados += c;
    cDespLancado += l;
    cDespSemCusto += cent(d.canceladosSemCusto);
    pedidosDesp += d.pedidosCancelados || 0;
    if (dentro(dia)) cDespNaContagem += c + l;
    else { cCanceladosNoCmv += c; cLancadoNoCmv += l; }
  }

  // Os sem custo dos dias de fora, juntados pelo nome.
  const juntos = new Map<string, ItemSemCusto>();
  for (const [dia, itens] of Object.entries(info?.semCustoPorDia || {})) {
    if (dia < dados.de || dia > dados.ate || dentro(dia)) continue;
    for (const i of itens) {
      const atual = juntos.get(i.nome);
      if (!atual) { juntos.set(i.nome, { nome: i.nome, valor: i.valor, faltas: [...i.faltas] }); continue; }
      atual.valor = reais(cent(atual.valor) + cent(i.valor));
      for (const f of i.faltas) if (!atual.faltas.some((g) => g.motivo === f.motivo && g.nome === f.nome)) atual.faltas.push(f);
    }
  }
  const semCustoItens = [...juntos.values()].sort((a, b) => b.valor - a.valor);
  const nomesDo = (motivos: MotivoSemCusto[]) => {
    const peso = new Map<string, number>();
    for (const i of semCustoItens) for (const f of i.faltas) if (motivos.includes(f.motivo)) peso.set(f.nome, (peso.get(f.nome) || 0) + i.valor);
    return [...peso.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  };

  const faltaCobertura = cItensFora > 0 && coberturaFora < COBERTURA_MINIMA;
  const faltas: FaltaDoCmv[] = [];
  const pendencias: string[] = [];
  const avisos: string[] = [];
  const motivosCurtos: string[] = [];

  // ── O que falta nos itens (fontes 2 e 3) ─────────────────────────────────
  const insumos = nomesDo(["INSUMO_SEM_CUSTO"]);
  if (insumos.length) {
    motivosCurtos.push("insumo sem compra lançada");
    faltas.push({
      chave: "COMPRAS", bloqueia: faltaCobertura, href: "/store/estoque/compras", rotulo: "Lançar compras",
      texto: `${insumos.length === 1 ? "Insumo" : "Insumos"} da ficha técnica sem custo (nenhuma compra lançada): ${listaCurta(insumos)}. Lance a compra em Estoque › Compras — ou ponha o custo no cadastro do insumo.`,
    });
  }
  const semFicha = nomesDo(["SEM_FICHA", "OPCAO_SEM_FICHA"]);
  if (semFicha.length) {
    if (info?.usaFicha) {
      motivosCurtos.push("produto sem ficha técnica");
      faltas.push({
        chave: "FICHA", bloqueia: faltaCobertura, href: "/store/estoque", rotulo: "Fazer as fichas técnicas",
        texto: `${semFicha.length === 1 ? "Produto vendido" : "Produtos vendidos"} sem ficha técnica e sem custo: ${listaCurta(semFicha)}. Monte a ficha em Estoque › Fichas técnicas (ou digite o custo do produto no cardápio).`,
      });
    } else {
      motivosCurtos.push("produto sem custo");
      faltas.push({
        chave: "CUSTO_NO_PRODUTO", bloqueia: faltaCobertura, href: "/store/cardapio", rotulo: "Cadastrar custos no cardápio",
        texto: `${semFicha.length === 1 ? "Produto vendido" : "Produtos vendidos"} sem custo: ${listaCurta(semFicha)}. Digite quanto custa cada um no cardápio — ou monte a ficha técnica no Estoque.`,
      });
    }
  }
  const nomes = nomesDo(["NOME_NAO_CASA"]);
  if (nomes.length) {
    motivosCurtos.push("nome do app que não existe no cardápio");
    faltas.push({
      chave: "NOME_DO_APP", bloqueia: faltaCobertura, href: "/store/cardapio", rotulo: "Abrir o cardápio",
      texto: `${nomes.length === 1 ? "Item vendido" : "Itens vendidos"} com nome que não existe no cardápio: ${listaCurta(nomes.map((n) => `“${n}”`))}. O custo vem do produto de MESMO nome: deixe o nome igual no app e no cardápio.`,
    });
  }

  // ── A contagem (fonte 1) ─────────────────────────────────────────────────
  const semana = info?.semana;
  const nomeDoDia = semana ? DIAS_DA_SEMANA[semana.diaDaContagem] : "semana";
  const semanaDoCmv = semana ? `de ${DIAS_DA_SEMANA[semana.comecaEm]} a ${DIAS_DA_SEMANA[semana.fecha]}` : "";
  if (info?.usaEstoque && !trecho) {
    const texto = !real || real.contagens === 0
      ? `Ainda não há contagem do estoque fechada. Com a contagem completa toda ${nomeDoDia}, o CMV sai real — o que de fato saiu do estoque —, sem depender de ficha nem de custo digitado.`
      : real.falta === "SO_UMA_CONTAGEM" && real.abertura
        ? `A contagem completa de ${diaCurto(real.abertura)} abre o período; falta a próxima (toda ${nomeDoDia}) para o CMV real fechar.`
        : `Nenhuma contagem completa cobre este período${real.ultimaCompleta ? ` (a última foi em ${diaCurto(real.ultimaCompleta)})` : ""}. Com duas contagens completas dentro dele, o CMV sai real.`;
    faltas.push({ chave: "CONTAGEM", bloqueia: false, href: "/store/estoque/contagem", rotulo: "Contar o estoque", texto });
  }
  if (trecho && cItensFora > 0) {
    avisos.push(`o CMV real cobre de ${diaCurto(trecho.de)} a ${diaCurto(trecho.ate)} (entre as contagens completas do período); os outros dias vão pela ficha técnica ou pelo custo do produto${semanaDoCmv ? ` — para o período inteiro sair da contagem, escolha a semana do CMV (${semanaDoCmv})` : ""}`);
  }
  if (trecho && real && real.semCustoNaContagem.length) {
    const n = real.semCustoNaContagem.length;
    pendencias.push(`${n} ${n === 1 ? "insumo contado" : "insumos contados"} sem custo na contagem do estoque (entram com R$ 0 no CMV real)`);
    faltas.push({
      chave: "CONTAGEM_SEM_CUSTO", bloqueia: true, href: "/store/estoque/compras", rotulo: "Lançar compras",
      texto: `Na contagem, ${n === 1 ? "este insumo foi contado" : "estes insumos foram contados"} sem custo e ${n === 1 ? "entrou" : "entraram"} com R$ 0: ${listaCurta(real.semCustoNaContagem)}. Lance a compra deles (ou o custo no cadastro do insumo) e feche a contagem de novo.`,
    });
  }
  if (trecho && trecho.cmv < 0) {
    pendencias.push("o CMV pela contagem deu negativo (o estoque final vale mais que o inicial mais as compras): quase sempre é compra que entrou sem ser lançada, ou contagem com quantidade errada");
  }
  if (info?.erro) pendencias.push("o custo dos produtos (contagem do estoque, fichas técnicas e custo digitado) não pôde ser lido agora — recarregue a página");

  if (faltaCobertura) {
    const p = Math.round((1 - coberturaFora) * 100);
    const porque = motivosCurtos.length ? ` (${listaPt(motivosCurtos)})` : info ? "" : " cadastrado";
    pendencias.unshift(trecho
      ? `nos dias fora da contagem do estoque, ${p}% do valor dos itens vendidos está sem custo${porque}`
      : `${p}% do valor dos itens vendidos está sem custo${porque}`);
  }

  // ── De onde veio ─────────────────────────────────────────────────────────
  const cCadastro = cCustoFora - cCustoFicha;
  const cItensCadastro = cComCustoFora - cItensFicha;
  const restoTem = [cItensFicha > 0 ? "pela ficha técnica e o custo das compras" : "", cItensCadastro > 0 ? "pelo custo cadastrado no produto" : ""].filter(Boolean);
  let fonte: FonteDoCmv;
  let titulo: string;
  if (trecho) {
    fonte = cItensFora > 0 ? "CONTAGEM_E_FICHA" : "CONTAGEM";
    titulo = `CMV real pela contagem do estoque de ${diaCurto(trecho.de)} a ${diaCurto(trecho.ate)}`
      + (cItensFora > 0 ? `; nos outros dias, ${restoTem.length ? listaPt(restoTem) : "sem custo"}` : "");
  } else if (cItensFicha > 0) {
    fonte = "FICHA";
    titulo = `CMV ${listaPt(restoTem)}`;
  } else if (cComCustoFora > 0) {
    fonte = "CADASTRO";
    titulo = "CMV pelo custo cadastrado no produto";
  } else {
    fonte = "NENHUMA";
    titulo = "Sem custo: nenhuma contagem do estoque, ficha técnica ou custo cadastrado cobre os itens vendidos";
  }

  const detalhe: CmvDoDRE = {
    fonte,
    titulo,
    real: trecho ? {
      de: trecho.de, ate: trecho.ate, abertura: somarDias(trecho.de, -1),
      estoqueInicial: trecho.estoqueInicial, compras: trecho.compras, estoqueFinal: trecho.estoqueFinal, cmv: trecho.cmv,
      vendas: reais(cVendasReal),
      pct: cVendasReal > 0 ? Math.round((cReal / cVendasReal) * 1000) / 10 : null,
    } : null,
    ficha: { custo: reais(cCustoFicha), itens: reais(cItensFicha) },
    cadastro: { custo: reais(cCadastro), itens: reais(cItensCadastro) },
    itensFora: reais(cItensFora),
    coberturaFora,
    semCusto: { valor: reais(cItensFora - cComCustoFora), itens: semCustoItens },
    desperdicio: {
      cancelados: { valor: reais(cDespCancelados), pedidos: pedidosDesp, semCusto: reais(cDespSemCusto), noCmv: reais(cCanceladosNoCmv) },
      lancado: { valor: reais(cDespLancado), noCmv: reais(cLancadoNoCmv) },
      naContagem: reais(cDespNaContagem),
    },
    faltas,
    completo: !faltaCobertura && !(trecho && real && real.semCustoNaContagem.length) && !(trecho && trecho.cmv < 0) && !info?.erro,
  };
  return { detalhe, cCmv: cReal + cCustoFora + cCanceladosNoCmv + cLancadoNoCmv, cComCusto: cItensReal + cComCustoFora, pendencias, avisos };
}

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
  let cValor = 0, cFrete = 0, cFreteApp = 0, cCupomApp = 0, cTaxaApp = 0, nTaxaApp = 0;
  let cItens = 0;
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
    if (p.taxaDoApp > 0) { cTaxaApp += cent(p.taxaDoApp); nTaxaApp++; }
    cItens += cent(p.itens);

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
  const receitaDaLoja = reais(cValor - cFreteApp - cTaxaApp - cent(descontoNaMesa) + cCupomApp);

  // ── CMV (contagem → ficha técnica → custo do produto; ver cmvDoPeriodo) ─
  const doCmv = cmvDoPeriodo(validos, dados);
  const cmv = reais(doCmv.cCmv);
  const cobertura = cItens > 0 ? doCmv.cComCusto / cItens : 1;
  const lucroBruto = reais(cent(receitaDaLoja) - doCmv.cCmv);

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
  pendencias.push(...doCmv.pendencias);
  avisos.push(...doCmv.avisos);
  const semComissao = comissoes.filter((c) => c.pct === null).map((c) => c.nome);
  if (semComissao.length > 0) pendencias.push(`comissão ${semComissao.length === 1 ? "do" : "dos apps"} ${listaPt(semComissao)} não configurada`);
  const semTaxa = taxas.filter((t) => !t.configurada).map((t) => t.rotulo.toLowerCase());
  if (semTaxa.length > 0) pendencias.push(`taxa da maquininha não cadastrada (${listaPt(semTaxa)})`);
  if (entregadores.erro) pendencias.push("o custo dos entregadores não pôde ser apurado");
  if (dados.mesas.erro) pendencias.push("as mesas fechadas não puderam ser lidas (desconto no fechamento e pagamento das mesas)");
  if (entregasSemEntregador > 0) {
    const fracao = entregasDaLoja > 0 ? entregasSemEntregador / entregasDaLoja : 0;
    const frase = `${entregasSemEntregador} ${entregasSemEntregador === 1 ? "entrega da loja ficou" : "entregas da loja ficaram"} sem entregador atribuído — o custo delas não entra aqui`;
    if (fracao > ENTREGAS_SEM_ENTREGADOR_MAXIMO) pendencias.push(frase);
    else avisos.push(frase);
  }
  if (entregadores.semDistancia > 0) {
    avisos.push(`${entregadores.semDistancia} ${entregadores.semDistancia === 1 ? "corrida paga" : "corridas pagas"} por distância sem distância medida entraram como R$ 0,00 (como no fechamento dos motoboys)`);
  }
  if (mesesDaMensalidade.some((m) => m.situacao === "projetado")) {
    avisos.push("a mensalidade do mês em andamento é projetada para o mês inteiro pelo ritmo de vendas até agora (o valor final sai no fechamento) e entra pelos dias do período");
  }
  if (mesesDaMensalidade.some((m) => m.situacao === "previsto")) {
    avisos.push("o mês que acabou ainda não foi fechado: a mensalidade dele é a conta do fechamento refeita agora");
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
    taxaDoApp: reais(cTaxaApp),
    pedidosComTaxaDoApp: nTaxaApp,
    cupomDoApp: reais(cCupomApp),
    descontoNaMesa,
    mesasComDesconto: dados.mesas.mesasComDesconto,
    receitaDaLoja,
    cmv,
    valorDosItens: reais(cItens),
    valorDosItensComCusto: reais(doCmv.cComCusto),
    cobertura,
    cmvDetalhe: doCmv.detalhe,
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

// ── MENSALIDADE DO MÊS EM ANDAMENTO ────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A mensalidade do MÊS EM ANDAMENTO projetada para o mês inteiro pelo ritmo
 * de vendas até agora, para o DRE ratear por dia do mesmo jeito que faz com o
 * mês fechado (o boleto inteiro × dias do período ÷ dias do mês).
 *
 * A previsão da aba Mensalidade é "até agora" — a porcentagem das vendas que
 * já aconteceram. Ratear ESSA previsão pelos dias do mês dividia duas vezes:
 * Brazza, 11/10/2026, R$ 162,65 de previsão + R$ 100 de lojas extras, e o
 * "Este mês" do DRE mostrava R$ 93,20 de mensalidade em vez de ~R$ 177.
 *
 * O ritmo conta do começo da base (fim do teste ou dia 1) até agora, com no
 * mínimo um dia. Em outubro/2026 a parte a 1% (01 a 03/10) já está completa
 * e não se projeta; projeta-se só o que corre a 2%. Mínimo e teto valem sobre
 * o mês projetado (calcMensalidade). Nunca abaixo da previsão até agora.
 */
export function projetarMensalidadeDoMes(e: {
  yearMonth: string;
  /** Vendas na base até agora (o `totalSales` da visão do ciclo). */
  vendas: number;
  /** A parte delas cobrada a 1% (antes de 04/10/2026). */
  vendasA1PorCento: number;
  /** Começo da base: fim do teste no meio do mês, ou o começo do mês. */
  desde: Date;
  /** Fim do mês (instante, lib/billing.ts intervaloDoMes). */
  fimDoMes: Date;
  agora: Date;
  /** O mínimo por uso do sistema sem venda (cobrancaPorUso.valor), ou 0. */
  minimoPorUso: number;
  /** A previsão até agora (mensalidadePrevista): o piso. */
  previstaAteAgora: number;
}): number {
  const a1 = Math.max(0, Math.min(e.vendasA1PorCento, e.vendas));
  const aParteA1Acabou = a1 > 0 && e.agora > VIRADA_DOS_2_POR_CENTO && VIRADA_DOS_2_POR_CENTO > e.desde;
  const inicioDoRitmo = aParteA1Acabou ? VIRADA_DOS_2_POR_CENTO : e.desde;
  const noRitmo = aParteA1Acabou ? e.vendas - a1 : e.vendas;
  const decorrido = Math.max(DIA_MS, e.agora.getTime() - inicioDoRitmo.getTime());
  const restanteTotal = Math.max(decorrido, e.fimDoMes.getTime() - inicioDoRitmo.getTime());
  const projetado = (aParteA1Acabou ? a1 : 0) + noRitmo * (restanteTotal / decorrido);
  const doMes = projetado > 0 ? calcMensalidade(projetado, true, e.yearMonth, a1).mensalidade : Math.max(0, e.minimoPorUso);
  return Math.max(e.previstaAteAgora, Math.round(doMes * 100) / 100);
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
