/**
 * E2E do JotaJá POR LOJA contra o PGlite local e um JotaJá FALSO (todo fetch é
 * interceptado: nada sai da máquina, nem o alerta de WhatsApp).
 *
 *   cd C:\Users\Micro\crm-teste && npx pglite-server --db=<pasta nova> --port=5481 --max-connections=10
 *   DATABASE_URL=<o PGlite: usuário/senha padrão dele, 127.0.0.1:5481/postgres?sslmode=disable&connection_limit=1&pgbouncer=true> \
 *     npx prisma db push --skip-generate --schema node_modules/.prisma/client/schema.prisma
 *   DATABASE_URL=<o mesmo> EVOLUTION_API_URL=http://127.0.0.1:9 EVOLUTION_API_KEY=teste \
 *     npx tsx scripts/e2e-jotaja-por-loja-pglite.ts
 *
 * O caso é o da Duga Burguer (16/10/2026): restaurante 19869 com a semana
 * parada na fila, ligando ao lado do Hakim (22238). Os pedidos têm o formato
 * de um pedido real da Duga, sem os dados do cliente.
 */
if (!/127\.0\.0\.1:5481/.test(process.env.DATABASE_URL || "")) throw new Error("DATABASE_URL não é o PGlite local (127.0.0.1:5481)");
if (!/127\.0\.0\.1:9\b/.test(process.env.EVOLUTION_API_URL || "")) throw new Error("EVOLUTION_API_URL tem de ser a porta morta");
delete process.env.CRON_SECRET;

const BASE = "https://api.jotaja.com/openDelivery";

// ── O JotaJá falso ───────────────────────────────────────────────────────────
const credenciais: Record<string, { secret: string; merchant: string }> = {
  "cred-duga": { secret: "s-duga", merchant: "19869" },
  "cred-hakim": { secret: "s-hakim", merchant: "22238" },
};
const filas: Record<string, any[]> = { "cred-duga": [], "cred-hakim": [] };
const pedidos = new Map<string, any>();
const tokens = new Map<string, string>();
const chamadas: { cred: string; metodo: string; caminho: string }[] = [];
const revogadas = new Set<string>();
let foraDoAr = false;
let bloqueados = 0;

const resposta = (status: number, corpo?: any) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (entrada: any, init: any = {}) => {
  const url = typeof entrada === "string" ? entrada : String(entrada?.url ?? entrada);
  if (!url.startsWith(BASE)) {
    bloqueados++;
    return resposta(599, { bloqueadoNoTeste: url });
  }
  const caminho = url.slice(BASE.length);
  const metodo = String(init.method || "GET").toUpperCase();
  if (caminho === "/oauth/token") {
    if (foraDoAr) return resposta(503, {});
    const p = new URLSearchParams(String(init.body));
    const id = p.get("client_id") || "";
    if (!credenciais[id] || credenciais[id].secret !== p.get("client_secret") || revogadas.has(id)) return resposta(401, { error: "invalid_client" });
    const token = `tok-${id}-${tokens.size}`;
    tokens.set(token, id);
    return resposta(200, { access_token: token, expires_in: 3600, token_type: "bearer" });
  }
  const h = init.headers || {};
  const cred = tokens.get(String(h.Authorization || h.authorization || "").replace("Bearer ", ""));
  if (!cred || revogadas.has(cred)) return resposta(401, {});
  chamadas.push({ cred, metodo, caminho });
  if (caminho === "/v1/events:polling") return resposta(200, filas[cred]);
  if (caminho === "/v1/events/acknowledgment") {
    const ids = new Set(JSON.parse(String(init.body)).map((e: any) => e.id));
    filas[cred] = filas[cred].filter((e) => !ids.has(e.eventId));
    return resposta(202);
  }
  const m = caminho.match(/^\/v1\/orders\/([^/]+)(?:\/(\w+))?$/);
  if (m) {
    // O falso devolve qualquer pedido, de qualquer restaurante: é o FireHub que tem de barrar.
    const p = pedidos.get(m[1]);
    if (!p) return resposta(404, {});
    return m[2] ? resposta(202) : resposta(200, p);
  }
  return resposta(404, { naoSei: caminho });
}) as any;

let seq = 0;
function pedido(merchant: string, criadoEm: Date, itens = [{ id: "930040", name: "Méqui Nelson" }]) {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const valor = 33 * itens.length;
  const p = {
    salesChannel: "JOTAJA", id, type: "TAKEOUT", displayId: String(33922000 + seq),
    createdAt: criadoEm.toISOString(), orderTiming: "INSTANT", preparationStartDateTime: criadoEm.toISOString(),
    merchant: { id: merchant, name: merchant === "19869" ? "DUGA BURGUER" : "HAKIM" },
    items: itens.map((i) => ({
      id: i.id, name: i.name, externalCode: "", unit: "UN", specialInstructions: "", quantity: 1,
      optionsPrice: { value: 0, currency: "BRL" }, options: [],
      unitPrice: { value: 33, currency: "BRL" }, totalPrice: { value: 33, currency: "BRL" },
    })),
    otherFees: [], discounts: [],
    total: { itemsPrice: { value: valor, currency: "BRL" }, otherFees: { value: 0, currency: "BRL" }, discount: { value: 0, currency: "BRL" }, orderAmount: { value: valor, currency: "BRL" } },
    payments: { prepaid: 0, pending: valor, methods: [{ type: "PENDING", currency: "BRL", method: "CREDIT", value: valor }] },
    customer: { id: "1", phone: { number: "22999990000" }, documentNumber: "", name: "Cliente Teste", ordersCountOnMerchant: 1 },
    takeout: { mode: "DEFAULT", takeoutDateTime: criadoEm.toISOString() },
    sendDelivered: true, extraInfo: "",
  };
  pedidos.set(id, p);
  return p;
}
function evento(cred: string, p: any, tipo: string, em: Date) {
  const e = { createdAt: em.toISOString(), eventId: `ev-${++seq}`, sourceAppId: "", orderId: p.id, storeId: p.merchant.id, eventType: tipo, orderURL: `${BASE}/v1/orders/${p.id}` };
  filas[cred].push(e);
  return e;
}

let falhas = 0;
const confere = (oQue: string, ok: boolean, extra?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok || extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
};
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const { ligarJotajaNaLoja } = await import("../src/lib/jotaja-ligacao");
  const { jotajaFetch, jotajaMutate, lojaComJotajaLigado, ligadoEmDaLoja } = await import("../src/lib/jotaja-api");
  const { processJotajaEvent } = await import("../src/lib/processJotajaEvent");
  const { GET: cronDoJotaja } = await import("../src/app/api/cron/jotaja-poll/route");
  const { NextRequest } = await import("next/server");
  const rodarCron = async () =>
    (await cronDoJotaja(new NextRequest("http://localhost:3000/api/cron/jotaja-poll", { headers: { host: "localhost:3000" } }))).json();
  const daLoja = (id: string) => prisma.user.findUnique({ where: { id } }) as Promise<any>;

  const agora = Date.now();
  const hakim = await prisma.user.create({
    data: {
      name: "Hakim", email: "hakim@teste.local", password: "x", storeName: "Hakim Centro",
      jotajaClientId: "cred-hakim", jotajaClientSecret: "s-hakim", jotajaMerchantId: "22238", jotajaConnected: true,
      createdAt: new Date("2026-01-10T12:00:00Z"),
    } as any,
  });
  const duga = await prisma.user.create({
    data: { name: "Duga", email: "duga@teste.local", password: "x", storeName: "DUGABURGUER", createdAt: new Date("2026-08-19T12:00:00Z") } as any,
  });
  const funcionario = await prisma.user.create({
    data: { name: "Func Duga", email: "func@teste.local", password: "x", role: "STAFF", ownerId: duga.id, storeName: "DUGABURGUER" } as any,
  });
  // O Hakim tem espelho com o MESMO id de item que a Duga vende; um funcionário
  // da Duga é dono de outro espelho (código antigo).
  await prisma.menuProduct.create({ data: { id: "jotaja-930040", franchiseeId: hakim.id, name: "Item do Hakim", description: "", price: 10, category: "Jotajá", active: false } as any });
  await prisma.menuProduct.create({ data: { id: "jotaja-930138", franchiseeId: funcionario.id, name: "Guaraviton Ginseng", description: "", price: 8, category: "Bebidas", active: false } as any });

  // ── 1. A fila parada da Duga (3 pedidos de antes + o cancelamento de um) ──
  const antigos = [3, 2, 1].map((h) => pedido("19869", new Date(agora - h * 3600_000)));
  for (const p of antigos) evento("cred-duga", p, "CREATED", new Date(p.createdAt));
  evento("cred-duga", antigos[0], "CANCELLED", new Date(agora - 30 * 60_000));
  const doHakim = pedido("22238", new Date(agora - 10 * 60_000), [{ id: "555", name: "X-Hakim" }]);
  evento("cred-hakim", doHakim, "CREATED", new Date(doHakim.createdAt));

  // ── 2. Ligar com credencial errada: nada gravado ─────────────────────────
  let r = await ligarJotajaNaLoja(duga.id, { clientId: "cred-hakim", clientSecret: "s-hakim" });
  confere("credencial do Hakim colada na Duga: recusada", r.status === 400 && /outra loja/.test(r.corpo.error), r);
  r = await ligarJotajaNaLoja(duga.id, { clientId: "cred-duga", clientSecret: "errado" });
  confere("secret errado: recusada", r.status === 400 && /recusou/.test(r.corpo.error), r);
  r = await ligarJotajaNaLoja(duga.id, { clientId: "cred-duga", clientSecret: "s-duga", merchantId: "22238" });
  confere("número do Hakim informado com a credencial da Duga: recusada", r.status === 400 && /19869/.test(r.corpo.error), r);
  foraDoAr = true;
  r = await ligarJotajaNaLoja(duga.id, { clientId: "cred-duga", clientSecret: "s-duga" });
  foraDoAr = false;
  confere("JotaJá fora do ar: 503", r.status === 503, r);
  let d = await daLoja(duga.id);
  confere("nada foi gravado na Duga até aqui", !d.jotajaClientId && !d.jotajaConnected && !d.jotajaMerchantId, d);
  confere("a fila da Duga continua intacta", filas["cred-duga"].length === 4);

  // ── 3. Ligar de verdade: largada limpa ───────────────────────────────────
  r = await ligarJotajaNaLoja(duga.id, { clientId: "cred-duga", clientSecret: "s-duga" });
  confere("ligou", r.status === 200 && r.corpo.user.jotajaConnected === true, r);
  confere("o restaurante 19869 veio da fila", r.corpo.user?.jotajaMerchantId === "19869", r.corpo.user);
  confere("os 3 pedidos de antes ficaram de fora", r.corpo.foraDaLargada === 3, r.corpo);
  confere("o cancelamento de antes ficou para o caminho normal", filas["cred-duga"].length === 1 && filas["cred-duga"][0].eventType === "CANCELLED", filas["cred-duga"]);
  const ligadoEm = await ligadoEmDaLoja(duga.id);
  confere("hora da ligação gravada (ms, sem fuso)", !!ligadoEm && Math.abs(ligadoEm - Date.now()) < 60_000, ligadoEm);

  // ── 4. Pedidos depois de ligar ───────────────────────────────────────────
  await esperar(20);
  const novo = pedido("19869", new Date(), [{ id: "930040", name: "Méqui Nelson" }, { id: "930138", name: "Guaraviton Ginseng" }]);
  evento("cred-duga", novo, "CREATED", new Date());
  const intruso = pedido("22238", new Date(), [{ id: "777", name: "Pedido do Hakim" }]);
  evento("cred-duga", intruso, "CREATED", new Date()); // pedido do Hakim aparecendo na fila da Duga
  await rodarCron();

  const naDuga = await prisma.customerOrder.findMany({ where: { franchiseeId: duga.id }, include: { items: true } });
  confere("só o pedido novo entrou na Duga", naDuga.length === 1 && naDuga[0].openDeliveryOrderId === novo.id, naDuga.map((p) => p.openDeliveryOrderId));
  confere("nenhum pedido de antes entrou", !(await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: { in: antigos.map((p) => p.id) } } })));
  confere("o pedido do Hakim na fila da Duga não entrou em lugar nenhum", !(await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: intruso.id } })));
  confere("... e não saiu da fila (sem baixa)", filas["cred-duga"].some((e) => e.orderId === intruso.id));
  confere("o cancelamento de antes saiu da fila", !filas["cred-duga"].some((e) => e.eventType === "CANCELLED"));
  const espelhos = (naDuga[0]?.items ?? []).map((i: any) => i.menuProductId);
  confere("item com o id do espelho do Hakim ganhou espelho da Duga", espelhos.includes(`jotaja-${duga.id}-930040`), espelhos);
  confere("espelho do funcionário da Duga é o de sempre", espelhos.includes("jotaja-930138"), espelhos);
  confere("o espelho do Hakim ficou intacto", (await prisma.menuProduct.findUnique({ where: { id: "jotaja-930040" } }))?.franchiseeId === hakim.id);
  confere("confirmou no JotaJá com a credencial da Duga", chamadas.some((c) => c.cred === "cred-duga" && c.caminho === `/v1/orders/${novo.id}/confirm`));
  confere("nenhuma chamada sobre pedido da Duga com a credencial do Hakim", !chamadas.some((c) => c.cred === "cred-hakim" && c.caminho.includes(novo.id)));
  const noHakim = await prisma.customerOrder.findMany({ where: { franchiseeId: hakim.id } });
  confere("o pedido do Hakim entrou no Hakim", noHakim.length === 1 && noHakim[0].openDeliveryOrderId === doHakim.id, noHakim.map((p) => p.openDeliveryOrderId));
  confere("o alerta da recusa tentou sair (e o teste bloqueou)", bloqueados >= 1, bloqueados);

  // ── 5. Cancelamento depois de ligar: só na Duga ──────────────────────────
  evento("cred-duga", novo, "CANCELLED", new Date());
  await rodarCron();
  confere("cancelado na Duga", (await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: novo.id } }))?.status === "CANCELADO");
  confere("o do Hakim intacto", (await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: doHakim.id } }))?.status !== "CANCELADO");

  // ── 6. Salvar de novo com a loja ligada: nada da fila se perde ───────────
  const vivo = pedido("19869", new Date());
  evento("cred-duga", vivo, "CREATED", new Date());
  r = await ligarJotajaNaLoja(duga.id, { clientId: "", clientSecret: "" });
  confere("salvar de novo: sem largada", r.status === 200 && r.corpo.foraDaLargada === 0, r.corpo);
  confere("... e avisa do pedido de outro restaurante parado na fila", /Atenção/.test(r.corpo.message || ""), r.corpo.message);
  confere("o pedido vivo continua na fila", filas["cred-duga"].some((e) => e.orderId === vivo.id));
  await rodarCron();
  confere("e entrou na Duga", !!(await prisma.customerOrder.findFirst({ where: { franchiseeId: duga.id, openDeliveryOrderId: vivo.id } })));

  // ── 7. Mesma credencial em outra loja (cadastro antigo): só a mais antiga ─
  const copia = await prisma.user.create({
    data: {
      name: "Duga cópia", email: "duga2@teste.local", password: "x", storeName: "DUGA CÓPIA",
      jotajaClientId: "cred-duga", jotajaClientSecret: "s-duga", jotajaMerchantId: "19869", jotajaConnected: true,
    } as any,
  });
  confere("a cópia não puxa pelo painel", !(await lojaComJotajaLigado(copia.id)));
  confere("a Duga puxa", await lojaComJotajaLigado(duga.id));
  const outro = pedido("19869", new Date());
  evento("cred-duga", outro, "CREATED", new Date());
  const log7 = await rodarCron();
  confere("o cron avisa da credencial repetida", (log7.log || []).some((l: string) => /repetida/.test(l)), log7.log);
  confere("o pedido foi para a Duga, não para a cópia", !!(await prisma.customerOrder.findFirst({ where: { franchiseeId: duga.id, openDeliveryOrderId: outro.id } })));
  confere("ligar a cópia pela tela: recusado", (await ligarJotajaNaLoja(copia.id, { clientId: "cred-duga", clientSecret: "s-duga" })).status === 400);
  await prisma.user.update({ where: { id: copia.id }, data: { jotajaConnected: false, jotajaClientId: null, jotajaClientSecret: null, jotajaMerchantId: null } });

  // ── 8. Import manual do pedido do Hakim na Duga: recusado ────────────────
  const manual = await processJotajaEvent(
    { orderId: intruso.id, eventType: "CREATED", code: "PLC" } as any,
    (p, o) => jotajaFetch(p, o, duga.id),
    (p, o) => jotajaMutate(p, o, duga.id),
    duga.id,
    { pedidoAntigoEntra: true },
  );
  confere("import manual de pedido do Hakim na Duga: recusado por loja", manual.action === "error" && manual.recusadoPorLoja === true, manual);

  // ── 9. Fila parada no Hakim (sem hora de ligação): régua de 12 h ─────────
  const velho = pedido("22238", new Date(agora - 13 * 3600_000));
  evento("cred-hakim", velho, "CREATED", new Date(velho.createdAt));
  await rodarCron();
  confere("pedido de 13 h atrás não entrou", !(await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: velho.id } })));
  confere("... e saiu da fila", !filas["cred-hakim"].some((e) => e.orderId === velho.id));

  // ── 10. Fora do ar não desliga; credencial revogada desliga ──────────────
  foraDoAr = true;
  r = await ligarJotajaNaLoja(duga.id, {});
  foraDoAr = false;
  d = await daLoja(duga.id);
  confere("JotaJá fora do ar com a loja ligada: 503 e continua ligada", r.status === 503 && d.jotajaConnected, r);
  revogadas.add("cred-duga");
  r = await ligarJotajaNaLoja(duga.id, {});
  revogadas.delete("cred-duga");
  d = await daLoja(duga.id);
  confere("credencial revogada: desliga", r.status === 400 && !d.jotajaConnected, r);
  confere("desligada não puxa pelo painel", !(await lojaComJotajaLigado(duga.id)));

  // ── 11. Religar depois de desligada: o que veio no meio fica no portal ───
  const noMeio = pedido("19869", new Date());
  evento("cred-duga", noMeio, "CREATED", new Date());
  await esperar(20);
  r = await ligarJotajaNaLoja(duga.id, {});
  confere("religar com pedido de outro restaurante na fila: recusado (a credencial não é só da loja)", r.status === 400 && /2 restaurantes/.test(r.corpo.error || ""), r.corpo);
  filas["cred-duga"] = filas["cred-duga"].filter((e) => e.orderId !== intruso.id); // o JotaJá corrigiu
  r = await ligarJotajaNaLoja(duga.id, {});
  confere("religou com largada", r.status === 200 && r.corpo.foraDaLargada >= 1, r.corpo);
  await rodarCron();
  confere("o pedido de quando estava desligada não entrou", !(await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: noMeio.id } })));

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  await prisma.$disconnect();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
