/**
 * Baixa do estoque nos pedidos do 99Food e nas pizzas da Wabiz (NIK, 16/11/2026).
 *
 *   npx tsx scripts/teste-baixa-99-e-wabiz.ts
 *
 * 1. O pedido do 99Food que nasce ACEITO (aceite automático) nunca passava pela
 *    troca de status, que é onde a baixa dispara: 0 de 177 pedidos com baixa.
 *    Aqui roda o webhook de verdade (src/app/api/99food/webhook/route.ts).
 * 2. A pizza da Wabiz vira "Pizza Calabresa" / "Pizza 1/2 A + 1/2 B" e a ficha
 *    está no sabor ("Calabresa"): a busca pelo nome inteiro nunca casava.
 *
 * Banco em memória e a baixa de verdade (src/lib/stock.ts).
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "x";

import { NextRequest } from "next/server";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── Banco em memória ────────────────────────────────────────────────────────
const LOJA = "nik";
const insumo = (id: string, nome: string) => ({ id, franchiseeId: LOJA, name: nome, unit: "g", quantity: 10_000 });
const ficha = (...itens: [string, number][]) =>
  itens.map(([stockItemId, quantityConsumed]) => ({ stockItemId, quantityConsumed }));

const db: { insumos: any[]; produtos: any[]; pedidos: any[]; movs: any[] } = {
  insumos: [insumo("frango", "Frango desfiado"), insumo("calab", "Calabresa fatiada"), insumo("presunto", "Presunto"), insumo("mus", "Muçarela")],
  produtos: [
    { id: "p-esfiha", franchiseeId: LOJA, name: "Esfiha Frango", active: true, isCombo: false, recipeItems: ficha(["frango", 30]) },
    { id: "p-calab", franchiseeId: LOJA, name: "Calabresa", active: true, isCombo: false, recipeItems: ficha(["calab", 200], ["mus", 250]) },
    { id: "p-port", franchiseeId: LOJA, name: "Portuguesa", active: true, isCombo: false, recipeItems: ficha(["presunto", 150], ["mus", 250]) },
    // Espelhos: sem ficha, inativos — é o que o importador cria.
    { id: "99food_esf", franchiseeId: LOJA, name: "Esfiha Frango", active: false, isCombo: false, recipeItems: [] },
    { id: "wabiz-nik-1", franchiseeId: LOJA, name: "Pizza Calabresa", active: false, isCombo: false, recipeItems: [] },
    { id: "wabiz-nik-1+2", franchiseeId: LOJA, name: "Pizza 1/2 Calabresa + 1/2 Portuguesa", active: false, isCombo: false, recipeItems: [] },
    { id: "ifood-pz", franchiseeId: LOJA, name: "Pizza Calabresa", active: false, isCombo: false, recipeItems: [] },
  ],
  pedidos: [],
  movs: [],
};

const comInsumo = (r: any) => {
  const s = db.insumos.find((i) => i.id === r.stockItemId);
  return { ...r, stockItem: { ...s } };
};
const casaProduto = (p: any, w: any = {}) => {
  if (w.id && typeof w.id === "string" && p.id !== w.id) return false;
  if (w.franchiseeId && p.franchiseeId !== w.franchiseeId) return false;
  if (w.active !== undefined && p.active !== w.active) return false;
  if (w.isCombo !== undefined && p.isCombo !== w.isCombo) return false;
  if (w.name?.equals && p.name.toLowerCase() !== String(w.name.equals).toLowerCase()) return false;
  if (w.NOT?.id?.startsWith && p.id.startsWith(w.NOT.id.startsWith)) return false;
  if (w.recipeItems?.some && p.recipeItems.length === 0) return false;
  if (w.comboGroups?.some) return false; // nenhum produto daqui tem grupo
  return true;
};
const pedidoCompleto = (o: any) => ({
  ...o,
  items: o.items.map((i: any) => {
    const mp = db.produtos.find((p) => p.id === i.menuProductId);
    return { ...i, menuProduct: mp ? { ...mp, recipeItems: mp.recipeItems.map(comInsumo) } : null };
  }),
});

const prismaFalso: any = {
  $transaction: async (fn: any) => fn(prismaFalso),
  user: {
    findUnique: async ({ where }: any) => (where?.id === LOJA ? { id: LOJA, role: "FRANCHISEE", food99MerchantId: "m1" } : null),
    findMany: async () => [],
    update: async () => ({}),
  },
  customerOrder: {
    findFirst: async () => null,
    findUnique: async ({ where }: any) => {
      const o = db.pedidos.find((x) => x.id === where.id);
      return o ? pedidoCompleto(o) : null;
    },
    create: async ({ data }: any) => {
      const o = {
        id: `o${db.pedidos.length + 1}`, franchiseeId: data.franchiseeId, status: data.status, source: data.source,
        cancelledAt: null, items: (data.items?.create || []).map((i: any, n: number) => ({ id: `i${n}`, comboSelections: null, ...i })),
      };
      db.pedidos.push(o);
      return { ...o };
    },
  },
  comboGroupItem: { findMany: async () => [] },
  menuProduct: {
    findFirst: async ({ where }: any) => {
      const p = db.produtos.find((x) => casaProduto(x, where));
      return p ? { id: p.id, name: p.name, recipeItems: p.recipeItems.map(comInsumo) } : null;
    },
    findMany: async ({ where }: any) =>
      db.produtos.filter((x) => casaProduto(x, where)).map((p) => ({ id: p.id, name: p.name, recipeItems: p.recipeItems.map(comInsumo) })),
  },
  stockTransaction: {
    findFirst: async ({ where }: any) =>
      db.movs.find((m) => m.type === where.type && (!where.notes?.contains || String(m.notes).includes(where.notes.contains))) || null,
    create: async ({ data }: any) => {
      if (db.movs.some((m) => m.sourceRef === data.sourceRef)) throw Object.assign(new Error("único"), { code: "P2002" });
      db.movs.push({ ...data });
      return data;
    },
    updateMany: async () => ({ count: 0 }),
  },
  stockItem: {
    updateMany: async ({ where, data }: any) => {
      const s = db.insumos.find((i) => i.id === where.id && i.franchiseeId === where.franchiseeId);
      if (!s) return { count: 0 };
      s.quantity -= data.quantity.decrement;
      return { count: 1 };
    },
    findUnique: async ({ where }: any) => ({ ...db.insumos.find((i) => i.id === where.id) }),
  },
};
(globalThis as any).prisma = prismaFalso;

// ── O que fica fora do teste ────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let aceitaSozinho = true;
stub("../src/lib/pausa-pelo-estoque-no-banco", { avisarMovimentoDeEstoque: () => {} });
stub("../src/lib/webhook-assinatura", {
  verificarAssinaturaHmac: () => ({ estado: "valida" }), avisarWebhookSemSegredo: () => {}, diagnosticarAssinatura: () => {},
});
stub("../src/lib/loja-sem-conexao-no-banco", { aceitaSozinhoAgora: async () => aceitaSozinho });
stub("../src/lib/webhook-99food-log", { registrar99Food: () => {} });
stub("../src/lib/loja-bloqueada", { lojaBloqueadaPorMensalidade: async () => false });
stub("../src/lib/order-number", { generateDailyOrderNumberTx: async () => 1 });
stub("../src/lib/categoria-do-item", { categoriasPeloNome: async () => undefined });
stub("../src/lib/food99-status", { aplicarPedidoAlterado99: async () => ({ ok: false }), sincronizar99Food: async () => {} });
stub("../src/lib/food99-status-do-evento", { aplicarStatusDoEvento99: async () => 0 });
stub("../src/lib/food99-lojas", { donoDoAppShopId: async () => LOJA, donoDoShopId: async () => LOJA });
stub("../src/lib/food99-api", { detalheDoPedido: async () => null });
stub("../src/lib/distancia-da-entrega", { pontoEDistanciaDoParceiro: async () => ({ km: null, ponto: null }) });
stub("../src/lib/food99-pedido", {
  traduzirPedido99Food: (o: any) => ({
    orderId: o.order_id, appShopId: "shop99", shopId: "m1", numeroNoParceiro: "403016",
    itens: [{ nome: "Esfiha Frango" }], coordenadas: null,
    cliente: { nome: "Cliente", telefone: "", endereco: "Rua A" }, pagamento: { texto: "Online", pagoOnline: true },
    trocoPara: null, total: 10, taxaEntrega: 0, descontos: { total: 0, loja: 0, plataforma: 0, recebeLoja: 10 }, precoCru: {},
    observacoes: "", entreguePor: "99FOOD", codigoDeColeta: null,
  }),
  itens99ParaPrisma: async () => [{ productName: "Esfiha Frango", quantity: 2, price: 5, menuProductId: "99food_esf" }],
});

const baixas = (pedidoId: string) => {
  const r: Record<string, number> = {};
  for (const m of db.movs.filter((x) => x.type === "SALE" && String(x.sourceRef).startsWith(`sale:${pedidoId}:`))) {
    r[m.stockItemId] = Math.round(-m.quantity * 1000) / 1000;
  }
  return r;
};
const espera = () => new Promise((r) => setTimeout(r, 300));

async function main() {
  const { POST } = await import("../src/app/api/99food/webhook/route");
  const { deductStockForOrder } = await import("../src/lib/stock");

  // ── 1. 99Food ──────────────────────────────────────────────────────────────
  console.log("── 99Food ──");
  const chega = async (orderId: string) => {
    const req = new NextRequest("http://localhost/api/99food/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "orderNew", app_shop_id: "shop99", order: { order_id: orderId } }),
    });
    await POST(req);
    await espera();
    return db.pedidos[db.pedidos.length - 1];
  };

  const aceito = await chega("99-1");
  confere("pedido do 99 com aceite automático nasce ACEITO", aceito?.status, "ACEITO");
  confere("…e já baixa a ficha da Esfiha Frango (2 × 30 g, movimento SALE)", baixas(aceito.id), { frango: 60 });

  aceitaSozinho = false;
  const novo = await chega("99-2");
  confere("nascendo NOVO não baixa (a baixa vem no aceite do lojista)", [novo?.status, baixas(novo.id)], ["NOVO", {}]);

  await deductStockForOrder(aceito.id);
  confere("baixa de novo no mesmo pedido não dobra", baixas(aceito.id), { frango: 60 });

  // ── 2. Pizza da Wabiz ──────────────────────────────────────────────────────
  console.log("\n── Pizza da Wabiz ──");
  const pedido = (id: string, source: string, item: any) => {
    db.pedidos.push({ id, franchiseeId: LOJA, status: "ACEITO", source, cancelledAt: null, items: [{ id: `${id}-i`, quantity: 1, comboSelections: null, ...item }] });
    return id;
  };

  const inteira = pedido("w1", "WABIZ", {
    productName: "Pizza Calabresa | Guaraná Mineiro 1,5l", menuProductId: "wabiz-nik-1",
    comboSelections: JSON.stringify([{ id: "x", name: "Guaraná Mineiro 1,5l", quantity: 1, price: 0 }]),
  });
  await deductStockForOrder(inteira);
  confere("\"Pizza Calabresa | Guaraná Mineiro 1,5l\" baixa a ficha da Calabresa", baixas(inteira), { calab: 200, mus: 250 });

  const semEspelho = pedido("w2", "WABIZ", { productName: "Pizza Calabresa | Guaraná Mineiro 1,5l", menuProductId: null });
  await deductStockForOrder(semEspelho);
  confere("…também pelo nome do item, sem o produto-espelho", baixas(semEspelho), { calab: 200, mus: 250 });

  const meia = pedido("w3", "WABIZ", { productName: "Pizza 1/2 Calabresa + 1/2 Portuguesa | Borda Catupiry", menuProductId: "wabiz-nik-1+2" });
  await deductStockForOrder(meia);
  confere("\"Pizza 1/2 Calabresa + 1/2 Portuguesa | Borda Catupiry\" baixa meia ficha de cada", baixas(meia), { calab: 100, mus: 250, presunto: 75 });

  const ifood = pedido("f1", "IFOOD", { productName: "Pizza Calabresa", menuProductId: "ifood-pz" });
  await deductStockForOrder(ifood);
  confere("iFood não muda: \"Pizza Calabresa\" sem produto de mesmo nome segue sem baixa", baixas(ifood), {});

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
