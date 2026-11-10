import assert from "node:assert/strict";
import Module from "node:module";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { basesDeComplementos, opcoesDaBase } from "../src/lib/bases-de-complementos";
import { tituloNormalizado } from "../src/lib/copiar-pergunta";

const opcao = (id: string, valor = 4) => ({ id: `link-${id}`, menuProductId: id, additionalPrice: valor, additionalPriceSalao: null, additionalPriceDelivery: 5, additionalPriceTotem: null, promoAdditionalPrice: 0, maxPerItem: 2, optionNote: "Sem troca", precoPorEscolha: null, sortOrder: 0 });
const grupo = (id: string, min = 0, max = 2) => ({ id, title: "Turbinar", minQty: min, maxQty: max, priceRule: null, sortOrder: 0, items: [{ ...opcao("bacon"), id: `bacon-${id}` }, { ...opcao("molho", 2), id: `molho-${id}`, sortOrder: 1 }] });
let produtos: any[] = [];
let tenant = "loja-A", falhar = false, gravacoes = 0;
function reset() { produtos = [...Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, franchiseeId: "loja-A", name: `Lanche ${i}`, active: true, isCombo: false, category: "Lanches", comboGroups: [grupo(`g${i}`, i % 2, i % 2 ? 3 : 2)] })), { id: "novo", name: "Novo lanche", franchiseeId: "loja-A", active: true, isCombo: false, category: "Lanches", comboGroups: [] }, { id: "bacon", name: "Bacon", franchiseeId: "loja-A", apenasEmCombo: true, comboGroups: [] }, { id: "molho", name: "Molho", franchiseeId: "loja-A", apenasEmCombo: true, comboGroups: [] }, { id: "outro", name: "Outra loja", franchiseeId: "loja-B", comboGroups: [grupo("vizinho")] }]; gravacoes = 0; falhar = false; tenant = "loja-A"; }
const grupos = () => produtos.flatMap(p => p.comboGroups.map((g: any) => ({ g, p })));
const itens = () => grupos().flatMap(({ g }) => g.items.map((i: any) => ({ i, g })));
const db: any = {
  user: { findUnique: async () => ({ slug: "fixture" }) },
  menuProduct: { findMany: async ({ where }: any) => structuredClone(produtos.filter(p => p.franchiseeId === where.franchiseeId)) },
  comboGroup: {
    findUnique: async ({ where }: any) => { const v = grupos().find(v => v.g.id === where.id); return v ? { ...structuredClone(v.g), menuProduct: { franchiseeId: v.p.franchiseeId } } : null; },
    update: async ({ where, data }: any) => { if (falhar && ++gravacoes === 3) throw new Error("falha simulada"); Object.assign(grupos().find(v => v.g.id === where.id)!.g, data); },
    delete: async ({ where }: any) => { if (falhar && ++gravacoes === 3) throw new Error("falha simulada"); const v = grupos().find(v => v.g.id === where.id)!; v.p.comboGroups = v.p.comboGroups.filter((g: any) => g.id !== where.id); },
    create: async ({ data }: any) => { const { items, ...g } = data; produtos.find(p => p.id === data.menuProductId).comboGroups.push({ ...g, id: `nova-${data.menuProductId}`, items: items.create.map((i: any, n: number) => ({ ...i, id: `novo-link-${n}` })) }); },
  },
  comboGroupItem: {
    findMany: async ({ where }: any) => structuredClone(grupos().find(v => v.g.id === where.comboGroupId)?.g.items || []),
    deleteMany: async ({ where }: any) => { const g = grupos().find(v => v.g.id === where.comboGroupId)!.g; g.items = g.items.filter((i: any) => where.menuProductId.notIn.includes(i.menuProductId)); },
    update: async ({ where, data }: any) => { const v = itens().find(v => v.i.id === where.id)!; Object.assign(v.i, data); },
    create: async ({ data }: any) => { grupos().find(v => v.g.id === data.comboGroupId)!.g.items.push({ ...data, id: `adicionado-${data.menuProductId}` }); },
  },
  $transaction: async (fn: any, config: any) => { assert.equal(config.isolationLevel, "Serializable"); const antes = structuredClone(produtos); try { return await fn(db); } catch (e) { produtos = antes; throw e; } },
};
const carregar = (Module as any)._load;
(Module as any)._load = function(id: string, ...args: any[]) {
  if (id === "@/lib/prisma") return { prisma: db };
  if (id === "@/lib/escopo-do-cardapio") return { resolveScope: async () => ({ scope: { storeId: tenant }, error: null }), canTouch: (s: any, id: string) => s.storeId === id };
  if (id === "@/lib/meio-a-meio-no-banco") return { refazerMeiasDaLoja: async () => {} };
  if (id === "next/cache") return { revalidatePath: () => {} };
  return carregar.call(this, id, ...args);
};

async function main() {
  const { POST, DELETE } = await import("../src/app/api/admin/menu-products/base-de-complementos/route");
  const enviar = (body: any) => POST(new Request("http://fixture.local/api/admin/menu-products/base-de-complementos", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) as any);
  const excluir = (body: any) => DELETE(new Request("http://fixture.local/api/admin/menu-products/base-de-complementos", { method: "DELETE", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) as any);
  reset();
  const base = basesDeComplementos(produtos).find(b => b.membros.length === 16)!;
  assert.equal(base.membros.length, 16, "mesmos IDs e preços, regras por produto diferentes: uma base");
  assert.equal(basesDeComplementos([{ ...produtos[0], comboGroups: [grupo("g"), { ...grupo("g-diferente"), items: [opcao("bacon", 0)] }] }]).length, 2, "nome igual não junta opções/valores diferentes");
  const payload = { grupoId: "g0", revisao: base.revisao, titulo: "Turbinar", produtoIds: base.membros.map(m => m.produto.id), opcoes: opcoesDaBase(base.membros[0].grupo) };
  const antesRegras = produtos.slice(0, 16).map(p => [p.comboGroups[0].minQty, p.comboGroups[0].maxQty]);
  const r = await enviar({ ...payload, opcoes: payload.opcoes.map(i => ({ ...i, additionalPrice: i.menuProductId === "bacon" ? 6 : i.additionalPrice })) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(produtos.slice(0, 16).filter(p => p.comboGroups[0].items[0].additionalPrice === 6).length, 16);
  assert.deepEqual(produtos.slice(0, 16).map(p => [p.comboGroups[0].minQty, p.comboGroups[0].maxQty]), antesRegras);
  assert.equal(produtos[0].comboGroups[0].items[0].promoAdditionalPrice, 0);
  assert.equal(produtos[0].comboGroups[0].items[0].additionalPriceDelivery, 5);
  assert.equal(produtos.at(-1).comboGroups[0].items[0].additionalPrice, 4, "outra loja intacta");
  assert.equal((await enviar(payload)).status, 409, "edição antiga é recusada após primeiro salvamento");
  reset();
  const check = await enviar({ ...payload, produtoIds: [...payload.produtoIds.filter(id => id !== "p1"), "novo"], regras: [{ produtoId: "p0", minQty: 2, maxQty: 3 }] });
  assert.equal(check.status, 200, await check.clone().text());
  assert.equal(produtos.find(p => p.id === "p1").comboGroups.length, 0);
  assert.equal(produtos.find(p => p.id === "novo").comboGroups.length, 1);
  assert.equal(produtos[0].comboGroups[0].minQty, 2);
  assert.equal(produtos[2].comboGroups[0].minQty, 0, "regras dos outros produtos preservadas");
  reset();
  const original = JSON.stringify(produtos);
  assert.equal((await enviar({ ...payload, produtoIds: ["outro"] })).status, 409);
  assert.equal(JSON.stringify(produtos), original);
  tenant = "loja-B"; assert.equal((await enviar(payload)).status, 403); tenant = "loja-A";
  assert.equal((await enviar({ ...payload, opcoes: [{ ...payload.opcoes[0], additionalPrice: -1 }] })).status, 400);
  assert.equal((await enviar({ ...payload, opcoes: [{ ...payload.opcoes[0], additionalPrice: "inválido" }] })).status, 400);
  assert.equal((await enviar({ ...payload, regras: [{ produtoId: "p0", minQty: 4, maxQty: 2 }] })).status, 409);
  falhar = true; assert.equal((await enviar(payload)).status, 500);
  assert.equal(JSON.stringify(produtos), original, "falha no terceiro produto reverte toda a operação");
  reset();
  const apagar = { grupoId: "g0", revisao: base.revisao, confirmarExclusao: true };
  assert.equal((await excluir({ ...apagar, confirmarExclusao: false })).status, 400);
  assert.equal(JSON.stringify(produtos), original, "sem confirmação explícita não exclui");
  tenant = "loja-B"; assert.equal((await excluir(apagar)).status, 403); tenant = "loja-A";
  assert.equal((await excluir({ ...apagar, revisao: "antiga" })).status, 409);
  assert.equal(JSON.stringify(produtos), original);
  falhar = true; assert.equal((await excluir(apagar)).status, 500);
  assert.equal(JSON.stringify(produtos), original, "falha no terceiro delete reverte todos os vínculos");
  reset();
  const cadastroAntes = produtos.map(({ comboGroups, ...p }) => p);
  const deletada = await excluir(apagar); assert.equal(deletada.status, 200, await deletada.clone().text());
  assert.equal((await deletada.json()).produtosAfetados, 16);
  assert.equal(produtos.filter(p => p.franchiseeId === "loja-A").flatMap(p => p.comboGroups).length, 0);
  assert.equal(produtos.at(-1).comboGroups.length, 1, "grupo de outra loja preservado");
  assert.deepEqual(produtos.map(({ comboGroups, ...p }) => p), cadastroAntes, "todos os produtos e opções preservados");
  reset();
  produtos.find(p => p.id === "novo").comboGroups = [{ ...grupo("isolado"), items: [opcao("bacon")] }];
  const isolada = basesDeComplementos(produtos).find(b => b.membros.some(m => m.grupo.id === "isolado"))!;
  assert.equal((await excluir({ grupoId: "isolado", revisao: isolada.revisao, confirmarExclusao: true })).status, 200);
  assert.equal(produtos.find(p => p.id === "novo").comboGroups.length, 0);
  assert.equal(produtos.slice(0, 16).filter(p => p.comboGroups.length === 1).length, 16, "versão dos outros produtos não é excluída");
  assert.equal((await enviar({ ...payload, produtoIds: [...payload.produtoIds, "novo"] })).status, 200, "depois de excluir a versão isolada pode usar a outra base");
  assert.equal(produtos.find(p => p.id === "novo").comboGroups[0].items.length, 2);
  reset();
  if (process.env.CATALOGO_SNAPSHOT) {
    const s = JSON.parse(fs.readFileSync(process.env.CATALOGO_SNAPSHOT, "utf8")).tables;
    const catalogo = s.MenuProduct.map((p: any) => ({ ...p, comboGroups: s.ComboGroup.filter((g: any) => g.menuProductId === p.id).map((g: any) => ({ ...g, items: s.ComboGroupItem.filter((i: any) => i.comboGroupId === g.id) })) }));
    const turbinar = basesDeComplementos(catalogo).filter(b => tituloNormalizado(b.titulo).includes("turbinar"));
    assert.equal(turbinar.length, 1); assert.equal(turbinar[0].membros.length, 16);
    console.log("PASS snapshot RO: Turbinar16 produtos em uma base, sem DML");
  }
  const { default: Painel, Editor } = await import("../src/components/admin/GruposDeComplementos");
  const props = { produtos, catalogo: produtos, busca: "", categoria: "TODAS", onCriar() {}, onEditarProduto() {}, onEditarOpcao() {}, onFeito() {} };
  const cards = renderToStaticMarkup(React.createElement(Painel, props));
  assert.equal((cards.match(/<h4[^>]*>🧩 Turbinar/g) || []).length, 2, "uma base por loja, não 17 cards");
  const editor = renderToStaticMarkup(React.createElement(Editor, { base, produtos, catalogo: produtos, onFechar() {}, onEditarOpcao() {}, onFeito() {} }));
  assert.equal((editor.match(/type="checkbox" checked/g) || []).length, 16);
  assert.match(editor, /Excluir grupo/); assert.doesNotMatch(editor, /Confirmar exclusão do grupo/, "exclusão tem uma segunda etapa");
  fs.mkdirSync("work", { recursive: true });
  fs.writeFileSync("work/preview-bases.html", `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px Arial;background:#f6f8fa;padding:20px}*{box-sizing:border-box}</style>${cards}${editor}`);
  console.log("PASS bases: edição16, regras, vínculos, preços, tenant, drift, rollback, exclusão confirmada/preservação de opções, excluir uma versão e usar outra, SSR");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
