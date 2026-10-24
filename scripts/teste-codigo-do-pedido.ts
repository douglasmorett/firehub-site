/**
 * CÓDIGO DO PEDIDO (lib/codigo-do-pedido.ts) no cancelamento público do Pix
 * (POST /api/payments/cancelar).
 *
 *   npx tsx scripts/teste-codigo-do-pedido.ts
 *
 * O id do pedido vaza (a busca por telefone devolve), e a rota cancelava só
 * com ele. Agora vem junto o código que só a criação do pedido entrega; sem
 * código, só pedido criado antes da publicação (página antiga) cancela.
 *
 * Sem banco: a rota roda contra um Prisma em memória.
 */
export {}; // módulo: sem isto, `confere` e `status` colidem com os de outros scripts no tsc

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

Object.assign(process.env, { NODE_ENV: "development", NEXTAUTH_SECRET: "segredo-do-teste" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco em memória (só o que a rota usa) ──────────────────────────────────
type Linha = Record<string, any>;
const pedidos: Linha[] = [];
(globalThis as any).prisma = {
  customerOrder: {
    findUnique: async ({ where }: any) => {
      const l = pedidos.find((p) => p.id === where.id);
      return l ? { ...l } : null;
    },
    updateMany: async ({ where, data }: any) => {
      const alvos = pedidos.filter((p) => p.id === where.id && p.status === where.status && p.paymentPaidAt == null);
      for (const l of alvos) Object.assign(l, data);
      return { count: alvos.length };
    },
  },
};

const DEPOIS = new Date("2026-10-26T15:00:00Z");
const ANTES = new Date("2026-10-24T15:00:00Z");
const novo = (id: string, createdAt: Date) =>
  pedidos.push({ id, status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null, gatewayProvider: null, createdAt });
const status = (id: string) => pedidos.find((p) => p.id === id)!.status;

(async () => {
  const { codigoDoPedido, confereCodigoDoPedido } = await import("../src/lib/codigo-do-pedido");
  const { POST } = await import("../src/app/api/payments/cancelar/route");
  let ip = 0;
  const cancelar = async (corpo: unknown) => {
    // IP diferente a cada chamada: o limite de 10/min não entra no teste.
    const r = await POST(new Request("http://t/api/payments/cancelar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
      body: JSON.stringify(corpo),
    }) as any);
    return r.status;
  };

  console.log("\n— 1. O código —");
  const c = codigoDoPedido("pedA");
  confere("tem 22 caracteres base64url", /^[A-Za-z0-9_-]{22}$/.test(c), true);
  confere("é o mesmo a cada cálculo (sem coluna no banco)", codigoDoPedido("pedA"), c);
  confere("o certo confere", confereCodigoDoPedido("pedA", c), true);
  confere("o de outro pedido não confere", confereCodigoDoPedido("pedB", c), false);
  confere("vazio, curto e não-texto não conferem", [confereCodigoDoPedido("pedA", ""), confereCodigoDoPedido("pedA", c.slice(0, 10)), confereCodigoDoPedido("pedA", 123)], [false, false, false]);

  console.log("\n— 2. Pedido criado depois da publicação —");
  novo("pedA", DEPOIS);
  novo("pedB", DEPOIS);
  confere("sem código: 403", await cancelar({ orderId: "pedA" }), 403);
  confere("código errado: 403", await cancelar({ orderId: "pedA", codigo: "x".repeat(22) }), 403);
  confere("código de outro pedido: 403", await cancelar({ orderId: "pedA", codigo: codigoDoPedido("pedB") }), 403);
  confere("…e o pedido continua esperando o Pix", status("pedA"), "AGUARDANDO_PAGAMENTO");
  confere("código certo: 200", await cancelar({ orderId: "pedA", codigo: codigoDoPedido("pedA") }), 200);
  confere("…e o pedido foi cancelado", status("pedA"), "CANCELADO");

  console.log("\n— 3. Pedido de página antiga (antes da publicação) —");
  novo("pedVelho", ANTES);
  novo("pedVelho2", ANTES);
  confere("sem código: 200 (continua cancelando)", await cancelar({ orderId: "pedVelho" }), 200);
  confere("…cancelado", status("pedVelho"), "CANCELADO");
  confere("com código errado: 403 (veio código, tem que conferir)", await cancelar({ orderId: "pedVelho2", codigo: "errado" }), 403);
  confere("…não mexeu", status("pedVelho2"), "AGUARDANDO_PAGAMENTO");

  console.log(falhas ? `\n❌ ${falhas} falha(s).` : "\n✅ Tudo certo.");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
