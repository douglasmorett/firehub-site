/**
 * lib/cardapioweb/traducao.ts — pedido do CardápioWeb → PedidoOD → dados do CustomerOrder.
 *
 * Função pura (sem banco, sem rede): adapta o formato próprio do CardápioWeb
 * ao contrato da base Open Delivery (lib/open-delivery/traducao.ts) e deixa a
 * base fazer o resto — espelho com o nome base, opções de todas as listas,
 * preço unitário, pagamento por mapa explícito, desconto com dono, total
 * conferido contra a soma das partes. O CardápioWeb é o primeiro formato que
 * NÃO é Open Delivery a entrar por ela.
 *
 * ── O que é do CardápioWeb e a base não sabe ────────────────────────────────
 *
 *   - Combo com `items` aninhados (as etapas). O schema da doc não declara o
 *     campo, mas o exemplo da doc traz — e a base descarta opção que tem
 *     filhas (ela entra pelas filhas). Aqui cada etapa vira uma opção IRMÃ de
 *     preço 0, com as escolhas dela logo abaixo, também de preço 0: quem diz o
 *     valor é o `total_price` do combo. Lemos os dois formatos (`options` e
 *     `items`) em todo item.
 *   - Grupo de complemento cobrado pela média/maior/menor (a pizza de dois
 *     sabores): `option_group_total_selected_options` vem preenchido e o
 *     preço de cada sabor NÃO soma. A opção entra com preço 0.
 *   - Taxa adicional e taxa da forma de pagamento são DA LOJA
 *     (`receivedBy: MERCHANT`), não da plataforma.
 *   - Pago online só com `payment_type = online` E status `paid`/`authorized`.
 *     Pagamento offline que a loja marcou como pago no portal continua sendo
 *     cobrado na entrega (é controle interno dela), com o aviso na observação.
 *   - Troco em `change_for` OU `change_of` (a doc usa os dois nomes).
 *   - `onsite` (consumo no local) é retirada com a nota; `closed_table` (mesa e
 *     comanda) nunca entra.
 *
 * O FILTRO (o que não entra) também mora aqui, puro, para o teste provar cada
 * regra com o pedido da doc.
 */
import {
  traduzirPedidoOpenDelivery,
  reais,
  texto,
  type CanalOD,
  type ContextoOD,
  type ItemOD,
  type OpcaoOD,
  type PedidoOD,
  type TraducaoOD,
} from "@/lib/open-delivery/traducao";
import { chaveDaLojaCW, type AmbienteCW } from "./id-do-pedido";

export const CANAL_CARDAPIOWEB: CanalOD = { chave: "CARDAPIOWEB", nome: "CardápioWeb", prefixo: "cardapioweb" };

/** Os canais de venda do PRÓPRIO CardápioWeb. Só eles entram por padrão. */
export const CANAIS_PROPRIOS_CW = ["catalog", "store_front_catalog", "portal", "whatsapp_extension"];

/**
 * Canais de marketplace que o CardápioWeb repassa. A doc só lista `ifood`; os
 * outros nomes (99Food, Keeta, aiqfome) são a aposta mais provável — canal
 * fora das duas listas cai em "canal desconhecido", que não entra e avisa.
 */
const CANAIS_DE_MARKETPLACE = ["ifood", "food99", "99food", "keeta", "aiqfome"];

export function ehCanalDeMarketplaceCW(salesChannel: unknown): boolean {
  return CANAIS_DE_MARKETPLACE.includes(minusc(salesChannel));
}

/** Pagamento feito no app do marketplace: o pedido é de lá, não da loja. */
const PAGAMENTOS_DE_MARKETPLACE = new Set(["ifood", "ifood_voucher", "food99", "food99_voucher"]);

const NOME_DO_MARKETPLACE: Record<string, string> = { ifood: "iFood", food99: "99Food", "99food": "99Food", keeta: "Keeta", aiqfome: "aiqfome" };

// ── Formato do CardápioWeb (o que a doc declara; o resto é tolerado) ────────

export type OpcaoCW = {
  option_id?: number | string | null;
  external_code?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  option_group_id?: number | string | null;
  option_group_name?: string | null;
  option_group_total_selected_options?: number | null;
  [k: string]: unknown;
};

export type ItemCW = {
  item_id?: number | string | null;
  order_item_id?: number | string | null;
  external_code?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  kind?: string | null;
  status?: string | null;
  observation?: string | null;
  options?: OpcaoCW[] | null;
  /** As etapas do combo — fora do schema, presente no exemplo da doc. */
  items?: ItemCW[] | null;
  [k: string]: unknown;
};

export type PagamentoCW = {
  total?: number | string | null;
  payment_method?: string | null;
  payment_type?: string | null;
  payment_fee?: number | string | null;
  change_for?: number | string | null;
  change_of?: number | string | null;
  status?: string | null;
  card_brand?: string | null;
  card_number?: string | null;
  observation?: string | null;
  [k: string]: unknown;
};

export type PedidoCW = {
  id?: number | string | null;
  display_id?: number | string | null;
  merchant_id?: number | string | null;
  status?: string | null;
  order_type?: string | null;
  order_timing?: string | null;
  sales_channel?: string | null;
  customer_origin?: string | null;
  external_order_id?: string | null;
  external_display_id?: string | null;
  delivered_by?: string | null;
  estimated_time?: number | string | null;
  cancellation_reason?: string | null;
  fiscal_document?: string | null;
  observation?: string | null;
  delivery_fee?: number | string | null;
  service_fee?: number | string | null;
  additional_fee?: number | string | null;
  total?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  schedule?: { scheduled_date_time_start?: string | null; scheduled_date_time_end?: string | null } | null;
  customer?: { id?: number | string | null; name?: string | null; phone?: string | null; ddi?: string | null } | null;
  delivery_address?: Record<string, any> | null;
  items?: ItemCW[] | null;
  discounts?: Array<Record<string, any>> | null;
  payments?: PagamentoCW[] | null;
  [k: string]: unknown;
};

// ── Leitores pequenos ────────────────────────────────────────────────────────

const minusc = (v: unknown) => texto(v).toLowerCase();

/** Número de verdade (0 vale; vazio, null e booleano não). */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function qtd(v: unknown): number {
  const n = num(v);
  return n !== null && n > 0 ? n : 1;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function data(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

const brl = (n: number) => `R$${n.toFixed(2)}`;

// ── O filtro ─────────────────────────────────────────────────────────────────

export type MotivoDoFiltro =
  | "sem-id"
  | "mesa"
  | "marketplace"
  | "canal-desconhecido"
  | "antes-da-conexao"
  | "aguardando-pagamento"
  | "cancelando"
  | "cancelado"
  | "passou-da-cozinha"
  | "status-desconhecido";

export type DecisaoDoFiltro =
  | { importar: true; marketplace: string | null; statusInicial: "ACEITO" | null }
  | { importar: false; motivo: MotivoDoFiltro; texto: string; alertar: boolean };

/** De qual marketplace é o pedido (null = venda do próprio CardápioWeb). */
export function marketplaceDoPedido(p: PedidoCW): string | null {
  const canal = minusc(p.sales_channel);
  if (CANAIS_DE_MARKETPLACE.includes(canal)) return NOME_DO_MARKETPLACE[canal] || canal;
  const pagamento = (p.payments || []).map((x) => minusc(x?.payment_method)).find((m) => PAGAMENTOS_DE_MARKETPLACE.has(m));
  if (pagamento) return pagamento.startsWith("food99") ? "99Food" : "iFood";
  if (texto(p.external_order_id)) return "marketplace";
  return null;
}

/**
 * Este pedido entra no FireHub? Na ordem: mesa nunca; marketplace só com a
 * opção ligada; canal que ninguém conhece não (e avisa); pedido de antes da
 * conexão não (a 1ª conexão traz até 8 h de histórico — nunca importar nem
 * confirmar em massa); pagamento pendente espera; cancelado não; o que já
 * passou da cozinha lá não entra para não ser feito duas vezes (e avisa — é
 * sinal de que o FireHub perdeu o começo do pedido).
 */
export function filtroDoPedidoCW(p: PedidoCW, opcoes: { receberMarketplaces: boolean; importarDesde?: Date | null }): DecisaoDoFiltro {
  if (!texto(p.id)) return { importar: false, motivo: "sem-id", texto: "pedido sem id", alertar: true };
  if (minusc(p.order_type) === "closed_table") return { importar: false, motivo: "mesa", texto: "mesa/comanda do CardápioWeb não entra", alertar: false };

  const canal = minusc(p.sales_channel);
  const marketplace = marketplaceDoPedido(p);
  if (marketplace) {
    if (!opcoes.receberMarketplaces) {
      return { importar: false, motivo: "marketplace", texto: `pedido do ${marketplace} repassado pelo CardápioWeb (a opção de receber marketplaces está desligada)`, alertar: false };
    }
  } else if (!CANAIS_PROPRIOS_CW.includes(canal)) {
    return { importar: false, motivo: "canal-desconhecido", texto: `canal de venda desconhecido: "${texto(p.sales_channel) || "(vazio)"}"`, alertar: true };
  }

  const criado = data(p.created_at);
  if (opcoes.importarDesde && criado && criado.getTime() < opcoes.importarDesde.getTime()) {
    return { importar: false, motivo: "antes-da-conexao", texto: "pedido de antes da conexão com o FireHub", alertar: false };
  }

  const status = minusc(p.status);
  switch (status) {
    case "waiting_confirmation":
    case "":
      return { importar: true, marketplace, statusInicial: null };
    case "confirmed":
    case "scheduled_confirmed":
      // Já aceito lá (aceite automático do CardápioWeb, ou alguém no portal):
      // entra aceito, sem pedir o "aceitar" duas vezes.
      return { importar: true, marketplace, statusInicial: "ACEITO" };
    case "pending_payment":
    case "pending_online_payment":
      return { importar: false, motivo: "aguardando-pagamento", texto: "esperando o pagamento — entra quando for pago", alertar: false };
    case "canceling":
      return { importar: false, motivo: "cancelando", texto: "em cancelamento no CardápioWeb — espera a decisão", alertar: false };
    case "canceled":
      return { importar: false, motivo: "cancelado", texto: "cancelado antes de entrar", alertar: false };
    case "ready":
    case "released":
    case "waiting_to_catch":
    case "delivered":
    case "closed":
      return { importar: false, motivo: "passou-da-cozinha", texto: `chegou ao FireHub já "${status}" no CardápioWeb — não entra para não ser feito de novo`, alertar: true };
    default:
      return { importar: false, motivo: "status-desconhecido", texto: `status desconhecido: "${texto(p.status)}"`, alertar: true };
  }
}

// ── Itens ────────────────────────────────────────────────────────────────────

function opcaoDoGrupo(o: OpcaoCW, idPrefixo = ""): OpcaoOD {
  // Média, maior ou menor: o sabor não soma; o total do item já diz o valor.
  const pelaRegraDoGrupo = num(o.option_group_total_selected_options) !== null;
  const unit = num(o.unit_price);
  const total = num(o.total_price);
  return {
    id: `${idPrefixo}${texto(o.option_id) || texto(o.external_code) || slug(texto(o.name))}`,
    externalCode: texto(o.external_code) || null,
    name: texto(o.name),
    quantity: qtd(o.quantity),
    ...(pelaRegraDoGrupo ? { unitPrice: 0 } : unit !== null ? { unitPrice: unit } : total !== null ? { totalPrice: total } : { unitPrice: 0 }),
  };
}

/**
 * As escolhas de um item, achatadas: `options` do jeito que vieram e cada
 * etapa de `items` como opção irmã de preço 0 — o nome do produto escolhido
 * na etapa e, logo abaixo, os complementos dele. A quantidade sai por UNIDADE
 * do item pai (2 refrigerantes numa etapa de quantidade 2 = "2x").
 */
function escolhasDoItem(item: ItemCW, multiplicador = 1, idPrefixo = ""): OpcaoOD[] {
  const lista: OpcaoOD[] = [];
  for (const o of Array.isArray(item.options) ? item.options : []) {
    if (!o || typeof o !== "object") continue;
    const op = opcaoDoGrupo(o, idPrefixo);
    if (!op.name) continue;
    if (multiplicador !== 1) op.quantity = qtd(op.quantity) * multiplicador;
    // Opção de etapa de combo: o preço é o da etapa, já dentro do combo.
    if (idPrefixo) {
      delete op.totalPrice;
      op.unitPrice = 0;
    }
    lista.push(op);
  }
  (Array.isArray(item.items) ? item.items : []).forEach((etapa, i) => {
    if (!etapa || typeof etapa !== "object" || minusc(etapa.status) === "canceled") return;
    const nome = texto(etapa.name);
    const q = qtd(etapa.quantity) * multiplicador;
    const prefixo = `${idPrefixo}etapa${i + 1}-`;
    if (nome) {
      lista.push({
        id: `${prefixo}${texto(etapa.item_id) || slug(nome)}`,
        name: nome,
        quantity: q,
        unitPrice: 0,
        specialInstructions: texto(etapa.observation) || null,
      });
    }
    lista.push(...escolhasDoItem(etapa, q, prefixo));
  });
  return lista;
}

function itemParaOD(item: ItemCW, chaveDaLoja: string): ItemOD {
  const nome = texto(item.name);
  const codigo = texto(item.item_id) || texto(item.external_code) || `nome-${slug(nome)}`;
  const unit = num(item.unit_price);
  const total = num(item.total_price);
  return {
    // A loja do CardápioWeb no código do espelho: duas marcas na mesma conta
    // não dividem o espelho de um item com o mesmo id.
    id: `${chaveDaLoja}-${codigo}`,
    externalCode: texto(item.external_code) || null,
    name: nome,
    quantity: num(item.quantity) ?? 1,
    ...(unit !== null ? { unitPrice: unit } : {}),
    ...(total !== null ? { totalPrice: total } : {}),
    specialInstructions: texto(item.observation) || null,
    options: escolhasDoItem(item),
  };
}

// ── Pagamento ────────────────────────────────────────────────────────────────

/** O `method` do Open Delivery para cada forma do CardápioWeb. O que não está aqui a base escreve "Não informado". */
const METODO_OD: Record<string, string> = {
  money: "CASH",
  credit_card: "CREDIT",
  debit_card: "DEBIT",
  pix: "PIX",
  pix_auto: "PIX",
  online_credit_card: "CREDIT",
  meal_voucher: "MEAL_VOUCHER",
  food_voucher: "FOOD_VOUCHER",
  bank_transfer: "BANK_TRANSFER",
  bank_slip: "BANK_SLIP",
  picpay: "PICPAY",
  debt_book: "DEBT_BOOK",
  ifood: "OTHER",
  ifood_voucher: "OTHER",
  food99: "OTHER",
  food99_voucher: "OTHER",
};

const NOME_DA_FORMA: Record<string, string> = {
  money: "Dinheiro",
  credit_card: "Crédito",
  debit_card: "Débito",
  pix: "Pix",
  pix_auto: "Pix",
  meal_voucher: "Vale-refeição",
  food_voucher: "Vale-alimentação",
  bank_transfer: "Transferência",
  bank_slip: "Boleto",
  picpay: "PicPay",
  debt_book: "Fiado",
};

/**
 * "Troco para" — a NOTA com que o cliente paga. A doc chama de `change_for`
 * no schema e de `change_of` no exemplo. `change_of` maior que o valor só
 * pode ser a nota; menor só pode ser o troco em si (ninguém paga R$ 80 com
 * uma nota de R$ 20). Os dois casos ficam no aviso até o pedido real dizer.
 */
function trocoPara(p: PagamentoCW, avisos: string[]): number | null {
  const valorPago = num(p.total) ?? 0;
  const para = num(p.change_for);
  if (para !== null) return para > 0 ? para : null;
  const de = num(p.change_of);
  if (de === null || de <= 0) return null;
  if (de > valorPago + 0.009) {
    avisos.push(`troco em change_of (${de.toFixed(2)}) lido como "troco para"`);
    return de;
  }
  if (de < valorPago - 0.009) {
    avisos.push(`troco em change_of (${de.toFixed(2)}) menor que o valor pago (${valorPago.toFixed(2)}): lido como o TROCO — nota de ${(valorPago + de).toFixed(2)}`);
    return reais(valorPago + de);
  }
  return null;
}

// ── A tradução ───────────────────────────────────────────────────────────────

export type AdaptacaoCW = { pedido: PedidoOD; notas: string[]; avisos: string[] };

/** O pedido do CardápioWeb no contrato da base. Puro. */
export function pedidoCWParaOD(p: PedidoCW, ctx: { ambiente: AmbienteCW; companyId: string; marketplace?: string | null }): AdaptacaoCW {
  const avisos: string[] = [];
  const notas: string[] = [];
  const chaveDaLoja = chaveDaLojaCW(ctx.ambiente, ctx.companyId);
  const tipoCW = minusc(p.order_type);
  const tipo = tipoCW === "delivery" ? "DELIVERY" : tipoCW === "takeout" || tipoCW === "onsite" ? "TAKEOUT" : tipoCW ? "TAKEOUT" : "DELIVERY";
  if (tipoCW && !["delivery", "takeout", "onsite"].includes(tipoCW)) avisos.push(`tipo de pedido desconhecido "${tipoCW}" — entrou como retirada`);
  const criado = data(p.created_at);
  const minutos = num(p.estimated_time);
  const previsto = criado && minutos !== null && minutos > 0 ? new Date(criado.getTime() + minutos * 60_000).toISOString() : null;

  // Itens: o cancelado vem só "para controle" (doc) e não conta.
  const itens: ItemOD[] = [];
  for (const item of Array.isArray(p.items) ? p.items : []) {
    if (!item || typeof item !== "object") continue;
    if (minusc(item.status) === "canceled") continue;
    const kind = minusc(item.kind);
    if (kind && kind !== "regular_item" && kind !== "combo") avisos.push(`item "${texto(item.name)}" de tipo desconhecido "${kind}"`);
    if (kind === "combo" && !(Array.isArray(item.items) && item.items.length > 0) && !(Array.isArray(item.options) && item.options.length > 0)) {
      avisos.push(`combo "${texto(item.name)}" veio sem as etapas`);
    }
    itens.push(itemParaOD(item, chaveDaLoja));
  }

  // Taxas: todas da LOJA no CardápioWeb.
  const pagamentos = (Array.isArray(p.payments) ? p.payments : []).filter((x) => x && typeof x === "object");
  const taxaDosPagamentos = reais(pagamentos.reduce((s, x) => s + (num(x.payment_fee) ?? 0), 0));
  const otherFees: NonNullable<PedidoOD["otherFees"]> = [];
  const taxa = (name: string, type: string, price: number | null) => {
    if (price !== null && price > 0) otherFees.push({ name, type, receivedBy: "MERCHANT", price });
  };
  taxa("Taxa de entrega", "DELIVERY_FEE", num(p.delivery_fee));
  taxa("Taxa adicional", "ADDITIONAL_FEE", num(p.additional_fee));
  taxa("Taxa da forma de pagamento", "PAYMENT_FEE", taxaDosPagamentos);
  taxa("Taxa de serviço", "SERVICE_FEE", num(p.service_fee));

  // Descontos: `sponsorship` diz quem paga. Sem ele, é da loja (a leitura que
  // não infla o repasse) — e o código do cupom vai junto.
  const discounts: NonNullable<PedidoOD["discounts"]> = [];
  for (const d of Array.isArray(p.discounts) ? p.discounts : []) {
    if (!d || typeof d !== "object") continue;
    const v = num(d.total) ?? 0;
    if (v <= 0) continue;
    const kind = minusc(d.kind);
    const quem = minusc(d.sponsorship);
    const codigo = minusc(d.category) === "coupon" ? texto(d.coupon_code) || texto(d.coupon_name) : "";
    discounts.push({
      value: v,
      target: kind === "free_delivery" ? "DELIVERY_FEE" : kind === "item" ? "ITEM" : "CART",
      sponsorshipValues: [{ name: quem && quem !== "merchant" ? "MARKETPLACE" : "MERCHANT", value: v, discountCode: codigo || null }],
    });
    if (minusc(d.category) === "loyalty") {
      const pontos = num(d.total_points);
      notas.push(`🎁 Fidelidade do CardápioWeb: ${texto(d.item_name) || "desconto"} (-${brl(v)}${pontos ? `, ${pontos} pontos` : ""})`);
    }
  }

  // Pagamentos.
  const methods: NonNullable<NonNullable<PedidoOD["payments"]>["methods"]> = [];
  let prepaid = 0;
  let pending = 0;
  for (const x of pagamentos) {
    const forma = minusc(x.payment_method);
    const valor = num(x.total) ?? 0;
    const status = minusc(x.status);
    const pago = minusc(x.payment_type) === "online" && (status === "paid" || status === "authorized");
    if (pago) prepaid += valor;
    else pending += valor;
    if (minusc(x.payment_type) === "online" && !pago) {
      notas.push(`⚠️ Pagamento online ${status || "sem status"} no CardápioWeb — COBRAR na entrega`);
    }
    if (!pago && status === "paid") {
      notas.push(`💰 ${NOME_DA_FORMA[forma] || forma || "Pagamento"} marcado como PAGO no CardápioWeb — confira antes de cobrar`);
    }
    const metodo = METODO_OD[forma] ?? (forma ? forma.toUpperCase() : "");
    const troco = forma === "money" ? trocoPara(x, avisos) : null;
    methods.push({
      value: valor,
      currency: "BRL",
      type: pago ? "PREPAID" : "PENDING",
      method: metodo,
      brand: texto(x.card_brand) || null,
      ...(troco !== null ? { changeFor: troco } : {}),
    });
  }

  // Cliente: telefone nacional (o resto do FireHub põe o 55 quando precisa);
  // DDI de fora vai junto, para não virar um número brasileiro de outra pessoa.
  const c = p.customer && typeof p.customer === "object" ? p.customer : null;
  const ddi = texto(c?.ddi).replace(/\D/g, "");
  const fone = texto(c?.phone).replace(/\D/g, "");
  const telefone = fone && ddi && ddi !== "55" ? `${ddi}${fone}` : fone;
  const documento = texto(p.fiscal_document);

  const endereco = p.delivery_address && typeof p.delivery_address === "object" ? p.delivery_address : null;
  const complemento = endereco
    ? [texto(endereco.complement), texto(endereco.address_block) ? `Quadra ${texto(endereco.address_block)}` : "", texto(endereco.address_lot) ? `Lote ${texto(endereco.address_lot)}` : ""]
        .filter(Boolean)
        .join(", ")
    : "";

  const quemEntrega = minusc(p.delivered_by);
  const agendado = minusc(p.order_timing) === "scheduled";

  const pedido: PedidoOD = {
    id: `${chaveDaLoja}_${texto(p.id)}`,
    type: tipo,
    displayId: texto(p.display_id) || null,
    createdAt: texto(p.created_at) || null,
    orderTiming: agendado ? "SCHEDULED" : "INSTANT",
    merchant: { id: texto(p.merchant_id) || ctx.companyId, name: null },
    items: itens,
    otherFees,
    discounts,
    total: { orderAmount: num(p.total) ?? undefined },
    payments: { prepaid: reais(prepaid), pending: reais(pending), methods },
    customer: c || documento
      ? { id: texto(c?.id) || null, name: texto(c?.name) || null, documentNumber: documento || null, phone: telefone ? { number: telefone } : null }
      : null,
    schedule: agendado && p.schedule
      ? { scheduledDateTimeStart: texto(p.schedule.scheduled_date_time_start) || null, scheduledDateTimeEnd: texto(p.schedule.scheduled_date_time_end) || null }
      : null,
    delivery:
      tipo === "DELIVERY"
        ? {
            deliveredBy: !quemEntrega || quemEntrega === "merchant" ? "MERCHANT" : quemEntrega.toUpperCase(),
            estimatedDeliveryDateTime: previsto,
            deliveryAddress: endereco
              ? {
                  street: endereco.street,
                  number: endereco.number,
                  complement: complemento,
                  reference: endereco.reference,
                  neighborhood: endereco.neighborhood,
                  city: endereco.city,
                  state: endereco.state,
                  postalCode: endereco.postal_code,
                  latitude: endereco.latitude,
                  longitude: endereco.longitude,
                }
              : null,
          }
        : null,
    takeout: tipo === "TAKEOUT" ? { mode: tipoCW === "onsite" ? "ONSITE" : "DEFAULT", takeoutDateTime: previsto } : null,
    extraInfo: texto(p.observation) || null,
  };

  if (tipoCW === "onsite") notas.push("🍽️ CONSUMO NO LOCAL (o cliente come na loja)");
  if (quemEntrega && quemEntrega !== "merchant") {
    const quem = quemEntrega === "ifood_shipping" ? "iFood Sob Demanda" : quemEntrega === "foody_delivery" ? "Foody Delivery" : quemEntrega;
    notas.push(`🛵 Entrega pelo ${quem} (chamada pelo CardápioWeb) — não mande o motoboy da loja`);
  }
  if (ctx.marketplace) {
    notas.push(`🛒 Pedido do ${ctx.marketplace} recebido pelo CardápioWeb${texto(p.external_display_id) ? ` (nº no app: ${texto(p.external_display_id)})` : ""}`);
  }
  if (texto(p.customer_origin)) notas.push(`📣 Origem do link do cardápio: ${texto(p.customer_origin)}`);

  return { pedido, notas, avisos };
}

export type ContextoCW = Omit<ContextoOD, "canal"> & {
  ambiente: AmbienteCW;
  companyId: string;
  /** "ACEITO" quando o CardápioWeb já aceitou (filtro). */
  statusInicial?: "ACEITO" | null;
  marketplace?: string | null;
};

/** Pedido do CardápioWeb → o que `gravarPedidoOpenDelivery` grava. Puro. */
export function traduzirPedidoCardapioWeb(p: PedidoCW, ctx: ContextoCW): TraducaoOD {
  const { pedido, notas, avisos } = pedidoCWParaOD(p, { ambiente: ctx.ambiente, companyId: ctx.companyId, marketplace: ctx.marketplace });
  const traducao = traduzirPedidoOpenDelivery(pedido, {
    lojaId: ctx.lojaId,
    fuso: ctx.fuso,
    autoAcceptOrders: ctx.autoAcceptOrders,
    canal: CANAL_CARDAPIOWEB,
    agora: ctx.agora,
  });
  if (notas.length > 0) traducao.dados.notes = [traducao.dados.notes, ...notas].filter(Boolean).join("\n");
  if (ctx.statusInicial === "ACEITO" && traducao.dados.status === "NOVO") traducao.dados.status = "ACEITO";
  traducao.avisos.unshift(...avisos);
  return traducao;
}

// ── Status do CardápioWeb → FireHub ─────────────────────────────────────────

/** Só avança: aviso atrasado não leva pedido entregue de volta para "pronto". */
export const RANK_DO_FIREHUB: Record<string, number> = {
  NOVO: 0,
  PENDENTE: 0,
  ACEITO: 1,
  CONFIRMADO: 1,
  PREPARANDO: 2,
  EM_PREPARO: 2,
  PRONTO: 3,
  SAIU_ENTREGA: 4,
  SAIU_PARA_ENTREGA: 4,
  ENTREGUE: 5,
  FINALIZADO: 5,
  CANCELADO: 9,
};

/**
 * O status do FireHub que um status do CardápioWeb pede. Retirada pronta no
 * CardápioWeb (`waiting_to_catch`) é o SAIU_ENTREGA do FireHub — é o que o
 * KDS grava quando a retirada fica pronta. `waiting_confirmation`, pagamento
 * pendente e `canceling` não mexem em nada.
 */
export function statusDoFireHubPara(statusCW: string | null | undefined): string | null {
  switch (minusc(statusCW)) {
    case "confirmed":
    case "scheduled_confirmed":
      return "ACEITO";
    case "ready":
      return "PRONTO";
    case "waiting_to_catch":
    case "released":
      return "SAIU_ENTREGA";
    case "delivered":
    case "closed":
      return "ENTREGUE";
    case "canceled":
      return "CANCELADO";
    default:
      return null;
  }
}
