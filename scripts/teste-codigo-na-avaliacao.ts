/**
 * CÓDIGO DO PEDIDO (lib/codigo-do-pedido.ts) na avaliação do cliente:
 * POST /api/customer-order/<id>/rating (acompanhamento) e
 * POST /api/customer-order/review (página /loja/<slug>/avaliar/<id>).
 *
 *   npx tsx scripts/teste-codigo-na-avaliacao.ts
 *
 * O id do pedido vaza (busca por telefone, lista pública de avaliações), e as
 * duas rotas gravavam a nota só com ele. Agora vem junto o código: nos links
 * do WhatsApp (`?c=`) e guardado no navegador que criou o pedido. Sem código,
 * só pedido criado antes do CORTE_DO_CODIGO (link antigo) avalia.
 *
 * Sem banco: as rotas rodam contra um Prisma em memória; o envio do WhatsApp
 * roda com o fetch trocado por um que só guarda o texto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export {}; // módulo: sem isto, `confere` colide com os de outros scripts no tsc

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

Object.assign(process.env, {
  NODE_ENV: "development",
  NEXTAUTH_SECRET: "segredo-do-teste",
  NEXTAUTH_URL: "https://firehubfood.com.br",
  EVOLUTION_API_URL: "http://gateway-falso",
  EVOLUTION_API_KEY: "chave-falsa",
});
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco em memória (só o que as rotas e o aviso usam) ─────────────────────
type Linha = Record<string, any>;
const pedidos: Linha[] = [];
const avaliacoes: Linha[] = [];
const loja = { id: "loja1", storeName: "Loja Teste", slug: "loja-teste", chatbotConfig: { connected: true }, storeTimezone: null, accountGroupId: null };
(globalThis as any).prisma = {
  customerOrder: {
    findUnique: async ({ where }: any) => {
      const l = pedidos.find((p) => p.id === where.id);
      return l ? { ...l, items: [], motoboy: l.motoboyId ? { name: "Zé" } : null, franchisee: loja } : null;
    },
    findMany: async () => pedidos.map((p) => ({ id: p.id })),
    update: async ({ where, data }: any) => Object.assign(pedidos.find((p) => p.id === where.id)!, data),
  },
  storeReview: {
    findUnique: async ({ where }: any) => avaliacoes.find((a) => a.orderId === where.orderId) || null,
    create: async ({ data }: any) => { avaliacoes.push({ ...data }); return data; },
  },
  user: { findUnique: async () => null, findFirst: async () => ({ chatbotConfig: {} }) },
  $executeRawUnsafe: async () => 0,
  $queryRawUnsafe: async () => [],
  $queryRaw: async () => [],
};

// O gateway do WhatsApp: guarda o texto enviado; o "quem é" falha (segue o número).
const enviados: string[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => {
  if (String(url).includes("/message/sendText/")) {
    enviados.push(JSON.parse(init.body).text);
    return new Response("{}", { status: 200 });
  }
  return new Response("{}", { status: 404 });
};

(async () => {
  const { codigoDoPedido, confereCodigoDoPedido, CORTE_DO_CODIGO } = await import("../src/lib/codigo-do-pedido");
  const { POST: avaliarNoAcompanhamento } = await import("../src/app/api/customer-order/[id]/rating/route");
  const { POST: avaliarNaPagina } = await import("../src/app/api/customer-order/review/route");
  const { sendOrderNotification } = await import("../src/lib/order-notifications");

  const DEPOIS = new Date(CORTE_DO_CODIGO.getTime() + 36 * 3600_000);
  const ANTES = new Date(CORTE_DO_CODIGO.getTime() - 12 * 3600_000);
  const novo = (id: string, createdAt: Date, extra: Linha = {}) =>
    pedidos.push({
      id, createdAt, franchiseeId: "loja1", customerId: "cli1", rating: null, ratingComment: null,
      customerName: "Ana", customerPhone: "31999998888", deliveryType: "DELIVERY", status: "ENTREGUE", ...extra,
    });
  const nota = (id: string) => [pedidos.find((p) => p.id === id)!.rating, avaliacoes.filter((a) => a.orderId === id).length];

  let ip = 0;
  // IP diferente a cada chamada: o limite por minuto não entra no teste.
  const chamar = (rota: any, url: string, corpo: unknown, params?: unknown) =>
    rota(new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.1.${++ip}` },
      body: JSON.stringify(corpo),
    }) as any, params as any).then((r: Response) => r.status);
  const peloAcompanhamento = (id: string, corpo: Linha) =>
    chamar(avaliarNoAcompanhamento, `http://t/api/customer-order/${id}/rating`, corpo, { params: Promise.resolve({ id }) });
  const pelaPagina = (corpo: Linha) => chamar(avaliarNaPagina, "http://t/api/customer-order/review", corpo);

  console.log("\n— 1. Acompanhamento (/api/customer-order/<id>/rating) —");
  novo("a1", DEPOIS); novo("a2", DEPOIS); novo("a3", ANTES); novo("a4", ANTES);
  confere("pós-corte, sem código: 403", await peloAcompanhamento("a1", { rating: 1 }), 403);
  confere("pós-corte, código errado: 403", await peloAcompanhamento("a1", { rating: 1, codigo: "x".repeat(22) }), 403);
  confere("pós-corte, código de outro pedido: 403", await peloAcompanhamento("a1", { rating: 1, codigo: codigoDoPedido("a2") }), 403);
  confere("…e nada foi gravado", nota("a1"), [null, 0]);
  confere("código certo: 200", await peloAcompanhamento("a1", { rating: 5, comment: "top", codigo: codigoDoPedido("a1") }), 200);
  confere("…nota no pedido e na StoreReview", nota("a1"), [5, 1]);
  confere("pré-corte, sem código: 200 (link antigo continua avaliando)", await peloAcompanhamento("a3", { rating: 4 }), 200);
  confere("…gravado", nota("a3"), [4, 1]);
  confere("pré-corte, código errado: 403 (veio código, tem que conferir)", await peloAcompanhamento("a4", { rating: 1, codigo: "errado" }), 403);
  confere("…não gravou", nota("a4"), [null, 0]);

  console.log("\n— 2. Página de avaliar (/api/customer-order/review) —");
  novo("b1", DEPOIS); novo("b2", ANTES); novo("b3", ANTES);
  confere("pós-corte, sem código: 403", await pelaPagina({ orderId: "b1", rating: 1 }), 403);
  confere("pós-corte, código errado: 403", await pelaPagina({ orderId: "b1", rating: 1, codigo: codigoDoPedido("a1") }), 403);
  confere("…e nada foi gravado", nota("b1"), [null, 0]);
  confere("código certo: 200", await pelaPagina({ orderId: "b1", rating: 5, codigo: codigoDoPedido("b1") }), 200);
  confere("…gravado", nota("b1"), [5, 1]);
  confere("pré-corte, sem código: 200", await pelaPagina({ orderId: "b2", rating: 3 }), 200);
  confere("…gravado", nota("b2"), [3, 1]);
  confere("pré-corte, código errado: 403", await pelaPagina({ orderId: "b3", rating: 1, codigo: "errado" }), 403);

  console.log("\n— 3. Os links que o WhatsApp manda levam o código —");
  novo("c1", DEPOIS, { status: "SAIU_ENTREGA", motoboyId: "mb1" });
  const linksDe = async (tipo: any) => {
    enviados.length = 0;
    await sendOrderNotification("c1", tipo);
    return enviados.join("\n").match(/https?:\/\/\S+/g) || [];
  };
  const doFireHub = (links: string[]) => links.filter((l) => l.includes("/loja/loja-teste/"));
  const certo = codigoDoPedido("c1");
  for (const [tipo, caminho] of [["SAIU_ENTREGA", "pedido"], ["CHEGANDO", "pedido"], ["ENTREGUE", "avaliar"]] as const) {
    const links = doFireHub(await linksDe(tipo));
    confere(`${tipo}: link de /${caminho}/ com ?c=<código do pedido>`, links, [`https://firehubfood.com.br/loja/loja-teste/${caminho}/c1?c=${certo}`]);
    const c = links[0] ? new URL(links[0]).searchParams.get("c") : null;
    confere(`${tipo}: o código do link confere`, confereCodigoDoPedido("c1", c), true);
  }

  console.log("\n— 4. O navegador repassa o código —");
  const guardado: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => guardado[k] ?? null,
    setItem: (k: string, v: string) => { guardado[k] = v; },
    removeItem: (k: string) => { delete guardado[k]; },
  };
  (globalThis as any).window = { location: { search: "" } };
  const nav = await import("../src/lib/codigo-do-pedido-no-navegador");
  nav.guardarCodigoDoPedido("d1", "cod-d1");
  confere("o criado neste navegador fica guardado", nav.codigoGuardado("d1"), "cod-d1");
  confere("página do pedido sem ?c=: usa o guardado", nav.codigoDoPedidoNoNavegador("d1"), "cod-d1");
  (globalThis as any).window.location.search = "?c=do-link";
  confere("página aberta pelo link: usa o ?c=", nav.codigoDoPedidoNoNavegador("d2"), "do-link");
  (globalThis as any).window.location.search = "";
  confere("…e guarda para a próxima visita", nav.codigoDoPedidoNoNavegador("d2"), "do-link");
  confere("pedido desconhecido: vazio", nav.codigoDoPedidoNoNavegador("d3"), "");

  // As telas (cliente React) — conferidas no fonte.
  const fonte = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  const loja1 = fonte("src/components/customer/CustomerStorePage.tsx");
  confere("cardápio guarda o código ao criar o pedido", /guardarCodigoDoPedido\(d\.orderId, d\.codigo/.test(loja1), true);
  confere("cardápio: \"Abrir Rastreamento\" leva ?c=", /pedido\/\$\{orderSuccess\}\$\{codigoGuardado\(orderSuccess\)/.test(loja1), true);
  confere("acompanhamento manda o código na avaliação",
    /codigo: codigoDoPedidoNoNavegador\(orderId\)/.test(fonte("src/app/loja/[slug]/pedido/[id]/OrderTrackingClient.tsx")), true);
  confere("página de avaliar manda o código",
    /codigo: codigoDoPedidoNoNavegador\(orderId\)/.test(fonte("src/app/loja/[slug]/avaliar/[orderId]/page.tsx")), true);
  confere("e-mail de entregue leva o código", /linkComCodigo\(/.test(fonte("src/lib/email.ts")), true);

  console.log(falhas ? `\n❌ ${falhas} falha(s).` : "\n✅ Tudo certo.");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
