/**
 * A escolha do combo que OUTRA tela faz aparece nela e tem baixa própria.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-kds-opcao-do-combo.ts
 *
 * Hakim Centro, 20/10/2026: "Combo Pizza Grande + 4 Esfirras Doces" está em
 * "Combos de Pizza" (tela Pizza), e as 4 doces são feitas na tela Esfirra. A
 * tela Esfirra precisa ver as doces, dar baixa nelas sem carimbar o combo, e a
 * finalização não pode encerrar o pedido com as doces por fazer.
 *
 * Regras puras (lib/kds-telas.ts) e a rota de verdade (src/app/api/kds/route.ts)
 * com banco em memória.
 */
import { NextRequest } from "next/server";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── As telas da Hakim Centro (User.kdsScreens, 20/10/2026) ──────────────────
const PIZZA = { id: "h-pizza", name: "Pizza", stage: "production", filter: "all", categoryFilter: ["Pizzas", "Promoção de Pizza", "Combos de Pizza"] };
const ESFIRRA = {
  id: "h-esfirra", name: "Esfirra", stage: "production", filter: "all",
  categoryFilter: ["Esfirras Salgadas", "Esfirras Doces", "Combos", "Promoção do Dia", "Novidade", "Acompanhamentos", "Bebidas", "Brindes"],
};
const FIN1 = { id: "h-fin1", name: "Finalização 1", stage: "finishing", filter: "all", categoryFilter: [] };
const TELAS = [PIZZA, FIN1, ESFIRRA];
let CONFIG: any = { opcaoDoComboNaTelaDela: true };
const LIGADO = { soNaFinalizacao: [], prioridade: [], opcaoDoComboNaTelaDela: true } as any;

// O que o resolvedor (lib/categoria-do-item.ts) devolve para as escolhas: a
// categoria do produto de mesmo nome. Sabor de pizza solto não casa com nada.
const CATEGORIA_DA_OPCAO: Record<string, string> = {
  "Esfirra de Nutella": "Esfirras Doces",
  "Esfirra de Romeu e Julieta": "Esfirras Doces",
  "Coca-Cola 2l": "Bebidas",
};
const comOpcoes = (i: any) => {
  const opcoes = (i.comboSelections || [])
    .filter((s: any) => CATEGORIA_DA_OPCAO[s.name])
    .map((s: any) => ({ name: s.name, quantity: s.quantity, category: CATEGORIA_DA_OPCAO[s.name] }));
  return opcoes.length ? { ...i, opcoesParaImpressao: opcoes } : i;
};

const comboPizzaDoces = (id: string, quantidade = 1, pronto = false) => ({
  id, productName: "Combo Pizza Grande + 4 Esfirras Doces", quantity: quantidade,
  prontoEm: pronto ? new Date("2026-10-20T23:10:00Z") : null,
  comboSelections: [
    { name: "1/2 Calabresa", quantity: 1, price: 0 },
    { name: "1/2 Portuguesa", quantity: 1, price: 8 },
    { name: "Esfirra de Nutella", quantity: 3, price: 4 },
    { name: "Esfirra de Romeu e Julieta", quantity: 1, price: 0 },
    { name: "Coca-Cola 2l", quantity: 1, price: 0 },
  ],
  menuProduct: { id: "p-combo", name: "Combo Pizza Grande + 4 Esfirras Doces", category: "Combos de Pizza" },
});
const esfirra = (id: string, pronto = false) => ({
  id, productName: "Esfirra de Carne", quantity: 2, prontoEm: pronto ? new Date("2026-10-20T23:10:00Z") : null,
  comboSelections: null, menuProduct: { id: "p-carne", name: "Esfirra de Carne", category: "Esfirras Salgadas" },
});

// ── Banco em memória ────────────────────────────────────────────────────────
const db: { user: any; order: any } = { user: null, order: null };
const prismaFalso: any = {
  user: {
    findUnique: async ({ where }: any) => (where?.email === db.user.email || where?.id === db.user.id ? { ...db.user } : null),
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
      for (const i of db.order.items) {
        if (!where.id.in.includes(i.id)) continue;
        if ("prontoEm" in where && i.prontoEm !== null) continue;
        Object.assign(i, data);
      }
      return { count: 0 };
    },
  },
};
(globalThis as any).prisma = prismaFalso;

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("next-auth/next", { getServerSession: async () => ({ user: { email: "hakim@teste" } }) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/categoria-do-item", {
  resolverCategoriasDosPedidos: async (p: any[]) => p.map((o) => ({ ...o, items: (o.items || []).map(comOpcoes) })),
});
stub("../src/lib/food99-status", { ehPedido99Food: () => false });
stub("../src/lib/wabiz-status", { ehPedidoWabiz: () => false });
stub("../src/lib/brendi-status", { ehPedidoBrendi: () => false });
stub("../src/lib/keeta/status", { ehPedidoKeeta: () => false });
stub("../src/lib/cardapioweb/status", { ehPedidoCardapioWeb: () => false });

function montar(itens: any[], kdsStage = "PRODUCTION") {
  db.user = { id: "hakim", email: "hakim@teste", role: "USER", ownerId: null, kdsScreens: TELAS, kdsConfig: CONFIG };
  db.order = {
    id: "o1", kdsStage, status: "PREPARANDO", deliveryType: "DELIVERY", franchiseeId: "hakim",
    ifoodOrderId: null, ifoodStoreMerchant: null, openDeliveryOrderId: null, openDeliveryChannel: null, source: "IFOOD",
    deliveryBy: null, openDeliveryReference: null, kdsTelasProntas: [], kdsBaixas: [], kdsFinishingAt: null,
    dailyOrderNumber: 12, food99AppShopId: null, items: itens,
  };
}

async function main() {
  const kds = await import("../src/lib/kds-telas");
  const { PUT } = await import("../src/app/api/kds/route");
  const acao = async (corpo: Record<string, unknown>) => {
    const req = new NextRequest("http://localhost/api/kds", { method: "PUT", body: JSON.stringify({ orderId: "o1", ...corpo }) });
    const res = await PUT(req);
    return { status: res.status, corpo: await res.json() };
  };
  const itensResolvidos = () => db.order.items.map(comOpcoes);

  console.log("\n— As linhas de cada tela —");
  montar([comboPizzaDoces("c1", 2)]);
  let linhas = kds.linhasDeOpcaoDaTela(ESFIRRA, itensResolvidos(), db.order.kdsBaixas, LIGADO);
  confere(
    "a Esfirra ganha as doces do combo (× 2 combos), sem a Coca",
    linhas.map((l) => [l.id, l.quantity, l.productName]),
    [
      ["c1#op0", 6, "Esfirra de Nutella (do Combo Pizza Grande + 4 Esfirras Doces)"],
      ["c1#op1", 2, "Esfirra de Romeu e Julieta (do Combo Pizza Grande + 4 Esfirras Doces)"],
    ],
  );
  confere("a Pizza já mostra o combo inteiro: nenhuma linha", kds.linhasDeOpcaoDaTela(PIZZA, itensResolvidos(), [], LIGADO).length, 0);
  confere("a finalização sem filtro também não", kds.linhasDeOpcaoDaTela(FIN1, itensResolvidos(), [], LIGADO).length, 0);

  console.log("\n— O pedido em cada tela (pedidoNaTela, a tela) —");
  const naEsfirra = kds.pedidoNaTela({ items: itensResolvidos(), kdsBaixas: [] } as any, { filtroDestaTela: ESFIRRA.categoryFilter, donos: null, estagio: "production", config: LIGADO });
  confere("o pedido só com o combo de pizza aparece na Esfirra, só com as doces", naEsfirra?.items.map((i: any) => i.id), ["c1#op0", "c1#op1"]);
  const naPizza = kds.pedidoNaTela({ items: itensResolvidos(), kdsBaixas: [] } as any, { filtroDestaTela: PIZZA.categoryFilter, donos: null, estagio: "production", config: LIGADO });
  confere("na Pizza, o combo", naPizza?.items.map((i: any) => i.id), ["c1"]);
  confere("a Esfirra tem pendência (o servidor manda o pedido para ela)", kds.telaTemPendencia(ESFIRRA, itensResolvidos(), [], LIGADO), true);

  console.log("\n— A Esfirra dá baixa nas doces —");
  let r = await acao({ action: "finish_production", tela: "h-esfirra" });
  confere("responde ok e devolve as linhas para o desfazer", [r.status, r.corpo.carimbados], [200, ["c1#op0", "c1#op1"]]);
  confere("o combo NÃO é carimbado (segue na Pizza)", db.order.items[0].prontoEm, null);
  confere("a baixa da Esfirra guarda as linhas", db.order.kdsBaixas.map((b: any) => [b.tela, b.itens]), [["h-esfirra", ["c1#op0", "c1#op1"]]]);
  confere("a Esfirra não tem mais o que fazer", kds.telaTemPendencia(ESFIRRA, itensResolvidos(), db.order.kdsBaixas, LIGADO), false);
  confere("a Pizza continua com o combo", kds.telaTemPendencia(PIZZA, itensResolvidos(), db.order.kdsBaixas, LIGADO), true);
  confere("o pedido não vai para a finalização só pelas doces", db.order.kdsStage, "PRODUCTION");

  console.log("\n— Desfazer a baixa da Esfirra —");
  r = await acao({ action: "revert_production", tela: "h-esfirra", itens: r.corpo.carimbados });
  confere("as doces voltam para a Esfirra", kds.telaTemPendencia(ESFIRRA, itensResolvidos(), db.order.kdsBaixas, LIGADO), true);

  console.log("\n— A Pizza dá baixa primeiro; a finalização tenta encerrar —");
  montar([comboPizzaDoces("c1")]);
  r = await acao({ action: "finish_production", tela: "h-pizza" });
  confere("a Pizza carimba o combo e o pedido vai para a finalização", [db.order.items[0].prontoEm !== null, db.order.kdsStage], [true, "FINISHING"]);
  confere("a Esfirra ainda tem as doces", kds.telaTemPendencia(ESFIRRA, itensResolvidos(), db.order.kdsBaixas, LIGADO), true);
  r = await acao({ action: "finish_order", tela: "h-fin1" });
  confere(
    "a finalização pergunta antes: faltam as doces na Esfirra",
    [r.corpo.precisaConfirmar, r.corpo.faltam],
    [true, [
      { item: "3× Esfirra de Nutella (do Combo Pizza Grande + 4 Esfirras Doces)", tela: "Esfirra" },
      { item: "1× Esfirra de Romeu e Julieta (do Combo Pizza Grande + 4 Esfirras Doces)", tela: "Esfirra" },
    ]],
  );
  r = await acao({ action: "finish_production", tela: "h-esfirra" });
  confere("a Esfirra dá baixa nas doces com o pedido já na finalização", [r.status, r.corpo.carimbados], [200, ["c1#op0", "c1#op1"]]);
  confere("as duas baixas de produção ficam guardadas", db.order.kdsBaixas.map((b: any) => b.tela), ["h-pizza", "h-esfirra"]);
  r = await acao({ action: "finish_order", tela: "h-fin1" });
  confere("agora encerra direto", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log("\n— Pedido com esfirra avulsa e o combo: a baixa da Esfirra faz as duas coisas —");
  montar([esfirra("e1"), comboPizzaDoces("c1")]);
  r = await acao({ action: "finish_production", tela: "h-esfirra" });
  confere("carimba a esfirra e as doces, não o combo", [db.order.items[0].prontoEm !== null, db.order.items[1].prontoEm, r.corpo.carimbados], [true, null, ["e1", "c1#op0", "c1#op1"]]);
  confere("vai para a finalização (a esfirra é item de verdade)", db.order.kdsStage, "FINISHING");

  console.log("\n— Baixa de novo na mesma tela não perde as doces já feitas —");
  r = await acao({ action: "finish_production", tela: "h-esfirra" });
  confere("a baixa nova continua com as linhas", db.order.kdsBaixas.find((b: any) => b.tela === "h-esfirra")?.itens, ["e1", "c1#op0", "c1#op1"]);
  confere("nada novo para desfazer", r.corpo.carimbados, []);

  console.log("\n— Loja que não ligou (Ragnar, NIK…): nada muda —");
  CONFIG = null;
  montar([comboPizzaDoces("c1")]);
  confere("sem linhas", kds.linhasDeOpcaoDaTela(ESFIRRA, itensResolvidos(), [], null).length, 0);
  confere(
    "o pedido só com o combo não aparece na Esfirra",
    kds.pedidoNaTela({ items: itensResolvidos(), kdsBaixas: [] } as any, { filtroDestaTela: ESFIRRA.categoryFilter, donos: null, estagio: "production", config: null }),
    null,
  );
  r = await acao({ action: "finish_production", tela: "h-pizza" });
  r = await acao({ action: "finish_order", tela: "h-fin1" });
  confere("a finalização encerra como antes", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
