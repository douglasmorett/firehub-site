/**
 * Pizza meio a meio: cada sabor baixa e custa a sua parte (lib/metade-da-pizza.ts,
 * lib/stock.ts, lib/financeiro/custo-pela-ficha.ts).
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" npx tsx scripts/teste-metade-da-pizza.ts
 *
 * NIK, 16/10/2026: a pizza "Calabresa" tem o grupo "Meio a meio? Escolha a
 * outra metade" (regra SOMA) com os outros sabores, e cada sabor tem a ficha
 * da pizza inteira (massa, caixa, queijo). A meia calabresa / meia frango
 * baixava duas massas e o recheio dos dois sabores inteiro.
 */
export {};

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  // Objeto compara pelas chaves em ordem: a ordem de gravação não importa.
  const txt = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  const ok = txt(obtido) === txt(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ── Banco em memória (o mesmo molde de teste-baixa-com-insumo-repetido.ts) ──
const LOJA = "nik";
const insumo = (id: string, name: string, unit: string) => ({ id, name, unit, quantity: 1000, franchiseeId: LOJA });
const db = {
  insumos: [
    insumo("massa", "RECEITA MASSA PIZZA", "un"), insumo("caixa", "CAIXA DE PIZZA", "un"),
    insumo("mus", "MUÇARELA", "kg"), insumo("cal", "CALABRESA", "kg"), insumo("fra", "FRANGO PRONTO", "kg"),
    insumo("guar", "GUARANÁ 1,5L", "un"),
  ],
  transacoes: [] as any[],
  produtos: [] as any[],
  opcoes: [] as any[],
  pedido: null as any,
};
const ficha = (...linhas: [string, number][]) =>
  linhas.map(([stockItemId, quantityConsumed]) => ({ stockItemId, quantityConsumed, stockItem: db.insumos.find((i) => i.id === stockItemId)! }));
const produto = (id: string, name: string, recipeItems: any[], isCombo = false) => ({ id, name, active: true, isCombo, franchiseeId: LOJA, recipeItems });
db.produtos = [
  produto("calabresa", "Calabresa", ficha(["massa", 1], ["caixa", 1], ["mus", 0.25], ["cal", 0.3])),
  produto("frango", "Frango Especial", ficha(["massa", 1], ["caixa", 1], ["mus", 0.25], ["fra", 0.3])),
  produto("adic-mus", "Adicional Muçarela", ficha(["mus", 0.25])),
  produto("esf-cal", "Esfiha Calabresa", ficha(["cal", 0.05])),
  // Combo: só a caixa e o guaraná na ficha; o sabor vem dos grupos.
  produto("combo", "Pizza Tradicional + Guaraná", ficha(["caixa", 1], ["guar", 1]), true),
  produto("sab-cal", "Calabresa Sabor", ficha(["massa", 1], ["mus", 0.25], ["cal", 0.3])),
  produto("sab-fra", "Frango Sabor", ficha(["massa", 1], ["mus", 0.25], ["fra", 0.3])),
];
const p = (id: string) => db.produtos.find((x) => x.id === id)!;
const opcao = (grupo: string, titulo: string, dono: string, prod: string, priceRule: string | null = null) => ({
  id: `${grupo}-${prod}`, comboGroupId: grupo, menuProductId: prod,
  comboGroup: { menuProductId: dono, priceRule, title: titulo },
  menuProduct: { name: p(prod).name, recipeItems: p(prod).recipeItems },
});
const META = "Meio a meio? Escolha a outra metade — deixe em branco para pizza inteira";
db.opcoes = [
  opcao("gm-cal", META, "calabresa", "frango"),
  opcao("ga-cal", "Adicionais", "calabresa", "adic-mus"),
  opcao("gs-combo", "Escolha o sabor", "combo", "sab-cal"), opcao("gs-combo", "Escolha o sabor", "combo", "sab-fra"),
  opcao("gm-combo", "Meio a meio? Escolha o 2º sabor (opcional)", "combo", "sab-cal"), opcao("gm-combo", "Meio a meio? Escolha o 2º sabor (opcional)", "combo", "sab-fra"),
];

const casaNome = (pr: any, where: any) =>
  (!where.name || pr.name.toLowerCase() === String(where.name.equals).toLowerCase()) &&
  (where.active === undefined || pr.active === where.active) &&
  (where.isCombo === undefined || pr.isCombo === where.isCombo) &&
  (!where.franchiseeId || pr.franchiseeId === where.franchiseeId) &&
  (!where.recipeItems || pr.recipeItems.length > 0) &&
  (!where.comboGroups || db.opcoes.some((o) => o.comboGroup.menuProductId === pr.id)) &&
  (!where.NOT?.id?.startsWith || !pr.id.startsWith(where.NOT.id.startsWith));

const prismaFalso: any = {
  customerOrder: { findUnique: async ({ where }: any) => (db.pedido?.id === where.id ? db.pedido : null) },
  stockTransaction: {
    findFirst: async ({ where }: any) => db.transacoes.find((t) => t.type === where.type && t.notes.includes(where.notes.contains)) ?? null,
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
    findFirst: async ({ where }: any) => db.produtos.find((x) => casaNome(x, where)) ?? null,
    findMany: async ({ where }: any) => db.produtos.filter((x) => casaNome(x, where)),
  },
  $transaction: async (fn: any) => fn(prismaFalso),
};
(globalThis as any).prisma = prismaFalso;
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("../src/lib/pausa-pelo-estoque-no-banco", { avisarMovimentoDeEstoque: () => {} });

const item = (menuProductId: string, quantity: number, comboSelections: unknown = null, productName?: string) => {
  const menuProduct = db.produtos.find((x) => x.id === menuProductId) ?? null;
  return { menuProductId, productName: productName ?? menuProduct?.name, quantity, comboSelections, menuProduct };
};
let n = 0;
async function baixa(items: any[]) {
  const id = `p${++n}`;
  db.pedido = { id, franchiseeId: LOJA, status: "ACEITO", cancelledAt: null, items };
  db.transacoes = [];
  const { deductStockForOrder } = await import("../src/lib/stock");
  await deductStockForOrder(id);
  return Object.fromEntries(db.transacoes.map((t) => [t.stockItemId, r3(t.quantity)]).sort());
}

async function main() {
  const { fracaoDoNome, fatoresDasMetades, ehGrupoDeMetade } = await import("../src/lib/metade-da-pizza");
  const { normalizarEscolhasDoCombo, acharOpcaoDoCombo, indexarOpcoes } = await import("../src/lib/stock");
  const { consumoDoItem, custoDoItem, montarCatalogo } = await import("../src/lib/financeiro/custo-pela-ficha");

  // ── Regras puras ──
  confere("fração do nome", fracaoDoNome("1/2 Calabresa"), { nome: "Calabresa", fracao: 0.5 });
  confere("sem fração", fracaoDoNome("5 Queijos"), { nome: "5 Queijos", fracao: null });
  confere("título da NIK é grupo de metade", [ehGrupoDeMetade(META), ehGrupoDeMetade("Meio a meio? Escolha o 2º sabor (opcional)"), ehGrupoDeMetade("Escolha o sabor"), ehGrupoDeMetade("Adicionais")], [true, true, false, false]);
  const grupos = [
    { id: "gm", titulo: META, produtos: ["frango", "muc"] },
    { id: "ga", titulo: "Adicionais", produtos: ["adic"] },
  ];
  confere("pizza + outra metade: ½ e ½", fatoresDasMetades({ grupos, escolhas: [{ produtoId: "frango", qtd: 1 }], temFichaPropria: true }), { fatores: [0.5], fatorDaFicha: 0.5 });
  confere("adicional não divide", fatoresDasMetades({ grupos, escolhas: [{ produtoId: "adic", qtd: 1 }], temFichaPropria: true }), { fatores: [1], fatorDaFicha: 1 });
  confere("metade + adicional", fatoresDasMetades({ grupos, escolhas: [{ produtoId: "frango", qtd: 1 }, { produtoId: "adic", qtd: 1 }], temFichaPropria: true }), { fatores: [0.5, 1], fatorDaFicha: 0.5 });
  confere("MAIOR segue qtd ÷ total", fatoresDasMetades({ grupos: [{ id: "gx", regra: "MAIOR", produtos: ["a", "b"] }], escolhas: [{ produtoId: "a", qtd: 1 }, { produtoId: "b", qtd: 1 }], temFichaPropria: false }), { fatores: [0.5, 0.5], fatorDaFicha: 1 });
  confere("1/2 do iFood vale pela fração", fatoresDasMetades({ grupos: [], escolhas: [{ produtoId: "a", qtd: 1, fracao: 0.5 }, { produtoId: "b", qtd: 1, fracao: 0.5 }], temFichaPropria: false }), { fatores: [0.5, 0.5], fatorDaFicha: 1 });

  // ── "1/2 Calabresa" não casa com a Esfiha Calabresa pelo fim do nome ──
  const ind = indexarOpcoes([opcao("x", "Sabores", "c", "esf-cal") as any]);
  confere("\"1/2 Calabresa\" não vira Esfiha Calabresa", normalizarEscolhasDoCombo([{ name: "1/2 Calabresa", quantity: 1 }]).map((e) => acharOpcaoDoCombo(ind, e)?.menuProductId ?? null), [null]);
  confere("\"Calabresa\" inteiro segue casando pelo fim (regra antiga)", normalizarEscolhasDoCombo([{ name: "Calabresa", quantity: 1 }]).map((e) => acharOpcaoDoCombo(ind, e)?.menuProductId ?? null), ["esf-cal"]);
  const ind2 = indexarOpcoes([opcao("gm-cal", META, "calabresa", "frango") as any]);
  confere("PDV: \"Pizza Frango Especial\" casa com a opção \"Frango Especial\"", normalizarEscolhasDoCombo([{ name: "Pizza Frango Especial", quantity: 1 }]).map((e) => acharOpcaoDoCombo(ind2, e)?.menuProductId ?? null), ["frango"]);

  // ── A baixa de verdade (deductStockForOrder) ──
  confere("pizza inteira: igual a antes", await baixa([item("calabresa", 1)]), { cal: -0.3, caixa: -1, massa: -1, mus: -0.25 });
  confere("½ calabresa + ½ frango (grupo da NIK): uma massa, uma caixa, metade de cada recheio",
    await baixa([item("calabresa", 1, [{ name: "Frango Especial", quantity: 1 }])]),
    { cal: -0.15, caixa: -1, fra: -0.15, massa: -1, mus: -0.25 });
  confere("meia a meia do site ({grupo: {nome: qtd}}) + adicional inteiro",
    await baixa([item("calabresa", 2, { "gm-cal": { "Frango Especial": 1 }, "ga-cal": { "Adicional Muçarela": 1 } })]),
    { cal: -0.3, caixa: -2, fra: -0.3, massa: -2, mus: -1 });
  confere("combo: \"Escolha o sabor\" + \"2º sabor\" dividem; caixa e guaraná do combo inteiros",
    await baixa([item("combo", 1, [{ name: "Calabresa Sabor", quantity: 1 }, { name: "Frango Sabor", quantity: 1 }])]),
    { cal: -0.15, caixa: -1, fra: -0.15, guar: -1, massa: -1, mus: -0.25 });
  confere("combo com um sabor só: inteiro",
    await baixa([item("combo", 1, [{ name: "Calabresa Sabor", quantity: 1 }])]),
    { cal: -0.3, caixa: -1, guar: -1, massa: -1, mus: -0.25 });

  // ── O CMV pela ficha faz a mesma conta ──
  const cat = montarCatalogo(db.produtos.map((x) => ({
    id: x.id, nome: x.name, ativo: true, custo: null, combo: x.isCombo,
    ficha: x.recipeItems.map((r: any) => ({ insumoId: r.stockItemId, nome: r.stockItem.name, quantidade: r.quantityConsumed })),
    grupos: [...new Set(db.opcoes.filter((o) => o.comboGroup.menuProductId === x.id).map((o) => o.comboGroupId))].map((g) => {
      const os = db.opcoes.filter((o) => o.comboGroupId === g);
      return { id: g, titulo: os[0].comboGroup.title, regra: os[0].comboGroup.priceRule, opcoes: os.map((o) => ({ id: o.id, produtoId: o.menuProductId })) };
    }),
  })));
  const consumo = (it: any) => Object.fromEntries([...consumoDoItem(it, cat).insumos].map(([k, v]) => [k, r3(v)]).sort());
  confere("consumo pela ficha: ½ + ½", consumo({ produtoId: "calabresa", nome: "Calabresa", quantidade: 1, preco: 60, escolhas: [{ name: "Frango Especial", quantity: 1 }] }),
    { cal: 0.15, caixa: 1, fra: 0.15, massa: 1, mus: 0.25 });
  const custo = custoDoItem({ produtoId: "calabresa", nome: "Calabresa", quantidade: 1, preco: 60, escolhas: [{ name: "Frango Especial", quantity: 1 }] }, cat,
    () => ({ custo: 10, faltando: [], foraDoCmv: false }));
  confere("custo pela ficha: ½ + ½ (R$ 10 por unidade de insumo)", custo.custo, r3(10 * (0.15 + 1 + 0.15 + 1 + 0.25)));

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}
main();
