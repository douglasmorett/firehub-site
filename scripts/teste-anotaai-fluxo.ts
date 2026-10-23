/**
 * scripts/teste-anotaai-fluxo.ts — o caminho inteiro do Anota AI contra um Anota AI FALSO.
 *
 * Precisa de um Postgres de TESTE com o schema do FireHub (nunca o de produção):
 *
 *   npx pglite-server --port=5491 --max-connections=10      (pacote @electric-sql/pglite-socket)
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5491/postgres?pgbouncer=true npx prisma db push --skip-generate
 *   ANOTAAI_TESTE_DB=postgresql://postgres@127.0.0.1:5491/postgres?pgbouncer=true npx tsx scripts/teste-anotaai-fluxo.ts
 *
 * O Anota AI falso imita a doc v2: token OAuth client_credentials, vínculo
 * por chave (`linkpage-by-token` devolve o Token da unidade com `idpage`),
 * lista/detalhe por `x-page-id`, a máquina de `check` que só avança, e o 429
 * quando o teste manda. Toda outra chamada de rede (alerta no WhatsApp,
 * mapas) é BARRADA pelo `fetch` do teste. Cada caso é um furo de outro canal:
 *
 *   - loja do pedido só pela página ligada, e página de uma conta não liga em outra;
 *   - pedido novo entra uma vez só (dois ciclos, um pedido);
 *   - aceite automático só na loja que aceita sozinha, e na hora (15 min e o Anota AI nega);
 *   - iFood repassado e mesa não entram;
 *   - status de volta em escada; 429 vira fila que o ciclo repete;
 *   - cancelado e negado lá cancelam aqui;
 *   - cancelar aqui manda a justificativa (sem ela o Anota AI dá 400).
 */
const URL_DO_BANCO = process.env.ANOTAAI_TESTE_DB || "";
if (!/127\.0\.0\.1|localhost/.test(URL_DO_BANCO)) {
  console.error("Defina ANOTAAI_TESTE_DB com um Postgres LOCAL de teste (ver o cabeçalho).");
  process.exit(2);
}
process.env.DATABASE_URL = URL_DO_BANCO;
process.env.FIREHUB_LOCAL = "1";
process.env.ANOTAAI_CLIENT_ID = "cliente-teste";
process.env.ANOTAAI_CLIENT_SECRET = "segredo-teste";
process.env.NEXTAUTH_SECRET ||= "teste";

import { createServer, type IncomingMessage } from "http";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

// ── O Anota AI falso ─────────────────────────────────────────────────────────
const PAGINA_A = "aaaaaaaaaaaaaaaaaaaaaaa1";
const PAGINA_B = "bbbbbbbbbbbbbbbbbbbbbbb2";
const jwt = (p: object) => `cab.${Buffer.from(JSON.stringify(p)).toString("base64url")}.ass`;
const CHAVES: Record<string, string> = { "chave-da-loja-A-0123456789": PAGINA_A, "chave-da-loja-B-0123456789": PAGINA_B };

type PedidoFalso = Record<string, any> & { _id: string; check: number };
const pedidos: Record<string, PedidoFalso[]> = { [PAGINA_A]: [], [PAGINA_B]: [] };
const chamadas: Array<{ metodo: string; caminho: string; pagina?: string; corpo: string; ua?: string; tamanho?: string }> = [];
let tokensEmitidos = 0;
let proximo429: string | null = null;

const ler = (req: IncomingMessage) => new Promise<string>((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });

const servidor = createServer(async (req, res) => {
  const corpo = await ler(req);
  const url = new URL(req.url || "/", "http://x");
  const pagina = String(req.headers["x-page-id"] || "") || undefined;
  chamadas.push({ metodo: req.method || "", caminho: url.pathname, pagina, corpo, ua: String(req.headers["user-agent"] || ""), tamanho: req.headers["content-length"] as string | undefined });
  const json = (status: number, d: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };

  if (url.pathname === "/integ/integ-oauth-api/oauth-client/token") {
    const p = new URLSearchParams(corpo);
    if (p.get("grant_type") !== "client_credentials" || p.get("client_id") !== "cliente-teste" || p.get("client_secret") !== "segredo-teste") return json(401, { message: "credenciais" });
    tokensEmitidos++;
    return json(200, { accessToken: `tok-${tokensEmitidos}`, tokenType: "Bearer", expiresIn: 3600 });
  }
  if (!String(req.headers.authorization || "").startsWith("Bearer tok-")) return json(401, { message: "token" });

  if (url.pathname === "/integ/integ-public-core/v2/integration-partner/linkpage-by-token") {
    const b = JSON.parse(corpo || "{}");
    const idpage = CHAVES[b.pageToken];
    if (!idpage) return json(200, { success: false, message: "Failed to link page by token", info: null });
    return json(200, { success: true, message: "Page vinculada com sucesso", info: { token: jwt({ idpartner: "firehub", idpage, iat: 1 }) } });
  }

  const base = "/api-old/partnerauth/v2";
  if (!url.pathname.startsWith(base)) return json(404, {});
  if (!pagina || !pedidos[pagina]) return json(500, { success: false, message: "x-page-id obrigatório" });
  const daPagina = pedidos[pagina];
  const rota = url.pathname.slice(base.length);

  if (rota === "/ping/list") {
    const docs = daPagina
      .filter((p) => (url.searchParams.get("cancelled") ? p.check === 4 : [0, 1, 2, 3].includes(p.check)))
      .filter((p) => !(url.searchParams.get("excludeIfood") && p.salesChannel === "ifood"))
      .map((p) => ({ _id: p._id, check: p.check, from: p.from || "site", salesChannel: p.salesChannel || "anotaai", updatedAt: p.updatedAt || p.createdAt }));
    return json(200, { success: true, info: { docs, count: docs.length, limit: 100, currentpage: 1 } });
  }
  const m = rota.match(/^\/ping\/get\/(.+)$/);
  if (m) {
    const p = daPagina.find((x) => x._id === m[1]);
    return p ? json(200, { success: true, info: p }) : json(500, { success: false, message: "não achado" });
  }
  const a = rota.match(/^\/order\/(accept|ready|finalize|cancel)\/(.+)$/);
  if (a && req.method === "POST") {
    if (proximo429 === `${a[1]}:${a[2]}`) { proximo429 = null; return json(429, { message: "Too Many Requests" }); }
    const p = daPagina.find((x) => x._id === a[2]);
    if (!p) return json(500, { success: false, message: "ID do pedido não enviado." });
    const destino = a[1] === "accept" ? (p.schedule_order ? -2 : 1) : a[1] === "ready" ? 2 : a[1] === "finalize" ? 3 : 4;
    const validas: Record<number, number[]> = { 0: [-2, 1, 4, 5], [-2]: [1, 4], 1: [2, 3, 4], 2: [3, 4], 3: [4] };
    if (a[1] === "cancel" && !JSON.parse(corpo || "{}").justification) return json(400, { success: false, message: "É necessário uma justificativa." });
    if (!(validas[p.check] || []).includes(destino)) return json(200, { success: false, message: `transição inválida ${p.check}→${destino}` });
    p.check = destino;
    return json(200, { success: true, message: "Prontinho!", info: { check: destino } });
  }
  return json(404, {});
});

// ── Rede barrada fora do Anota AI falso ──────────────────────────────────────
const fetchDeVerdade = globalThis.fetch;
const barradas: string[] = [];
let PORTA = 0;
globalThis.fetch = (async (entrada: any, init?: any) => {
  const alvo = String(typeof entrada === "string" ? entrada : entrada?.url || entrada);
  if (alvo.startsWith(`http://127.0.0.1:${PORTA}/`)) return fetchDeVerdade(entrada, init);
  barradas.push(alvo.slice(0, 80));
  throw new Error("rede barrada no teste");
}) as typeof fetch;

const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const pedidoFalso = (id: string, extra: Record<string, any> = {}): PedidoFalso => ({
  _id: id,
  id,
  check: 0,
  shortReference: Number(id.slice(-2)) || 1,
  createdAt: new Date().toISOString(),
  type: "DELIVERY",
  salesChannel: "anotaai",
  from: "site",
  customer: { id: "c1", name: "Maria", phone: "74981040000" },
  items: [{ _id: `i-${id}`, id: 0, name: "Pastel de Carne", quantity: 2, internalId: "prod-carne", price: 9, total: 18, subItems: [] }],
  payments: [{ name: "money", code: "money", value: "23", changeFor: 50, prepaid: false }],
  deliveryFee: 5,
  total: 23,
  deliveryAddress: { streetName: "Rua A", streetNumber: "10", neighborhood: "Centro", city: "Petrolina", state: "PE", postalCode: "56300-000" },
  ...extra,
});

async function main() {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  PORTA = (servidor.address() as any).port;
  process.env.ANOTAAI_BASE_URL = `http://127.0.0.1:${PORTA}`;

  const { prisma } = await import("../src/lib/prisma");
  const api = await import("../src/lib/anotaai/api");
  const lojas = await import("../src/lib/anotaai/lojas");
  const { cicloDoAnotaAi } = await import("../src/lib/anotaai/eventos");
  const { sincronizarAnotaAi } = await import("../src/lib/anotaai/status");

  // Limpa o que um teste anterior deixou no banco de TESTE.
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "AnotaAiLoja"`).catch(() => {});
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "AcaoPendenteAnotaAi"`).catch(() => {});
  await prisma.customerOrderItem.deleteMany({}).catch(() => {});
  await prisma.customerOrder.deleteMany({});
  await prisma.menuProduct.deleteMany({ where: { id: { startsWith: "anotaai-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@teste-anotaai.local" } } });

  const lojaA = await prisma.user.create({ data: { name: "Pastel A", email: "a@teste-anotaai.local", password: "x", storeName: "Pastel A", autoAcceptOrders: true } as any });
  const lojaB = await prisma.user.create({ data: { name: "Pastel B", email: "b@teste-anotaai.local", password: "x", storeName: "Pastel B", autoAcceptOrders: false } as any });

  // ── Conexão ────────────────────────────────────────────────────────────────
  const v = await api.vincularPaginaAnotaAi("chave-errada-000000000000", lojaA.id);
  confere("chave errada: o Anota AI recusa (success:false com HTTP 200)", [v.ok, v.erro], [false, "Failed to link page by token"]);
  const vA = await api.vincularPaginaAnotaAi("chave-da-loja-A-0123456789", lojaA.id);
  confere("chave certa: o idpage sai do token devolvido", api.idPageDoToken(vA.dados?.info?.token), PAGINA_A);
  confere("prova: a lista abre com o x-page-id", (await api.listarPedidosAnotaAi(PAGINA_A)).ok, true);
  confere("liga a página A na loja A", (await lojas.ligarLojaAnotaAi({ pageId: PAGINA_A, franchiseeId: lojaA.id, nome: "Pastel A", quem: "teste" })).ok, true);
  const outra = await lojas.ligarLojaAnotaAi({ pageId: PAGINA_A, franchiseeId: lojaB.id, nome: null, quem: "teste" });
  confere("a mesma página NÃO liga em outra conta", outra.ok, false);
  confere("liga a página B na loja B", (await lojas.ligarLojaAnotaAi({ pageId: PAGINA_B, franchiseeId: lojaB.id, nome: "Pastel B", quem: "teste" })).ok, true);
  confere("um token só para tudo isso (reaproveitado)", tokensEmitidos, 1);

  // A conexão move o importarDesde para agora: pedido de antes não entra.
  pedidos[PAGINA_A].push(pedidoFalso("velho000000000000000001", { createdAt: minutosAtras(60), updatedAt: minutosAtras(60) }));

  // ── Pedido novo na loja que aceita sozinha ─────────────────────────────────
  pedidos[PAGINA_A].push(pedidoFalso("novoA00000000000000001"));
  pedidos[PAGINA_A].push(pedidoFalso("ifood0000000000000001", { salesChannel: "ifood", ifood_id: "x" }));
  pedidos[PAGINA_A].push(pedidoFalso("mesa00000000000000001", { type: "LOCAL", from: "qrcode", table: "t1", qr_description: "Mesa 5" }));
  chamadas.length = 0;
  await cicloDoAnotaAi();
  const noBanco = () => prisma.customerOrder.findMany({ where: { openDeliveryOrderId: { startsWith: "anotaai_" } } as any, include: { items: true } });
  let todos = await noBanco();
  confere("entrou só o pedido novo (nem o velho, nem iFood, nem mesa)", todos.map((o: any) => o.openDeliveryOrderId), [`anotaai_${PAGINA_A}_novoA00000000000000001`]);
  const pA = todos[0] as any;
  confere("na loja A, aceito", [pA.franchiseeId, pA.status], [lojaA.id, "ACEITO"]);
  confere("canal, número, total, troco", [pA.source, pA.openDeliveryReference, pA.totalAmount, pA.changeAmount, pA.deliveryFee], ["ANOTAAI", "1", 23, 50, 5]);
  confere("item: 2x a 9", [pA.items[0].quantity, pA.items[0].price], [2, 9]);
  confere("aceitou no Anota AI (check 1)", pedidos[PAGINA_A][1].check, 1);
  const aceite = chamadas.find((c) => c.caminho.endsWith("/order/accept/novoA00000000000000001"));
  confere("aceite com x-page-id, User-Agent e Content-Length 0", [aceite?.pagina, /^firehub-anotaai\//.test(aceite?.ua || ""), aceite?.tamanho], [PAGINA_A, true, "0"]);
  confere("iFood repassado: nem buscou o detalhe (filtrado na lista)", chamadas.some((c) => c.caminho.includes("/ping/get/ifood")), false);

  chamadas.length = 0;
  await cicloDoAnotaAi();
  todos = await noBanco();
  confere("segundo ciclo: continua um pedido só", todos.length, 1);
  confere("segundo ciclo: não busca de novo o que já decidiu", chamadas.filter((c) => c.caminho.includes("/ping/get/")).length, 0);

  // ── Status de volta ────────────────────────────────────────────────────────
  const idA = `anotaai_${PAGINA_A}_novoA00000000000000001`;
  let r = await sincronizarAnotaAi({ openDeliveryOrderId: idA, franchiseeId: lojaA.id, status: "ACEITO" }, "PRONTO");
  confere("PRONTO → ready", [r.acoes, pedidos[PAGINA_A][1].check], [["ready"], 2]);
  r = await sincronizarAnotaAi({ openDeliveryOrderId: idA, franchiseeId: lojaA.id, status: "PRONTO" }, "SAIU_ENTREGA");
  confere("SAIU_ENTREGA não manda nada (o pronto deles já é 'pronto para entrega')", [r.acoes, r.erros], [[], []]);
  r = await sincronizarAnotaAi({ openDeliveryOrderId: idA, franchiseeId: lojaA.id, status: "SAIU_ENTREGA" }, "ENTREGUE");
  confere("ENTREGUE → finalize", [r.acoes, pedidos[PAGINA_A][1].check], [["finalize"], 3]);

  // ── Loja que aceita na mão; 429 vira fila ─────────────────────────────────
  pedidos[PAGINA_B].push(pedidoFalso("novoB00000000000000002"));
  await cicloDoAnotaAi();
  const pB = (await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: `anotaai_${PAGINA_B}_novoB00000000000000002` } as any })) as any;
  confere("loja B: entra NOVO na loja B e NÃO aceita lá sozinho", [pB?.franchiseeId, pB?.status, pedidos[PAGINA_B][0].check], [lojaB.id, "NOVO", 0]);
  proximo429 = "accept:novoB00000000000000002";
  r = await sincronizarAnotaAi({ openDeliveryOrderId: pB.openDeliveryOrderId, franchiseeId: lojaB.id, status: "NOVO" }, "ACEITO");
  confere("aceite na mão com 429: vai para a fila", [r.acoes, r.pendentes], [[], ["accept"]]);
  r = await sincronizarAnotaAi({ openDeliveryOrderId: pB.openDeliveryOrderId, franchiseeId: lojaB.id, status: "ACEITO" }, "PRONTO");
  confere("o PRONTO seguinte entra ATRÁS na fila (sem passar na frente do aceite)", [r.acoes, r.pendentes, pedidos[PAGINA_B][0].check], [[], ["ready"], 0]);
  await cicloDoAnotaAi();
  confere("o ciclo repete a fila na ordem (aceito e pronto lá)", pedidos[PAGINA_B][0].check, 2);

  // ── Cancelado e negado lá ─────────────────────────────────────────────────
  pedidos[PAGINA_A].push(pedidoFalso("canc00000000000000003"));
  pedidos[PAGINA_A].push(pedidoFalso("nega00000000000000004"));
  await cicloDoAnotaAi();
  pedidos[PAGINA_A].find((p) => p._id === "canc00000000000000003")!.check = 4;
  pedidos[PAGINA_A].find((p) => p._id === "nega00000000000000004")!.check = 5; // some das duas listas
  await cicloDoAnotaAi();
  const canc = (await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: `anotaai_${PAGINA_A}_canc00000000000000003` } as any })) as any;
  const nega = (await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: `anotaai_${PAGINA_A}_nega00000000000000004` } as any })) as any;
  confere("cancelado lá → cancelado aqui, pelo canal", [canc?.status, canc?.cancelledBy], ["CANCELADO", "ANOTAAI"]);
  confere("negado lá (sumiu da lista) → cancelado aqui", [nega?.status, nega?.cancelReason], ["CANCELADO", "Negado no Anota AI (15 min sem aceite)"]);

  // ── Cancelar aqui ─────────────────────────────────────────────────────────
  pedidos[PAGINA_A].push(pedidoFalso("loja00000000000000005"));
  await cicloDoAnotaAi();
  const idC = `anotaai_${PAGINA_A}_loja00000000000000005`;
  chamadas.length = 0;
  r = await sincronizarAnotaAi({ openDeliveryOrderId: idC, franchiseeId: lojaA.id, status: "ACEITO" }, "CANCELADO", { motivo: "Acabou o pastel" });
  const cancelou = chamadas.find((c) => c.caminho.endsWith("/order/cancel/loja00000000000000005"));
  confere("cancelar aqui manda a justificativa", [r.acoes, JSON.parse(cancelou?.corpo || "{}").justification, pedidos[PAGINA_A].find((p) => p._id === "loja00000000000000005")!.check], [["cancel"], "Acabou o pastel", 4]);

  // ── Desligar ──────────────────────────────────────────────────────────────
  confere("desligar a página A na loja B não desliga (não é dela)", await lojas.desligarLojaAnotaAi(lojaB.id, PAGINA_A), false);
  confere("desligar a página A na loja A", await lojas.desligarLojaAnotaAi(lojaA.id, PAGINA_A), true);
  pedidos[PAGINA_A].push(pedidoFalso("depois000000000000006"));
  await cicloDoAnotaAi();
  confere("página desligada: pedido novo não entra", Boolean(await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: `anotaai_${PAGINA_A}_depois000000000000006` } as any })), false);

  console.log(`(rede barrada: ${barradas.length} chamada(s) — ${Array.from(new Set(barradas.map((u) => u.split("/")[2]))).join(", ") || "nenhuma"})`);

  await prisma.$disconnect();
  servidor.close();
  console.log(falhas === 0 ? "\n🎉 Tudo certo." : `\n💥 ${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
