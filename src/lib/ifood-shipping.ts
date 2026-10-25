/**
 * /src/lib/ifood-shipping.ts
 *
 * Shipping API v1.0 — o entregador do iFood para o pedido que NÃO nasceu no
 * iFood (balcão, site próprio, robô). O iFood chama esses pedidos de
 * `salesChannel=POS`, e é exatamente o que os critérios de homologação pedem:
 * "pedidos Sob Demanda com orderType=DELIVERY, orderTiming=IMMEDIATE,
 * salesChannel=POS".
 *
 * O fluxo, como a documentação descreve e como medimos na loja de teste em
 * 17/10/2026:
 *
 *   1. cotação      GET  /merchants/{id}/deliveryAvailabilities?latitude&longitude
 *                   → `id` vira o quoteId; vale ~24h; o valor pode subir entre
 *                     duas consultas (veio 12,99 e depois 13,99 com o mesmo id).
 *   2. registro     POST /merchants/{id}/orders → 202 {id, trackingUrl}. O pedido
 *                   aparece no polling como PLACED e, frações de segundo depois,
 *                   CONFIRMED — o próprio iFood confirma. O polling do FireHub
 *                   importa o pedido para a loja como um pedido do iFood.
 *   3. endereço     userConfirmAddress (só antes de qualquer troca: depois dela
 *                   volta 409 ChangeAddressOperationConflict),
 *                   deliveryAddressChangeRequest → evento ..._REQUESTED, e a loja
 *                   tem 15 min para acceptDeliveryAddressChange (200) ou
 *                   denyDeliveryAddressChange (202). Limite de 500 m.
 *   4. cancelamento GET cancellationReasons (lista muda por pedido — "não faça
 *                   hardcoding") e POST cancel. ⚠️ `cancellationCode` vai como
 *                   TEXTO: a doc mostra número, mas a API responde 400
 *                   "expected=string, got=number".
 *   5. coleta       o `pickupCode` vem nos detalhes do pedido (Order API) e é
 *                   conferido em POST /order/v1.0/orders/{id}/validatePickupCode.
 *                   Antes de um entregador aceitar a corrida o iFood devolve 412.
 *
 * Os eventos de cada pedido (troca de endereço, cancelamento, código de coleta)
 * ficam gravados em "IfoodShippingPedido" pelo polling — sem isso a tela não
 * teria como mostrar que a solicitação do cliente chegou nem que o
 * cancelamento foi aceito.
 */
import { chamarComContexto } from "./ifood-http";
import type { ContextoIfood } from "./ifood-token";
import { ErroValidacao } from "./ifood-catalog";

const SHIP = "/shipping/v1.0";
const ORDER = "/order/v1.0";

// ── tipos da entrada da tela ───────────────────────────────────────────────

export type Endereco = {
  postalCode?: string;
  streetName: string;
  streetNumber?: string;
  complement?: string;
  reference?: string;
  neighborhood: string;
  city: string;
  state: string;
  country?: string;
  latitude: number;
  longitude: number;
};

export type ItemPedido = { nome: string; quantidade: number; precoUnitario: number };

export type PagamentoPedido =
  | { metodo: "CASH"; trocoPara?: number | null }
  | { metodo: "CREDIT" | "DEBIT"; bandeira: string };

export type EntradaPedido = {
  cliente: { nome: string; ddd: string; numero: string };
  endereco: Endereco;
  itens: ItemPedido[];
  pagamento: PagamentoPedido;
  quoteId: string;
  /** Taxa de entrega cobrada do cliente (vai em delivery.merchantFee). */
  taxaEntrega: number;
  /** Minutos até o pedido ficar pronto; 0 aloca o entregador na hora. */
  preparoMin?: number;
};

const so = (s: unknown) => String(s ?? "").trim();
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const centavos = (n: number) => Math.round(n * 100) / 100;

/** Distância em metros entre dois pontos (haversine). */
export function distanciaEmMetros(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Troca de endereço só é aceita pelo iFood até 500 m da coordenada original. */
export const LIMITE_TROCA_ENDERECO_M = 500;

function conferirEndereco(e: Endereco, rotulo = "Endereço") {
  if (!so(e?.streetName)) throw new ErroValidacao(`${rotulo}: informe a rua.`);
  if (!so(e?.neighborhood)) throw new ErroValidacao(`${rotulo}: informe o bairro.`);
  if (!so(e?.city)) throw new ErroValidacao(`${rotulo}: informe a cidade.`);
  if (so(e?.state).length !== 2) throw new ErroValidacao(`${rotulo}: a UF tem 2 letras.`);
  const lat = Number(e?.latitude), lng = Number(e?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ErroValidacao(`${rotulo}: latitude e longitude são obrigatórias.`);
  }
}

function enderecoParaApi(e: Endereco) {
  return {
    ...(so(e.postalCode) ? { postalCode: digitos(e.postalCode) } : {}),
    streetName: so(e.streetName).slice(0, 50),
    ...(so(e.streetNumber) ? { streetNumber: so(e.streetNumber) } : {}),
    ...(so(e.complement) ? { complement: so(e.complement).slice(0, 50) } : {}),
    ...(so(e.reference) ? { reference: so(e.reference).slice(0, 70) } : {}),
    neighborhood: so(e.neighborhood).slice(0, 50),
    city: so(e.city).slice(0, 50),
    state: so(e.state).toUpperCase(),
    country: so(e.country || "BR").toUpperCase(),
    coordinates: { latitude: Number(e.latitude), longitude: Number(e.longitude) },
  };
}

/**
 * O corpo do POST /orders. Puro, para dar para testar sem rede.
 *
 * O total do pagamento tem que fechar com itens + taxa de entrega: diferente
 * disso o iFood devolve PaymentTotalInvalid. Por isso ele é calculado aqui e
 * nunca digitado.
 */
export function montarPedido(entrada: EntradaPedido) {
  const nome = so(entrada?.cliente?.nome);
  if (!nome) throw new ErroValidacao("Informe o nome do cliente.");
  const ddd = digitos(entrada.cliente.ddd);
  const numero = digitos(entrada.cliente.numero);
  if (ddd.length !== 2) throw new ErroValidacao("O DDD do cliente tem 2 dígitos.");
  if (numero.length < 7 || numero.length > 9) throw new ErroValidacao("Telefone do cliente inválido.");

  if (!so(entrada.quoteId)) throw new ErroValidacao("Consulte a disponibilidade do entregador antes de registrar.");
  conferirEndereco(entrada.endereco);
  if (!entrada.endereco.postalCode || digitos(entrada.endereco.postalCode).length !== 8) {
    throw new ErroValidacao("Endereço: o CEP tem 8 dígitos.");
  }
  if (!so(entrada.endereco.streetNumber)) throw new ErroValidacao("Endereço: informe o número.");

  const itens = (entrada.itens ?? []).filter((i) => so(i?.nome));
  if (itens.length === 0) throw new ErroValidacao("Inclua pelo menos um item.");
  const items = itens.map((i, n) => {
    const quantidade = Math.max(1, Math.round(Number(i.quantidade) || 1));
    const unitPrice = centavos(Number(i.precoUnitario) || 0);
    if (unitPrice < 0) throw new ErroValidacao("Preço de item não pode ser negativo.");
    const price = centavos(unitPrice * quantidade);
    return {
      // O iFood pede um uuid por item; o do cardápio não serve porque o mesmo
      // produto pode entrar duas vezes no pedido.
      id: uuidDoItem(n),
      name: so(i.nome).slice(0, 50),
      quantity: quantidade,
      unitPrice,
      price,
      optionsPrice: 0,
      totalPrice: price,
    };
  });

  const taxa = centavos(Number(entrada.taxaEntrega) || 0);
  const total = centavos(items.reduce((s, i) => s + i.totalPrice, 0) + taxa);

  const p = entrada.pagamento;
  let method: any;
  if (p?.metodo === "CASH") {
    const troco = Number(p.trocoPara ?? 0);
    if (troco && troco < total) throw new ErroValidacao("O troco tem que ser para um valor maior que o total.");
    method = { method: "CASH", type: "OFFLINE", value: total, cash: { changeFor: troco ? centavos(troco) : 0 } };
  } else if (p?.metodo === "CREDIT" || p?.metodo === "DEBIT") {
    if (!so((p as any).bandeira)) throw new ErroValidacao("Escolha a bandeira do cartão.");
    method = { method: p.metodo, type: "OFFLINE", value: total, card: { brand: so((p as any).bandeira) } };
  } else {
    throw new ErroValidacao("Escolha a forma de pagamento.");
  }

  const preparo = Math.max(0, Math.round(Number(entrada.preparoMin) || 0)) * 60;

  return {
    customer: {
      name: nome.slice(0, 50),
      // CUSTOMER: o código de entrega passa a ser os 4 últimos dígitos deste
      // telefone, e é o modo que a documentação recomenda.
      phone: { countryCode: "55", areaCode: ddd, number: numero, type: "CUSTOMER" },
    },
    delivery: {
      merchantFee: taxa,
      quoteId: so(entrada.quoteId),
      preparationTime: preparo,
      deliveryAddress: enderecoParaApi(entrada.endereco),
    },
    items,
    payments: { methods: [method] },
    total,
  };
}

function uuidDoItem(n: number): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${(n % 0xffff).toString(16).padStart(4, "0")}`;
}

// ── chamadas ────────────────────────────────────────────────────────────────

export function consultarDisponibilidade(ctx: ContextoIfood, latitude: number, longitude: number) {
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ErroValidacao("Informe latitude e longitude do endereço de entrega.");
  }
  return chamarComContexto(
    ctx,
    `${SHIP}/merchants/${ctx.merchantId}/deliveryAvailabilities?latitude=${lat}&longitude=${lng}`,
    { idempotente: true },
  );
}

export async function registrarPedido(ctx: ContextoIfood, entrada: EntradaPedido) {
  const { total, ...corpo } = montarPedido(entrada);
  const r = await chamarComContexto<{ id: string; trackingUrl: string }>(
    ctx,
    `${SHIP}/merchants/${ctx.merchantId}/orders`,
    { method: "POST", body: JSON.stringify(corpo) },
  );
  return { ...r, total, corpo };
}

/** Detalhes pela Order API: orderType, orderTiming, salesChannel, pickupCode. */
export function detalhesDoPedido(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${ORDER}/orders/${orderId}`, { idempotente: true });
}

export function confirmarPedido(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${ORDER}/orders/${orderId}/confirm`, { method: "POST" });
}

export function confirmarEnderecoDoCliente(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/userConfirmAddress`, { method: "POST" });
}

export function pedirTrocaDeEndereco(ctx: ContextoIfood, orderId: string, novo: Endereco) {
  conferirEndereco(novo, "Novo endereço");
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/deliveryAddressChangeRequest`, {
    method: "POST",
    body: JSON.stringify(enderecoParaApi(novo)),
  });
}

export function aceitarTrocaDeEndereco(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/acceptDeliveryAddressChange`, { method: "POST" });
}

export function recusarTrocaDeEndereco(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/denyDeliveryAddressChange`, { method: "POST" });
}

export function motivosDeCancelamento(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto<{ cancelCodeId: string; description: string }[]>(
    ctx,
    `${SHIP}/orders/${orderId}/cancellationReasons`,
    { idempotente: true },
  );
}

export function cancelarPedido(ctx: ContextoIfood, orderId: string, codigo: string, motivo: string) {
  const code = so(codigo);
  if (!code) throw new ErroValidacao("Escolha o motivo do cancelamento.");
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/cancel`, {
    method: "POST",
    // Texto, não número — ver o cabeçalho deste arquivo.
    body: JSON.stringify({ reason: so(motivo).slice(0, 250) || "Cancelado pela loja", cancellationCode: code }),
  });
}

export function rastreioDoPedido(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/tracking`, { idempotente: true });
}

export function confiancaDaEntrega(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, `${SHIP}/orders/${orderId}/safeDelivery`, { idempotente: true });
}

export function validarCodigoDeColeta(ctx: ContextoIfood, orderId: string, codigo: string) {
  const code = digitos(codigo);
  if (!code) throw new ErroValidacao("Digite o código que o entregador informou.");
  return chamarComContexto(ctx, `${ORDER}/orders/${orderId}/validatePickupCode`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// ── o que os eventos dizem ──────────────────────────────────────────────────

/** Eventos que interessam à tela de Shipping. */
export const EVENTOS_DO_SHIPPING = new Set([
  "PLACED", "CONFIRMED", "DISPATCHED", "CONCLUDED", "CANCELLED",
  "CANCELLATION_REQUESTED", "CANCELLATION_REQUEST_FAILED",
  "DELIVERY_ADDRESS_CHANGE_REQUESTED", "DELIVERY_ADDRESS_CHANGE_ACCEPTED",
  "DELIVERY_ADDRESS_CHANGE_DENIED", "DELIVERY_ADDRESS_CHANGE_USER_CONFIRMED",
  "DELIVERY_PICKUP_CODE_REQUESTED", "DELIVERY_DROP_CODE_REQUESTED",
  "ASSIGN_DRIVER", "GOING_TO_ORIGIN", "ARRIVED_AT_ORIGIN", "DELIVERY_IN_TRANSIT",
  "ARRIVED_AT_DESTINATION", "DELIVERY_CONCLUDED", "DELIVERY_CANCELLED",
]);

export type EventoGravado = { codigo: string; em: string; metadata?: any };

/** Status do pedido a partir dos eventos — o último que muda o ciclo de vida. */
export function statusPelosEventos(eventos: EventoGravado[]): string {
  const ordem = [...eventos].sort((a, b) => a.em.localeCompare(b.em));
  let status = "REGISTRADO";
  for (const e of ordem) {
    if (e.codigo === "CANCELLED" || e.codigo === "DELIVERY_CANCELLED") status = "CANCELADO";
    else if (status === "CANCELADO") continue;
    else if (e.codigo === "CONCLUDED" || e.codigo === "DELIVERY_CONCLUDED") status = "CONCLUIDO";
    else if (e.codigo === "DISPATCHED" || e.codigo === "DELIVERY_IN_TRANSIT") status = "EM_ROTA";
    else if (e.codigo === "CONFIRMED" && status === "REGISTRADO") status = "CONFIRMADO";
  }
  return status;
}

/**
 * Situação da troca de endereço: só pode haver uma em aberto por pedido, e
 * ela vence em 15 min (depois disso o iFood recusa sozinho).
 */
export function trocaDeEnderecoPendente(eventos: EventoGravado[]): EventoGravado | null {
  const ordem = [...eventos].sort((a, b) => a.em.localeCompare(b.em));
  let pendente: EventoGravado | null = null;
  for (const e of ordem) {
    if (e.codigo === "DELIVERY_ADDRESS_CHANGE_REQUESTED") pendente = e;
    else if (e.codigo === "DELIVERY_ADDRESS_CHANGE_ACCEPTED" || e.codigo === "DELIVERY_ADDRESS_CHANGE_DENIED") pendente = null;
  }
  return pendente;
}

// ── tabela ───────────────────────────────────────────────────────────────────

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "IfoodShippingPedido" (
     "ifoodOrderId" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "merchantId" TEXT NOT NULL,
     "displayId" TEXT,
     "trackingUrl" TEXT,
     "clienteNome" TEXT,
     "total" DOUBLE PRECISION,
     "enderecoOriginal" JSONB,
     "pedidoEnviado" JSONB,
     "eventos" JSONB NOT NULL DEFAULT '[]'::jsonb,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "IfoodShippingPedido_pkey" PRIMARY KEY ("ifoodOrderId")
   )`,
  `CREATE INDEX IF NOT EXISTS "IfoodShippingPedido_franchiseeId_createdAt_idx" ON "IfoodShippingPedido"("franchiseeId", "createdAt")`,
  // O pedido da loja que o Sob Demanda atende (lib/ifood-sob-demanda.ts).
  `ALTER TABLE "IfoodShippingPedido" ADD COLUMN IF NOT EXISTS "pedidoDoFireHub" TEXT`,
];

let tabelaOk = false;

export async function garantirTabelaDoShipping(prisma: any): Promise<boolean> {
  if (tabelaOk) return true;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    tabelaOk = true;
  } catch (e: any) {
    console.error("[iFood shipping] tabela IfoodShippingPedido indisponível:", e?.message);
  }
  return tabelaOk;
}

export async function gravarPedidoShipping(
  prisma: any,
  p: {
    ifoodOrderId: string; franchiseeId: string; merchantId: string; trackingUrl?: string | null;
    clienteNome: string; total: number; enderecoOriginal: Endereco; pedidoEnviado: any;
  },
) {
  if (!(await garantirTabelaDoShipping(prisma))) return;
  await prisma.$executeRaw`
    INSERT INTO "IfoodShippingPedido"
      ("ifoodOrderId", "franchiseeId", "merchantId", "trackingUrl", "clienteNome", "total", "enderecoOriginal", "pedidoEnviado")
    VALUES (${p.ifoodOrderId}, ${p.franchiseeId}, ${p.merchantId}, ${p.trackingUrl ?? null}, ${p.clienteNome}, ${p.total},
            ${JSON.stringify(p.enderecoOriginal)}::jsonb, ${JSON.stringify(p.pedidoEnviado)}::jsonb)
    ON CONFLICT ("ifoodOrderId") DO NOTHING`;
}

export async function gravarDisplayId(prisma: any, ifoodOrderId: string, displayId: string) {
  if (!displayId || !(await garantirTabelaDoShipping(prisma))) return;
  await prisma.$executeRaw`
    UPDATE "IfoodShippingPedido" SET "displayId" = ${displayId}
     WHERE "ifoodOrderId" = ${ifoodOrderId} AND "displayId" IS NULL`.catch(() => null);
}

/**
 * Chamado pelo polling para todo evento com orderId. É um UPDATE pela chave
 * primária: para os pedidos que não são de Shipping (quase todos) não acha
 * linha e não custa nada além da consulta pelo índice.
 *
 * Nunca lança — o polling não pode parar por causa desta tela.
 */
export async function registrarEventoDeShipping(prisma: any, evento: any): Promise<void> {
  try {
    const codigo = String(evento?.fullCode || evento?.code || "");
    if (!evento?.orderId || !EVENTOS_DO_SHIPPING.has(codigo)) return;
    if (!tabelaOk && !(await garantirTabelaDoShipping(prisma))) return;
    const item = JSON.stringify([{
      id: evento.id ?? null,
      codigo,
      em: evento.createdAt ?? new Date().toISOString(),
      metadata: evento.metadata ?? null,
    }]);
    // Deduplicação pelo id do evento: o iFood reentrega o que não recebeu ack.
    await prisma.$executeRaw`
      UPDATE "IfoodShippingPedido"
         SET "eventos" = "eventos" || ${item}::jsonb
       WHERE "ifoodOrderId" = ${evento.orderId}
         AND NOT ("eventos" @> ${JSON.stringify([{ id: evento.id ?? "__sem_id__" }])}::jsonb)`;
  } catch (e: any) {
    console.warn("[iFood shipping] evento não gravado:", e?.message);
  }
}

export async function listarPedidosShipping(prisma: any, franchiseeId: string) {
  if (!(await garantirTabelaDoShipping(prisma))) return [];
  const linhas: any[] = await prisma.$queryRaw`
    SELECT s."ifoodOrderId", s."displayId", s."trackingUrl", s."clienteNome", s."total",
           s."enderecoOriginal", s."eventos", s."createdAt",
           o."status" AS "statusNoSistema", o."dailyOrderNumber"
      FROM "IfoodShippingPedido" s
      LEFT JOIN "CustomerOrder" o ON o."ifoodOrderId" = s."ifoodOrderId" OR o."id" = s."pedidoDoFireHub"
     WHERE s."franchiseeId" = ${franchiseeId}
       AND s."createdAt" > NOW() - INTERVAL '3 days'
     ORDER BY s."createdAt" DESC
     LIMIT 40`;
  return linhas.map((l) => {
    const eventos: EventoGravado[] = Array.isArray(l.eventos) ? l.eventos : [];
    return {
      ...l,
      eventos,
      status: statusPelosEventos(eventos),
      trocaPendente: trocaDeEnderecoPendente(eventos),
    };
  });
}
