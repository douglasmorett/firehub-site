/**
 * lib/aiqfome/traducao.ts — pedido do aiqfome (API V2) → PedidoOD → dados do CustomerOrder.
 *
 * Função pura (sem banco, sem rede), no molde de lib/cardapioweb/traducao.ts:
 * adapta o formato próprio do aiqfome ao contrato da base Open Delivery
 * (lib/open-delivery/traducao.ts), que faz o resto — espelho com o nome base
 * e a loja no id, opções somadas, preço unitário, pagamento por mapa
 * explícito, desconto com dono, total conferido contra as partes.
 *
 * ── O que é do aiqfome e a base não sabe ────────────────────────────────────
 *
 *   - Preço: `unit_value` é o unitário SEM opções; `order_mandatory_items`
 *     (com quantity) e `order_additional_items` (sem quantity = 1) somam por
 *     unidade; e a embalagem (`unit_packing_fee` × qtd) é taxa da LOJA. Nos
 *     exemplos da doc fecha: (unit_value + Σ opções) × qtd + embalagem =
 *     payment_method.subtotal. Com `promotional_value` preenchido (nenhum
 *     exemplo traz), vale o preço que fecha o subtotal.
 *   - Sabores do meio a meio em `order_item_subitems`, sem preço: opção de
 *     preço 0 ("1/3 Calabresa").
 *   - Pagamento em TEXTO livre ("Mastercard Crédito", "PIX - Perto de Você"):
 *     lido por palavra; o que não casa fica "Não informado" (nunca "Cartão").
 *     Pago online só com `pre_paid`.
 *   - Taxa de serviço com dono: `service_fee.store` é da loja, `.aiq` do aiqfome.
 *   - Cupom com dono: `coupon.origin` AIQFOME = plataforma, SELLER = loja. O
 *     valor sai de `coupon_value`; sem ele, de `totalDiscountInCents`/100. O
 *     exemplo da doc traz os dois em desacordo — vira aviso, não conta inventada.
 *   - Datas "YYYY-MM-DD HH:mm:ss" SEM fuso: hora local do `timeline.timezone`
 *     (que pode vir null → fuso da loja).
 *   - `is_aiqentrega_delivery`: quem entrega é o motoboy do aiqfome.
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

export const CANAL_AIQFOME: CanalOD = { chave: "AIQFOME", nome: "aiqfome", prefixo: "aiqfome" };

/** Minutos que o aiqfome espera o "lido" antes de cancelar o pedido sozinho. */
export const PRAZO_DO_ACEITE_MIN = 10;

// ── Formato do aiqfome (o que a doc mostra; o resto é tolerado) ──────────────

export type OpcaoAQ = { id?: number | string | null; group?: string | null; name?: string | null; value?: number | string | null; sku?: string | null; quantity?: number | string | null; [k: string]: unknown };
export type SaborAQ = { id?: string | null; name?: string | null; nome?: string | null; description?: string | null; sku?: string | null; [k: string]: unknown };

export type ItemAQ = {
  id?: string | null;
  order_item_id?: number | string | null;
  name?: string | null;
  sku?: string | null;
  size?: string | null;
  unit_value?: number | string | null;
  promotional_value?: number | string | null;
  quantity?: number | string | null;
  discount_tax?: number | string | null;
  observations?: string | null;
  unit_packing_fee?: number | string | null;
  order_mandatory_items?: OpcaoAQ[] | null;
  order_additional_items?: OpcaoAQ[] | null;
  order_item_subitems?: SaborAQ[] | null;
  [k: string]: unknown;
};

export type EnderecoAQ = {
  street_name?: string | null;
  number?: string | null;
  complement?: string | null;
  reference?: string | null;
  neighborhood_name?: string | null;
  city_name?: string | null;
  state_uf?: string | null;
  zip_code?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  [k: string]: unknown;
};

export type PedidoAQ = {
  id?: number | string | null;
  delivery_time?: string | null;
  created_at?: string | null;
  is_ready?: boolean | null;
  is_read?: boolean | null;
  is_cancelled?: boolean | null;
  is_in_separation?: boolean | null;
  is_delivered?: boolean | null;
  order_observations?: string | null;
  is_aiqentrega_delivery?: boolean | null;
  is_pickup?: boolean | null;
  pickup_at?: string | null;
  coupon_hash?: string | null;
  coupon?: { totalDiscountInCents?: number | string | null; origin?: string | null } | null;
  is_scheduled?: boolean | null;
  scheduled_dates?: { start_date?: string | null; end_date?: string | null } | null;
  items?: ItemAQ[] | null;
  cancelled_items?: unknown[] | null;
  replaced_items?: unknown[] | null;
  user?: {
    name?: string | null;
    surname?: string | null;
    mobile_phone?: string | null;
    phone_number?: string | null;
    email?: string | null;
    document_receipt?: string | null;
    address?: EnderecoAQ | null;
  } | null;
  payment_method?: {
    id?: number | string | null;
    name?: string | null;
    subtotal?: number | string | null;
    delivery_tax?: number | string | null;
    total_packing_fee?: number | string | null;
    change?: number | string | null;
    coupon_value?: number | string | null;
    pre_paid?: boolean | null;
    service_fee?: { store?: number | string | null; aiq?: number | string | null; total?: number | string | null } | number | string | null;
    total_cancelled_replaced?: number | string | null;
    total?: number | string | null;
  } | null;
  store?: { id?: number | string | null; name?: string | null } | null;
  timeline?: { created_at?: string | null; read_at?: string | null; timezone?: string | null } | null;
  aiqentrega?: { driver_name?: string | null; driver_phone?: string | null } | null;
  [k: string]: unknown;
};

// ── Leitores pequenos ────────────────────────────────────────────────────────

const minusc = (v: unknown) => texto(v).toLowerCase();

/** Número de verdade (0 vale; vazio, null e booleano não). O aiqfome manda "286.44" em texto. */
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

const centavos = (n: number) => Math.round(n * 100);

/** Quanto o fuso está deslocado do UTC no instante (o mesmo cálculo de lib/fuso.ts). */
function deslocamento(instante: Date, fuso: string): number {
  const p: Record<string, string> = {};
  for (const parte of new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante)) {
    if (parte.type !== "literal") p[parte.type] = parte.value;
  }
  return instante.getTime() - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
}

/**
 * "2025-12-16 15:10:53" no relógio do `fuso` → o instante. Com fuso explícito
 * no texto (ISO com -03:00), vale o texto. Fuso inválido cai em Brasília.
 */
export function instanteLocal(v: unknown, fuso: string | null | undefined): Date | null {
  const t = texto(v);
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = new Date(t);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const chute = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  let tz = texto(fuso) || "America/Sao_Paulo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "America/Sao_Paulo";
  }
  const d1 = deslocamento(new Date(chute), tz);
  const d2 = deslocamento(new Date(chute + d1), tz);
  return new Date(chute + d2);
}

/** O fuso das datas do pedido: o do `timeline`, senão o da loja. */
export const fusoDoPedido = (p: PedidoAQ, fusoDaLoja: string) => texto(p.timeline?.timezone) || fusoDaLoja;

export const criadoEm = (p: PedidoAQ, fusoDaLoja: string) => instanteLocal(p.created_at || p.timeline?.created_at, fusoDoPedido(p, fusoDaLoja));

/**
 * Criado antes de `desde`? A hora do aiqfome vem sem milissegundos: o pedido
 * feito no mesmo segundo da conexão aparece como 12:00:05.000 contra um
 * `importarDesde` de 12:00:05.700 — e seria descartado. A folga é esse segundo.
 */
export function criadoAntesDe(criado: Date | null, desde: Date | null | undefined): boolean {
  return !!criado && !!desde && criado.getTime() + 999 < desde.getTime();
}

// ── O filtro ─────────────────────────────────────────────────────────────────

export type MotivoDoFiltro = "sem-id" | "status-desconhecido" | "cancelado" | "antes-da-conexao" | "passou-da-cozinha";

export type DecisaoDoFiltro =
  | { importar: true; statusInicial: "ACEITO" | null }
  | { importar: false; motivo: MotivoDoFiltro; texto: string; alertar: boolean };

/**
 * Este pedido entra no FireHub? Na ordem: sem os sinais de status (formato
 * que ninguém previu) não, e avisa; cancelado não; criado antes da conexão
 * não (nunca importar nem aceitar fila velha); já pronto ou entregue lá não
 * entra para não ser feito duas vezes, e avisa (o FireHub perdeu o começo).
 * Já LIDO lá (alguém aceitou no Geraldo) entra aceito.
 */
export function filtroDoPedidoAQ(p: PedidoAQ, opcoes: { importarDesde?: Date | null; fuso: string }): DecisaoDoFiltro {
  if (!texto(p.id)) return { importar: false, motivo: "sem-id", texto: "pedido sem id", alertar: true };
  if (typeof p.is_read !== "boolean" && typeof p.is_cancelled !== "boolean") {
    return { importar: false, motivo: "status-desconhecido", texto: "pedido sem is_read/is_cancelled — formato desconhecido", alertar: true };
  }
  if (p.is_cancelled === true) return { importar: false, motivo: "cancelado", texto: "cancelado antes de entrar", alertar: false };
  const criado = criadoEm(p, opcoes.fuso);
  if (criadoAntesDe(criado, opcoes.importarDesde)) {
    return { importar: false, motivo: "antes-da-conexao", texto: "pedido de antes da conexão com o FireHub", alertar: false };
  }
  if (p.is_delivered === true || p.is_ready === true) {
    return { importar: false, motivo: "passou-da-cozinha", texto: `chegou ao FireHub já ${p.is_delivered ? "entregue" : "pronto"} no aiqfome — não entra para não ser feito de novo`, alertar: true };
  }
  if (p.is_read === true || p.is_in_separation === true) return { importar: true, statusInicial: "ACEITO" };
  return { importar: true, statusInicial: null };
}

// ── Itens ────────────────────────────────────────────────────────────────────

const TAMANHO_SEM_NOME = /^(unidade|un|unid|único|unico|padrão|padrao)$/i;

function nomeDoItem(item: ItemAQ): string {
  const nome = texto(item.name);
  const tamanho = texto(item.size);
  if (!tamanho || TAMANHO_SEM_NOME.test(tamanho)) return nome;
  const n = nome.toLowerCase();
  const t = tamanho.toLowerCase();
  if (n.includes(`(${t})`) || n.endsWith(` ${t}`)) return nome;
  return `${nome} (${tamanho})`;
}

/**
 * As escolhas de um item: sabores (preço 0), obrigatórios (com quantity) e
 * adicionais (sem quantity = 1). O id é o SKU — ou o grupo + nome —, nunca o
 * id da linha: a mesma bebida escolhida duas vezes vem em duas linhas com ids
 * diferentes, e a base só soma ("2x Coca") o que tem o mesmo id.
 */
function opcoesDoItem(item: ItemAQ): OpcaoOD[] {
  const lista: OpcaoOD[] = [];
  const sabores = (Array.isArray(item.order_item_subitems) ? item.order_item_subitems : []).filter((s) => s && typeof s === "object" && texto(s.name ?? s.nome));
  for (const s of sabores) {
    const nome = texto(s.name ?? s.nome);
    lista.push({ id: `sabor-${slug(nome)}`, name: sabores.length > 1 ? `1/${sabores.length} ${nome}` : nome, quantity: 1, unitPrice: 0 });
  }
  for (const o of Array.isArray(item.order_mandatory_items) ? item.order_mandatory_items : []) {
    if (!o || typeof o !== "object" || !texto(o.name)) continue;
    lista.push({ id: texto(o.sku) || `${slug(texto(o.group))}-${slug(texto(o.name))}`, name: texto(o.name), quantity: qtd(o.quantity), unitPrice: num(o.value) ?? 0 });
  }
  for (const o of Array.isArray(item.order_additional_items) ? item.order_additional_items : []) {
    if (!o || typeof o !== "object" || !texto(o.name)) continue;
    lista.push({ id: texto(o.sku) || `adicional-${slug(texto(o.name))}`, name: texto(o.name), quantity: qtd(o.quantity), unitPrice: num(o.value) ?? 0 });
  }
  return lista;
}

const somaDasOpcoes = (ops: OpcaoOD[]) => ops.reduce((s, o) => s + (num(o.unitPrice) ?? 0) * qtd(o.quantity), 0);

// ── Pagamento ────────────────────────────────────────────────────────────────

/**
 * A forma pelo TEXTO do aiqfome ("Dinheiro", "Mastercard Crédito", "Visa
 * Débito", "PIX - Perto de Você"). O que não casa devolve method vazio e a
 * base escreve "Não informado" — "Cartão" como padrão pôs pedido de forma
 * desconhecida no crédito da maquininha.
 */
export function formaDoTexto(nome: unknown): { method: string; brand: string | null } {
  const t = texto(nome);
  const s = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const marca = (palavra: RegExp) => {
    const b = t.replace(palavra, "").replace(/[-–—:|/]+/g, " ").replace(/\s+/g, " ").trim();
    return b || null;
  };
  if (/\bdinheiro\b|\bespecie\b/.test(s)) return { method: "CASH", brand: null };
  if (/\bpix\b/.test(s)) return { method: "PIX", brand: null };
  if (/\bcredito\b/.test(s)) return { method: "CREDIT", brand: marca(/cr[eé]dito/i) };
  if (/\bdebito\b/.test(s)) return { method: "DEBIT", brand: marca(/d[eé]bito/i) };
  if (/refeicao/.test(s)) return { method: "MEAL_VOUCHER", brand: null };
  if (/alimentacao/.test(s)) return { method: "FOOD_VOUCHER", brand: null };
  return { method: "", brand: null };
}

// ── A tradução ───────────────────────────────────────────────────────────────

export type AdaptacaoAQ = { pedido: PedidoOD; notas: string[]; avisos: string[] };

/** O pedido do aiqfome no contrato da base. Puro. */
export function pedidoAQParaOD(p: PedidoAQ, ctx: { storeId: string; fuso: string }): AdaptacaoAQ {
  const avisos: string[] = [];
  const notas: string[] = [];
  const fuso = fusoDoPedido(p, ctx.fuso);
  const pg = p.payment_method && typeof p.payment_method === "object" ? p.payment_method : {};
  const aiqentrega = p.is_aiqentrega_delivery === true;
  const retirada = p.is_pickup === true;

  // ── Itens e o preço que fecha o subtotal ──────────────────────────────────
  const brutos = (Array.isArray(p.items) ? p.items : []).filter((i): i is ItemAQ => !!i && typeof i === "object");
  const embalagemDosItens = reais(brutos.reduce((s, i) => s + (num(i.unit_packing_fee) ?? 0) * qtd(i.quantity), 0));
  const embalagem = num(pg.total_packing_fee) ?? embalagemDosItens;
  if (num(pg.total_packing_fee) !== null && Math.abs(centavos(embalagem) - centavos(embalagemDosItens)) > 1) {
    avisos.push(`embalagem ${embalagem.toFixed(2)} ≠ soma das embalagens dos itens ${embalagemDosItens.toFixed(2)}`);
  }
  const opcoes = brutos.map(opcoesDoItem);
  const somaCom = (promo: boolean) =>
    reais(
      brutos.reduce((s, i, k) => {
        const pr = num(i.promotional_value);
        const unit = promo && pr !== null && pr > 0 ? pr : num(i.unit_value) ?? 0;
        return s + (unit + somaDasOpcoes(opcoes[k])) * qtd(i.quantity);
      }, 0),
    );
  const subtotal = num(pg.subtotal);
  const alvo = subtotal !== null ? reais(subtotal - embalagem) : null;
  const temPromocional = brutos.some((i) => (num(i.promotional_value) ?? 0) > 0);
  const usarPromocional = temPromocional && alvo !== null && Math.abs(centavos(somaCom(false)) - centavos(alvo)) > 1 && Math.abs(centavos(somaCom(true)) - centavos(alvo)) <= 1;
  if (temPromocional) avisos.push(`item com promotional_value: valeu o ${usarPromocional ? "promocional" : "unit_value"} (o que fecha o subtotal)`);
  if (alvo !== null && Math.abs(centavos(somaCom(usarPromocional)) - centavos(alvo)) > 1) {
    avisos.push(`subtotal ${subtotal!.toFixed(2)} ≠ itens ${somaCom(usarPromocional).toFixed(2)} + embalagem ${embalagem.toFixed(2)}`);
  }
  if (brutos.some((i) => num(i.discount_tax) !== null && num(i.discount_tax) !== 0)) avisos.push("item com discount_tax preenchido — não usado na conta");
  if ((Array.isArray(p.cancelled_items) && p.cancelled_items.length > 0) || (Array.isArray(p.replaced_items) && p.replaced_items.length > 0) || (num(pg.total_cancelled_replaced) ?? 0) !== 0) {
    avisos.push("pedido com item cancelado/substituído no aiqfome — confira os itens");
  }

  const itens: ItemOD[] = brutos.map((i, k) => {
    const nome = nomeDoItem(i);
    const codigo = texto(i.sku) || texto(i.id) || `nome-${slug(nome)}`;
    const pr = num(i.promotional_value);
    return {
      // A loja do aiqfome no código do espelho: duas lojas na mesma conta
      // não dividem o espelho de um item com o mesmo SKU.
      id: `${ctx.storeId}-${codigo}`,
      externalCode: texto(i.sku) || null,
      name: nome,
      quantity: num(i.quantity) ?? 1,
      unitPrice: usarPromocional && pr !== null && pr > 0 ? pr : num(i.unit_value) ?? 0,
      specialInstructions: texto(i.observations) || null,
      options: opcoes[k],
    };
  });

  // ── Taxas ─────────────────────────────────────────────────────────────────
  const otherFees: NonNullable<PedidoOD["otherFees"]> = [];
  const taxa = (name: string, type: string, receivedBy: string, price: number | null) => {
    if (price !== null && price > 0.0049) otherFees.push({ name, type, receivedBy, price: reais(price) });
  };
  taxa("Taxa de entrega", "DELIVERY_FEE", aiqentrega ? "LOGISTIC_SERVICES" : "MERCHANT", num(pg.delivery_tax));
  taxa("Embalagem", "PACKING_FEE", "MERCHANT", embalagem);
  const sf = pg.service_fee;
  if (sf && typeof sf === "object") {
    const daLoja = num(sf.store) ?? 0;
    const doAiq = num(sf.aiq) ?? 0;
    const total = num(sf.total) ?? daLoja + doAiq;
    // A doc traz um exemplo com total 1 e store/aiq 0: o total é o que entra
    // na conta; o que sobra sem dono fica com a plataforma (não infla a loja).
    if (Math.abs(centavos(total) - centavos(daLoja + doAiq)) > 1) avisos.push(`taxa de serviço: total ${total.toFixed(2)} ≠ loja ${daLoja.toFixed(2)} + aiqfome ${doAiq.toFixed(2)} — a diferença ficou com o aiqfome`);
    taxa("Taxa de serviço da loja", "SERVICE_FEE", "MERCHANT", daLoja);
    taxa("Taxa de serviço aiqfome", "SERVICE_FEE", "MARKETPLACE", reais(total - daLoja));
  } else {
    taxa("Taxa de serviço aiqfome", "SERVICE_FEE", "MARKETPLACE", num(sf));
  }

  // ── Cupom ─────────────────────────────────────────────────────────────────
  const discounts: NonNullable<PedidoOD["discounts"]> = [];
  const doCampo = num(pg.coupon_value);
  const centavosDoCupom = num(p.coupon?.totalDiscountInCents);
  const doCupom = centavosDoCupom !== null ? reais(centavosDoCupom / 100) : null;
  const desconto = doCampo ?? doCupom ?? 0;
  if (doCampo !== null && doCupom !== null && Math.abs(centavos(doCampo) - centavos(doCupom)) > 1) {
    avisos.push(`cupom incoerente: coupon_value ${doCampo.toFixed(2)} × coupon.totalDiscountInCents ${centavosDoCupom} — valeu o coupon_value`);
  }
  if (desconto > 0) {
    const origem = minusc(p.coupon?.origin);
    if (!origem) avisos.push("cupom sem origem (AIQFOME/SELLER) — lido como da loja");
    discounts.push({
      value: desconto,
      target: "CART",
      sponsorshipValues: [{ name: origem === "aiqfome" ? "MARKETPLACE" : "MERCHANT", value: desconto, discountCode: texto(p.coupon_hash) || null }],
    });
  }

  // ── Pagamento ─────────────────────────────────────────────────────────────
  const total = num(pg.total);
  const forma = formaDoTexto(pg.name);
  const pago = pg.pre_paid === true;
  const troco = num(pg.change);
  const valorPago = total ?? 0;
  if (!forma.method) notas.push(`💳 Forma de pagamento no aiqfome: ${texto(pg.name) || "(não informada)"}${pago ? " — pago no app" : ""}`);
  const methods: NonNullable<NonNullable<PedidoOD["payments"]>["methods"]> = texto(pg.name) || total !== null
    ? [{ value: valorPago, currency: "BRL", type: pago ? "PREPAID" : "PENDING", method: forma.method || texto(pg.name), brand: forma.brand, ...(troco !== null && troco > 0 ? { changeFor: troco } : {}) }]
    : [];

  // ── Cliente e endereço ────────────────────────────────────────────────────
  const u = p.user && typeof p.user === "object" ? p.user : null;
  const end = u?.address && typeof u.address === "object" ? u.address : null;
  const nomeDoCliente = [texto(u?.name), texto(u?.surname)].filter(Boolean).join(" ");
  const telefone = (texto(u?.mobile_phone) || texto(u?.phone_number) || texto(end?.mobile_phone) || texto(end?.phone)).replace(/\D/g, "");
  const documento = texto(u?.document_receipt).replace(/\D/g, "");
  if (!retirada && !end) avisos.push("entrega sem endereço");

  // ── Prazo ─────────────────────────────────────────────────────────────────
  const criado = criadoEm(p, ctx.fuso);
  const minutos = (texto(p.delivery_time).match(/\d+/g) || []).map(Number).filter((n) => n > 0);
  const previsto = criado && minutos.length > 0 ? new Date(criado.getTime() + Math.max(...minutos) * 60_000).toISOString() : null;
  const iso = (v: unknown) => instanteLocal(v, fuso)?.toISOString() ?? null;
  const agendado = p.is_scheduled === true;

  const pedido: PedidoOD = {
    id: `${ctx.storeId}_${texto(p.id)}`,
    type: retirada ? "TAKEOUT" : "DELIVERY",
    // O número que o cliente e o Geraldo mostram é o próprio id do pedido.
    displayId: texto(p.id) || null,
    createdAt: criado ? criado.toISOString() : null,
    orderTiming: agendado ? "SCHEDULED" : "INSTANT",
    merchant: { id: ctx.storeId, name: texto(p.store?.name) || null },
    items: itens,
    otherFees,
    discounts,
    total: { orderAmount: total ?? undefined },
    payments: { prepaid: pago ? reais(valorPago) : 0, pending: pago ? 0 : reais(valorPago), methods },
    customer: u ? { name: nomeDoCliente || null, documentNumber: documento || null, phone: telefone ? { number: telefone } : null } : null,
    schedule: agendado && p.scheduled_dates ? { scheduledDateTimeStart: iso(p.scheduled_dates.start_date), scheduledDateTimeEnd: iso(p.scheduled_dates.end_date) } : null,
    delivery: retirada
      ? null
      : {
          deliveredBy: aiqentrega ? "AIQFOME" : "MERCHANT",
          estimatedDeliveryDateTime: previsto,
          deliveryAddress: end
            ? {
                street: end.street_name,
                number: end.number,
                complement: end.complement,
                reference: end.reference,
                neighborhood: end.neighborhood_name,
                city: end.city_name,
                state: end.state_uf,
                postalCode: end.zip_code,
                latitude: end.latitude,
                longitude: end.longitude,
              }
            : null,
        },
    takeout: retirada ? { mode: "DEFAULT", takeoutDateTime: iso(p.pickup_at) || previsto } : null,
    extraInfo: texto(p.order_observations) || null,
  };

  if (agendado && !p.scheduled_dates) avisos.push("agendado sem scheduled_dates");
  if (aiqentrega) {
    const moto = texto(p.aiqentrega?.driver_name);
    notas.push(`🛵 Entrega pelo aiqentrega (motoboy do aiqfome)${moto ? `: ${moto}` : ""} — não mande o motoboy da loja`);
  }
  return { pedido, notas, avisos };
}

export type ContextoAQ = Omit<ContextoOD, "canal"> & {
  storeId: string;
  /** "ACEITO" quando o pedido já foi lido no aiqfome (filtro). */
  statusInicial?: "ACEITO" | null;
};

/** Pedido do aiqfome → o que `gravarPedidoOpenDelivery` grava. Puro. */
export function traduzirPedidoAiqfome(p: PedidoAQ, ctx: ContextoAQ): TraducaoOD {
  const { pedido, notas, avisos } = pedidoAQParaOD(p, { storeId: ctx.storeId, fuso: ctx.fuso });
  const traducao = traduzirPedidoOpenDelivery(pedido, {
    lojaId: ctx.lojaId,
    fuso: ctx.fuso,
    autoAcceptOrders: ctx.autoAcceptOrders,
    canal: CANAL_AIQFOME,
    agora: ctx.agora,
  });
  if (ctx.statusInicial === "ACEITO" && traducao.dados.status === "NOVO") traducao.dados.status = "ACEITO";
  // Quem aceita na mão tem 10 min: depois disso o aiqfome cancela sozinho.
  if (traducao.dados.status === "NOVO") notas.push(`⏰ Aceite em até ${PRAZO_DO_ACEITE_MIN} min — senão o aiqfome cancela o pedido`);
  if (notas.length > 0) traducao.dados.notes = [traducao.dados.notes, ...notas].filter(Boolean).join("\n");
  traducao.avisos.unshift(...avisos);
  return traducao;
}

// ── Status do aiqfome → FireHub ─────────────────────────────────────────────

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

/** O status do FireHub que os sinais do aiqfome pedem (vale para o pedido completo e para o resumo das listas). */
export function statusDoFireHubPara(s: Pick<PedidoAQ, "is_read" | "is_ready" | "is_delivered" | "is_cancelled" | "is_in_separation"> | null | undefined): string | null {
  if (!s) return null;
  if (s.is_cancelled === true) return "CANCELADO";
  if (s.is_delivered === true) return "ENTREGUE";
  if (s.is_ready === true) return "PRONTO";
  if (s.is_read === true || s.is_in_separation === true) return "ACEITO";
  return null;
}
