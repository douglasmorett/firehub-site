/**
 * A baixa do KDS em "Todas as Lojas" usa as MESMAS telas que desenharam o pedido.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-kds-baixa-em-todas-as-lojas.ts
 *
 * Annalu + Rush, 03/11/2026: a TV aberta em "Todas" desenha pelas telas da
 * principal (Annalu: "Cozinha", sem filtro). A Rush tinha uma tela com o MESMO
 * id, "ESTAÇÃO PIZZA", filtrada em "Refrigerantes". A baixa lia as telas da
 * loja do PEDIDO: carimbava zero itens da pizza da Rush e o pedido voltava
 * para a Produção (#8, #9, #10 e #12 gravados com `itens: []`).
 *
 * Banco em memória e a rota de verdade (src/app/api/kds/route.ts).
 */
import { NextRequest } from "next/server";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TELA = "7e32e160";
const ANNALU = {
  id: "annalu", email: "annalu@teste", role: "FRANCHISEE", ownerId: null, accountGroupId: null,
  kdsScreens: [{ id: TELA, name: "Cozinha", stage: "production", filter: "all", categoryFilter: [] }], kdsConfig: null,
};
const RUSH = {
  id: "rush", email: "rush@teste", role: "FRANCHISEE", ownerId: null, accountGroupId: "annalu",
  kdsScreens: [{ id: TELA, name: "ESTAÇÃO PIZZA", stage: "production", filter: "all", categoryFilter: ["Refrigerantes"] }], kdsConfig: null,
};

// ── Banco em memória ────────────────────────────────────────────────────────
const db: { users: any[]; order: any; sessao: string } = { users: [ANNALU, RUSH], order: null, sessao: "annalu@teste" };
const prismaFalso: any = {
  user: {
    findUnique: async ({ where }: any) => {
      const u = db.users.find((x) => (where?.email && x.email === where.email) || (where?.id && x.id === where.id));
      return u ? { ...u } : null;
    },
    findMany: async ({ where }: any) => {
      const ors: any[] = where?.OR || [];
      return db.users
        .filter((u) => ors.some((c) => (c.id && u.id === c.id) || (c.accountGroupId && u.accountGroupId === c.accountGroupId)))
        .map((u) => ({ id: u.id, storeName: u.id, slug: u.id, isPrimaryStore: !u.accountGroupId }));
    },
  },
  customerOrder: {
    findUnique: async () => (db.order ? { ...db.order, items: db.order.items.map((i: any) => ({ ...i })) } : null),
    update: async ({ data }: any) => {
      Object.assign(db.order, data);
      return db.order;
    },
  },
  customerOrderItem: {
    updateMany: async ({ where, data }: any) => {
      for (const i of db.order.items) if (where.id.in.includes(i.id) && i.prontoEm === null) Object.assign(i, data);
      return { count: 0 };
    },
  },
};
(globalThis as any).prisma = prismaFalso;

// ── O que fica fora do teste ────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("next-auth/next", { getServerSession: async () => ({ user: { email: db.sessao } }) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/categoria-do-item", { resolverCategoriasDosPedidos: async (p: any[]) => p });
stub("../src/lib/food99-status", { ehPedido99Food: () => false });
stub("../src/lib/wabiz-status", { ehPedidoWabiz: () => false });
stub("../src/lib/brendi-status", { ehPedidoBrendi: () => false });
stub("../src/lib/keeta/status", { ehPedidoKeeta: () => false });
stub("../src/lib/cardapioweb/status", { ehPedidoCardapioWeb: () => false });

const pizza = (id: string, productName: string) => ({
  id, productName, quantity: 1, prontoEm: null, comboSelections: null,
  menuProduct: { id: `p-${id}`, active: true, name: productName, category: "Pizzas Meio A Meio" },
});

function pedidoDa(loja: string) {
  db.order = {
    id: "o8", kdsStage: null, status: "ACEITO", deliveryType: "DELIVERY", franchiseeId: loja,
    ifoodOrderId: null, ifoodStoreMerchant: null, openDeliveryOrderId: null, openDeliveryChannel: null, source: "SITE",
    deliveryBy: null, openDeliveryReference: null, kdsTelasProntas: [], kdsBaixas: [], kdsFinishingAt: null,
    dailyOrderNumber: 8, food99AppShopId: null, items: [pizza("i1", "Toscana Rush")],
  };
}

async function main() {
  const { PUT } = await import("../src/app/api/kds/route");
  const darPronto = async (visao: string | null) => {
    const req = new NextRequest("http://localhost/api/kds", {
      method: "PUT",
      headers: visao ? { cookie: `firehub_active_store=${visao}` } : {},
      body: JSON.stringify({ orderId: "o8", action: "finish_production", tela: TELA }),
    });
    const res = await PUT(req);
    return { status: res.status, corpo: await res.json() };
  };

  console.log("\n— Pedido da Rush, cozinha da Annalu aberta em \"Todas\" (o caso da Karen) —");
  pedidoDa("rush");
  let r = await darPronto("all");
  confere("aceita a baixa", r.status, 200);
  confere("carimba a pizza (a tela que desenhou não tem filtro)", r.corpo.itensCarimbados, 1);
  confere("o pedido vai para a finalização", db.order.kdsStage, "FINISHING");

  console.log("\n— Pedido da própria Annalu, mesma tela —");
  pedidoDa("annalu");
  r = await darPronto("all");
  confere("carimba e vai para a finalização, como sempre", [r.corpo.itensCarimbados, db.order.kdsStage], [1, "FINISHING"]);

  console.log("\n— Cozinha aberta na própria Rush (sessão da Rush) —");
  db.sessao = "rush@teste";
  pedidoDa("rush");
  r = await darPronto(null);
  confere("vale a tela da Rush (Refrigerantes): a pizza não é dela", [r.status, r.corpo.itensCarimbados], [200, 0]);
  confere("o pedido segue na produção", db.order.kdsStage, null);
  db.sessao = "annalu@teste";

  console.log("\n— Fora do \"Todas\", pedido de outra loja continua barrado —");
  pedidoDa("rush");
  r = await darPronto(null);
  confere("403", r.status, 403);

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
