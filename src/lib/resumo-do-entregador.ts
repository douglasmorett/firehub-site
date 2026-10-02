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
 */
import { toLocalISODate } from "@/lib/timezone";
import { HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";

const VIRADA_MS = HORA_DE_VIRADA_DO_EXPEDIENTE * 60 * 60 * 1000;

export const ehCancelado = (status: string | null | undefined) => String(status || "").toUpperCase().includes("CANCEL");

type PedidoDoDinheiro = {
  paymentMethod?: string | null;
  totalAmount?: number | null;
  changeAmount?: number | null;
  notes?: string | null;
};

export const ehDinheiro = (paymentMethod: string | null | undefined) => {
  const pm = String(paymentMethod || "").toUpperCase();
  return pm === "CASH" || pm.includes("DINHEIR");
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

export type EntregaDoResumo = PedidoDoDinheiro & {
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

  for (const o of orders) {
    if (ehCancelado(o.status)) continue; // Pedido cancelado: não cobrar prestação de contas do motoboy

    const pm = (o.paymentMethod || "").toUpperCase();
    const total = Number(o.totalAmount || 0);

    if (ehDinheiro(o.paymentMethod)) {
      const changeFor = trocoParaDoPedido(o);
      // O valor que o motoboy recebe fisicamente do cliente e entrega para a loja
      cashCollectedSum += changeFor ? changeFor : total;
      cashOrdersCount++;
      changeGivenSum += changeFor ? changeFor - total : 0;
      cashOrdersValueSum += total;
    } else if (pm.includes("DEBIT") || pm.includes("DEBITO") || pm.includes("DÉBITO")) {
      debitTotal += total;
      debitCount++;
    } else if (pm.includes("VOUCHER") || pm.includes("VALE") || pm.includes("VR") || pm.includes("VA")) {
      voucherTotal += total;
      voucherCount++;
    } else if (pm.includes("CARD") || pm.includes("CART") || pm.includes("CREDIT") || pm.includes("MAQUININHA") || pm.includes("MAQUINA")) {
      creditTotal += total;
      creditCount++;
    } else {
      // PIX Online, iFood Pago Online, etc.
      onlineTotal += total;
      onlineCount++;
    }
  }

  return {
    totalDeliveries,
    totalDistance,
    uniqueDays,
    deliveryFeeSum,
    motoboyFeeSum,
    cashCollectedSum,
    cashOrdersCount,
    cashOrdersValueSum,
    changeGivenSum,
    cardPosTotal: debitTotal + creditTotal + voucherTotal,
    cardPosCount: debitCount + creditCount + voucherCount,
    debitTotal,
    debitCount,
    creditTotal,
    creditCount,
    voucherTotal,
    voucherCount,
    onlineTotal,
    onlineCount,
    feeTotal: Math.round(orders.reduce((s, o) => s + o.ganho, 0) * 100) / 100,
  };
}
