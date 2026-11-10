import assert from "node:assert/strict";
import Module from "node:module";
import { NextResponse } from "next/server";
import { quantidadeDeItensNaComposicao as quantidade } from "../src/lib/combo-e-pergunta";
import { precoUnitarioDoItem } from "../src/lib/preco-combo";

const item = (id: string, adicional = 0) => ({ id, additionalPrice: adicional });
const grupo = (id: string, ids: string[], min = 1, max = min) => ({ id, title: "Escolha", minQty: min, maxQty: max, items: ids.map(id => item(id)) });
const catalogo = [
  { id: "burger", name: "Burger", franchiseeId: "A", isCombo: false, apenasEmCombo: false },
  { id: "outro-burger", name: "Outro Burger", franchiseeId: "A", isCombo: false, apenasEmCombo: false },
  { id: "refri", name: "Refri", franchiseeId: "A", isCombo: false, apenasEmCombo: false },
  { id: "bacon", name: "Bacon", franchiseeId: "A", isCombo: false, apenasEmCombo: true },
  { id: "sabor", name: "Sabor", franchiseeId: "A", isCombo: false, apenasEmCombo: true },
  { id: "vizinho", name: "Outra loja", franchiseeId: "B", isCombo: false, apenasEmCombo: false },
];
const adicionais = [{ ...grupo("a", ["bacon"], 0, 10), items: [item("bacon", 3)] }];
const composto = [grupo("lanche", ["burger", "outro-burger"]), grupo("bebida", ["refri"])];
assert.equal(quantidade(adicionais, catalogo), 0);
assert.equal(quantidade([grupo("sabores", ["sabor"], 2)], catalogo), 0);
assert.equal(quantidade([grupo("opcional", ["refri"], 0, 10)], catalogo), 0);
assert.equal(quantidade([grupo("um", ["burger"])], catalogo), 1);
assert.equal(quantidade(composto, catalogo), 2);
assert.equal(quantidade([grupo("fixo", ["burger"], 4)], catalogo), 4);
assert.equal(quantidade([grupo("ausente", ["nao-existe"], 4)], catalogo), 0);

let produtos: any[], writes = 0;
function reset() {
  produtos = structuredClone(catalogo).map(p => ({ ...p, price: 10, category: "Cardápio", recipeItems: [], comboGroups: [] }));
  produtos.push({ id: "normal", franchiseeId: "A", name: "Nome com Combo + Kit", price: 20, isCombo: false, comboGroups: structuredClone(adicionais), recipeItems: [] });
  produtos.push({ id: "legado", franchiseeId: "A", name: "Pacote legado legítimo", price: 40, isCombo: true, comboGroups: [grupo("sabores", ["sabor"], 2)], recipeItems: [] });
  writes = 0;
}
const filtrar = (where: any = {}) => produtos.filter(p =>
  (!where.franchiseeId || p.franchiseeId === where.franchiseeId) &&
  (!where.id?.in || where.id.in.includes(p.id)) && (!where.id?.not || p.id !== where.id.not));
const db: any = {
  $transaction: async (operacoes: any[]) => Promise.all(operacoes),
  menuProduct: {
    findMany: async ({ where }: any) => structuredClone(filtrar(where)),
    findUnique: async ({ where }: any) => structuredClone(produtos.find(p => p.id === where.id) || null),
    findFirst: async ({ where }: any) => structuredClone(produtos.find(p => p.id === where.id && p.franchiseeId === where.franchiseeId) || null),
    create: async ({ data }: any) => { writes++; const p = { ...structuredClone(data), id: `novo-${writes}`, isCombo: data.isCombo ?? false, comboGroups: data.comboGroups?.create?.map((g: any, k: number) => ({ ...g, id: `grupo-${writes}-${k}`, items: g.items.create })) || [] }; produtos.push(p); return structuredClone(p); },
    update: async ({ where, data }: any) => { writes++; const p = produtos.find(p => p.id === where.id); Object.assign(p, structuredClone(data)); return structuredClone(p); },
    updateMany: async () => ({ count: 0 }),
  },
  user: { findUnique: async () => ({ slug: "fixture" }) },
  comboGroup: {
    deleteMany: async ({ where }: any) => { produtos.find(p => p.id === where.menuProductId).comboGroups = []; },
    create: async ({ data }: any) => { const g = { ...data, items: data.items.create }; produtos.find(p => p.id === data.menuProductId).comboGroups.push(g); return g; },
  },
};
const carregar = (Module as any)._load;
(Module as any)._load = function(id: string, ...args: any[]) {
  if (id === "@/lib/prisma") return { prisma: db };
  if (id === "@/lib/escopo-do-cardapio") return { resolveScope: async () => ({ scope: { storeId: "A", isAdmin: false } }), canTouch: (_s: any, loja: string) => loja === "A" };
  if (id === "next/server") return { NextResponse, after: () => {} };
  if (id === "next/cache") return { revalidatePath: () => {} };
  if (id === "@/lib/storage") return { isDataUrl: () => false };
  if (id === "@/lib/espelho-de-integracao") return { proximoCodigoPDV: async () => 1 };
  if (id === "@/lib/cardapio-da-loja") return {};
  if (id === "@/lib/meio-a-meio-no-banco") return { refazerMeiasDaLoja: async () => {} };
  if (id === "@/lib/pausa-pelo-estoque-no-banco") return { esquecerPausaPeloEstoque: async () => {} };
  if (id === "@/lib/keeta/cardapio") return { avisarKeetaDaPausa: async () => {}, avisarKeetaDoCardapio: async () => {} };
  if (id === "@/lib/estoque-restante") return {};
  if (id === "@/lib/loja-ativa") return {};
  if (id === "@/lib/fuso-da-loja") return {};
  return carregar.call(this, id, ...args);
};

async function main() {
  const { POST, PUT } = await import("../src/app/api/admin/menu-products/route");
  const enviar = (fn: typeof POST, corpo: any) => fn(new Request("http://fixture.local/api/admin/menu-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }) as any);
  reset();
  let r = await enviar(POST, { name: "Combo no nome não classifica", description: "Burger", price: 20, comboGroups: adicionais });
  assert.equal(r.status, 200); assert.equal((await r.json()).isCombo, false);
  reset();
  r = await enviar(POST, { name: "Burger", price: 20, isCombo: true, comboGroups: adicionais });
  assert.equal(r.status, 400); assert.equal(writes, 0);
  r = await enviar(POST, { name: "Pizza", price: 20, isCombo: true, comboGroups: [grupo("sabores", ["sabor"], 2)] });
  assert.equal(r.status, 400); assert.equal(writes, 0);
  r = await enviar(POST, { name: "Qualquer nome", price: 30, isCombo: true, comboGroups: composto });
  assert.equal(r.status, 200); const combo = await r.json(); assert.equal(combo.isCombo, true); assert.equal(combo.comboGroups.length, 2);
  reset();
  r = await enviar(POST, { name: "Quatro burgers", price: 60, isCombo: true, comboGroups: [grupo("fixo", ["burger"], 4)] });
  assert.equal(r.status, 200); assert.equal((await r.json()).isCombo, true);
  reset();
  r = await enviar(POST, { name: "Foreign", price: 40, isCombo: true, comboGroups: [grupo("outro", ["vizinho"], 2)] });
  assert.equal(r.status, 400); assert.equal(writes, 0);
  reset();
  r = await enviar(PUT, { id: "normal", isCombo: true, comboGroups: adicionais });
  assert.equal(r.status, 400); assert.equal(writes, 0); // formulário antigo não recria o erro
  r = await enviar(PUT, { id: "normal", description: "Texto corrigido", isCombo: false, comboGroups: adicionais });
  assert.equal(r.status, 200); assert.equal((await r.json()).isCombo, false);
  const salvo = produtos.find(p => p.id === "normal");
  assert.equal(salvo.comboGroups[0].minQty, 0); assert.equal(salvo.comboGroups[0].maxQty, 10); assert.equal(salvo.comboGroups[0].items[0].additionalPrice, 3);
  const grupoPreco = [{ ...adicionais[0], items: [{ menuProductId: "bacon", additionalPrice: 3, menuProduct: { id: "bacon", name: "Bacon" } }] }];
  const escolha = { a: { Bacon: 2 } };
  assert.equal(precoUnitarioDoItem({ price: 20, comboGroups: grupoPreco } as any, escolha), 26);
  assert.equal(precoUnitarioDoItem({ price: 20, isCombo: true, comboGroups: grupoPreco } as any, escolha), precoUnitarioDoItem({ price: 20, isCombo: false, comboGroups: grupoPreco } as any, escolha));
  reset();
  r = await enviar(PUT, { id: "legado", description: "Editar sem converter representação", isCombo: true });
  assert.equal(r.status, 200); assert.equal((await r.json()).isCombo, true);
  r = await enviar(POST, { name: "Cópia do legado", price: 40, isCombo: true, comboGroups: [grupo("sabores", ["sabor"], 2)], duplicadoDe: "legado" });
  assert.equal(r.status, 200); assert.equal((await r.json()).isCombo, true);
  r = await enviar(PUT, { id: "vizinho", isCombo: true, comboGroups: composto });
  assert.equal(r.status, 403);
  console.log("PASS: composição explícita, adicionais/sabores, criação e edição reais da API, tenant, legado, duplicação, preço e prevenção de formulário antigo.");
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { (Module as any)._load = carregar; });
