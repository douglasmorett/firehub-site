/**
 * Dois itens do mesmo pedido com o mesmo insumo baixam os dois (lib/stock.ts).
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" npx tsx scripts/teste-baixa-com-insumo-repetido.ts
 *
 * NIK, 06/11/2026: o balcão vendeu "Combo 1" (4 Esfiha Carne) + "Esfiha
 * Banoffe" — as duas fichas levam a RECEITA MASSA ESFIHA. A baixa gravava
 * `sale:<pedido>:<insumo>` item a item; a massa do segundo item repetia a
 * chave, o índice único dava P2002, a transação voltava INTEIRA e o pedido
 * ficava sem baixa nenhuma (113 de 115 pedidos assim em 3 dias).
 *
 * Banco em memória e a função de verdade (deductStockForOrder).
 */
export {}; // módulo: sem isto o `falhas`/`main` colidem com os outros scripts no tsc

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const LOJA = "nik";
const insumo = (id: string, name: string, unit: string) => ({ id, name, unit, quantity: 1000, franchiseeId: LOJA });
const ficha = (...linhas: [string, number][]) =>
  linhas.map(([stockItemId, quantityConsumed]) => ({ stockItemId, quantityConsumed, stockItem: db.insumos.find((i) => i.id === stockItemId)! }));

// ── Banco em memória ────────────────────────────────────────────────────────
const db = {
  insumos: [insumo("massa", "RECEITA MASSA ESFIHA", "un"), insumo("carne", "CARNE ESFIHA", "g"), insumo("banana", "BANANA NANICA", "kg")],
  transacoes: [] as any[],
  produtos: [] as any[],
  opcoes: [] as any[],
  pedido: null as any,
};
db.produtos = [
  { id: "combo1", name: "Combo 1", active: true, isCombo: true, franchiseeId: LOJA, recipeItems: [] },
  { id: "carne", name: "Esfiha Carne", active: true, isCombo: false, franchiseeId: LOJA, recipeItems: ficha(["massa", 1], ["carne", 70]) },
  { id: "banoffe", name: "Esfiha Banoffe", active: true, isCombo: false, franchiseeId: LOJA, recipeItems: ficha(["massa", 1], ["banana", 0.08]) },
];
db.opcoes = [{
  id: "gi-carne", comboGroupId: "g1", menuProductId: "carne",
  comboGroup: { menuProductId: "combo1", priceRule: null },
  menuProduct: { name: "Esfiha Carne", recipeItems: db.produtos[1].recipeItems },
}];

const casaNome = (p: any, where: any) =>
  (!where.name || p.name.toLowerCase() === String(where.name.equals).toLowerCase()) &&
  (where.active === undefined || p.active === where.active) &&
  (where.isCombo === undefined || p.isCombo === where.isCombo) &&
  (!where.franchiseeId || p.franchiseeId === where.franchiseeId) &&
  (!where.recipeItems || p.recipeItems.length > 0) &&
  (!where.comboGroups || db.opcoes.some((o) => o.comboGroup.menuProductId === p.id));

const prismaFalso: any = {
  customerOrder: {
    findUnique: async ({ where }: any) => (db.pedido?.id === where.id ? db.pedido : null),
  },
  stockTransaction: {
    findFirst: async ({ where }: any) =>
      db.transacoes.find((t) => t.type === where.type && t.notes.includes(where.notes.contains)) ?? null,
    create: async ({ data }: any) => {
      if (db.transacoes.some((t) => t.sourceRef === data.sourceRef)) throw Object.assign(new Error("unique"), { code: "P2002" });
      db.transacoes.push({ ...data });
      return data;
    },
  },
  stockItem: {
    updateMany: async ({ where, data }: any) => {
      const i = db.insumos.find((x) => x.id === where.id && x.franchiseeId === where.franchiseeId);
      if (!i) return { count: 0 };
      i.quantity -= data.quantity.decrement;
      return { count: 1 };
    },
    findUnique: async ({ where }: any) => db.insumos.find((x) => x.id === where.id) ?? null,
  },
  comboGroupItem: {
    findMany: async ({ where }: any) => {
      const donos: string[] = where.comboGroup.menuProductId.in ?? [where.comboGroup.menuProductId];
      return db.opcoes.filter((o) => donos.includes(o.comboGroup.menuProductId));
    },
  },
  menuProduct: {
    findFirst: async ({ where }: any) => db.produtos.find((p) => casaNome(p, where)) ?? null,
    findMany: async ({ where }: any) => db.produtos.filter((p) => casaNome(p, where)),
  },
  // Transação que volta atrás de verdade: é o rollback que apagava a baixa.
  $transaction: async (fn: any) => {
    const antes = { transacoes: [...db.transacoes], saldos: db.insumos.map((i) => i.quantity) };
    try {
      return await fn(prismaFalso);
    } catch (e) {
      db.transacoes = antes.transacoes;
      db.insumos.forEach((i, n) => (i.quantity = antes.saldos[n]));
      throw e;
    }
  },
};
(globalThis as any).prisma = prismaFalso;

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("../src/lib/pausa-pelo-estoque-no-banco", { avisarMovimentoDeEstoque: () => {} });

const item = (menuProductId: string, quantity: number, comboSelections: unknown = null) => {
  const menuProduct = db.produtos.find((p) => p.id === menuProductId)!;
  return { menuProductId, productName: menuProduct.name, quantity, comboSelections, menuProduct };
};
const pedido = (id: string, items: any[]) => {
  db.pedido = { id, franchiseeId: LOJA, status: "ACEITO", cancelledAt: null, items };
  db.transacoes = [];
  db.insumos.forEach((i) => (i.quantity = 1000));
};
const baixas = () =>
  Object.fromEntries(db.transacoes.map((t) => [t.stockItemId, Math.round(t.quantity * 1000) / 1000]));

async function main() {
  const { deductStockForOrder } = await import("../src/lib/stock");

  // cmw42q83v0acepk07rzj73njd — Combo 1 (4 Esfiha Carne) + Esfiha Banoffe.
  pedido("p-combo-banoffe", [item("combo1", 1, [{ name: "Esfiha Carne", quantity: 4 }]), item("banoffe", 1)]);
  await deductStockForOrder("p-combo-banoffe");
  confere("combo + esfiha com a mesma massa: baixa as duas, massa somada", baixas(), { massa: -5, carne: -280, banana: -0.08 });
  confere("uma linha por insumo no pedido", db.transacoes.map((t) => t.sourceRef).sort(),
    ["sale:p-combo-banoffe:banana", "sale:p-combo-banoffe:carne", "sale:p-combo-banoffe:massa"]);
  confere("saldo da massa", db.insumos.find((i) => i.id === "massa")!.quantity, 995);

  // cmw46byn00kvjpk07sktud2ut — duas linhas de Combo 1 no mesmo pedido.
  pedido("p-dois-combos", [item("combo1", 1, [{ name: "Esfiha Carne", quantity: 4 }]), item("combo1", 2, [{ name: "Esfiha Carne", quantity: 4 }])]);
  await deductStockForOrder("p-dois-combos");
  confere("duas linhas do mesmo combo: 12 esfihas", baixas(), { massa: -12, carne: -840 });

  // A garantia de uma vez só continua: chamar de novo não baixa outra vez.
  await deductStockForOrder("p-dois-combos");
  confere("segunda chamada não dobra", db.insumos.find((i) => i.id === "massa")!.quantity, 988);

  // Item só, como antes: nada muda.
  pedido("p-so-banoffe", [item("banoffe", 3)]);
  await deductStockForOrder("p-so-banoffe");
  confere("item único segue igual", baixas(), { massa: -3, banana: -0.24 });

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}
main();
