// Módulo, não script global: sem isto `falhas`/`confere` brigam com os outros
// scripts no tsc do projeto inteiro.
export {};

/**
 * Compra de insumos (api/checkout): quantidade negativa, zero ou quebrada é
 * recusada com 400 antes de recalcular o total. Negativa abatia do total —
 * 20 de A (R$ 50) + -17 de B (R$ 40) dava R$ 320, passava do mínimo e o
 * boleto saía por R$ 320 com R$ 1.000 de mercadoria no pedido.
 *
 *   npx tsx scripts/teste-quantidade-do-checkout.ts
 *
 * Sem banco: Prisma, sessão e Asaas são trocados por versões em memória.
 */
import { NextRequest } from "next/server";

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};

const pedidosCriados: any[] = [];
stub("next-auth/next", { getServerSession: async () => ({ user: { id: "loja1", email: "loja@teste" } }) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/prisma", {
  prisma: {
    user: { findUnique: async () => ({ id: "loja1", name: "Loja", email: "loja@teste", cpfCnpj: null }) },
    product: { findMany: async () => [{ id: "A", price: 50 }, { id: "B", price: 40 }] },
    order: {
      create: async ({ data }: any) => { pedidosCriados.push(data); return { id: `pedido${pedidosCriados.length}xxxxxx` }; },
      update: async () => ({}),
    },
    orderHistory: { create: async () => ({}) },
  },
});
stub("../src/lib/asaas", {
  checkAsaasOverdue: async () => ({ blocked: false, payments: [] }),
  createAsaasPayment: async () => ({ boletoUrl: "https://boleto", paymentId: "pay1" }),
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require("../src/app/api/checkout/route");

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

async function chama(items: any): Promise<number> {
  const req = new NextRequest("http://x/api/checkout", {
    method: "POST",
    body: JSON.stringify({ items }),
    headers: { "content-type": "application/json" },
  });
  return (await POST(req)).status;
}

(async () => {
  const recusados: [string, any][] = [
    ["quantidade negativa abatendo o total", [{ id: "A", quantity: 20 }, { id: "B", quantity: -17 }]],
    ["o mesmo produto com +10 e -9", [{ id: "A", quantity: 10 }, { id: "A", quantity: -9 }, { id: "B", quantity: 8 }]],
    ["quantidade zero", [{ id: "A", quantity: 7 }, { id: "B", quantity: 0 }]],
    ["quantidade quebrada", [{ id: "A", quantity: 6.5 }]],
    ["quantidade em texto", [{ id: "A", quantity: "7" }]],
    ["sem quantidade", [{ id: "A" }]],
  ];
  for (const [nome, items] of recusados) {
    const antes = pedidosCriados.length;
    const status = await chama(items).catch((e) => e.message);
    confere(`${nome}: 400 e nenhum pedido`, status === 400 && pedidosCriados.length === antes, status);
  }

  const status = await chama([{ id: "A", quantity: 4 }, { id: "B", quantity: 3 }]);
  const criado = pedidosCriados[pedidosCriados.length - 1];
  confere("carrinho normal continua passando (R$ 320)", status === 200 && criado?.totalAmount === 320, { status, criado });

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
