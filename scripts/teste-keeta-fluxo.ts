/**
 * scripts/teste-keeta-fluxo.ts — o caminho inteiro da Keeta, sem banco e sem rede.
 *
 *   npx tsx scripts/teste-keeta-fluxo.ts
 *
 * Banco em memória (o jeito de scripts/teste-motivo-do-cancelamento.ts) e uma
 * Keeta FALSA no `fetch` que confere a assinatura de cada chamada, como a de
 * verdade faz. Cada caso é um furo de outro canal:
 *
 *   - pedido gravado ANTES do ok para a Keeta (JotaJá perdeu pedido com ack antes);
 *   - loja só pelo vínculo (JotaJá/iFood/Brendi já gravaram na loja errada);
 *   - mesmo evento duas vezes = um pedido (webhook + polling);
 *   - confirm na hora (a Keeta cancela em 5 min e fecha a loja);
 *   - falha ao avisar a Keeta vira pendência, não log calado (dispatch do iFood);
 *   - Keeta antes do "senão é JotaJá" (canal decide, não o campo).
 */
import { assinarChamada, hmacBase64 } from "../src/lib/keeta/assinatura";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

const SEGREDO = "segredo-de-teste";
Object.assign(process.env, { KEETA_CLIENT_ID: "app-teste", KEETA_CLIENT_SECRET: SEGREDO, NODE_ENV: "development" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco em memória ─────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; menuProduct: Linha[] } = { user: [], customerOrder: [], menuProduct: [] };
let proximoId = 1;
const casa = (l: Linha, where: any): boolean =>
  !where ||
  Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "OR") return (v as any[]).some((w) => casa(l, w));
    if (v && typeof v === "object" && "startsWith" in v) return String(l[k] || "").startsWith(v.startsWith);
    return l[k] === v;
  });
const pega = (l: Linha | undefined, select?: any) => (l && select ? Object.fromEntries(Object.keys(select).map((k) => [k, l[k]])) : l ?? null);
const delegado = (tabela: keyof typeof db) => ({
  findFirst: async ({ where, select }: any) => pega(db[tabela].find((l) => casa(l, where)), select),
  findUnique: async ({ where, select }: any) => pega(db[tabela].find((l) => casa(l, where)), select),
  update: async ({ where, data }: any) => {
    const l = db[tabela].find((x) => casa(x, where));
    if (!l) throw new Error(`update sem linha em ${tabela}`);
    Object.assign(l, data);
    return l;
  },
  create: async ({ data, select }: any) => {
    if (tabela === "customerOrder" && db.customerOrder.some((o) => o.openDeliveryOrderId === data.openDeliveryOrderId)) {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    }
    const l = { id: `id${proximoId++}`, ...data };
    if (tabela === "customerOrder") l.items = data.items?.create || [];
    db[tabela].push(l);
    return pega(l, select);
  },
});
(globalThis as any).prisma = {
  user: delegado("user"),
  customerOrder: delegado("customerOrder"),
  menuProduct: delegado("menuProduct"),
  $transaction: async (fn: any) => fn((globalThis as any).prisma),
  $executeRawUnsafe: async () => 0,
  $queryRawUnsafe: async () => [],
};

// ── O que fica fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let numeroDoDia = 0;
stub("../src/lib/order-number", { generateDailyOrderNumberTx: async () => ++numeroDoDia });
stub("../src/lib/fuso-da-loja", { fusoDaLoja: async () => "America/Sao_Paulo" });
stub("../src/lib/distancia-da-entrega", { pontoEDistanciaDoParceiro: async (_: string, p: any) => ({ ponto: p, km: p ? 2.4 : null }) });
stub("../src/lib/stock", { deductStockForOrder: async () => {} });
const impressos: string[] = [];
stub("../src/app/api/store/print-queue/route", { pushJobToPrintQueue: (_loja: string, pedido: any) => impressos.push(pedido.id) });
const alertas: string[] = [];
stub("../src/lib/server-monitor", { alertarFalhaDeIntegracao: async (_c: string, loja: string, d: string) => void alertas.push(`${loja}: ${d}`) });
stub("../src/lib/fiscal-automatico", { alertarCancelamentoComNota: async () => 0, emitirNfceDosPedidos: async () => {} });
const payloads: any[] = [];
stub("../src/lib/open-delivery/payload-cru", { guardarPayloadCru: async (r: any) => void payloads.push(r) });
const pendentes: any[] = [];
stub("../src/lib/keeta/acoes-pendentes", {
  registrarAcaoPendente: async (pedidoId: string, acao: string, corpo: unknown, erro: string) => void pendentes.push({ pedidoId, acao, corpo, erro }),
  acoesPendentes: async () => [],
  marcarTentativa: async () => {},
});
const MERCHANT = "firehub-keeta-loja-teste-0000000000000";
const vinculos: Record<string, any> = { [MERCHANT]: { merchantId: MERCHANT, franchiseeId: "loja-teste", keetaMerchantId: "159416882", ativa: true } };
stub("../src/lib/keeta/lojas", { lojaDoMerchant: async (m: string) => vinculos[m] ?? null, merchantsAtivos: async () => Object.keys(vinculos) });

db.user.push({ id: "loja-teste", storeName: "Loja Teste", autoAcceptOrders: false });

// ── Keeta falsa ──────────────────────────────────────────────────────────────
const BASE = "https://open.mykeeta.com/api/open/opendelivery";
type Chamada = { metodo: string; caminho: string; corpo: any; assinaturaOk: boolean };
const chamadas: Chamada[] = [];
const pedidosNaKeeta: Record<string, any> = {};
let confirmResponde = 202;

const pedidoBase = (id: string, extra: any = {}) => ({
  id,
  type: "DELIVERY",
  displayId: `D${id}`,
  createdAt: new Date().toISOString(),
  orderTiming: "INSTANT",
  lastEvent: "CREATED",
  preparationStartDateTime: new Date().toISOString(),
  merchant: { id: MERCHANT, name: "Loja Teste" },
  items: [{ id: "x1", name: "X-Salada", externalCode: "x1", unit: "UN", quantity: 1, unitPrice: { value: 30, currency: "BRL" }, totalPrice: { value: 30, currency: "BRL" } }],
  otherFees: [{ name: "Entrega", type: "DELIVERY_FEE", receivedBy: "MERCHANT", price: { value: 5, currency: "BRL" } }],
  discounts: [],
  total: { itemsPrice: { value: 30, currency: "BRL" }, otherFees: { value: 5, currency: "BRL" }, discount: { value: 0, currency: "BRL" }, orderAmount: { value: 35, currency: "BRL" } },
  payments: { prepaid: 35, pending: 0, methods: [{ value: 35, currency: "BRL", type: "PREPAID", method: "PIX" }] },
  customer: { id: "c1", name: "Ana", phone: { number: "ENC_tel" }, ordersCountOnMerchant: 1 },
  delivery: {
    deliveredBy: "MERCHANT",
    estimatedDeliveryDateTime: new Date(Date.now() + 40 * 60_000).toISOString(),
    deliveryAddress: { country: "BR", state: "BR-RJ", city: "Rio das Ostras", district: "ENC_bairro", street: "Rua das Flores", number: "ENC_num", formattedAddress: "ENC_fmt", postalCode: "28890000", coordinates: { latitude: -22.520318, longitude: -41.944127 } },
  },
  ...extra,
});
const claros: Record<string, string> = { ENC_tel: "22999998888", ENC_bairro: "Centro", ENC_num: "120", ENC_fmt: "Rua das Flores, 120" };

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const [semQuery, qs] = String(url).split("?");
  const caminho = semQuery.replace(BASE, "");
  const corpo = init.body;
  const resposta = (status: number, json?: unknown) => new Response(json === undefined ? null : JSON.stringify(json), { status });
  if (caminho === "/oauth/token") return resposta(200, { access_token: "tok", token_type: "bearer", expires_in: 21600 });
  const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : null;
  const esperada = assinarChamada(SEGREDO, semQuery, query, typeof corpo === "string" ? corpo : null);
  const assinaturaOk = init.headers?.["X-App-Signature"] === esperada && init.headers?.Authorization === "Bearer tok";
  chamadas.push({ metodo: init.method || "GET", caminho, corpo: corpo ? JSON.parse(corpo) : undefined, assinaturaOk });
  if (!assinaturaOk) return resposta(401, { title: `Invalid signature, Keeta sig is ${esperada}`, status: 401 });

  const m = caminho.match(/^\/v1\/orders\/([^/]+)(?:\/(\w+))?$/);
  if (m && !m[2]) return pedidosNaKeeta[m[1]] ? resposta(200, pedidosNaKeeta[m[1]]) : resposta(404, { title: "not found", status: 404 });
  if (m && m[2] === "confirm") return resposta(confirmResponde, confirmResponde >= 400 ? { title: "indisponível", status: confirmResponde } : undefined);
  if (m) return resposta(202);
  if (caminho === "/v1/batchDecrypt") {
    const { cipherInfos } = JSON.parse(corpo);
    return resposta(200, { plainInfos: cipherInfos.map((c: any) => ({ cipherText: c.cipherText, plainText: claros[c.cipherText] ?? "", errorCode: claros[c.cipherText] ? 0 : 1, errorMsg: "" })) });
  }
  return resposta(404, { title: "rota falsa desconhecida", status: 404 });
};

async function main() {
  const { processarEventoKeeta } = await import("../src/lib/keeta/eventos");
  const { sincronizarKeeta } = await import("../src/lib/keeta/status");
  const { chaveDoCanal } = await import("../src/lib/canal-do-pedido");
  const { infoDaEntrega } = await import("../src/lib/entrega-parceira");
  const ev = (orderId: string, eventType: string, metadata?: any) => ({ eventId: `${orderId}-${eventType}`, eventType, orderId, createdAt: new Date().toISOString(), metadata: metadata ? JSON.stringify(metadata) : undefined });

  // 1. Pedido novo de loja vinculada, entrega da loja
  pedidosNaKeeta["1001"] = pedidoBase("1001");
  const r1 = await processarEventoKeeta(ev("1001", "CREATED"));
  const p1 = db.customerOrder.find((o) => o.openDeliveryOrderId === "keeta_1001");
  confere("CREATED: gravado e pode dar ack", [r1.confirmar, r1.acao, !!p1], [true, "created", true]);
  confere("CREATED: canal, número curto, loja", [p1?.source, p1?.openDeliveryReference, p1?.franchiseeId], ["KEETA", "D1001", "loja-teste"]);
  confere("CREATED: aceite automático desligado → NOVO no FireHub", p1?.status, "NOVO");
  confere("CREATED: decifrou telefone e endereço (entrega da loja)", [p1?.customerPhone, p1?.customerAddress], ["22999998888", "Rua das Flores, 120 - Centro - Rio das Ostras"]);
  confere("CREATED: pago no app", p1?.paymentMethod, "Pix (Pago Online)");
  confere("CREATED: número do dia e km", [p1?.dailyOrderNumber, p1?.deliveryDistance], [1, 2.4]);
  confere("CREATED: foi para a impressão", impressos.includes(p1?.id), true);
  const confirm1 = chamadas.find((c) => c.caminho === "/v1/orders/1001/confirm");
  confere("CREATED: confirm na hora, com o número do FireHub", [!!confirm1, confirm1?.corpo?.orderExternalCode, typeof confirm1?.corpo?.createdAt], [true, "#1", "string"]);
  confere("toda chamada à Keeta saiu assinada certo", chamadas.every((c) => c.assinaturaOk), true);
  confere("payload cru guardado com a loja", payloads.some((p) => p.tipo === "pedido" && p.idNoParceiro === "1001" && p.franchiseeId === "loja-teste"), true);

  // 2. O mesmo evento de novo (webhook + polling)
  const antes = db.customerOrder.length;
  const confirmsAntes = chamadas.filter((c) => c.caminho.endsWith("/confirm")).length;
  const r2 = await processarEventoKeeta(ev("1001", "CREATED"));
  confere("mesmo CREATED de novo: um pedido só, sem confirm repetido", [r2.acao, db.customerOrder.length - antes, chamadas.filter((c) => c.caminho.endsWith("/confirm")).length - confirmsAntes], ["exists", 0, 0]);

  // 3. Loja sem vínculo
  pedidosNaKeeta["2001"] = pedidoBase("2001", { merchant: { id: "firehub-keeta-outra-loja-000000000000000", name: "?" } });
  const r3 = await processarEventoKeeta(ev("2001", "CREATED"));
  await new Promise((r) => setTimeout(r, 50)); // o aviso sai em segundo plano, sem segurar a resposta à Keeta
  confere("loja sem vínculo: NÃO grava, NÃO dá ack, avisa", [r3.confirmar, r3.acao, db.customerOrder.some((o) => o.openDeliveryOrderId === "keeta_2001"), alertas.length > 0], [false, "sem-loja", false, true]);

  // 4. Webhook diz uma loja e o pedido diz outra
  pedidosNaKeeta["3001"] = pedidoBase("3001");
  const r4 = await processarEventoKeeta(ev("3001", "CREATED"), { merchantDoCabecalho: "firehub-keeta-intrusa-0000000000000000000" });
  confere("loja do webhook ≠ loja do pedido: recusa", [r4.confirmar, r4.acao, db.customerOrder.some((o) => o.openDeliveryOrderId === "keeta_3001")], [false, "recusado", false]);

  // 5. Pedido que a Keeta não conhece
  const r5 = await processarEventoKeeta(ev("9999", "CREATED"));
  confere("404 na Keeta: descarta (não segura o evento 4 h)", [r5.confirmar, r5.acao], [true, "descartado"]);

  // 6. Entregador da Keeta: não decifra, LOGISTICS
  pedidosNaKeeta["4001"] = pedidoBase("4001", { delivery: { ...pedidoBase("x").delivery, deliveredBy: "MARKETPLACE", pickupCode: "7731" } });
  const decifrasAntes = chamadas.filter((c) => c.caminho === "/v1/batchDecrypt").length;
  await processarEventoKeeta(ev("4001", "CREATED"));
  const p4 = db.customerOrder.find((o) => o.openDeliveryOrderId === "keeta_4001");
  confere("entrega da Keeta: não chama batchDecrypt", chamadas.filter((c) => c.caminho === "/v1/batchDecrypt").length - decifrasAntes, 0);
  confere("entrega da Keeta: LOGISTICS + código de coleta, sem ENC_ no endereço", [p4?.deliveryBy, p4?.openDeliveryPickupCode, p4?.customerAddress, p4?.customerPhone], ["LOGISTICS", "7731", "Rua das Flores - Rio das Ostras", ""]);
  confere("entrega da Keeta: o resto do sistema vê entrega parceira da Keeta", infoDaEntrega(p4), { parceira: true, parceiro: "KEETA", codigoDeColeta: "7731" });

  // 7. Confirm recusado: pedido fica, pendência registrada, loja avisada
  confirmResponde = 503;
  pedidosNaKeeta["5001"] = pedidoBase("5001");
  const alertasAntes = alertas.length;
  const r7 = await processarEventoKeeta(ev("5001", "CREATED"));
  await new Promise((r) => setTimeout(r, 50));
  confere("confirm 503: pedido gravado e ack (o pedido está salvo)", [r7.confirmar, db.customerOrder.some((o) => o.openDeliveryOrderId === "keeta_5001")], [true, true]);
  confere("confirm 503: vira pendência para o polling repetir + aviso", [pendentes.some((p) => p.pedidoId === "keeta_5001" && p.acao === "confirm"), alertas.length > alertasAntes], [true, true]);
  confirmResponde = 202;

  // 8. Pedido velho (fila antiga) não é confirmado
  pedidosNaKeeta["6001"] = pedidoBase("6001", { createdAt: new Date(Date.now() - 60 * 60_000).toISOString() });
  await processarEventoKeeta(ev("6001", "CREATED"));
  confere("pedido de 1 h atrás entra, mas sem confirm", chamadas.some((c) => c.caminho === "/v1/orders/6001/confirm"), false);

  // 9. Já cancelado na Keeta
  pedidosNaKeeta["7001"] = pedidoBase("7001", { lastEvent: "CANCELLED" });
  const r9 = await processarEventoKeeta(ev("7001", "CREATED"));
  confere("já cancelado lá: não entra na cozinha", [r9.acao, db.customerOrder.some((o) => o.openDeliveryOrderId === "keeta_7001")], ["ja-cancelado", false]);

  // 10. Status vindo da Keeta só avança
  await processarEventoKeeta(ev("1001", "CONCLUDED"));
  confere("CONCLUDED → ENTREGUE", p1?.status, "ENTREGUE");
  await processarEventoKeeta(ev("1001", "DISPATCHED"));
  confere("DISPATCHED atrasado não volta o pedido", p1?.status, "ENTREGUE");
  await processarEventoKeeta(ev("4001", "CONFIRMED"));
  confere("CONFIRMED (eco do nosso confirm) não muda o status escolhido pela loja", p4?.status, "NOVO");

  // 11. Cancelado pela Keeta
  await processarEventoKeeta(ev("4001", "CANCELLED", { cancelReason: "Preparo dos alimentos demorado", cancelType: 505001 }));
  confere("CANCELLED: cancela com motivo e culpa a Keeta", [p4?.status, p4?.cancelledBy, p4?.cancelReason], ["CANCELADO", "KEETA", "Preparo dos alimentos demorado"]);

  // 12. Reembolso pedido pelo cliente: nota, valor em centavos → reais
  await processarEventoKeeta(ev("5001", "USER_REFUND_REQUEST", { money: 3500, applyReason: "Faltou item" }));
  const p5 = db.customerOrder.find((o) => o.openDeliveryOrderId === "keeta_5001");
  confere("reembolso: aviso nas notas, valor em reais", String(p5?.notes).includes("Cliente pediu reembolso R$ 35.00 na Keeta (Faltou item)"), true);

  // 13. Status da loja para a Keeta
  chamadas.length = 0;
  await sincronizarKeeta({ openDeliveryOrderId: "keeta_5001", franchiseeId: "loja-teste", status: "ACEITO", deliveryBy: "MERCHANT", deliveryType: "DELIVERY" }, "SAIU_ENTREGA");
  confere("ACEITO → SAIU_ENTREGA (entrega da loja): readyForPickup + dispatch", chamadas.map((c) => c.caminho), ["/v1/orders/5001/readyForPickup", "/v1/orders/5001/dispatch"]);
  chamadas.length = 0;
  await sincronizarKeeta({ openDeliveryOrderId: "keeta_4001", franchiseeId: "loja-teste", status: "ACEITO", deliveryBy: "LOGISTICS", deliveryType: "DELIVERY" }, "SAIU_ENTREGA");
  confere("entregador da Keeta: só readyForPickup (quem despacha é ela)", chamadas.map((c) => c.caminho), ["/v1/orders/4001/readyForPickup"]);
  chamadas.length = 0;
  await sincronizarKeeta({ openDeliveryOrderId: "keeta_1001", franchiseeId: "loja-teste", status: "NOVO" }, "CANCELADO", { motivo: "Sem entregador" });
  confere("CANCELADO: requestCancellation com motivo, code e mode", chamadas.map((c) => [c.caminho, c.corpo]), [["/v1/orders/1001/requestCancellation", { reason: "Sem entregador", code: "SYSTEMIC_ISSUES", mode: "AUTO" }]]);
  chamadas.length = 0;
  await sincronizarKeeta({ openDeliveryOrderId: "keeta_1001", franchiseeId: "loja-teste", status: "NOVO" }, "ACEITO");
  confere("NOVO → ACEITO: confirm", chamadas.map((c) => c.caminho), ["/v1/orders/1001/confirm"]);

  // 14. Canal decide
  confere("canal-do-pedido reconhece a Keeta antes do 'todo openDeliveryOrderId é JotaJá'", chaveDoCanal({ source: "KEETA", openDeliveryOrderId: "keeta_1" }), "KEETA");

  // 15. Webhook: 204 só depois de gravar
  const { POST } = await import("../src/app/api/keeta/webhook/route");
  pedidosNaKeeta["8001"] = pedidoBase("8001");
  const corpo = JSON.stringify(ev("8001", "CREATED"));
  const req = (b: string, assinatura: string, merchant = MERCHANT) =>
    new Request("https://firehubfood.com.br/api/keeta/webhook", { method: "POST", body: b, headers: { "x-app-signature": assinatura, "x-app-merchantid": merchant } }) as any;
  const w1 = await POST(req(corpo, hmacBase64(SEGREDO, corpo)));
  confere("webhook assinado: 204 com o pedido gravado", [w1.status, db.customerOrder.some((o) => o.openDeliveryOrderId === "keeta_8001")], [204, true]);
  pedidosNaKeeta["8002"] = pedidoBase("8002", { merchant: { id: "firehub-keeta-outra-loja-000000000000000", name: "?" } });
  const corpo2 = JSON.stringify(ev("8002", "CREATED"));
  const w2 = await POST(req(corpo2, hmacBase64(SEGREDO, corpo2), "firehub-keeta-outra-loja-000000000000000"));
  confere("webhook de loja sem vínculo: 500 (a Keeta reenvia; o polling também)", w2.status, 500);
  process.env.KEETA_WEBHOOK_ASSINATURA = "obrigatoria";
  const w3 = await POST(req(corpo, "assinatura-errada"));
  confere("assinatura obrigatória + errada: 401", w3.status, 401);
  delete process.env.KEETA_WEBHOOK_ASSINATURA;
  const w4 = await POST(req(corpo, "assinatura-errada"));
  confere("modo observar: assinatura errada processa (só usa o orderId) e registra o aviso", [w4.status, payloads.some((p) => p.tipo === "webhook" && (p.avisos || []).length > 0)], [204, true]);

  // 16. Sem credencial no servidor, nada chama a Keeta
  delete process.env.KEETA_CLIENT_ID;
  chamadas.length = 0;
  const desligada = await sincronizarKeeta({ openDeliveryOrderId: "keeta_1001", franchiseeId: "loja-teste", status: "NOVO" }, "ACEITO");
  const w5 = await POST(req(corpo, hmacBase64(SEGREDO, corpo)));
  confere("sem credencial: sincronizar ignora, webhook 503, zero chamadas", [desligada.ignorado, w5.status, chamadas.length], [true, 503, 0]);

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
