/**
 * O relatório "Vendas por forma de pagamento" — o da Saipos, com a régua do
 * FECHAMENTO DE CAIXA.
 *
 * ── Por que não é agrupar o texto do pagamento ──────────────────────────────
 *
 * O painel antigo (/store/relatorios/painel) fazia `paymentMethod || "Outros"`
 * e desenhava uma fatia por texto. Medido na NIK de 17 a 23/09/2026: o dinheiro
 * pago no app do iFood chegava com sete textos diferentes ("Crédito (Pago
 * Online)", "Pix (Pago Online)", "iFood App (Pago Online)", "Cartão (Pago
 * Online)"…) e virava sete fatias; o crédito do balcão, o da Wabiz ("Cartão Elo
 * Credito (Cobrar na Entrega)") e o do iFood na porta eram três fatias de
 * "crédito" que ninguém somava; e a mesa aparecia como "N/A", porque o pedido
 * de mesa nunca recebe a forma — ela é gravada na CONTA da mesa.
 *
 * "Forma de pagamento" no FireHub é texto livre de seis origens. Quem já sabe
 * ler esse texto é o fechamento de caixa (lib/esperado-do-turno.ts): é a conta
 * que o operador confere contra a gaveta e o extrato da maquininha todo dia, e
 * cada caso esquisito já custou uma diferença de caixa e virou uma linha lá.
 * Este relatório usa a MESMA cascata, na mesma ordem — para "Crédito: R$ X"
 * aqui ser o mesmo crédito que o caixa cobrou.
 *
 * ── As diferenças para o caixa, de propósito ───────────────────────────────
 *
 * A cascata do caixa mora dentro de uma função com banco (não dá para importar
 * pura), então está repetida aqui, linha a linha, com quatro correções que o
 * caixa ainda não tem:
 *
 * 1. "Cartão Deb Master (Cobrar na Entrega)" — como a Wabiz grava o débito da
 *    Mastercard — não tem "débito" por extenso, cai no "cartão genérico" do
 *    caixa e vira CRÉDITO. Na NIK foram 5 pedidos, R$ 352,44, em 17–23/09/2026.
 *    Aqui, antes de desistir para o cartão genérico, o texto passa por
 *    `formaCanonica` (lib/pagamento-na-entrega.ts, a régua da troca de
 *    pagamento), que reconhece "Deb", "espécie", "refeição", "card".
 * 2. "Fiado"/"Conta funcionário" numa parte de pagamento dividido ou numa
 *    baixa de mesa vira FIADO, não "não identificado".
 * 3. Pedido do iFood gravado "CASH" (o código cru do iFood para dinheiro na
 *    porta) é DINHEIRO. O caixa só reconhece "dinheiro" por extenso nesse
 *    ramo e o leva para "pago online" — o dinheiro some da gaveta (1 pedido,
 *    R$ 5,89, nos 90 dias até 24/09/2026, em todas as lojas).
 * 4. O troco da mesa sai do dinheiro (ver "Mesa", abaixo).
 *
 * Mudou a cascata do caixa, mude aqui (e o teste scripts/teste-formas-de-
 * pagamento.ts diz o que cada texto real vira).
 *
 * ── Mesa ────────────────────────────────────────────────────────────────────
 *
 * O pedido lançado numa conta de mesa (tableSessionId) grava "N/A": a forma
 * real está nas baixas da SESSÃO (TableSession.paymentMethods), junto com a
 * taxa de serviço e a gorjeta, que não existem em pedido nenhum. Então, como no
 * caixa: o pagamento da mesa entra pelas baixas das contas FECHADAS no período
 * (pelo `closedAt` — a mesa aberta às 23h e paga à 0h30 é dinheiro de quando
 * pagou), e o pedido de mesa NÃO entra como pagamento. Contar os dois seria
 * contar a mesma pizza duas vezes.
 *
 * O pedido de mesa continua no "Total das vendas", que segue a régua única de
 * lib/relatorios/regua-da-venda.ts: valor = Σ dos pedidos que são venda (a
 * mesa pelo lançado, aberta ou fechada) e vendas = atendimentos (a mesa conta
 * UMA vez). É o mesmo "valor vendido" e o mesmo número de vendas do Vendas por
 * período, do Faturamento por dia e do Dia e hora — até 24/09/2026 este cartão
 * dizia "635 pedidos" onde o Faturamento dizia 495 vendas (Pastel da
 * Paulista, 09–16/09). Os PAGAMENTOS continuam das baixas reais, porque é
 * disso que este relatório trata. A diferença entre as duas somas é explicada
 * linha a linha em `diferenca`: taxa de serviço, gorjeta, o pago a mais no
 * cartão/Pix, desconto dado no fechamento, a conta fechada a menos sem ser
 * desconto, a mesa que abriu num período e fechou noutro e a que fechou fora
 * da faixa de horário. Taxa, gorjeta e desconto no fechamento saem da régua
 * (servicoDasMesas, descontoNoFechamento): na ponte, são os mesmos números do
 * Vendas por período e do Faturamento por dia.
 *
 * A tabela conta CONTAS pagas (o pedido, ou a conta da mesa no dia em que
 * fechou) e a média por conta — não "vendas" nem "ticket médio", que são as
 * palavras da régua e aparecem só no cartão Total das vendas (ver LinhaDaForma).
 *
 * O TROCO. A baixa da mesa grava o que o cliente ENTREGOU, não o que devia: a
 * tela pede "Informe quanto foi recebido" e, quando passa da conta, mostra
 * "💵 Troco" para o garçom devolver (components/mesas/MesasApp.tsx); o
 * fechamento aceita a sobra (api/store/table-sessions/[id]/close). Somar a
 * baixa inteira contava como dinheiro recebido a nota de R$ 50 de uma conta de
 * R$ 13,90. Na Pastel da Paulista, 01–23/09/2026, eram ~R$ 298 de troco em 17
 * contas pagas só com nota redonda — 10% a mais de Dinheiro que a gaveta viu —
 * e a ponte ainda chamava esse troco de "sobra que ficou na loja".
 *
 * Então: o que a conta recebeu além de consumo + serviço + gorjeta é troco e
 * sai do DINHEIRO daquela conta (o troco sai da gaveta), da maior nota para a
 * menor, até o que ela pagou em dinheiro. Só o que passar disso — pago a mais
 * no cartão ou no Pix, onde não há troco em dinheiro a devolver — fica na ponte.
 * O troco devolvido aparece à parte em `mesas.troco`, para o lojista que soma
 * as baixas cruas saber por que o Dinheiro deu menos. O troco não mexe no
 * total das VENDAS (que é a soma dos pedidos); só no dos pagamentos. Limite: o
 * desconto do fechamento não é gravado, e a conta com desconto E troco só
 * mostra o saldo — sai do dinheiro menos troco do que houve, nunca mais.
 *
 * Pedido com deliveryType "MESA" SEM sessão (o lançamento de mesa pelo PDV —
 * na NIK são todos assim) tem a forma gravada nele: é pedido como outro qualquer.
 *
 * ── Pago online × recebido na loja ──────────────────────────────────────────
 *
 * O pago no app (iFood, 99Food, Wabiz) ou no site não passa pela gaveta nem
 * pela maquininha: chega pelo repasse da plataforma ou do gateway. Fica num
 * grupo próprio, aberto por canal, com o cupom que a plataforma bancou ao lado
 * — o cupom não é pagamento do cliente, mas a plataforma o paga à loja.
 *
 * Puro: recebe pedidos e contas de mesa já buscados (a rota busca).
 */
import { lerPagamentos, emCentavos } from "@/lib/pagamentos-da-mesa";
import { formaCanonica } from "@/lib/pagamento-na-entrega";
import { cupomBancadoPelo99, ehDo99Food } from "@/lib/cupom-do-parceiro";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { STATUS_FORA_DA_VENDA, canalDoRelatorio, diasNoPeriodo, naLoja, somarDias } from "@/lib/relatorios/base";
import {
  atendimentosDaVenda, cent, descontoNoFechamento, servicoDasMesas, situacaoDoPedido, temValorImpossivel, ticketMedio,
  type ItemDaRegua, type MesaFechada,
} from "@/lib/relatorios/regua-da-venda";

// ── AS FORMAS ───────────────────────────────────────────────────────────────

export type ChaveDaForma = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VALE" | "ONLINE" | "FIADO" | "OUTROS";

/**
 * Onde o dinheiro está: na loja (o caixa confere), no repasse da plataforma, ou
 * em lugar nenhum ainda (fiado e forma que ninguém reconheceu).
 */
export type GrupoDaForma = "LOJA" | "ONLINE" | "SEM_DINHEIRO";

/**
 * Ordem fixa, a do fechamento de caixa. Ordenar pelo valor faria a linha do
 * Pix trocar de lugar de uma semana para outra, e o lojista que compara dois
 * períodos lado a lado procuraria a linha em vez de ler o número.
 */
export const FORMAS: { chave: ChaveDaForma; rotulo: string; grupo: GrupoDaForma }[] = [
  { chave: "DINHEIRO", rotulo: "Dinheiro", grupo: "LOJA" },
  { chave: "PIX", rotulo: "Pix", grupo: "LOJA" },
  { chave: "CREDITO", rotulo: "Crédito", grupo: "LOJA" },
  { chave: "DEBITO", rotulo: "Débito", grupo: "LOJA" },
  { chave: "VALE", rotulo: "Vale-refeição / Voucher", grupo: "LOJA" },
  { chave: "ONLINE", rotulo: "Pago online (app / site)", grupo: "ONLINE" },
  { chave: "FIADO", rotulo: "Fiado / Conta funcionário", grupo: "SEM_DINHEIRO" },
  { chave: "OUTROS", rotulo: "Outros / Não identificado", grupo: "SEM_DINHEIRO" },
];

export const GRUPOS: { chave: GrupoDaForma; rotulo: string; explicacao: string }[] = [
  { chave: "LOJA", rotulo: "Recebido na loja", explicacao: "Gaveta, maquininha e Pix da loja — o que o fechamento de caixa confere." },
  { chave: "ONLINE", rotulo: "Pago online", explicacao: "Pago no app do marketplace ou no site: chega pelo repasse da plataforma ou do gateway, não passa pelo caixa." },
  { chave: "SEM_DINHEIRO", rotulo: "Sem dinheiro no dia", explicacao: "Fiado (acertado depois) e forma que o sistema não reconheceu — ninguém recebeu na hora." },
];

const ROTULO_DA_FORMA = new Map(FORMAS.map((f) => [f.chave, f.rotulo]));
export const rotuloDaForma = (chave: ChaveDaForma) => ROTULO_DA_FORMA.get(chave) || chave;

const CANAIS = new Map(canaisConhecidos().map((c) => [c.chave as string, c]));
/** "Online" é o nome do site no selo; ao lado de "Pago online" ele não diz nada. */
export const nomeDoCanal = (chave: string) => (chave === "SITE" ? "Site próprio" : CANAIS.get(chave)?.nome || chave);

// ── A CASCATA DO CAIXA ──────────────────────────────────────────────────────

const DA_FORMA_CANONICA: Record<string, ChaveDaForma> = {
  "Dinheiro": "DINHEIRO",
  "Cartão Débito": "DEBITO",
  "Cartão Crédito": "CREDITO",
  "Pix": "PIX",
  "Vale-refeição": "VALE",
};

/**
 * A forma de um texto de pagamento feito NA LOJA: uma parte do pagamento
 * dividido, uma baixa de mesa, ou o pedido que não foi pago online.
 *
 * A ordem é a do fechamento de caixa (esperado-do-turno.ts: `somarParte`, o
 * laço das mesas e a cascata do pedido): um texto com duas formas ("Crédito +
 * Débito") cai na primeira da ordem — débito, lá e aqui. As duas correções
 * estão no cabeçalho deste arquivo.
 */
export function formaDoTexto(texto: string | null | undefined): ChaveDaForma {
  const m = String(texto || "").toLowerCase();
  if (!m.trim()) return "OUTROS";
  if (m.includes("funcion") || m.includes("fiado")) return "FIADO";
  if (m.includes("dinheiro") || m.includes("cash")) return "DINHEIRO";
  if (m.includes("débito") || m.includes("debito") || m.includes("debit")) return "DEBITO";
  if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) return "CREDITO";
  if (m.includes("pix")) return "PIX";
  if (m.includes("voucher") || m.includes("vale") || m.includes("meal") || m.includes("food")) return "VALE";
  // Onde o caixa jogaria "cartão/maquininha" direto no crédito, a régua da
  // troca de pagamento lê antes o "Deb" abreviado da Wabiz. Ela mesma termina
  // em cartão/maquininha → crédito, que é o destino do caixa: o Mercado Pago
  // Point não devolve o tipo do cartão, e crédito é onde a maioria cai.
  const canonica = formaCanonica(m);
  if (canonica) return DA_FORMA_CANONICA[canonica] || "OUTROS";
  // "A combinar (Cobrar na Entrega)", "Pendente", "N/A", o rótulo que a
  // próxima integração inventar: fica visível numa linha própria, nunca some
  // dentro do dinheiro (era o que o caixa fazia até 28/08/2026).
  return "OUTROS";
}

/** O que a cascata do pedido lê. */
export type PedidoParaForma = {
  paymentMethod?: string | null;
  source?: string | null;
  paymentPaidAt?: Date | string | null;
  gatewayProvider?: string | null;
  openDeliveryChannel?: string | null;
};

/**
 * Foi pago no app ou no site? A leitura de `isOnlinePayment` do caixa, com
 * uma correção: o pedido do iFood gravado "CASH" (o código cru do iFood para
 * dinheiro na porta) não é online. O ramo do iFood diz "sem forma de entrega
 * no texto → pago no app", e só conhecia "dinheiro" por extenso — enquanto a
 * própria cascata (`formaDoTexto`, e o caixa) já lê "cash" como dinheiro.
 * Dinheiro não se paga no app. "Credit"/"debit" em inglês ficam como estão:
 * o iFood também usa esses códigos no pré-pago, e aí o texto não decide.
 */
export function foiPagoOnline(p: PedidoParaForma): boolean {
  const pm = String(p.paymentMethod || "").toLowerCase();
  const src = String(p.source || "").toUpperCase();
  // Totem e PDV são venda de salão: o cartão passa na maquininha DA LOJA, e o
  // carimbo de pago (paymentPaidAt) não diz por onde o dinheiro entrou.
  const ehVendaDeSalao = src === "PDV" || src === "TOTEM";
  const online =
    pm.includes("online") ||
    pm.includes("prepaid") ||
    pm.includes("ifood") ||
    pm.includes("pago_online") ||
    (!ehVendaDeSalao && Boolean(p.paymentPaidAt || p.gatewayProvider)) ||
    (src === "IFOOD" && !pm.includes("dinheiro") && !pm.includes("cash") && !pm.includes("debito") && !pm.includes("débito") &&
      !pm.includes("credito") && !pm.includes("crédito") && !pm.includes("maquininha") && !pm.includes("cobrar"));
  if (!online) return false;
  // Os três ramos do caixa (99Food online, iFood online, online fora do salão)
  // se resumem nisto: online vale, menos na venda de salão.
  return ehDo99Food(p) || src === "IFOOD" || !ehVendaDeSalao;
}

/** A forma do pedido de UMA forma só (sem divisão e sem mesa). */
export function formaDoPedido(p: PedidoParaForma): ChaveDaForma {
  if (foiPagoOnline(p)) return "ONLINE";
  return formaDoTexto(p.paymentMethod);
}

// ── CUPOM DA PLATAFORMA ─────────────────────────────────────────────────────

export type PedidoComCupom = PedidoParaForma & {
  discountIfood?: number | null;
  discountTotal?: number | null;
  discountMerchant?: number | null;
  notes?: string | null;
  discountDetails?: unknown;
};

const CUPOM_NAS_OBSERVACOES = /(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i;

/** O cupom pelos campos numéricos: iFood (e 99Food desde 17/09/2026) e o total menos a loja. */
export function cupomPelosCampos(p: PedidoComCupom): number {
  if ((p.discountIfood || 0) > 0) return Number(p.discountIfood);
  if (p.discountTotal && p.discountMerchant && p.discountTotal > p.discountMerchant) return p.discountTotal - p.discountMerchant;
  return 0;
}

/**
 * Quanto a PLATAFORMA bancou de desconto no pedido — a conta `channelDisc` do
 * caixa, com o 99Food antigo pelas promoções (lib/cupom-do-parceiro.ts).
 * Só informação: não é pagamento do cliente, mas a plataforma paga à loja.
 */
export function cupomDaPlataforma(p: PedidoComCupom): number {
  let v = cupomPelosCampos(p);
  if (!v) {
    const achado = String(p.notes || "").match(CUPOM_NAS_OBSERVACOES)?.[1];
    if (achado) v = parseFloat(achado.replace(",", "."));
  }
  if (ehDo99Food(p) && !v) v = cupomBancadoPelo99(p as any);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * A rota só busca as observações e o detalhe do desconto (texto e JSON, os
 * campos pesados — o detalhe do 99Food traz o preço cru inteiro) dos pedidos
 * que podem precisar deles: marketplace sem cupom nos campos numéricos. O
 * caixa lê as observações de todo pedido; aqui o balcão e o site ficam de fora,
 * porque "iFood: R$" na observação de uma venda própria não é cupom de ninguém.
 */
export function precisaDoDetalheDoCupom(p: PedidoComCupom & { status?: string | null; tableSessionId?: string | null; paymentMethods?: unknown; ifoodOrderId?: string | null }): boolean {
  if (p.tableSessionId || STATUS_FORA_DA_VENDA.includes(String(p.status || ""))) return false;
  if (lerPagamentos(p.paymentMethods).length > 0) return false;
  if (cupomPelosCampos(p) > 0) return false;
  const canal = canalDoRelatorio(p as any);
  return Boolean(CANAIS.get(canal)?.ehMarketplace);
}

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

/**
 * As colunas do pedido que a rota busca, além das dos filtros. Os ITENS (só
 * preço e quantidade) estão aqui por causa da trava do valor impossível
 * (regua-da-venda.ts, `temValorImpossivel`): sem eles ela só olha o total, e um
 * pedido com item de R$ 2 milhões e total gravado de R$ 50 saía do valor e das
 * vendas do Vendas por período, do Faturamento e do Dia e hora, mas ficava no
 * "Total das vendas" daqui (revisão de 24/09/2026 — este era o único dos
 * quatro que não buscava os itens).
 */
export const COLUNAS_DO_PEDIDO = {
  paymentMethod: true, paymentMethods: true, paymentPaidAt: true, gatewayProvider: true,
  discountIfood: true, discountTotal: true, discountMerchant: true, parentOrderId: true,
  items: { select: { quantity: true, price: true } },
} as const;

export type PedidoParaFormas = PedidoComCupom & {
  id: string;
  createdAt: Date | string;
  status: string;
  totalAmount: number;
  /** Pagamento dividido: [{ method, amount }] (lib/pagamento-dividido.ts). */
  paymentMethods?: unknown;
  tableSessionId?: string | null;
  /** O acréscimo: não é venda nova quando o pai está no período (a régua única). */
  parentOrderId?: string | null;
  deliveryType?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  totemLicenseId?: string | null;
  /** Preço e quantidade (COLUNAS_DO_PEDIDO): a trava do valor impossível olha os itens também. */
  items?: ItemDaRegua[] | null;
};

/** Uma conta de mesa FECHADA no período, com todos os pedidos dela (de qualquer dia). */
export type MesaParaFormas = {
  id: string;
  fechadaEm: Date | string;
  totalPago: number | null;
  taxaDeServico: number | null;
  gorjeta: number | null;
  /** TableSession.paymentMethods, cru. */
  pagamentos: unknown;
  /** `discountTotal`: o pedido que já traz desconto zera o desconto da conta (`descontoNoFechamento`). */
  pedidos: { id: string; totalAmount: number; status: string; discountTotal?: number | null }[];
};

/** A conta vista pela régua única, para o serviço, a gorjeta e o desconto saírem da MESMA conta do Vendas por período. */
const mesaDaRegua = (m: MesaParaFormas): MesaFechada => ({
  id: m.id, serviceFee: m.taxaDeServico, waiterTip: m.gorjeta, fechadaEm: m.fechadaEm, pago: m.totalPago, pedidos: m.pedidos,
});

/**
 * A conta de um pedido de mesa do recorte que NÃO está entre as contas
 * fechadas do recorte — para a ponte dizer por quê. Sem isto, todo pedido
 * assim era "mesa ainda aberta"; com faixa de horário, a maioria era conta já
 * paga, que só fechou fora da faixa (Pastel da Paulista, 01–15/09/2026,
 * 12h–19h: R$ 3.495,65 de "mesa aberta" numa loja sem nenhuma mesa aberta).
 */
export type SituacaoDaMesa = { id: string; status: string; fechadaEm: Date | string | null };

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type LinhaDeDetalhe = { chave: string; rotulo: string; pagamentos: number; valor: number; pct: number };

/**
 * CONTAS, não "vendas": a tabela conta em quantas contas pagas (o pedido, ou a
 * conta da mesa pelo dia em que FECHOU) a forma apareceu, e a média é o que
 * cada conta pagou nela. "Vendas" e "ticket médio" são palavras da régua única
 * (regua-da-venda.ts: vendas = atendimentos, ticket = valor vendido ÷ vendas),
 * e o número daqui é outro — a mesa entra pelo fechamento, a cortesia de R$ 0
 * não tem pagamento, a mesa aberta ainda não pagou. Com a mesma palavra na
 * mesma tela, a Pastel da Paulista em 11/09/2026 via "97 pagamentos em 92
 * vendas" e ticket de R$ 68,70 na tabela, e "93 vendas" com ticket de
 * R$ 66,17 no cartão Total das vendas e nos outros três relatórios.
 */
export type LinhaDaForma = {
  chave: ChaveDaForma;
  rotulo: string;
  grupo: GrupoDaForma;
  /** Quantas partes de pagamento (o dividido em crédito + débito conta uma em cada). */
  pagamentos: number;
  /** Em quantas contas pagas (pedido ou conta de mesa) a forma apareceu. */
  contas: number;
  valor: number;
  /** Do total dos pagamentos, 0 a 100. */
  pct: number;
  /**
   * Valor ÷ CONTAS: quanto cada conta pagou nesta forma, em média. Por
   * pagamento, a mesa de R$ 100 paga em 4 baixas de R$ 25 dava R$ 25 — e na
   * planilha a coluna fica ao lado de "Contas pagas".
   */
  mediaPorConta: number;
  /** Alinhado com `dias`. */
  porDia: number[];
  /** De qual canal veio — no pago online é o que diz de qual repasse. */
  porCanal: LinhaDeDetalhe[];
  /** Como veio escrito, para o lojista ver o que foi somado junto. */
  textos: LinhaDeDetalhe[];
};

export type LinhaDaDiferenca = { chave: string; rotulo: string; valor: number; quantidade: number; explicacao: string };

export type ResultadoDasFormas = {
  dias: string[];
  formas: LinhaDaForma[];
  /** `contas` = pedidos e contas de mesa distintos: o dividido em crédito + débito é uma conta no grupo. */
  grupos: { chave: GrupoDaForma; rotulo: string; explicacao: string; pagamentos: number; contas: number; valor: number; pct: number; mediaPorConta: number }[];
  total: { pagamentos: number; contas: number; valor: number; mediaPorConta: number; porDia: number[] };
  /**
   * A régua única de venda (lib/relatorios/regua-da-venda.ts): `valor` = Σ dos
   * pedidos que são venda, mesa incluída; `atendimentos` = as vendas (a mesa
   * uma vez), das quais `mesas` são contas de mesa; `pedidos` = lançamentos;
   * `ticketMedio` = valor ÷ vendas — os números dos outros três relatórios.
   */
  vendas: { atendimentos: number; mesas: number; pedidos: number; valor: number; ticketMedio: number };
  /**
   * `valor` já sem o troco; `troco` é o que saiu do Dinheiro das contas (ver o
   * cabeçalho). `taxaDeServico` e `gorjeta` são as da régua (servicoDasMesas):
   * a soma crua, a mesma do Vendas por período e do Faturamento por dia.
   */
  mesas: { fechadas: number; valor: number; taxaDeServico: number; gorjeta: number; troco: { contas: number; valor: number } };
  /** Total dos pagamentos − total das vendas, explicado. */
  diferenca: { valor: number; linhas: LinhaDaDiferenca[] };
  cupomDaPlataforma: { pedidos: number; valor: number; porCanal: LinhaDeDetalhe[] };
  /**
   * `valoresImpossiveis`: pedidos de R$ 1 milhão ou mais, fora de toda soma.
   * O #112 da Pastel da Paulista (cancelado, R$ 1e17) entrava no "Cancelados
   * (não entram)" daqui com 18 dígitos.
   */
  foraDaVenda: { cancelados: { pedidos: number; valor: number }; aguardandoPagamento: { pedidos: number; valor: number }; valoresImpossiveis: number };
};

// ── A CONTA ─────────────────────────────────────────────────────────────────

const reais = (c: number) => Math.round(c) / 100;
const pctDe = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : 0);
/** "Cartão  Crédito (Cobrar na Entrega) " → "Cartão Crédito (Cobrar na Entrega)" — só para agrupar. */
const textoLimpo = (t: string | null | undefined) => String(t || "").replace(/\s+/g, " ").trim() || "(sem forma gravada)";

type Acumulado = { pagamentos: number; centavos: number };
const somar = (mapa: Map<string, Acumulado>, chave: string, centavos: number) => {
  const a = mapa.get(chave) || { pagamentos: 0, centavos: 0 };
  a.pagamentos += 1;
  a.centavos += centavos;
  mapa.set(chave, a);
};
const detalhes = (mapa: Map<string, Acumulado>, rotulo: (k: string) => string, todo: number, limite = 30): LinhaDeDetalhe[] =>
  [...mapa.entries()]
    .map(([chave, a]) => ({ chave, rotulo: rotulo(chave), pagamentos: a.pagamentos, valor: reais(a.centavos), pct: pctDe(a.centavos, todo) }))
    .sort((a, b) => b.valor - a.valor || b.pagamentos - a.pagamentos)
    .slice(0, limite);

/**
 * As partes de pagamento de um pedido que não é de mesa: as do dividido, cada
 * uma na sua forma, ou o pedido inteiro numa forma só. Pedido de R$ 0 (cortesia)
 * é venda, não pagamento.
 */
export function pagamentosDoPedido(p: PedidoParaFormas): { forma: ChaveDaForma; centavos: number; texto: string }[] {
  const partes = lerPagamentos(p.paymentMethods);
  if (partes.length > 0) return partes.map((x) => ({ forma: formaDoTexto(x.method), centavos: emCentavos(x.amount), texto: textoLimpo(x.method) }));
  const centavos = emCentavos(p.totalAmount);
  if (centavos <= 0) return [];
  return [{ forma: formaDoPedido(p), centavos, texto: textoLimpo(p.paymentMethod) }];
}

export function formasDePagamento(
  pedidos: PedidoParaFormas[],
  mesas: MesaParaFormas[],
  periodo: { de: string; ate: string; tz: string | null | undefined },
  situacaoDasMesas: SituacaoDaMesa[] = [],
): ResultadoDasFormas {
  const n = Math.max(1, diasNoPeriodo(periodo.de, periodo.ate));
  const dias = Array.from({ length: n }, (_, i) => somarDias(periodo.de, i));
  const indiceDoDia = new Map(dias.map((d, i) => [d, i]));

  type Soma = { pagamentos: number; centavos: number; contas: Set<string>; porDia: number[]; porCanal: Map<string, Acumulado>; textos: Map<string, Acumulado> };
  const soma = new Map<ChaveDaForma, Soma>(FORMAS.map((f) => [f.chave, {
    pagamentos: 0, centavos: 0, contas: new Set<string>(), porDia: new Array(n).fill(0), porCanal: new Map(), textos: new Map(),
  }]));
  const totalPorDia = new Array(n).fill(0);

  const registrar = (forma: ChaveDaForma, centavos: number, conta: string, dia: string, canal: string, texto: string) => {
    const s = soma.get(forma)!;
    s.pagamentos += 1;
    s.centavos += centavos;
    s.contas.add(conta);
    const i = indiceDoDia.get(dia);
    if (i !== undefined) { s.porDia[i] += centavos; totalPorDia[i] += centavos; }
    somar(s.porCanal, canal, centavos);
    somar(s.textos, texto, centavos);
  };

  const vendas = { pedidos: 0, centavos: 0 };
  const cancelados = { pedidos: 0, centavos: 0 };
  const aguardando = { pedidos: 0, centavos: 0 };
  let impossiveis = 0;
  const cupom = { pedidos: 0, centavos: 0, porCanal: new Map<string, Acumulado>() };
  let arredondamentoDoDividido = 0;
  let divididosComDiferenca = 0;
  /** Pedidos de mesa DESTE relatório (na régua), para a ponte com as contas. */
  const pedidosDeMesa = new Map<string, { centavos: number; sessao: string }>();
  // As vendas (atendimentos) pela régua única: a mesa conta uma vez.
  const at = atendimentosDaVenda(pedidos);

  for (const p of pedidos) {
    const status = String(p.status || "").toUpperCase();
    // Valor impossível (≥ R$ 1 milhão) fica fora de toda soma, até da dos cancelados.
    if (temValorImpossivel(p)) { impossiveis++; continue; }
    const situacao = situacaoDoPedido(status);
    if (situacao !== "venda") {
      // Cancelado e pedido do totem sem pagamento não entram — e aparecem
      // contados, para "sumiram R$ 300" ter resposta sem abrir outra tela.
      if (situacao === "cancelado") { cancelados.pedidos++; cancelados.centavos += emCentavos(p.totalAmount); }
      else if (status === "AGUARDANDO_PAGAMENTO") { aguardando.pedidos++; aguardando.centavos += emCentavos(p.totalAmount); }
      continue;
    }
    vendas.pedidos++;
    vendas.centavos += emCentavos(p.totalAmount);

    // Pedido de mesa: o dinheiro está na conta da mesa (ver o cabeçalho).
    if (p.tableSessionId) {
      pedidosDeMesa.set(p.id, { centavos: emCentavos(p.totalAmount), sessao: p.tableSessionId });
      continue;
    }

    const canal = canalDoRelatorio(p as any);
    const dia = naLoja(p.createdAt, periodo.tz).dia;
    const partes = pagamentosDoPedido(p);
    for (const parte of partes) registrar(parte.forma, parte.centavos, `p:${p.id}`, dia, canal, parte.texto);
    if (lerPagamentos(p.paymentMethods).length > 0) {
      // As partes fecham com o total com 2 centavos de tolerância
      // (lib/pagamento-dividido.ts); o que sobrar vai para a ponte.
      const dif = partes.reduce((s, x) => s + x.centavos, 0) - emCentavos(p.totalAmount);
      if (dif !== 0) { arredondamentoDoDividido += dif; divididosComDiferenca++; }
    } else {
      const c = emCentavos(cupomDaPlataforma(p));
      if (c > 0) { cupom.pedidos++; cupom.centavos += c; somar(cupom.porCanal, canal, c); }
    }
  }

  // ── As contas de mesa fechadas no período ─────────────────────────────────
  // Serviço, gorjeta e desconto no fechamento vêm da régua única
  // (servicoDasMesas, descontoNoFechamento): os MESMOS números do Vendas por
  // período e do Faturamento por dia. Até a revisão de 24/09/2026 esta ponte
  // tinha a sua conta: somava a taxa mesa a mesa em centavos (Pastel da
  // Paulista, 01–24/09, só Mesa: R$ 2.457,48 aqui × 2.457,44 lá) e chamava de
  // "desconto dado no fechamento" qualquer pago menor que a conta, em qualquer
  // data (Ruíco Burger, 01/08–24/09: −R$ 12,00 aqui × R$ 0 lá, por uma mesa
  // fechada em 20/08 com R$ 12 de consumo e nada pago — antes de o fechamento
  // ter desconto, isso é conta mal fechada).
  const daRegua = servicoDasMesas(mesas.map(mesaDaRegua));
  const mesasResumo = { fechadas: 0, centavos: 0, servicoContaAConta: 0, servicoQtd: 0, gorjetaContaAConta: 0, gorjetaQtd: 0, troco: 0, trocoContas: 0 };
  let aMaisForaDoDinheiro = 0, aMaisQtd = 0, aMenos = 0, aMenosQtd = 0;
  let deOutroPeriodo = 0, deOutroPeriodoQtd = 0;
  const sessoesContadas = new Set<string>();

  for (const m of mesas) {
    sessoesContadas.add(m.id);
    mesasResumo.fechadas++;
    const dia = naLoja(m.fechadaEm, periodo.tz).dia;
    const servico = emCentavos(m.taxaDeServico || 0);
    const gorjeta = emCentavos(m.gorjeta || 0);

    // O consumo da conta = os pedidos dela que são venda (o fechamento ignora
    // o cancelado; o valor impossível fica fora, como na régua).
    let consumo = 0;
    for (const o of m.pedidos) {
      if (situacaoDoPedido(o.status) !== "venda" || temValorImpossivel(o)) continue;
      const c = emCentavos(o.totalAmount);
      consumo += c;
      if (!pedidosDeMesa.has(o.id)) { deOutroPeriodo += c; deOutroPeriodoQtd++; }
    }

    const baixas = lerPagamentos(m.pagamentos).map((b) => ({ forma: formaDoTexto(b.method), centavos: emCentavos(b.amount), texto: textoLimpo(b.method) }));
    // Conta antiga com total pago e sem as baixas: o dinheiro entrou, só não
    // se sabe por onde. Aparece em "não identificado" em vez de sumir.
    if (baixas.length === 0 && emCentavos(m.totalPago || 0) > 0) {
      baixas.push({ forma: "OUTROS", centavos: emCentavos(m.totalPago || 0), texto: "Mesa sem a forma registrada" });
    }
    const entregue = baixas.reduce((s, b) => s + b.centavos, 0);

    // O TROCO (ver o cabeçalho): o entregue além de consumo + serviço +
    // gorjeta volta para o cliente, da gaveta. Sai do dinheiro desta conta,
    // da maior nota para a menor; a nota que vira troco inteira (R$ 5 numa
    // conta já coberta pelo cartão) deixa de ser pagamento.
    const aMais = Math.max(0, entregue - servico - gorjeta - consumo);
    let troco = 0;
    for (const b of baixas.filter((x) => x.forma === "DINHEIRO").sort((x, y) => y.centavos - x.centavos)) {
      if (troco >= aMais) break;
      const sai = Math.min(b.centavos, aMais - troco);
      b.centavos -= sai;
      troco += sai;
    }
    for (const b of baixas) if (b.centavos > 0) registrar(b.forma, b.centavos, `m:${m.id}`, dia, "MESA", b.texto);
    if (troco > 0) { mesasResumo.troco += troco; mesasResumo.trocoContas++; }
    mesasResumo.centavos += entregue - troco;

    // Taxa NEGATIVA existe no banco: antes de o fechamento recusar taxa fora
    // de 0–100%, ela era o jeito de dar desconto na mesa (Pastel da Paulista,
    // 05/09/2026: R$ 125,40 de consumo, taxa de R$ −48,91, R$ 76,49 pagos). Ela
    // não é taxa: a régua a lê como desconto (descontoNoFechamento).
    const servicoCobrado = Math.max(0, servico), gorjetaCobrada = Math.max(0, gorjeta);
    if (servicoCobrado > 0) { mesasResumo.servicoContaAConta += servicoCobrado; mesasResumo.servicoQtd++; }
    if (gorjetaCobrada > 0) { mesasResumo.gorjetaContaAConta += gorjetaCobrada; mesasResumo.gorjetaQtd++; }

    // Tirados o troco, o serviço, a gorjeta e o desconto que a régua reconhece,
    // o que o pagamento ainda tem A MAIS foi pago a mais no cartão ou no Pix
    // (gorjeta sem registro, valor digitado a mais); o que tem A MENOS é conta
    // fechada abaixo do consumo sem ser desconto — antes de 13/09/2026 o
    // fechamento não tinha desconto. A soma das linhas fecha conta a conta:
    // serviço + gorjeta − desconto + resto = entregue − troco − consumo.
    const resto = entregue - troco - consumo - servicoCobrado - gorjetaCobrada + cent(descontoNoFechamento(mesaDaRegua(m)));
    if (resto > 0) { aMaisForaDoDinheiro += resto; aMaisQtd++; }
    else if (resto < 0) { aMenos += resto; aMenosQtd++; }
  }

  // Pedido de mesa do recorte cuja conta não está entre as fechadas do
  // recorte: o motivo sai da situação da conta, nunca de palpite.
  const situacao = new Map(situacaoDasMesas.map((s) => [s.id, s]));
  type Motivo = "ABERTA" | "FECHOU_DEPOIS" | "FORA_DO_FILTRO" | "SEM_PAGAMENTO";
  const motivoDaMesa = (sessao: string): Motivo => {
    const s = situacao.get(sessao);
    if (!s) return "SEM_PAGAMENTO";
    if (s.status !== "CLOSED") return "ABERTA";
    if (!s.fechadaEm) return "SEM_PAGAMENTO";
    const diaDoFechamento = naLoja(s.fechadaEm, periodo.tz).dia;
    if (diaDoFechamento > periodo.ate) return "FECHOU_DEPOIS";
    // Fechou dentro do período e mesmo assim não veio: o filtro a tirou. Conta
    // e pedido de mesa têm o mesmo tipo, canal, marca e loja; o único filtro
    // que separa os dois é a faixa de horário (a conta vai pelo fechamento).
    if (diaDoFechamento >= periodo.de) return "FORA_DO_FILTRO";
    return "SEM_PAGAMENTO";
  };
  const semPagamento: Record<Motivo, { centavos: number; qtd: number }> = {
    ABERTA: { centavos: 0, qtd: 0 }, FECHOU_DEPOIS: { centavos: 0, qtd: 0 }, FORA_DO_FILTRO: { centavos: 0, qtd: 0 }, SEM_PAGAMENTO: { centavos: 0, qtd: 0 },
  };
  for (const [, o] of pedidosDeMesa) {
    if (sessoesContadas.has(o.sessao)) continue;
    const s = semPagamento[motivoDaMesa(o.sessao)];
    s.centavos += o.centavos;
    s.qtd++;
  }

  // ── Totais ────────────────────────────────────────────────────────────────
  const totalCentavos = [...soma.values()].reduce((s, x) => s + x.centavos, 0);
  const totalPagamentos = [...soma.values()].reduce((s, x) => s + x.pagamentos, 0);
  /** Contas distintas de várias formas: o dividido em crédito + débito é uma conta só. */
  const contasDistintas = (lista: Soma[]) => new Set(lista.flatMap((x) => [...x.contas])).size;
  const mediaPorConta = (centavos: number, contas: number) => (contas ? reais(centavos / contas) : 0);

  const formas: LinhaDaForma[] = FORMAS.map((f) => {
    const s = soma.get(f.chave)!;
    return {
      chave: f.chave, rotulo: f.rotulo, grupo: f.grupo,
      pagamentos: s.pagamentos, contas: s.contas.size, valor: reais(s.centavos), pct: pctDe(s.centavos, totalCentavos),
      mediaPorConta: mediaPorConta(s.centavos, s.contas.size),
      porDia: s.porDia.map(reais),
      porCanal: detalhes(s.porCanal, nomeDoCanal, s.centavos),
      textos: detalhes(s.textos, (k) => k, s.centavos),
    };
  });

  const grupos = GRUPOS.map((g) => {
    const doGrupo = FORMAS.filter((f) => f.grupo === g.chave).map((f) => soma.get(f.chave)!);
    const c = doGrupo.reduce((s, x) => s + x.centavos, 0);
    const n = contasDistintas(doGrupo);
    return { ...g, pagamentos: doGrupo.reduce((s, x) => s + x.pagamentos, 0), contas: n, valor: reais(c), pct: pctDe(c, totalCentavos), mediaPorConta: mediaPorConta(c, n) };
  });
  const totalContas = contasDistintas([...soma.values()]);

  // ── A ponte: por que o total dos pagamentos não é o total das vendas ─────
  const linhas: LinhaDaDiferenca[] = [];
  const linha = (chave: string, rotulo: string, centavos: number, quantidade: number, explicacao: string) => {
    if (centavos !== 0) linhas.push({ chave, rotulo, valor: reais(centavos), quantidade, explicacao });
  };
  const servicoDaRegua = cent(daRegua.taxa), gorjetaDaRegua = cent(daRegua.gorjeta);
  linha("SERVICO", "Taxa de serviço das mesas", servicoDaRegua, mesasResumo.servicoQtd,
    "Cobrada no fechamento da mesa: está no pagamento, não está em pedido nenhum. O mesmo total do Vendas por período e do Faturamento por dia.");
  linha("GORJETA", "Gorjeta das mesas", gorjetaDaRegua, mesasResumo.gorjetaQtd,
    "Registrada no fechamento da mesa, para o garçom: é pagamento, não é venda.");
  linha("SERVICO_CENTAVOS", "Centavos da taxa de serviço, conta a conta",
    mesasResumo.servicoContaAConta + mesasResumo.gorjetaContaAConta - servicoDaRegua - gorjetaDaRegua, 0,
    "A taxa é gravada sem arredondar (10% de R$ 63,59 = 6,359). A linha da taxa é a soma crua, a de todo relatório e do acerto do garçom; cada conta cobrou a sua arredondada ao centavo, e a diferença são estes centavos.");
  linha("SOBRA", "Pago a mais nas mesas, no cartão ou no Pix", aMaisForaDoDinheiro, aMaisQtd,
    "A mesa pagou mais que a conta fora do dinheiro (gorjeta sem registro ou valor digitado a mais). O troco em dinheiro não entra aqui: já saiu do Dinheiro.");
  linha("DESCONTO_MESA", "Desconto dado no fechamento das mesas", -cent(daRegua.descontoNaMesa), daRegua.mesasComDesconto,
    "Consumo − (pago − serviço − gorjeta), nas mesas fechadas desde 13/09/2026 (nas contas antigas, a taxa de serviço negativa) — o mesmo do Vendas por período e do Faturamento por dia. É um piso: troco deixado na mesa esconde parte dele.");
  linha("MESA_A_MENOS", "Mesas fechadas recebendo menos que a conta", aMenos, aMenosQtd,
    "A conta fechou recebendo menos que o consumo, e não é o desconto do fechamento: antes de 13/09/2026 ele não existia (até 24/08 a mesa fechava com qualquer valor), ou o pedido da conta já trazia o desconto dele. Os pedidos estão no total das vendas; esse dinheiro não entrou.");
  linha("MESA_ABERTA", "Pedidos de mesas ainda abertas", -semPagamento.ABERTA.centavos, semPagamento.ABERTA.qtd,
    "Lançados no período numa mesa que ainda não fechou: o pagamento entra no dia em que a conta fechar.");
  linha("MESA_FECHOU_DEPOIS", "Pedidos de mesas que fecharam depois do período", -semPagamento.FECHOU_DEPOIS.centavos, semPagamento.FECHOU_DEPOIS.qtd,
    "A conta só fechou depois do último dia do período: o pagamento está no dia em que ela fechou.");
  linha("MESA_FORA_DO_FILTRO", "Pedidos de mesas fechadas fora da faixa de horário", -semPagamento.FORA_DO_FILTRO.centavos, semPagamento.FORA_DO_FILTRO.qtd,
    "A conta fechou no período, mas fora da faixa de horário do filtro: o pedido entra no recorte, o pagamento dela não.");
  linha("MESA_SEM_PAGAMENTO", "Pedidos de mesa sem o fechamento da conta", -semPagamento.SEM_PAGAMENTO.centavos, semPagamento.SEM_PAGAMENTO.qtd,
    "Lançados no período numa conta de mesa cujo fechamento não foi encontrado neste recorte.");
  linha("MESA_DE_ANTES", "Mesas fechadas no período com pedidos de antes", deOutroPeriodo, deOutroPeriodoQtd,
    "A conta fechou no período, mas o pedido foi lançado antes (ou fora da faixa de horário).");
  linha("DIVIDIDO", "Centavos do pagamento dividido", arredondamentoDoDividido, divididosComDiferenca,
    "As partes de um pagamento dividido podem diferir do total em até 2 centavos de arredondamento.");

  const diferenca = totalCentavos - vendas.centavos;
  const explicado = linhas.reduce((s, l) => s + emCentavos(l.valor), 0);
  linha("OUTROS", "Outras diferenças", diferenca - explicado, 0,
    "Diferença que as linhas acima não explicam.");

  return {
    dias,
    formas,
    grupos,
    total: { pagamentos: totalPagamentos, contas: totalContas, valor: reais(totalCentavos), mediaPorConta: mediaPorConta(totalCentavos, totalContas), porDia: totalPorDia.map(reais) },
    vendas: { atendimentos: at.vendas, mesas: at.mesas, pedidos: vendas.pedidos, valor: reais(vendas.centavos), ticketMedio: ticketMedio(reais(vendas.centavos), at.vendas) },
    mesas: {
      fechadas: mesasResumo.fechadas, valor: reais(mesasResumo.centavos), taxaDeServico: daRegua.taxa, gorjeta: daRegua.gorjeta,
      troco: { contas: mesasResumo.trocoContas, valor: reais(mesasResumo.troco) },
    },
    diferenca: { valor: reais(diferenca), linhas },
    cupomDaPlataforma: { pedidos: cupom.pedidos, valor: reais(cupom.centavos), porCanal: detalhes(cupom.porCanal, nomeDoCanal, cupom.centavos) },
    foraDaVenda: {
      cancelados: { pedidos: cancelados.pedidos, valor: reais(cancelados.centavos) },
      aguardandoPagamento: { pedidos: aguardando.pedidos, valor: reais(aguardando.centavos) },
      valoresImpossiveis: impossiveis,
    },
  };
}
