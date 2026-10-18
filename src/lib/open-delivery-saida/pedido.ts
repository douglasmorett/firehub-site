/**
 * lib/open-delivery-saida/pedido.ts — CustomerOrder → Order do Open Delivery V1.
 *
 * Função pura: não lê banco nem relógio (o "agora" vem de fora). É o que a
 * logística (Bem Dito) recebe em GET /v1/orders/{orderId}.
 *
 * ── Os valores saem das réguas que já existem ───────────────────────────────
 *
 *   - Itens, taxa, desconto e total: `contaDoPedido` (lib/conta-do-pedido.ts),
 *     a mesma conta que a comanda e o painel mostram — o desconto é o que a
 *     conta exige (itens + taxa − total), nunca um campo solto. O
 *     `orderAmount` é SEMPRE o `totalAmount` gravado.
 *   - Pagamento: `pagamentosDoPedido` (lib/relatorios/formas-de-pagamento.ts),
 *     a régua do caixa e do acerto do motoboy — dividido parte por parte, pago
 *     online como PREPAID, o resto como PENDING (cobrar na porta). Forma não
 *     identificada é PENDING/OTHER: "na dúvida, cobra" (lib/pagamento-na-entrega).
 *   - Troco: `trocoParaDoPedido` (lib/resumo-do-entregador.ts).
 *
 * ── Opções do item ──────────────────────────────────────────────────────────
 *
 * No FireHub o `price` do item já é o unitário COM as opções (é assim que
 * totalDosItens soma). As opções vão com nome e quantidade e preço 0, e o
 * `unitPrice` do item leva o valor inteiro: `totalPrice = qtd × (unitPrice +
 * optionsPrice)` fecha com a soma do pedido. Repartir o preço entre item e
 * opção seria inventar — o pedido do site nem grava o preço da opção.
 */
import { contaDoPedido } from "@/lib/conta-do-pedido";
import { pagamentosDoPedido, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import { trocoParaDoPedido } from "@/lib/resumo-do-entregador";
import { lerEnderecoGravado } from "@/lib/cliente-reconhecido";
import { parseComboSelections } from "@/lib/parse-combo";
import { nomeDoItem } from "@/lib/nome-do-item";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";

const MOEDA = "BRL";
const reais = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const preco = (n: number) => ({ value: reais(n), currency: MOEDA });

// ── Quem entra ────────────────────────────────────────────────────────────────

export type PedidoParaLogistica = {
  id: string;
  status: string;
  source?: string | null;
  deliveryType?: string | null;
  deliveryBy?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryReference?: string | null;
  food99AppShopId?: string | null;
  tableSessionId?: string | null;
  parentOrderId?: string | null;
};

const NAO_E_PEDIDO_AINDA = new Set(["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"]);

/**
 * Este pedido vai para a logística? Só ENTREGA de canal PRÓPRIO da loja
 * (site, robô, PDV, telefone, API): iFood, 99, Keeta têm entregador deles, e
 * Brendi/JotaJá/Wabiz já falam com a logística por conta própria (a Bem Dito
 * integra direto com a Brendi e o JotaJá) — mandar daqui seria a corrida em
 * dobro. Mesa, acréscimo (é o mesmo cliente, a mesma corrida) e o rascunho do
 * robô / Pix esperando pagamento ficam de fora.
 */
export function vaiParaALogistica(p: PedidoParaLogistica): boolean {
  if (String(p.deliveryType || "").toUpperCase() !== "DELIVERY") return false;
  if (p.ifoodOrderId || p.openDeliveryOrderId || p.food99AppShopId) return false;
  if (p.tableSessionId || p.parentOrderId) return false;
  if (NAO_E_PEDIDO_AINDA.has(String(p.status || "").toUpperCase())) return false;
  if (String(p.source || "").toUpperCase() === "EQUIPE") return false;
  const por = String(p.deliveryBy || "").toUpperCase().trim();
  if (por && por !== "MERCHANT") return false;
  const canal = canalDoPedido(p as any);
  return !canal.ehMarketplace && canal.chave !== "MESA";
}

// ── Status → último evento ────────────────────────────────────────────────────

export const STATUS_CONFIRMADOS = ["ACEITO", "CONFIRMADO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO"];
export const STATUS_EM_ROTA = ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA"];

export function ultimoEventoDoStatus(status: string | null | undefined): string {
  const s = String(status || "").toUpperCase();
  if ((STATUS_CANCELADOS as readonly string[]).includes(s)) return "CANCELLED";
  if ((STATUS_FINALIZADOS as readonly string[]).includes(s)) return "CONCLUDED";
  if (STATUS_EM_ROTA.includes(s)) return "DISPATCHED";
  if (s === "PRONTO") return "READY_FOR_PICKUP";
  if (STATUS_CONFIRMADOS.includes(s)) return "CONFIRMED";
  return "CREATED";
}

// ── Pagamento ─────────────────────────────────────────────────────────────────

const METODO_NA_PORTA: Record<ChaveDaForma, string> = {
  DINHEIRO: "CASH",
  PIX: "PIX",
  CREDITO: "CREDIT",
  DEBITO: "DEBIT",
  VALE: "MEAL_VOUCHER",
  ONLINE: "OTHER",
  FIADO: "OTHER",
  PROPRIA: "OTHER",
  OUTROS: "OTHER",
};

/** O método do pago online, pelo texto ("Pix Pago Online", "Crédito (Pago Online)"). */
function metodoOnline(texto: string): string {
  const t = texto.toLowerCase();
  if (t.includes("pix")) return "PIX";
  if (t.includes("débito") || t.includes("debito") || t.includes("debit")) return "DEBIT";
  if (t.includes("crédito") || t.includes("credito") || t.includes("credit") || t.includes("cart")) return "CREDIT";
  return "OTHER";
}

export type MetodoOD = {
  value: number;
  currency: string;
  type: "PREPAID" | "PENDING";
  method: string;
  methodInfo?: string;
  changeFor?: number;
};

export function pagamentosOD(o: any): { prepaid: number; pending: number; methods: MetodoOD[] } {
  const partes = pagamentosDoPedido({ ...o, totalAmount: Number(o.totalAmount) || 0 });
  const troco = trocoParaDoPedido(o);
  const methods: MetodoOD[] = partes.map((p, i) => {
    const valor = reais(p.centavos / 100);
    // Fiado: a loja cobra depois, o entregador não recebe nada na porta.
    const pago = p.forma === "ONLINE" || p.forma === "FIADO";
    const m: MetodoOD = {
      value: valor,
      currency: MOEDA,
      type: pago ? "PREPAID" : "PENDING",
      method: p.forma === "ONLINE" ? metodoOnline(p.texto) : METODO_NA_PORTA[p.forma],
    };
    const info = p.forma === "FIADO" ? `${p.texto || "Fiado"} (não cobrar)` : p.texto;
    if (info) m.methodInfo = info;
    if (p.forma === "DINHEIRO") {
      // No dividido o troco é o changeAmount (a nota da parte em dinheiro);
      // numa forma só, a régua do acerto (inclusive "troco para 50" nas notas).
      const nota = partes.length > 1 ? Number(o.changeAmount || 0) : troco || 0;
      if (nota > valor) m.changeFor = reais(nota);
    }
    return m;
  });
  const soma = (t: "PREPAID" | "PENDING") => reais(methods.filter((m) => m.type === t).reduce((s, m) => s + m.value, 0));
  return { prepaid: soma("PREPAID"), pending: soma("PENDING"), methods };
}

// ── Endereço ──────────────────────────────────────────────────────────────────

function coordenadas(latLng: unknown): { latitude: number; longitude: number } | null {
  if (!latLng || typeof latLng !== "object") return null;
  const p = latLng as { lat?: unknown; lng?: unknown };
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

/** UF da loja pelo fim do endereço ou da cidade ("Rio das Ostras - RJ", ".../RJ"). */
function ufDaLoja(loja: LojaParaOD): string {
  for (const t of [loja.city, loja.storeAddress]) {
    const m = String(t || "").match(/(?:^|[\s,\/-])([A-Z]{2})\s*(?:,?\s*\d{5}-?\d{3})?\s*$/);
    if (m) return `BR-${m[1]}`;
  }
  return "";
}

function cidadeDaLoja(loja: LojaParaOD): string {
  return String(loja.city || "").replace(/\s*[-\/,]\s*[A-Z]{2}\s*$/, "").trim();
}

function enderecoOD(o: any, loja: LojaParaOD) {
  const texto = String(o.customerAddress || "").trim();
  const lido = lerEnderecoGravado(texto, o.customerLatLng);
  const ponto = coordenadas(o.customerLatLng);
  return {
    country: "BR",
    state: ufDaLoja(loja),
    city: cidadeDaLoja(loja),
    district: lido?.bairro || "",
    street: lido?.rua || texto,
    number: lido?.numero || "",
    ...(lido?.complemento ? { complement: lido.complemento } : {}),
    formattedAddress: texto,
    postalCode: (lido?.cep || "").replace(/\D/g, ""),
    // Sem ponto gravado a spec ainda pede o campo: vai nulo, e a logística
    // geocodifica pelo texto (o FireHub não inventa um ponto).
    coordinates: ponto ?? { latitude: null, longitude: null },
  };
}

// ── O pedido ──────────────────────────────────────────────────────────────────

export type LojaParaOD = {
  storeName?: string | null;
  city?: string | null;
  storeAddress?: string | null;
};

export type IntegracaoParaOD = { merchantId: string };

/** Prazo usado quando o pedido não gravou o tempo de entrega (tempoEntregaMin). */
export const PRAZO_PADRAO_MIN = 45;

const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);

export function pedidoNoFormatoOD(o: any, loja: LojaParaOD, integ: IntegracaoParaOD) {
  const itensValidos = (o.items || []).filter((i: any) => Number(i.quantity) > 0);
  const conta = contaDoPedido({ ...o, items: itensValidos });
  const total = reais(Number(o.totalAmount) || 0);

  const items = itensValidos.map((i: any, idx: number) => {
    const qtd = Number(i.quantity) || 1;
    const unit = reais(Number(i.price) || 0);
    const options = parseComboSelections(i.comboSelections, 1).map((op, j) => ({
      index: j,
      id: `${i.id}-${j}`,
      name: op.name,
      externalCode: "",
      unit: "UN",
      quantity: Number(op.quantity) || 1,
      unitPrice: preco(0),
      totalPrice: preco(0),
    }));
    return {
      id: i.id,
      index: idx,
      name: nomeDoItem(i),
      externalCode: i.menuProductId || "",
      unit: "UN",
      quantity: qtd,
      ...(i.notes ? { specialInstructions: String(i.notes) } : {}),
      unitPrice: preco(unit),
      optionsPrice: preco(0),
      totalPrice: preco(unit * qtd),
      ...(options.length > 0 ? { options } : {}),
    };
  });

  // Ajustes da conta: negativo = desconto, positivo = valor a mais (taxa de
  // serviço/embalagem que não tem campo próprio).
  const descontos = conta.ajustes.filter((a) => a.valor < 0);
  const acrescimos = conta.ajustes.filter((a) => a.valor > 0);
  const valorDoDesconto = reais(descontos.reduce((s, a) => s - a.valor, 0));

  const otherFees: any[] = [];
  if (conta.taxaEntrega > 0) {
    otherFees.push({ name: "Taxa de entrega", type: "DELIVERY_FEE", receivedBy: "MERCHANT", price: preco(conta.taxaEntrega) });
  }
  for (const a of acrescimos) {
    otherFees.push({ name: a.rotulo, type: "SERVICE_FEE", receivedBy: "MERCHANT", price: preco(a.valor) });
  }
  const valorDasTaxas = reais(otherFees.reduce((s, f) => s + f.price.value, 0));

  const discounts =
    valorDoDesconto > 0
      ? [
          {
            amount: preco(valorDoDesconto),
            target: "CART",
            sponsorshipValues: [{ name: "MERCHANT", amount: preco(valorDoDesconto) }],
          },
        ]
      : [];

  const criadoEm = new Date(o.createdAt);
  const agendado = Boolean(o.agendado && o.scheduledDatetime);
  const inicioDaEntrega = agendado ? new Date(o.scheduledDatetime) : criadoEm;
  const prazoMin = Number(o.tempoEntregaMin) > 0 ? Number(o.tempoEntregaMin) : PRAZO_PADRAO_MIN;
  const previsao = new Date(inicioDaEntrega.getTime() + prazoMin * 60_000);

  const telefone = String(o.customerPhone || "").replace(/\D/g, "");

  return {
    id: o.id,
    type: "DELIVERY",
    displayId: String(o.dailyOrderNumber ?? o.id.slice(-4).toUpperCase()),
    salesChannel: canalDoPedido(o).nome,
    category: "FOOD",
    createdAt: criadoEm.toISOString(),
    lastEvent: ultimoEventoDoStatus(o.status),
    orderTiming: agendado ? "SCHEDULED" : "INSTANT",
    preparationStartDateTime: (iso(o.acceptedAt) || criadoEm.toISOString()) as string,
    merchant: { id: integ.merchantId, name: String(loja.storeName || "Loja") },
    items,
    otherFees,
    discounts,
    total: {
      itemsPrice: preco(conta.subtotal),
      otherFees: preco(valorDasTaxas),
      discount: preco(valorDoDesconto),
      orderAmount: preco(total),
    },
    payments: pagamentosOD(o),
    customer: {
      id: o.customerId || telefone || o.id,
      name: String(o.customerName || "Cliente"),
      ...(o.customerCpfCnpj ? { documentNumber: String(o.customerCpfCnpj).replace(/\D/g, "") } : {}),
      phone: { number: telefone },
    },
    ...(agendado
      ? {
          schedule: {
            scheduledDateTimeStart: new Date(o.scheduledDatetime).toISOString(),
            scheduledDateTimeEnd: previsao.toISOString(),
          },
        }
      : {}),
    delivery: {
      deliveredBy: "MERCHANT",
      deliveryAddress: enderecoOD(o, loja),
      estimatedDeliveryDateTime: previsao.toISOString(),
      ...(o.deliveredAt ? { deliveryDateTime: new Date(o.deliveredAt).toISOString() } : {}),
    },
    ...(o.notes ? { extraInfo: String(o.notes) } : {}),
  };
}
