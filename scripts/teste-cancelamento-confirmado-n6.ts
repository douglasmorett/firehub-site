/**
 * Evento de parceiro SEM assinatura válida só cancela/disputa/muda status de
 * pedido existente depois de a API do parceiro confirmar (auditoria de
 * 23/10/2026: Brendi F17/F68/F86, 99Food F67/F96, Keeta F138/F141, JotaJá
 * F139/F140). Banco em memória e `fetch` falso: sem banco e sem rede.
 *
 *   NEXTAUTH_SECRET=teste-local npx tsx scripts/teste-cancelamento-confirmado-n6.ts
 *
 * Para cada parceiro:
 *   - forjado, API diz "não cancelado"   → ignorado (o código antigo cancelava)
 *   - sem assinatura, API confirma        → aplica
 *   - API fora do ar                      → aplica (perder cancelamento real é pior)
 *   - veio do polling                     → aplica sem perguntar à API
 *   - outro canal com o mesmo id          → não é tocado
 */
import { readFileSync } from "node:fs";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

Object.assign(process.env, { KEETA_CLIENT_ID: "app-teste", KEETA_CLIENT_SECRET: "segredo-de-teste", NODE_ENV: "development" });
process.env.DATABASE_URL ||= "postgresql://127.0.0.1:1/teste"; // nunca conecta: só o import exige a variável

// ── Banco em memória ─────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const pedidos: Linha[] = [];
const casaValor = (valor: any, cond: any): boolean => {
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    if ("notIn" in cond) return !cond.notIn.includes(valor);
    if ("in" in cond) return cond.in.includes(valor);
    if ("startsWith" in cond) return String(valor ?? "").startsWith(cond.startsWith);
    if ("not" in cond) return valor !== cond.not;
  }
  return valor === cond;
};
const casa = (l: Linha, where: any): boolean =>
  !where ||
  Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "OR") return (v as any[]).some((w) => casa(l, w));
    if (k === "AND") return (v as any[]).every((w) => casa(l, w));
    if (k === "NOT") return !casa(l, v);
    return casaValor(l[k], v);
  });
const pega = (l: Linha | undefined, select?: any) => (l && select ? Object.fromEntries(Object.keys(select).map((k) => [k, l[k]])) : l ?? null);
(globalThis as any).prisma = {
  customerOrder: {
    findFirst: async ({ where, select }: any) => pega(pedidos.find((l) => casa(l, where)), select),
    findMany: async ({ where }: any) => pedidos.filter((l) => casa(l, where)),
    update: async ({ where, data }: any) => {
      const l = pedidos.find((x) => casa(x, where));
      if (!l) throw new Error("update sem linha");
      return Object.assign(l, data);
    },
    updateMany: async ({ where, data }: any) => {
      const alvo = pedidos.filter((x) => casa(x, where));
      alvo.forEach((l) => Object.assign(l, data));
      return { count: alvo.length };
    },
  },
  user: { findFirst: async () => null, findUnique: async () => null, findMany: async () => [] },
  $queryRaw: async () => [],
  $executeRaw: async () => 0,
  $transaction: async (fn: any) => fn((globalThis as any).prisma),
};

// ── API falsa dos parceiros ──────────────────────────────────────────────────
// `naApi[parceiro][id]`: o pedido como a API devolve; "fora" = 503; ausente = 404.
const naApi: Record<string, Record<string, any>> = { brendi: {}, keeta: {}, jotaja: {}, food99: {} };
const consultas: Record<string, number> = { brendi: 0, keeta: 0, jotaja: 0, food99: 0 };
(globalThis as any).fetch = async (url: string) => {
  const u = new URL(String(url));
  const resposta = (status: number, json?: unknown) => new Response(json === undefined ? null : JSON.stringify(json), { status });
  if (u.pathname.endsWith("/oauth/token")) return resposta(200, { access_token: "tok", expires_in: 21600 });
  const parceiro = u.host.startsWith("brendi") ? "brendi" : u.host.startsWith("jotaja") ? "jotaja" : u.host.startsWith("99") ? "food99" : "keeta";
  const id = parceiro === "food99" ? String(u.searchParams.get("order_id")) : decodeURIComponent(u.pathname.split("/").pop() || "");
  consultas[parceiro]++;
  const p = naApi[parceiro][id];
  if (p === "fora") return resposta(503, { erro: "fora do ar" });
  if (!p) return resposta(404, { title: "not found" });
  return resposta(200, p);
};

// ── O que fica fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("../src/lib/fiscal-automatico", { alertarCancelamentoComNota: async () => 0, emitirNfceDosPedidos: async () => {} });
stub("../src/lib/brendi-api", {
  brendiFetch: (caminho: string, loja: string) => fetch(`https://brendi.falso${caminho}?loja=${loja}`),
  brendiMutate: async () => new Response(null, { status: 202 }),
  confirmarPedidoBrendi: async () => ({ ok: true }),
});
stub("../src/lib/food99-status", {
  buscarPedido99: async (loja: string, orderId: string) => {
    const r = await fetch(`https://99.falso/v1/order/order/detail?order_id=${orderId}&loja=${loja}`);
    if (!r.ok) return { ok: false, errno: r.status, errmsg: "falhou", tentativas: 1 };
    return { ok: true, data: await r.json(), token: "t" };
  },
});
stub("../src/lib/open-delivery/payload-cru", { guardarPayloadCru: async () => {} });
stub("../src/lib/server-monitor", { alertarFalhaDeIntegracao: async () => {} });
stub("../src/lib/jotaja-api", { ligadoEmDaLoja: async () => null });

const novoPedido = (id: string, canal: string, extra: Linha = {}): Linha => {
  const l = { id: `p-${canal}-${id}`, openDeliveryOrderId: id, openDeliveryChannel: canal, franchiseeId: "loja-a", status: "ACEITO", notes: "", cancelledBy: null, ...extra };
  pedidos.push(l);
  return l;
};

async function main() {
  const { processBrendiEvent } = await import("../src/lib/processBrendiEvent");
  const { processarEventoKeeta } = await import("../src/lib/keeta/eventos");
  const { processJotajaEvent } = await import("../src/lib/processJotajaEvent");
  const { aplicarStatusDoEvento99 } = await import("../src/lib/food99-status-do-evento");
  const { estadoDoLastEvent, conferirEstado } = await import("../src/lib/evento-sem-assinatura");
  const avisoOriginal = console.warn;
  const avisos: string[] = [];
  console.warn = (...a: any[]) => void avisos.push(a.join(" "));
  const silencio = console.error;
  console.error = () => {};

  // ── Regra pura ──────────────────────────────────────────────────────────────
  console.log("\n── Regra ──");
  confere("CANCELLED confirma cancelamento", conferirEstado(estadoDoLastEvent("CANCELLED"), "CANCELADO"), "confere");
  confere("CONFIRMED não confirma cancelamento", conferirEstado(estadoDoLastEvent("CONFIRMED"), "CANCELADO"), "nao-confere");
  confere("sem lastEvent: não dá para conferir (aplica)", conferirEstado(estadoDoLastEvent(undefined), "CANCELADO"), "sem-estado");
  confere("DISPATCHED confirma PRONTO (a API já passou)", conferirEstado(estadoDoLastEvent("DISPATCHED"), "PRONTO"), "confere");
  confere("CONFIRMED não confirma ENTREGUE", conferirEstado(estadoDoLastEvent("CONFIRMED"), "ENTREGUE"), "nao-confere");
  confere("CANCELLED não confirma ENTREGUE", conferirEstado(estadoDoLastEvent("CANCELLED"), "ENTREGUE"), "nao-confere");
  confere("negativa vale com o pedido seguindo", conferirEstado(estadoDoLastEvent("CONFIRMED"), "DISPUTA_NEGADA"), "confere");
  confere("negativa não vale com disputa aberta", conferirEstado(estadoDoLastEvent("CANCELLATION_REQUESTED"), "DISPUTA_NEGADA"), "nao-confere");

  // ── Brendi ──────────────────────────────────────────────────────────────────
  console.log("\n── Brendi ──");
  const b1 = novoPedido("b-forjado", "BRENDI");
  naApi.brendi["b-forjado"] = { id: "b-forjado", lastEvent: "CONFIRMED" };
  avisos.length = 0;
  const rb1 = await processBrendiEvent({ orderId: "b-forjado", eventType: "CANCELLED" }, { conferirNaApi: true });
  confere("forjado, API diz CONFIRMED: NÃO cancela", [rb1.action, b1.status], ["skipped", "ACEITO"]);
  confere("…e loga o aviso combinado", avisos.some((a) => a.includes("[Brendi] evento sem assinatura não confere com a API: ignorado")), true);
  confere("…e marca para o webhook não dar ACK (o polling aplica o real)", rb1.naoConferiuNaApi, true);
  confere("API confirmando não marca", (await processBrendiEvent({ orderId: "b-forjado", eventType: "PICKUP_AREA_ASSIGNED" }, { conferirNaApi: true })).naoConferiuNaApi, undefined);

  const b2 = novoPedido("b-real", "BRENDI");
  naApi.brendi["b-real"] = { id: "b-real", lastEvent: "CANCELLED" };
  const rb2 = await processBrendiEvent({ orderId: "b-real", eventType: "CANCELLED" }, { conferirNaApi: true });
  confere("sem assinatura, API confirma: cancela", [rb2.action, b2.status, b2.cancelledBy], ["cancelled", "CANCELADO", "BRENDI"]);

  const b3 = novoPedido("b-fora", "BRENDI");
  naApi.brendi["b-fora"] = "fora";
  const rb3 = await processBrendiEvent({ orderId: "b-fora", eventType: "CANCELLED" }, { conferirNaApi: true });
  confere("API fora do ar: cancela assim mesmo", [rb3.action, b3.status], ["cancelled", "CANCELADO"]);

  const b4 = novoPedido("b-poll", "BRENDI");
  naApi.brendi["b-poll"] = { id: "b-poll", lastEvent: "CONFIRMED" };
  const antesB = consultas.brendi;
  const rb4 = await processBrendiEvent({ orderId: "b-poll", eventType: "CANCELLED" }, { targetFranchiseeId: "loja-a" });
  confere("polling: cancela sem consultar a API", [rb4.action, b4.status, consultas.brendi - antesB], ["cancelled", "CANCELADO", 0]);

  const k99 = novoPedido("x-outro", "99FOOD");
  const rb5 = await processBrendiEvent({ orderId: "x-outro", eventType: "CANCELLED" }, { targetFranchiseeId: "loja-a" });
  confere("id de pedido do 99Food: o CANCELLED da Brendi não toca", [rb5.action, k99.status], ["cancelled", "ACEITO"]);
  const kk = novoPedido("keeta_7", "KEETA");
  await processBrendiEvent({ orderId: "keeta_7", eventType: "CANCELLATION_REQUESTED", metadata: { reason: "x" } }, { targetFranchiseeId: "loja-a" });
  confere("…nem a disputa da Brendi", kk.cancelDispute, undefined);

  const b6 = novoPedido("b-rec", "BRENDI", { openDeliveryOrderId: "b-rec_recovered" });
  naApi.brendi["b-rec"] = { id: "b-rec", lastEvent: "CANCELLED" };
  await processBrendiEvent({ orderId: "b-rec", eventType: "CANCELLED" }, { conferirNaApi: true });
  confere("o registro _recovered continua alcançado", b6.status, "CANCELADO");

  const b7 = novoPedido("b-disp", "BRENDI");
  naApi.brendi["b-disp"] = { id: "b-disp", lastEvent: "CONFIRMED" };
  const rb7 = await processBrendiEvent({ orderId: "b-disp", eventType: "CANCELLATION_REQUESTED", metadata: { reason: "forjado" } }, { conferirNaApi: true });
  confere("disputa forjada (API sem disputa): não grava", [rb7.action, b7.cancelDispute], ["skipped", undefined]);
  naApi.brendi["b-disp"] = { id: "b-disp", lastEvent: "CANCELLATION_REQUESTED" };
  const rb7b = await processBrendiEvent({ orderId: "b-disp", eventType: "CANCELLATION_REQUESTED", metadata: { reason: "cliente" } }, { conferirNaApi: true });
  confere("disputa confirmada na API: grava", [rb7b.action, b7.cancelDispute?.pending], ["dispute", true]);

  const b8 = novoPedido("b-stat", "BRENDI");
  naApi.brendi["b-stat"] = { id: "b-stat", lastEvent: "CONFIRMED" };
  const rb8 = await processBrendiEvent({ orderId: "b-stat", eventType: "DELIVERED" }, { conferirNaApi: true });
  confere("DELIVERED forjado (API em CONFIRMED): status fica", [rb8.action, b8.status], ["skipped", "ACEITO"]);
  naApi.brendi["b-stat"] = { id: "b-stat", lastEvent: "DISPATCHED" };
  await processBrendiEvent({ orderId: "b-stat", eventType: "DISPATCHED" }, { conferirNaApi: true });
  confere("DISPATCHED confirmado: avança", b8.status, "SAIU_ENTREGA");

  // ── Keeta ───────────────────────────────────────────────────────────────────
  console.log("\n── Keeta ──");
  const ev = (orderId: string, eventType: string) => ({ eventId: `${orderId}-${eventType}`, eventType, orderId, metadata: JSON.stringify({ cancelReason: "motivo do corpo" }) });
  const k1 = novoPedido("keeta_k-forjado", "KEETA");
  naApi.keeta["k-forjado"] = { id: "k-forjado", lastEvent: "CONFIRMED" };
  avisos.length = 0;
  const rk1 = await processarEventoKeeta(ev("k-forjado", "CANCELLED"), { conferirNaApi: true });
  confere("forjado, API diz CONFIRMED: NÃO cancela", [rk1.acao, k1.status], ["ignorado", "ACEITO"]);
  confere("…e loga o aviso combinado", avisos.some((a) => a.includes("[Keeta] evento sem assinatura não confere com a API: ignorado")), true);

  const k2 = novoPedido("keeta_k-real", "KEETA");
  naApi.keeta["k-real"] = { id: "k-real", lastEvent: "CANCELLED" };
  const rk2 = await processarEventoKeeta(ev("k-real", "CANCELLED"), { conferirNaApi: true });
  confere("sem assinatura, API confirma: cancela", [rk2.acao, k2.status], ["cancelado", "CANCELADO"]);

  const k3 = novoPedido("keeta_k-fora", "KEETA");
  naApi.keeta["k-fora"] = "fora";
  const rk3 = await processarEventoKeeta(ev("k-fora", "CANCELLED"), { conferirNaApi: true });
  confere("API fora do ar: cancela assim mesmo", [rk3.acao, k3.status], ["cancelado", "CANCELADO"]);

  const k4 = novoPedido("keeta_k-poll", "KEETA");
  naApi.keeta["k-poll"] = { id: "k-poll", lastEvent: "CONFIRMED" };
  const antesK = consultas.keeta;
  const rk4 = await processarEventoKeeta(ev("k-poll", "CANCELLED"));
  confere("polling: cancela sem consultar a API", [rk4.acao, k4.status, consultas.keeta - antesK], ["cancelado", "CANCELADO", 0]);

  const k5 = novoPedido("keeta_k-outro", "BRENDI");
  const rk5 = await processarEventoKeeta(ev("k-outro", "CANCELLED"));
  confere("o mesmo id em outro canal: não toca", [rk5.acao, k5.status], ["ignorado", "ACEITO"]);

  const k6 = novoPedido("keeta_k-stat", "KEETA", { status: "PRONTO" });
  naApi.keeta["k-stat"] = { id: "k-stat", lastEvent: "READY_FOR_PICKUP" };
  const rk6 = await processarEventoKeeta(ev("k-stat", "DELIVERED"), { conferirNaApi: true });
  confere("DELIVERED forjado (API em READY_FOR_PICKUP): status fica", [rk6.acao, k6.status], ["ignorado", "PRONTO"]);
  naApi.keeta["k-stat"] = { id: "k-stat", lastEvent: "CONCLUDED" };
  await processarEventoKeeta(ev("k-stat", "DELIVERED"), { conferirNaApi: true });
  confere("DELIVERED confirmado: avança", k6.status, "ENTREGUE");

  // ── JotaJá ──────────────────────────────────────────────────────────────────
  console.log("\n── JotaJá ──");
  const jf = (caminho: string) => fetch(`https://jotaja.falso${caminho}`);
  const jm = async () => new Response(null, { status: 202 });
  const j1 = novoPedido("j-forjado", "JOTAJA");
  naApi.jotaja["j-forjado"] = { id: "j-forjado", lastEvent: "CONFIRMED" };
  avisos.length = 0;
  const rj1 = await processJotajaEvent({ orderId: "j-forjado", eventType: "CANCELLED" }, jf, jm, "loja-a", { conferirNaApi: true });
  confere("forjado, API diz CONFIRMED: NÃO cancela (e não é ackado)", [rj1.action, j1.status], ["error", "ACEITO"]);
  confere("…e loga o aviso combinado", avisos.some((a) => a.includes("[JotaJá] evento sem assinatura não confere com a API: ignorado")), true);

  const j2 = novoPedido("j-real", "JOTAJA");
  naApi.jotaja["j-real"] = { id: "j-real", lastEvent: "CANCELLED" };
  const rj2 = await processJotajaEvent({ orderId: "j-real", eventType: "CANCELLED" }, jf, jm, "loja-a", { conferirNaApi: true });
  confere("sem assinatura, API confirma: cancela", [rj2.action, j2.status, j2.cancelledBy], ["cancelled", "CANCELADO", "JOTAJA"]);

  const j3 = novoPedido("j-fora", "JOTAJA");
  naApi.jotaja["j-fora"] = "fora";
  const rj3 = await processJotajaEvent({ orderId: "j-fora", eventType: "CANCELLED" }, jf, jm, "loja-a", { conferirNaApi: true });
  confere("API fora do ar: cancela assim mesmo", [rj3.action, j3.status], ["cancelled", "CANCELADO"]);

  const j4 = novoPedido("j-poll", "JOTAJA");
  naApi.jotaja["j-poll"] = { id: "j-poll", lastEvent: "CONFIRMED" };
  const antesJ = consultas.jotaja;
  const rj4 = await processJotajaEvent({ orderId: "j-poll", eventType: "CANCELLED" }, jf, jm, "loja-a");
  confere("polling: cancela sem consultar a API", [rj4.action, j4.status, consultas.jotaja - antesJ], ["cancelled", "CANCELADO", 0]);

  const j5 = novoPedido("j-outro", "BRENDI");
  naApi.jotaja["j-outro"] = { id: "j-outro", lastEvent: "CANCELLED", createdAt: new Date().toISOString() };
  const rj5 = await processJotajaEvent({ orderId: "j-outro", eventType: "CANCELLED" }, jf, jm, "loja-a");
  confere("o mesmo id em outro canal: não toca", [rj5.action !== "cancelled", j5.status], [true, "ACEITO"]);

  const j6 = novoPedido("j-disp", "JOTAJA");
  naApi.jotaja["j-disp"] = { id: "j-disp", lastEvent: "CONFIRMED" };
  const rj6 = await processJotajaEvent({ orderId: "j-disp", eventType: "CANCELLATION_REQUESTED", code: "CRR", metadata: { message: "forjado" } } as any, jf, jm, "loja-a", { conferirNaApi: true });
  confere("disputa forjada: não grava", [rj6.action, j6.cancelDispute], ["error", undefined]);

  const j7 = novoPedido("j-stat", "JOTAJA");
  naApi.jotaja["j-stat"] = { id: "j-stat", lastEvent: "CONFIRMED" };
  const rj7 = await processJotajaEvent({ orderId: "j-stat", eventType: "CONCLUDED" }, jf, jm, "loja-a", { conferirNaApi: true });
  confere("CONCLUDED forjado (API em CONFIRMED): status fica", [rj7.action, j7.status], ["error", "ACEITO"]);
  const rj7b = await processJotajaEvent({ orderId: "j-stat", eventType: "CONCLUDED" }, jf, jm, "loja-a");
  confere("…e o mesmo evento pelo polling avança", [rj7b.action, j7.status], ["updated", "ENTREGUE"]);

  // ── 99Food ──────────────────────────────────────────────────────────────────
  console.log("\n── 99Food ──");
  const n1 = novoPedido("n-forjado", "99FOOD");
  naApi.food99["n-forjado"] = { order_id: "n-forjado", status: "CONFIRMED" };
  avisos.length = 0;
  const rn1 = await aplicarStatusDoEvento99("n-forjado", "CANCELADO", "orderCancel", true);
  confere("forjado, order/detail diz CONFIRMED: NÃO cancela", [rn1, n1.status], [{ aplicado: 0, ignorado: true }, "ACEITO"]);
  confere("…e loga o aviso combinado", avisos.some((a) => a.includes("[99Food] evento sem assinatura não confere com a API: ignorado")), true);

  const n2 = novoPedido("n-real", "99FOOD");
  naApi.food99["n-real"] = { order_id: "n-real", status: "CANCELLED" };
  const rn2 = await aplicarStatusDoEvento99("n-real", "CANCELADO", "orderCancel", true);
  confere("sem assinatura, API confirma: cancela", [rn2.aplicado, n2.status], [1, "CANCELADO"]);

  const n3 = novoPedido("n-fora", "99FOOD");
  naApi.food99["n-fora"] = "fora";
  const rn3 = await aplicarStatusDoEvento99("n-fora", "CANCELADO", "orderCancel", true);
  confere("API fora do ar: cancela assim mesmo", [rn3.aplicado, n3.status], [1, "CANCELADO"]);

  const n4 = novoPedido("n-num", "99FOOD");
  naApi.food99["n-num"] = { order_id: "n-num", status: 160 };
  const rn4 = await aplicarStatusDoEvento99("n-num", "CANCELADO", "orderCancel", true);
  confere("estado numérico ainda não mapeado: aplica (com log do valor)", [rn4.aplicado, n4.status, avisos.some((a) => a.includes("160"))], [1, "CANCELADO", true]);

  const n5 = novoPedido("n-assinado", "99FOOD");
  naApi.food99["n-assinado"] = { order_id: "n-assinado", status: "CONFIRMED" };
  const antes99 = consultas.food99;
  const rn5 = await aplicarStatusDoEvento99("n-assinado", "CANCELADO", "orderCancel", false);
  confere("assinatura válida: cancela sem consultar a API", [rn5.aplicado, n5.status, consultas.food99 - antes99], [1, "CANCELADO", 0]);

  const n6 = novoPedido("n-outro", "JOTAJA");
  const rn6 = await aplicarStatusDoEvento99("n-outro", "CANCELADO", "orderCancel", false);
  confere("o mesmo id em outro canal: não toca", [rn6.aplicado, n6.status], [0, "ACEITO"]);

  // ── As rotas passam a origem ────────────────────────────────────────────────
  console.log("\n── Rotas ──");
  const ler = (f: string) => readFileSync(f, "utf8");
  confere("Brendi webhook: confere na API quando a assinatura não é válida",
    ler("src/app/api/brendi/webhook/route.ts").includes('processBrendiEvent(eventoMinimo, { conferirNaApi: assinaturaBrendi.estado !== "valida" })'), true);
  confere("Brendi webhook: evento que não conferiu fica sem ACK",
    /if \(eventoId && result\.naoConferiuNaApi\) \{[\s\S]{0,300}?\} else if \(eventoId\) \{\s*const gravado/.test(ler("src/app/api/brendi/webhook/route.ts")), true);
  confere("Brendi polling não confere (evento veio da API)",
    /processBrendiEvent\(event, \{ targetFranchiseeId: storeId \}\)/.test(ler("src/app/api/cron/brendi-poll/route.ts")), true);
  confere("Keeta webhook: confere quando a assinatura não bate",
    ler("src/app/api/keeta/webhook/route.ts").includes("conferirNaApi: !assinaturaOk"), true);
  confere("Keeta polling não confere", ler("src/app/api/cron/keeta-poll/route.ts").includes("processarEventoKeeta(ev)"), true);
  confere("JotaJá webhook: confere enquanto não há segredo",
    ler("src/app/api/jotaja/webhook/route.ts").includes("{ conferirNaApi: !process.env.JOTAJA_WEBHOOK_SECRET }"), true);
  confere("JotaJá polling não confere", !ler("src/app/api/cron/jotaja-poll/route.ts").includes("conferirNaApi"), true);
  confere("99Food webhook: confere quando a assinatura não é válida",
    ler("src/app/api/99food/webhook/route.ts").includes('aplicarStatusDoEvento99(String(orderId), newStatus, eventType, assinatura99.estado !== "valida")'), true);

  console.warn = avisoOriginal;
  console.error = silencio;
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
