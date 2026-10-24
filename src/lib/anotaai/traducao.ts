/**
 * lib/anotaai/traducao.ts — pedido do Anota AI → PedidoOD → dados do CustomerOrder.
 *
 * Função pura (sem banco, sem rede), no molde de lib/cardapioweb/traducao.ts:
 * adapta o formato próprio do Anota AI (o `GET /ping/get/{id}` da API v2) ao
 * contrato da base Open Delivery e deixa a base fazer o resto.
 *
 * ── O que é do Anota AI e a base não sabe ───────────────────────────────────
 *
 *   - `items[].id` e `subItems[].id` são POSIÇÕES (0, 1, 2…), não ids: dois
 *     pedidos têm "id 0" em produtos diferentes. O código do espelho sai do
 *     `internalId` (o id do produto no Anota AI), senão do nome.
 *   - `items[].total` é a LINHA com os adicionais (Lanchão 13 + bacon 2,50 +
 *     ovo 2 = 17,50; refrigerante 2 × 10 = 20). Vai como `totalPrice`, e a
 *     base divide pela quantidade.
 *   - Pizza em fração: "1/3 Morango" com `price` 15 e `total` 5 — o que conta
 *     é o `total` do subitem. Os preços do subitem vêm em duas grafias na doc
 *     (`price`/`total` e `unitPrice`/`totalPrice`/`new_*`); lemos todas.
 *   - `payments[].value` é TEXTO ("20"); `prepaid: true` é o pago online.
 *   - `type`: DELIVERY, TAKE (retirada) e LOCAL (mesa). Mesa, garçom e PDV do
 *     Anota AI não entram (o salão é do FireHub).
 *   - Agendado: `schedule_order.date` é quando ENTRA EM PRODUÇÃO (UTC), e
 *     `start`/`end` são a janela que o cliente escolheu, na hora local.
 *   - `check` é o status: 0 análise, 1 produção, 2 pronto, 3 finalizado,
 *     4 cancelado, 5 negado (15 min sem aceite), 6 pedido de cancelamento,
 *     -2 agendado aceito, -1 aguardando pagamento, 41/42 cancelamentos internos.
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

export const CANAL_ANOTAAI: CanalOD = { chave: "ANOTAAI", nome: "Anota AI", prefixo: "anotaai" };

// ── Formato do Anota AI (o que a doc declara; o resto é tolerado) ───────────

type Preco = number | string | null | undefined;

export type SubItemAnotaAi = {
  _id?: string | null;
  id?: number | string | null;
  name?: string | null;
  quantity?: number | string | null;
  price?: Preco;
  total?: Preco;
  unitPrice?: Preco;
  totalPrice?: Preco;
  new_unitPrice?: Preco;
  new_totalPrice?: Preco;
  externalCode?: string | null;
  externalId?: string | null;
  quantityFraction?: number | string | null;
  observation?: string | null;
  [k: string]: unknown;
};

export type ItemAnotaAi = SubItemAnotaAi & { internalId?: string | null; subItems?: SubItemAnotaAi[] | null; orderId?: string | null };

export type PagamentoAnotaAi = {
  name?: string | null;
  code?: string | null;
  value?: Preco;
  cardSelected?: string | null;
  changeFor?: Preco;
  prepaid?: boolean | null;
  [k: string]: unknown;
};

export type PedidoAnotaAi = {
  _id?: string | null;
  id?: string | null;
  check?: number | string | null;
  shortReference?: number | string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  type?: string | null;
  from?: string | null;
  salesChannel?: string | null;
  ifood_id?: string | null;
  merchant?: { id?: string | null; name?: string | null; unit?: string | null } | null;
  customer?: { id?: string | null; name?: string | null; phone?: string | null; taxPayerIdentificationNumber?: string | null } | null;
  items?: ItemAnotaAi[] | null;
  payments?: PagamentoAnotaAi[] | null;
  additionalFees?: Array<{ type?: string | null; description?: string | null; value?: Preco }> | null;
  discounts?: Array<{ amount?: Preco; tag?: string | null; target?: string | null }> | null;
  deliveryFee?: Preco;
  total?: Preco;
  observation?: string | null;
  deliveryAddress?: Record<string, any> | null;
  schedule_order?: { date?: string | null; start?: string | null; end?: string | null; timezone?: string | null } | null;
  table?: string | null;
  qr_description?: string | null;
  pdv?: { status?: boolean | null; mode?: number | null; table?: string | null } | null;
  main_order?: boolean | null;
  [k: string]: unknown;
};

// ── Leitores pequenos ────────────────────────────────────────────────────────

const minusc = (v: unknown) => texto(v).toLowerCase();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(String(v).replace(",", "."));
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

export function checkDo(p: { check?: unknown }): number | null {
  return num(p.check);
}

/** O primeiro preço que veio, na ordem dada (0 vale). */
function primeiro(...vs: unknown[]): number | null {
  for (const v of vs) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
}

/**
 * "13:00" na data local de `instante`, no fuso `tz` → o instante UTC.
 * Usado no agendado: a janela vem em hora local e o dia sai do `date`.
 */
export function horaLocalNoDia(instante: Date, hhmm: string, tz: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  let partes: Record<string, string>;
  try {
    partes = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(instante)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    return null;
  }
  const comoUtc = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(m[1]), Number(m[2]));
  // O deslocamento do fuso naquele instante (Brasil hoje não tem horário de verão, mas o cálculo não supõe).
  const local = new Date(new Date(comoUtc).toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(new Date(comoUtc).toLocaleString("en-US", { timeZone: "UTC" }));
  const d = new Date(comoUtc + (utc.getTime() - local.getTime()));
  return Number.isFinite(d.getTime()) ? d : null;
}

// ── O filtro ─────────────────────────────────────────────────────────────────

export type MotivoDoFiltroAnotaAi =
  | "sem-id"
  | "ifood"
  | "mesa"
  | "antes-da-conexao"
  | "aguardando-pagamento"
  | "cancelado"
  | "passou-da-cozinha"
  | "status-desconhecido";

export type DecisaoAnotaAi =
  | { importar: true; statusInicial: "ACEITO" | null }
  | { importar: false; motivo: MotivoDoFiltroAnotaAi; texto: string; alertar: boolean };

/** Mesa, garçom ou pedido agrupado de mesa — o salão do Anota AI. */
export function ehMesaAnotaAi(p: Pick<PedidoAnotaAi, "type" | "from" | "table" | "main_order">): boolean {
  if (minusc(p.type) === "local") return true;
  if (texto(p.table) || p.main_order) return true;
  return ["waiter-app", "table-merged"].includes(minusc(p.from));
}

/**
 * Este pedido entra no FireHub? Na ordem: iFood repassado nunca (o iFood liga
 * direto no FireHub, e o mesmo pedido pelos dois caminhos é dobro na
 * cozinha); mesa nunca; pedido de antes da conexão não; aguardando pagamento
 * espera; cancelado/negado não; o que já passou da cozinha lá não entra para
 * não ser feito duas vezes (e avisa).
 */
export function filtroDoPedidoAnotaAi(p: PedidoAnotaAi, opcoes: { importarDesde?: Date | null }): DecisaoAnotaAi {
  if (!texto(p._id ?? p.id)) return { importar: false, motivo: "sem-id", texto: "pedido sem id", alertar: true };
  if (minusc(p.salesChannel) === "ifood" || texto(p.ifood_id)) {
    return { importar: false, motivo: "ifood", texto: "pedido do iFood repassado pelo Anota AI (o iFood entra direto no FireHub)", alertar: false };
  }
  if (ehMesaAnotaAi(p)) return { importar: false, motivo: "mesa", texto: "mesa/garçom do Anota AI não entra", alertar: false };

  const criado = data(p.createdAt);
  if (opcoes.importarDesde && criado && criado.getTime() < opcoes.importarDesde.getTime()) {
    return { importar: false, motivo: "antes-da-conexao", texto: "pedido de antes da conexão com o FireHub", alertar: false };
  }

  const check = checkDo(p);
  switch (check) {
    case 0:
    case -3:
      return { importar: true, statusInicial: null };
    case 1:
    case -2:
      // Já aceito lá (aceite automático do Anota AI, ou alguém no admin
      // deles): entra aceito, sem pedir o "aceitar" duas vezes.
      return { importar: true, statusInicial: "ACEITO" };
    case -1:
      return { importar: false, motivo: "aguardando-pagamento", texto: "esperando o pagamento — entra quando for pago", alertar: false };
    case 4:
    case 5:
    case 6:
    case 41:
    case 42:
    case -4:
      return { importar: false, motivo: "cancelado", texto: "cancelado ou negado antes de entrar", alertar: false };
    case 2:
    case 3:
      return { importar: false, motivo: "passou-da-cozinha", texto: `chegou ao FireHub já ${check === 2 ? "pronto" : "finalizado"} no Anota AI — não entra para não ser feito de novo`, alertar: true };
    default:
      return { importar: false, motivo: "status-desconhecido", texto: `status desconhecido: check ${texto(p.check) || "(vazio)"}`, alertar: true };
  }
}

// ── Itens ────────────────────────────────────────────────────────────────────

function subItemParaOD(s: SubItemAnotaAi): OpcaoOD | null {
  const nome = texto(s.name);
  if (!nome) return null;
  const q = qtd(s.quantity);
  // O que o subitem COBROU: a linha (fração de pizza incluída) ÷ quantidade;
  // sem linha, o unitário.
  const linha = primeiro(s.new_totalPrice, s.totalPrice, s.total);
  const unit = linha !== null ? linha / q : primeiro(s.new_unitPrice, s.unitPrice, s.price) ?? 0;
  return {
    id: texto(s._id) || `${slug(nome)}-${Math.round(unit * 100)}`,
    externalCode: texto(s.externalId) && texto(s.externalId) !== "null" ? texto(s.externalId) : null,
    name: nome,
    quantity: q,
    unitPrice: reais(unit),
    specialInstructions: texto(s.observation) || null,
  };
}

function itemParaOD(item: ItemAnotaAi, pageId: string): ItemOD {
  const nome = texto(item.name);
  const codigo = texto(item.internalId) || `nome-${slug(nome)}`;
  const unit = primeiro(item.new_unitPrice, item.unitPrice, item.price);
  const linha = primeiro(item.new_totalPrice, item.totalPrice, item.total);
  const opcoes = (Array.isArray(item.subItems) ? item.subItems : []).map((s) => (s && typeof s === "object" ? subItemParaOD(s) : null)).filter(Boolean) as OpcaoOD[];
  return {
    // A página no código do espelho: duas marcas na mesma conta não dividem
    // o espelho de um produto com o mesmo id.
    id: `${pageId}-${codigo}`,
    externalCode: texto(item.externalId) && texto(item.externalId) !== "null" ? texto(item.externalId) : null,
    name: nome,
    quantity: num(item.quantity) ?? 1,
    ...(unit !== null ? { unitPrice: unit } : {}),
    ...(linha !== null ? { totalPrice: linha } : {}),
    specialInstructions: texto(item.observation) || null,
    options: opcoes,
  };
}

// ── Pagamento ────────────────────────────────────────────────────────────────

/** O `method` do Open Delivery para cada código do Anota AI. O que não está aqui a base escreve "Não informado". */
const METODO_OD: Record<string, string> = {
  money: "CASH",
  card: "CREDIT",
  credit: "CREDIT",
  debit: "DEBIT",
  pix: "PIX",
  "pix-ifood": "PIX",
  online: "OTHER",
  online_credit: "CREDIT",
  online_tuna: "OTHER",
  tuna_nupay_credit: "CREDIT",
  tuna_nupay_debit: "DEBIT",
  tuna_wallet_credit: "CREDIT",
  tuna_wallet_debit: "DEBIT",
  tuna_minimal_payment_link: "OTHER",
  "ifood-pago-credit": "CREDIT",
  "ifood-pago-debit": "DEBIT",
  "ifood-pago-pix": "PIX",
  "ifood-pago-voucher": "MEAL_VOUCHER",
  "ifood-pago-credit-pinpad": "CREDIT",
  "ifood-pago-debit-pinpad": "DEBIT",
  "ifood-pago-pix-pinpad": "PIX",
  "ifood-online-credit-payin": "CREDIT",
  "ifood-online-pix-payin": "PIX",
};

/** Etiquetas de desconto que NÃO são código de cupom (doc: Fidelidade, Cashback, promoção, Desconto via PDV). */
const DESCONTOS_SEM_CUPOM = ["fidelidade", "cashback", "promoção", "promocao", "desconto via pdv"];

// ── A tradução ───────────────────────────────────────────────────────────────

export type AdaptacaoAnotaAi = { pedido: PedidoOD; notas: string[]; avisos: string[] };

/** O pedido do Anota AI no contrato da base. Puro. */
export function pedidoAnotaAiParaOD(p: PedidoAnotaAi, ctx: { pageId: string; fuso: string }): AdaptacaoAnotaAi {
  const avisos: string[] = [];
  const notas: string[] = [];
  const orderId = texto(p._id ?? p.id);
  const tipoAnota = minusc(p.type);
  const tipo = tipoAnota === "take" ? "TAKEOUT" : "DELIVERY";
  if (tipoAnota && !["delivery", "take"].includes(tipoAnota)) avisos.push(`tipo de pedido desconhecido "${tipoAnota}" — entrou como entrega`);

  const itens: ItemOD[] = [];
  for (const item of Array.isArray(p.items) ? p.items : []) {
    if (!item || typeof item !== "object") continue;
    itens.push(itemParaOD(item, ctx.pageId));
  }

  // Taxas: a entrega é da loja; a taxa do pagamento online (`addition_pol`)
  // fica com o Anota AI; gorjeta é gorjeta; o resto, da loja.
  const otherFees: NonNullable<PedidoOD["otherFees"]> = [];
  const entrega = num(p.deliveryFee);
  if (entrega !== null && entrega > 0) otherFees.push({ name: "Taxa de entrega", type: "DELIVERY_FEE", receivedBy: "MERCHANT", price: entrega });
  for (const f of Array.isArray(p.additionalFees) ? p.additionalFees : []) {
    const v = num(f?.value);
    if (!f || v === null || v <= 0) continue;
    const t = minusc(f.type);
    if (t === "waiter_tip") otherFees.push({ name: texto(f.description) || "Gorjeta", type: "TIP", price: v });
    else if (t === "addition_pol") otherFees.push({ name: texto(f.description) || "Taxa do pagamento online", type: "SERVICE_FEE", receivedBy: "MARKETPLACE", price: v });
    else otherFees.push({ name: texto(f.description) || "Taxa adicional", type: "ADDITIONAL_FEE", receivedBy: "MERCHANT", price: v });
  }

  // Descontos: no Anota AI o desconto é da loja (cupom, fidelidade, cashback
  // são configurados por ela).
  const discounts: NonNullable<PedidoOD["discounts"]> = [];
  for (const d of Array.isArray(p.discounts) ? p.discounts : []) {
    const v = num(d?.amount);
    if (!d || v === null || v <= 0) continue;
    const tag = texto(d.tag);
    const ehCupom = tag && !DESCONTOS_SEM_CUPOM.includes(tag.toLowerCase());
    discounts.push({
      value: v,
      target: texto(d.target).toUpperCase() === "DELIVERY_FEE" ? "DELIVERY_FEE" : "CART",
      sponsorshipValues: [{ name: "MERCHANT", value: v, discountCode: ehCupom ? tag : null }],
    });
    if (tag && !ehCupom) notas.push(`🏷️ ${tag} do Anota AI: -R$${v.toFixed(2)}`);
  }

  // Pagamentos.
  const methods: NonNullable<NonNullable<PedidoOD["payments"]>["methods"]> = [];
  let prepaid = 0;
  let pending = 0;
  for (const x of Array.isArray(p.payments) ? p.payments : []) {
    if (!x || typeof x !== "object") continue;
    const codigo = minusc(x.code || x.name);
    const valor = num(x.value) ?? 0;
    const pago = x.prepaid === true;
    if (pago) prepaid += valor;
    else pending += valor;
    const troco = codigo === "money" ? num(x.changeFor) : null;
    methods.push({
      value: valor,
      currency: "BRL",
      type: pago ? "PREPAID" : "PENDING",
      method: METODO_OD[codigo] ?? (codigo ? codigo.toUpperCase() : ""),
      brand: texto(x.cardSelected) || null,
      ...(troco !== null && troco > 0 ? { changeFor: troco } : {}),
    });
  }

  const c = p.customer && typeof p.customer === "object" ? p.customer : null;
  let fone = texto(c?.phone).replace(/\D/g, "");
  if (fone.length >= 12 && fone.startsWith("55")) fone = fone.slice(2);
  const documento = texto(c?.taxPayerIdentificationNumber);
  const nomeDoCliente = texto(c?.name);

  // Agendado: início da janela na hora local do dia de produção.
  const agenda = p.schedule_order && typeof p.schedule_order === "object" ? p.schedule_order : null;
  const producao = data(agenda?.date);
  const fusoDaAgenda = texto(agenda?.timezone) || ctx.fuso;
  const inicio = producao && texto(agenda?.start) ? horaLocalNoDia(producao, texto(agenda?.start), fusoDaAgenda) : null;
  const fim = producao && texto(agenda?.end) ? horaLocalNoDia(producao, texto(agenda?.end), fusoDaAgenda) : null;
  const agendado = Boolean(producao);
  if (agendado && !inicio) avisos.push(`agendado sem janela legível (${texto(agenda?.start)}–${texto(agenda?.end)}): prazo = início da produção`);

  const endereco = p.deliveryAddress && typeof p.deliveryAddress === "object" ? p.deliveryAddress : null;

  const pedido: PedidoOD = {
    id: `${ctx.pageId}_${orderId}`,
    type: tipo,
    displayId: texto(p.shortReference) || null,
    createdAt: texto(p.createdAt) || null,
    orderTiming: agendado ? "SCHEDULED" : "INSTANT",
    merchant: { id: ctx.pageId, name: texto(p.merchant?.name) || null },
    items: itens,
    otherFees,
    discounts,
    total: { orderAmount: num(p.total) ?? undefined },
    payments: { prepaid: reais(prepaid), pending: reais(pending), methods },
    customer:
      (nomeDoCliente && !/^n[aã]o identificad/i.test(nomeDoCliente)) || fone || documento
        ? { id: texto(c?.id) || null, name: nomeDoCliente || null, documentNumber: documento || null, phone: fone ? { number: fone } : null }
        : null,
    schedule: agendado
      ? { scheduledDateTimeStart: (inicio || producao)!.toISOString(), scheduledDateTimeEnd: fim ? fim.toISOString() : null }
      : null,
    delivery:
      tipo === "DELIVERY"
        ? {
            deliveredBy: "MERCHANT",
            deliveryAddress: endereco
              ? {
                  streetName: endereco.streetName,
                  streetNumber: endereco.streetNumber,
                  complement: endereco.complement,
                  reference: endereco.reference,
                  neighborhood: endereco.neighborhood,
                  city: endereco.city,
                  state: endereco.state,
                  postalCode: endereco.postalCode,
                  formattedAddress: endereco.formattedAddress,
                  coordinates: endereco.coordinates,
                }
              : null,
          }
        : null,
    takeout: tipo === "TAKEOUT" ? { mode: "DEFAULT" } : null,
    extraInfo: texto(p.observation) || null,
  };

  if (minusc(p.from) === "totem") notas.push("🖥️ Pedido do totem do Anota AI");
  if (minusc(p.from) === "pdv" || minusc(p.from) === "pdv-popup") notas.push("🧾 Pedido lançado no PDV do Anota AI");

  return { pedido, notas, avisos };
}

export type ContextoAnotaAi = Omit<ContextoOD, "canal"> & {
  pageId: string;
  /** "ACEITO" quando o Anota AI já aceitou (filtro). */
  statusInicial?: "ACEITO" | null;
};

/** Pedido do Anota AI → o que `gravarPedidoOpenDelivery` grava. Puro. */
export function traduzirPedidoAnotaAi(p: PedidoAnotaAi, ctx: ContextoAnotaAi): TraducaoOD {
  const { pedido, notas, avisos } = pedidoAnotaAiParaOD(p, { pageId: ctx.pageId, fuso: ctx.fuso });
  const traducao = traduzirPedidoOpenDelivery(pedido, {
    lojaId: ctx.lojaId,
    fuso: ctx.fuso,
    autoAcceptOrders: ctx.autoAcceptOrders,
    canal: CANAL_ANOTAAI,
    agora: ctx.agora,
  });
  if (notas.length > 0) traducao.dados.notes = [traducao.dados.notes, ...notas].filter(Boolean).join("\n");
  if (ctx.statusInicial === "ACEITO" && traducao.dados.status === "NOVO") traducao.dados.status = "ACEITO";
  traducao.avisos.unshift(...avisos);
  return traducao;
}

// ── Status do Anota AI → FireHub ─────────────────────────────────────────────

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
 * O status do FireHub que um `check` do Anota AI pede. O 2 ("pronto") é
 * PRONTO; o 3 (finalizado) é ENTREGUE; cancelado, negado e os cancelamentos
 * internos (41, 42) cancelam. O 6 (pedido de cancelamento) não muda o status
 * — vira aviso no pedido.
 */
export function statusDoFireHubParaCheck(check: number | null): string | null {
  switch (check) {
    case 1:
    case -2:
      return "ACEITO";
    case 2:
      return "PRONTO";
    case 3:
      return "ENTREGUE";
    case 4:
    case 5:
    case 41:
    case 42:
    case -4:
      return "CANCELADO";
    default:
      return null;
  }
}
