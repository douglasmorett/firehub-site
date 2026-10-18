/**
 * A finalização não encerra, sem querer, o pedido que a produção ainda está fazendo.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-kds-finalizacao-com-pendente.ts
 *
 * Ragnar Burger, 18/10/2026, pedido #148 (Ragnar + 2 Thor + MilkShake): a tela
 * Pizza deu baixa no shake, o pedido foi para a finalização (regra de 22/09) e
 * a "Finalização 2" deu pronto 28 s depois — FINISHED com os burgers sem
 * carimbo, e ele sumiu da tela Burger. Agora o `finish_order` devolve
 * `precisaConfirmar` com o que falta, e só encerra com `forcar: true`.
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

// ── As telas da Ragnar (User.kdsScreens) ────────────────────────────────────
const TELAS_DA_RAGNAR = [
  { id: "r-pizza", name: "Pizza", stage: "production", filter: "all", categoryFilter: ["Sobremesas", "Pizzas", "Sucos"] },
  { id: "r-burger", name: "Burger", stage: "production", filter: "all", categoryFilter: ["Entradas", "Burgers", "Combos", "Refrigerantes", "Adicionais Burger"] },
  { id: "r-bar", name: "Bar", stage: "production", filter: "all", categoryFilter: ["Drinks"] },
  { id: "r-fin1", name: "Finalização 1", stage: "finishing", filter: "all", categoryFilter: ["Drinks"] },
  { id: "r-fin2", name: "Finalização 2", stage: "finishing", filter: "all", categoryFilter: [] },
];

// ── Banco em memória ────────────────────────────────────────────────────────
const db: { user: any; order: any; atualizacoes: any[] } = { user: null, order: null, atualizacoes: [] };
const prismaFalso: any = {
  user: {
    findUnique: async ({ where }: any) => (where?.email === db.user.email || where?.id === db.user.id ? { ...db.user } : null),
  },
  customerOrder: {
    findUnique: async () => (db.order ? { ...db.order, items: db.order.items.map((i: any) => ({ ...i })) } : null),
    update: async ({ data }: any) => {
      db.atualizacoes.push(data);
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
stub("next-auth/next", { getServerSession: async () => ({ user: { email: "ragnar@teste" } }) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/categoria-do-item", { resolverCategoriasDosPedidos: async (p: any[]) => p });
stub("../src/lib/food99-status", { ehPedido99Food: () => false });
stub("../src/lib/wabiz-status", { ehPedidoWabiz: () => false });
stub("../src/lib/brendi-status", { ehPedidoBrendi: () => false });
stub("../src/lib/keeta/status", { ehPedidoKeeta: () => false });
stub("../src/lib/cardapioweb/status", { ehPedidoCardapioWeb: () => false });

const item = (id: string, productName: string, quantity: number, category: string, pronto = false) => ({
  id, productName, quantity, prontoEm: pronto ? new Date("2026-10-18T03:53:10Z") : null,
  menuProduct: { id: `p-${id}`, name: productName, category },
});

function montar(itens: any[], telas: any[] = TELAS_DA_RAGNAR) {
  db.user = { id: "ragnar", email: "ragnar@teste", role: "USER", ownerId: null, kdsScreens: telas, kdsConfig: null };
  db.order = {
    id: "o148", kdsStage: "FINISHING", status: "PREPARANDO", deliveryType: "DELIVERY", franchiseeId: "ragnar",
    ifoodOrderId: null, ifoodStoreMerchant: null, openDeliveryOrderId: null, openDeliveryChannel: null, source: "SITE",
    deliveryBy: null, openDeliveryReference: null, kdsTelasProntas: [], kdsBaixas: [], kdsFinishingAt: new Date(),
    dailyOrderNumber: 148, food99AppShopId: null, items: itens,
  };
  db.atualizacoes = [];
}

async function main() {
  const { PUT } = await import("../src/app/api/kds/route");
  const finalizar = async (corpo: Record<string, unknown>) => {
    const req = new NextRequest("http://localhost/api/kds", { method: "PUT", body: JSON.stringify({ orderId: "o148", action: "finish_order", ...corpo }) });
    const res = await PUT(req);
    return { status: res.status, corpo: await res.json() };
  };

  console.log("\n— #148: a Pizza deu baixa no shake, a Finalização 2 tenta encerrar —");
  montar([item("b1", "Ragnar", 1, "Burgers"), item("b2", "Thor", 2, "Burgers"), item("s1", "MilkShake", 1, "Sobremesas", true)]);
  let r = await finalizar({ tela: "r-fin2" });
  confere("responde 200 pedindo confirmação", [r.status, r.corpo.precisaConfirmar], [200, true]);
  confere("diz o que falta e em que tela", r.corpo.faltam, [{ item: "1× Ragnar", tela: "Burger" }, { item: "2× Thor", tela: "Burger" }]);
  confere("não grava nada", db.atualizacoes.length, 0);
  confere("o pedido continua na finalização (e na tela Burger)", db.order.kdsStage, "FINISHING");

  console.log("\n— \"Finalizar mesmo assim\" (forcar) —");
  r = await finalizar({ tela: "r-fin2", forcar: true });
  confere("finaliza", [r.status, r.corpo.success, r.corpo.stage], [200, true, "FINISHED"]);
  confere("o pedido vira FINISHED", db.order.kdsStage, "FINISHED");

  console.log("\n— Burgers prontos, só o chopp (categoria sem tela de produção) —");
  montar([item("b1", "Ragnar", 1, "Burgers", true), item("c1", "Chopp", 1, "Cerveja")]);
  r = await finalizar({ tela: "r-fin2" });
  confere("finaliza direto: a bebida que ninguém carimba não prende", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log("\n— Tudo pronto —");
  montar([item("b1", "Ragnar", 1, "Burgers", true), item("s1", "MilkShake", 1, "Sobremesas", true)]);
  r = await finalizar({ tela: "r-fin2" });
  confere("finaliza direto", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log("\n— Loja sem telas configuradas —");
  montar([item("b1", "Ragnar", 1, "Burgers"), item("s1", "MilkShake", 1, "Sobremesas", true)], []);
  r = await finalizar({ tela: "qualquer" });
  confere("finaliza direto, como sempre", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log("\n— Tela sem identidade (link antigo) —");
  montar([item("b1", "Ragnar", 1, "Burgers"), item("s1", "MilkShake", 1, "Sobremesas", true)]);
  r = await finalizar({});
  confere("finaliza direto, como sempre", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
