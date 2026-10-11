/**
 * /src/lib/resumo-do-entregador.ts
 *
 * A SOMA das entregas de um motoboy — quantas, km, dias, o dinheiro de cada
 * forma de pagamento e o que ele ganhou — sem banco, para rodar no servidor e
 * na tela.
 *
 * ── Por que mora separada ───────────────────────────────────────────────────
 * O relatório (lib/relatorio-do-entregador.ts) somava tudo no servidor. Com o
 * filtro de integrações dentro do cartão de cada motoboy ("só iFood", "só 99",
 * pedido do Douglas, 02/10/2026), a tela precisa refazer a mesma soma com só
 * parte das entregas. Duas somas escritas em dois lugares é como nasce o "no
 * filtro dá um valor, sem filtro dá outro" — então os dois chamam esta.
 *
 * A diária fica de fora: ela é por DIA trabalhado, não se divide por canal.
 *
 * ── Em que caixa cai cada entrega ───────────────────────────────────────────
 * A forma de pagamento sai da régua do FECHAMENTO DE CAIXA
 * (lib/relatorios/formas-de-pagamento.ts, `formaDoPedido`), não de uma leitura
 * própria. A leitura antiga daqui procurava pedaços de palavra na ordem
 * dinheiro → débito → vale → cartão, e o resto virava "Pago Online":
 *   • "Cartão (Pago Online)", "Débito (Pago Online)", "Vale Refeição (Pago
 *     Online)" — pagos no app — iam para a MAQUININHA;
 *   • o Pix pago na porta ("Pix" trocado na entrega, "PIX_ENTREGA" do site),
 *     "A combinar (Cobrar na Entrega)" e o pedido sem forma iam para o PAGO
 *     ONLINE.
 * A Delícia de Casa somou as notas pagas online de um motoboy e o quadrado
 * "Pago Online" dava outro valor, "mais de uma nota" de diferença, sem ter
 * como achar quais (Fellipe, 10/10/2026). Agora cada entrega cai na caixa que
 * o caixa daria a ela, e a tela marca a caixa na linha de cada entrega
 * (`partesDaEntrega`) — a soma das linhas marcadas é o quadrado.
 */
import { toLocalISODate } from "@/lib/timezone";
import { HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";
import { formaDoPedido, formaDoTexto, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { infoDaEntrega } from "@/lib/entrega-parceira";

const VIRADA_MS = HORA_DE_VIRADA_DO_EXPEDIENTE * 60 * 60 * 1000;

export const ehCancelado = (status: string | null | undefined) => String(status || "").toUpperCase().includes("CANCEL");

/** Chegou ao cliente: ENTREGUE ou ENCERRADO (lib/status-pedido.ts, STATUS_FINALIZADOS). */
export const foiEntregue = (status: string | null | undefined) => {
  const s = String(status || "").toUpperCase();
  return s === "ENTREGUE" || s === "ENCERRADO";
};

// ── CANCELADO SÓ É CORRIDA SE O MOTOBOY SAIU ──────────────────────────────────
//
// Até 11/10/2026 o acerto contava TODO pedido cancelado com o motoboy como
// corrida (cancelado-com-motoboy-conta), e o fechamento de caixa não contava
// nenhum: o mesmo entregador, no mesmo turno, com dois números (77 cancelados
// com motoboy em 60 dias; na Delícia de Casa, em 30 dias, Ian 8, Jobson 6,
// guilherme 5). A regra única é a frase do Douglas (02/10/2026), "se ele puxou
// o pedido, vai ficar na conta": SAIU com o pedido (`dispatchedAt`, o carimbo de
// SAIU_ENTREGA) antes do cancelamento → a corrida conta. Cancelado antes de
// sair → não houve corrida. Das 77, 57 tinham saído; nenhuma saiu depois de
// cancelada. Pedido anterior a 29/08/2026 não tem o carimbo e fica sem corrida.

type PedidoDaCorrida = { status?: string | null; dispatchedAt?: Date | string | null; cancelledAt?: Date | string | null };

/** Cancelado DEPOIS de o motoboy sair com ele: a corrida conta (e o dinheiro não). */
export function canceladoComCorrida(o: PedidoDaCorrida): boolean {
  if (!ehCancelado(o.status) || !o.dispatchedAt) return false;
  const saiu = new Date(o.dispatchedAt).getTime();
  const cancelou = o.cancelledAt ? new Date(o.cancelledAt).getTime() : NaN;
  return !Number.isFinite(cancelou) || saiu <= cancelou;
}

/** A entrega vira corrida do motoboy: não cancelada, ou cancelada depois de sair. */
export const contaComoCorrida = (o: PedidoDaCorrida) => !ehCancelado(o.status) || canceladoComCorrida(o);

// ── É ENTREGA DA LOJA? ────────────────────────────────────────────────────────
//
// Uma régua para o acerto do motoboy e o fechamento de caixa. O caixa olhava
// só `deliveryBy` ("tem e não é MERCHANT" = parceira), o acerto não olhava nada
// e a tela de Áreas usa `infoDaEntrega` (lib/entrega-parceira.ts) — a régua do
// painel e da comanda, que é a base daqui.
//
// Uma exceção, de dado velho: até 17/09/2026 o app do motoboy da loja carimbava
// `ifoodDriverStatus = "DELIVERED"` ao conferir o código da entrega PRÓPRIA (ver
// o comentário de ESTADOS_DE_ENTREGADOR_IFOOD). Em 60 dias são 15 pedidos da
// Frangoso, todos com o motoboy da loja e sem `deliveryBy` — dois deles
// "Crédito (Cobrar na Entrega)", cobrados na porta pelo motoboy da loja. Pela
// régua do painel eles viram "entregador do iFood" e sumiriam do acerto de
// setembro. Com motoboy da loja atribuído, "DELIVERED" sozinho (sem `deliveryBy`
// de parceiro) não prova entrega parceira. Desde 18/09 não há nenhum caso assim.
export function ehEntregaDaLoja(o: {
  motoboyId?: string | null;
  deliveryBy?: string | null;
  ifoodDriverStatus?: string | null;
  ifoodDriverName?: string | null;
  [k: string]: unknown;
}): boolean {
  const info = infoDaEntrega(o);
  if (!info.parceira) return true;
  const por = String(o.deliveryBy || "").toUpperCase().trim();
  const soOCarimboDoApp =
    Boolean(o.motoboyId) && !por && !o.ifoodDriverName && String(o.ifoodDriverStatus || "").toUpperCase() === "DELIVERED";
  return soOCarimboDoApp;
}

type PedidoDoDinheiro = {
  paymentMethod?: string | null;
  totalAmount?: number | null;
  changeAmount?: number | null;
  notes?: string | null;
};

/**
 * "Troco para quanto": o `changeAmount` gravado ou, sem ele, o que estiver
 * escrito na observação ("Troco para 100", "Troco p/ R$ 50,00", "Troco: 100").
 * Só vale acima do total — abaixo dele não é troco, é erro de digitação.
 */
export function trocoParaDoPedido(o: PedidoDoDinheiro): number | null {
  const orderTotal = Number(o.totalAmount || 0);
  if (typeof o.changeAmount === "number" && o.changeAmount > orderTotal) return o.changeAmount;
  if (!o.notes) return null;
  const notesUpper = String(o.notes).toUpperCase();
  const match =
    notesUpper.match(/TROCO\s*(?:PARA|P\/|DE|PRA)?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i) ||
    notesUpper.match(/TROCO\s*[:=]?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (match && match[1]) {
    const parsed = parseFloat(match[1].replace(",", "."));
    if (!isNaN(parsed) && parsed > orderTotal) return parsed;
  }
  return null;
}

/** O que a régua do caixa lê para decidir a forma de uma entrega. */
export type EntregaParaCaixa = PedidoDoDinheiro & {
  source?: string | null;
  paymentPaidAt?: Date | string | null;
  gatewayProvider?: string | null;
  openDeliveryChannel?: string | null;
  /** Pagamento dividido (troca de pagamento na loja ou no app): manda no texto. */
  paymentMethods?: unknown;
};

/** As caixas do acerto, na ordem da tela. As três últimas só aparecem com valor. */
export const CAIXAS_DO_ACERTO: { chave: ChaveDaForma; rotulo: string; curto: string }[] = [
  { chave: "DINHEIRO", rotulo: "💵 Dinheiro (em mãos)", curto: "💵 Dinheiro" },
  { chave: "DEBITO", rotulo: "💳 Débito (Máquina)", curto: "💳 Débito" },
  { chave: "CREDITO", rotulo: "💳 Crédito (Máquina)", curto: "💳 Crédito" },
  { chave: "VALE", rotulo: "🎟️ Voucher (Vale)", curto: "🎟️ Vale" },
  { chave: "PIX", rotulo: "📲 Pix na entrega", curto: "📲 Pix na entrega" },
  { chave: "ONLINE", rotulo: "⚡ Pago Online", curto: "⚡ Pago Online" },
  { chave: "FIADO", rotulo: "📒 Fiado", curto: "📒 Fiado" },
  { chave: "OUTROS", rotulo: "❓ Forma não identificada", curto: "❓ Não identificada" },
];

/** Um pedaço do pagamento de uma entrega: em que caixa cai e quanto. */
export type ParteDaEntrega = {
  caixa: ChaveDaForma;
  valor: number;
  /** Só no dinheiro: a nota com que o cliente pagou ("troco para 100"). */
  trocoPara: number | null;
};

/**
 * Em que caixa do acerto cai cada real desta entrega. Pagamento dividido vai
 * parte por parte (cada uma pela forma escrita nela, como o caixa faz); o
 * resto é UMA parte, pela cascata do caixa. No dinheiro dividido, o troco é o
 * `changeAmount` — a observação "troco para 50" fala do pedido inteiro, não
 * da parte.
 */
export function partesDaEntrega(o: EntregaParaCaixa): ParteDaEntrega[] {
  const divisao = lerPagamentos(o.paymentMethods);
  if (divisao.length > 0) {
    return divisao.map((p) => {
      const caixa = formaDoTexto(p.method);
      const nota = Number(o.changeAmount || 0);
      return { caixa, valor: p.amount, trocoPara: caixa === "DINHEIRO" && nota > p.amount ? nota : null };
    });
  }
  const caixa = formaDoPedido(o);
  return [{ caixa, valor: Number(o.totalAmount || 0), trocoPara: caixa === "DINHEIRO" ? trocoParaDoPedido(o) : null }];
}

export type EntregaDoResumo = EntregaParaCaixa & {
  status?: string | null;
  createdAt: Date | string;
  deliveryDistance?: number | null;
  deliveryFee?: number | null;
  motoboyFee?: number | null;
  /** O que o motoboy ganha nesta entrega (lib/ganho-do-entregador). */
  ganho: number;
};

export function resumoDasEntregas(orders: EntregaDoResumo[], tz: string) {
  const totalDeliveries = orders.length;
  const totalDistance = orders.reduce((s, o) => s + (o.deliveryDistance || 0), 0);

  // Dias trabalhados = EXPEDIENTES, no fuso da loja. É o que paga a diária:
  // pelo calendário, o turno das 18h às 2h contava dois dias.
  const uniqueDays = orders.length > 0
    ? new Set(orders.map((o) => toLocalISODate(new Date(new Date(o.createdAt).getTime() - VIRADA_MS), tz))).size
    : 0;

  // Soma das taxas dos pedidos
  const deliveryFeeSum = orders.reduce((s, o) => s + (o.deliveryFee || o.motoboyFee || 0), 0);
  const motoboyFeeSum = orders.reduce((s, o) => s + (o.motoboyFee || 0), 0);

  // Classificação de pagamentos recebidos pelo motoboy na entrega vs online
  let cashCollectedSum = 0, cashOrdersCount = 0, changeGivenSum = 0, cashOrdersValueSum = 0;
  let debitTotal = 0, debitCount = 0;
  let creditTotal = 0, creditCount = 0;
  let voucherTotal = 0, voucherCount = 0;
  let onlineTotal = 0, onlineCount = 0;
  // Pix na porta não está no bolso do motoboy nem na maquininha: caiu na
  // conta da loja. Fiado e forma não identificada: ninguém recebeu na hora.
  let pixTotal = 0, pixCount = 0;
  let fiadoTotal = 0, fiadoCount = 0;
  let naoIdentificadoTotal = 0, naoIdentificadoCount = 0;

  // ── ENTREGUES, CANCELADAS E O VALOR DOS PEDIDOS ───────────────────────────
  // "Jobson 30 notas, e o valor dos pedidos das 30 do lado" (Delícia de Casa,
  // 09/10/2026). As entregas contam o cancelado (a corrida é dele); o lojista
  // precisa ver quantas daquelas foram canceladas, e o valor dos pedidos é só
  // o das entregues, em qualquer forma de pagamento — ninguém pagou o
  // cancelado.
  let canceladasCount = 0, canceladasValor = 0;
  let valorDosPedidos = 0;

  for (const o of orders) {
    const total = Number(o.totalAmount || 0);
    if (ehCancelado(o.status)) { // Pedido cancelado: não cobrar prestação de contas do motoboy
      canceladasCount++;
      canceladasValor += total;
      continue;
    }
    valorDosPedidos += total;

    for (const parte of partesDaEntrega(o)) {
      const v = parte.valor;
      switch (parte.caixa) {
        case "DINHEIRO":
          // O valor que o motoboy recebe fisicamente do cliente e entrega para a loja
          cashCollectedSum += parte.trocoPara ?? v;
          cashOrdersCount++;
          changeGivenSum += parte.trocoPara ? parte.trocoPara - v : 0;
          cashOrdersValueSum += v;
          break;
        case "DEBITO": debitTotal += v; debitCount++; break;
        case "CREDITO": creditTotal += v; creditCount++; break;
        case "VALE": voucherTotal += v; voucherCount++; break;
        case "PIX": pixTotal += v; pixCount++; break;
        case "ONLINE": onlineTotal += v; onlineCount++; break;
        case "FIADO": fiadoTotal += v; fiadoCount++; break;
        default: naoIdentificadoTotal += v; naoIdentificadoCount++;
      }
    }
  }

  const centavos = (v: number) => Math.round(v * 100) / 100;

  return {
    totalDeliveries,
    entreguesCount: totalDeliveries - canceladasCount,
    canceladasCount,
    canceladasValor: centavos(canceladasValor),
    /** Soma do total das entregas que não foram canceladas, de todas as formas. */
    valorDosPedidos: centavos(valorDosPedidos),
    totalDistance,
    uniqueDays,
    deliveryFeeSum,
    motoboyFeeSum,
    cashCollectedSum: centavos(cashCollectedSum),
    cashOrdersCount,
    cashOrdersValueSum: centavos(cashOrdersValueSum),
    changeGivenSum: centavos(changeGivenSum),
    cardPosTotal: centavos(debitTotal + creditTotal + voucherTotal),
    cardPosCount: debitCount + creditCount + voucherCount,
    debitTotal: centavos(debitTotal),
    debitCount,
    creditTotal: centavos(creditTotal),
    creditCount,
    voucherTotal: centavos(voucherTotal),
    voucherCount,
    onlineTotal: centavos(onlineTotal),
    onlineCount,
    pixTotal: centavos(pixTotal),
    pixCount,
    fiadoTotal: centavos(fiadoTotal),
    fiadoCount,
    naoIdentificadoTotal: centavos(naoIdentificadoTotal),
    naoIdentificadoCount,
    feeTotal: Math.round(orders.reduce((s, o) => s + o.ganho, 0) * 100) / 100,
  };
}
