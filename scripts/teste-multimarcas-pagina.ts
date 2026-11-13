/**
 * As regras da página do Multimarcas: config limpa (lib/multimarcas/pagina.ts), o filtro do cardápio por
 * marca (no-cardapio.ts), a marca na comanda (itens.ts) e a nota por marca (carga.ts).
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-multimarcas-pagina.ts
 */
import assert from "node:assert/strict";
import { limparConfig, marcaDaCategoria, mapaDeCategorias } from "../src/lib/multimarcas/pagina";
import { categoriaEntraNaMarca, marcasNoCardapio, siglaDaMarca } from "../src/lib/multimarcas/no-cardapio";
import { itensComMarca } from "../src/lib/multimarcas/itens";
import { emPromocao, notasPorMarca } from "../src/lib/multimarcas/carga";
import { corParaTexto, textoSobreCor } from "../src/lib/multimarcas/vitrine";
import { diaDaSemanaDaLoja } from "../src/lib/cardapio-interno";

let casos = 0;
const ok = (f: () => void) => { f(); casos++; };

// ─── limparConfig ───
const suja = {
  nome: "  Rede   Trindade  ",
  cor: "vermelho",
  marcas: [
    { id: "smash", nome: "Smash da Vila", tipo: "Hambúrguer", cor: "#1f1f23", logo: "javascript:alert(1)", capa: "/uploads/lojas/a.webp", categorias: ["Burguers", " burguers ", "Combos"] },
    // Mesmo id e uma categoria que já é da primeira: id muda, e a categoria fica nas duas (Lucas, 11/11).
    { id: "smash", nome: "", categorias: ["COMBOS", "Frango"], logo: "http://inseguro.com/x.png", capa: "https://cdn.exemplo.com/c.webp" },
  ],
  banners: [
    { id: "b1", titulo: "Oferta", marca: "smash", imagem: "//cdn.mal.com/x.png" },
    { id: "b2", titulo: "", imagem: null },
    { id: "b3", titulo: "Leva a marca que não existe", marca: "fantasma" },
  ],
};
const c = limparConfig(suja, "Frangoso");
ok(() => assert.equal(c.nome, "Rede Trindade"));
ok(() => assert.equal(c.cor, "#E8590C"));
ok(() => assert.equal(c.marcas.length, 2));
ok(() => assert.notEqual(c.marcas[0].id, c.marcas[1].id));
ok(() => assert.deepEqual(c.marcas[0].categorias, ["Burguers", "Combos"]));
ok(() => assert.deepEqual(c.marcas[1].categorias, ["COMBOS", "Frango"]));
ok(() => assert.equal(c.marcas[0].logo, null)); // javascript: não passa
ok(() => assert.equal(c.marcas[0].capa, "/uploads/lojas/a.webp"));
ok(() => assert.equal(c.marcas[1].logo, null)); // http não passa
ok(() => assert.equal(c.marcas[1].capa, "https://cdn.exemplo.com/c.webp"));
ok(() => assert.equal(c.marcas[1].nome, "Marca 2"));
ok(() => assert.equal(c.banners.length, 2)); // o vazio sai
ok(() => assert.equal(c.banners[0].imagem, null)); // //cdn não passa
ok(() => assert.equal(c.banners[0].marca, "smash"));
ok(() => assert.equal(c.banners[1].marca, null)); // marca inexistente vira aviso
ok(() => assert.equal(limparConfig(null, "Loja X").nome, "Loja X"));
ok(() => assert.equal(limparConfig({ marcas: Array.from({ length: 50 }, (_, i) => ({ nome: `M${i}` })) }).marcas.length, 30));

// ─── destaques e banner que abre item (Lucas, 25/10) ───
const comItens = limparConfig({
  marcas: [{ id: "smash", nome: "Smash", categorias: ["Burguers"] }],
  banners: [
    { id: "b1", titulo: "Smash em dobro", produto: "cmprod123", marca: "smash" },
    { id: "b2", titulo: "Cupom PRIMEIRA10" },
    { id: "b3", titulo: "Id ruim", produto: "<script>" },
  ],
  destaques: ["p1", "p1", "p2", 42, "x y", ...Array.from({ length: 30 }, (_, i) => `q${i}`)],
});
ok(() => assert.equal(comItens.banners[0].produto, "cmprod123"));
ok(() => assert.equal(comItens.banners[1].produto, null)); // cupom: só aviso
ok(() => assert.equal(comItens.banners[1].marca, null));
ok(() => assert.equal(comItens.banners[2].produto, null)); // id inválido não passa
ok(() => assert.deepEqual(comItens.destaques.slice(0, 3), ["p1", "p2", "q0"])); // repetido e inválido saem
ok(() => assert.equal(comItens.destaques.length, 20)); // limite
ok(() => assert.deepEqual(limparConfig(null).destaques, []));

// ─── categoria → marca ───
ok(() => assert.equal(marcaDaCategoria(c, "  BURGUERS")?.id, "smash"));
ok(() => assert.equal(marcaDaCategoria(c, "Bebidas"), null));
const comOculta = { marcas: [...c.marcas.slice(0, 1), { ...c.marcas[1], oculta: true }] };
ok(() => assert.equal(mapaDeCategorias(comOculta).has("frango"), false));
ok(() => assert.deepEqual(mapaDeCategorias(c).get("combos"), ["smash", c.marcas[1].id])); // nas duas, na ordem da página
ok(() => assert.deepEqual(mapaDeCategorias(comOculta).get("combos"), ["smash"])); // marca escondida não conta
ok(() => assert.equal(marcaDaCategoria(c, "Combos"), null)); // de várias marcas: nenhuma "dona"
// Config gravada no formato antigo (cada categoria numa marca só) sai igual.
const antiga = { marcas: [{ id: "a", nome: "A", categorias: ["Lanches", "Bebidas"] }, { id: "b", nome: "B", categorias: ["Pizzas"] }] };
ok(() => assert.deepEqual(limparConfig(antiga).marcas.map((m) => m.categorias), [["Lanches", "Bebidas"], ["Pizzas"]]));

// ─── cardápio aberto por uma marca ───
const mm = marcasNoCardapio(c)!;
const outra = c.marcas[1].id;
ok(() => assert.equal(categoriaEntraNaMarca(mm, "smash", "Burguers"), true));
ok(() => assert.equal(categoriaEntraNaMarca(mm, "smash", "Frango"), false)); // é da outra marca
ok(() => assert.equal(categoriaEntraNaMarca(mm, outra, "Frango"), true));
ok(() => assert.equal(categoriaEntraNaMarca(mm, "smash", "Bebidas"), true)); // para acompanhar entra em todas
ok(() => assert.equal(categoriaEntraNaMarca(mm, outra, "Bebidas"), true));
ok(() => assert.equal(categoriaEntraNaMarca(mm, "smash", "Combos"), true)); // em duas marcas: entra nas duas
ok(() => assert.equal(categoriaEntraNaMarca(mm, outra, "combos "), true));
ok(() => assert.equal(categoriaEntraNaMarca({ marcas: [...mm.marcas, { ...mm.marcas[0], id: "terceira", categorias: [] }] }, "terceira", "Combos"), false)); // e só nelas
ok(() => assert.equal(marcasNoCardapio({ marcas: [{ ...c.marcas[0], oculta: true }] }), null));
ok(() => assert.equal(siglaDaMarca("Smash da Vila"), "SV"));
ok(() => assert.equal(siglaDaMarca("Braseou! Burguers na Brasa"), "BB"));

// ─── marca na comanda ───
const categoria = new Map([["p1", "Burguers"], ["p2", "Bebidas"], ["p3", "Frango"], ["p4", "Combos"]]);
const itens = [
  { menuProductId: "p2", productName: "Coca lata", quantity: 1 },
  { menuProductId: "p3", productName: "Box M", quantity: 1 },
  { menuProductId: "p1", productName: "Smash em dobro", quantity: 2 },
  { menuProductId: "p4", productName: "Combo casal", quantity: 1 },
];
// Combos está nas duas marcas: o cliente pôs o combo dentro da Smash (`marca` do item).
const marcados = itensComMarca(itens, categoria, c, [null, null, null, "smash"]);
ok(() => assert.deepEqual(marcados.map((i) => i.productName), [
  "[SMASH DA VILA] Smash em dobro", "[SMASH DA VILA] Combo casal", "[MARCA 2] Box M", "Coca lata",
]));
ok(() => assert.equal(marcados[0].quantity, 2)); // o resto do item não muda
ok(() => assert.equal(itens[2].productName, "Smash em dobro")); // não mexe no original
// Já marcado não ganha prefixo duas vezes.
ok(() => assert.equal(itensComMarca(marcados, categoria, c)[0].productName, "[SMASH DA VILA] Smash em dobro"));
// Pedido só com "para acompanhar": volta igual (mesmo array).
const soBebida = [{ menuProductId: "p2", productName: "Coca lata" }];
ok(() => assert.equal(itensComMarca(soBebida, categoria, c), soBebida));
// Item sem produto (brinde) fica no fim, sem marca.
ok(() => assert.equal(itensComMarca([{ menuProductId: null, productName: "Brinde" }, { menuProductId: "p1", productName: "Smash" }], categoria, c)[1].productName, "Brinde"));
// Categoria de duas marcas, escolhido na outra: vai com a outra.
ok(() => assert.equal(itensComMarca([{ menuProductId: "p4", productName: "Combo casal" }], categoria, c, [outra])[0].productName, "[MARCA 2] Combo casal"));
// Sem a marca (sacola antiga) ou com uma marca em que a categoria não está: fica como "para acompanhar".
ok(() => assert.equal(itensComMarca([{ menuProductId: "p4", productName: "Combo casal" }], categoria, c)[0].productName, "Combo casal"));
ok(() => assert.equal(itensComMarca([{ menuProductId: "p4", productName: "Combo casal" }], categoria, c, ["fantasma"])[0].productName, "Combo casal"));
// Categoria de uma marca só: a escolha não muda nada (vale a dona).
ok(() => assert.equal(itensComMarca([{ menuProductId: "p1", productName: "Smash" }], categoria, c, [outra])[0].productName, "[SMASH DA VILA] Smash"));

// ─── nota por marca ───
const mapa = mapaDeCategorias(c);
const notas = notasPorMarca([
  { rating: 5, categorias: ["Burguers", "Bebidas"] },
  { rating: 4, categorias: ["Burguers", "Frango", "Burguers"] }, // conta uma vez por marca
  { rating: 3, categorias: ["Frango"] },
  { rating: 1, categorias: ["Bebidas"] }, // só bebida: não é de marca nenhuma
], mapa);
ok(() => assert.deepEqual(notas.get("smash"), { media: 4.5, total: 2 }));
ok(() => assert.deepEqual(notas.get(outra), { media: 3.5, total: 2 }));
ok(() => assert.equal(notas.size, 2));
// Categoria em duas marcas conta para as duas.
const notasCombo = notasPorMarca([{ rating: 5, categorias: ["Combos"] }], mapa);
ok(() => assert.deepEqual([notasCombo.get("smash")?.total, notasCombo.get(outra)?.total], [1, 1]));

// ─── cor livre e contraste (Lucas, 11/11: o amarelo da marca) ───
ok(() => assert.equal(limparConfig({ cor: "#ffc800" }).cor, "#FFC800"));
ok(() => assert.equal(textoSobreCor("#FFC800"), "#1F1F23")); // amarelo: texto escuro
ok(() => assert.equal(textoSobreCor("#E8590C"), "#FFFFFF")); // o laranja de sempre continua branco
ok(() => assert.equal(textoSobreCor("#1F1F23"), "#FFFFFF"));
ok(() => assert.equal(corParaTexto("#1864AB"), "#1864AB")); // cor escura já se lê: não muda
ok(() => assert.notEqual(corParaTexto("#FFC800"), "#FFC800")); // amarelo como texto escurece
ok(() => assert.equal(textoSobreCor(corParaTexto("#FFC800")), "#FFFFFF")); // ...até dar contraste com o branco

// ─── home de app de delivery: atalhos e foto do cartão (Lucas, 13/11) ───
const home = limparConfig({
  marcas: [{ id: "smash", nome: "Smash", fundo: "/uploads/lojas/f.webp" }, { id: "frango", nome: "Frango", fundo: "javascript:x" }],
  atalhos: [
    { id: "a1", nome: "  Lanches  ", marcas: ["smash", "fantasma", "smash", "frango"] },
    { id: "a1", nome: "Porções", marcas: "frango" },
    { id: "a3", nome: "", marcas: ["smash"] },
  ],
});
ok(() => assert.equal(home.marcas[0].fundo, "/uploads/lojas/f.webp"));
ok(() => assert.equal(home.marcas[1].fundo, null)); // javascript: não passa
ok(() => assert.equal(home.atalhos.length, 2)); // sem nome some
ok(() => assert.equal(home.atalhos[0].nome, "Lanches"));
ok(() => assert.deepEqual(home.atalhos[0].marcas, ["smash", "frango"])); // marca que não existe sai, repetida conta uma vez
ok(() => assert.notEqual(home.atalhos[0].id, home.atalhos[1].id));
ok(() => assert.deepEqual(home.atalhos[1].marcas, []));
// Config antiga, sem nada disso: sem atalhos e sem foto (a página fica como era).
ok(() => assert.deepEqual(c.atalhos, []));
ok(() => assert.equal(c.marcas[0].fundo, null));

// ─── promoções do dia: a regra do botão Ofertas do cardápio ───
ok(() => assert.equal(emPromocao({ name: "Smash", price: 20, precoDe: 25 }), true));
ok(() => assert.equal(emPromocao({ name: "Smash", price: 20 }), false));
ok(() => assert.equal(emPromocao({ name: "Smash", price: 20, precoDe: 25, esgotado: true }), false));
ok(() => assert.equal(emPromocao({ name: "Pizza", price: 30, comboGroups: [{ items: [{ adicionalDe: 10 }] }] }), true));
ok(() => assert.equal(emPromocao({ name: "Combo", price: 30, tags: "Promoção" }), true));
ok(() => assert.equal(emPromocao({ name: "Batata", price: 10, category: "Promoções" }), true));
// Fora do dia (só domingo) não entra, mesmo com preço promocional.
// O dia de depois de amanhã: nunca é hoje, nem com a madrugada contando como ontem.
const diaQueNaoE = diaDaSemanaDaLoja("America/Sao_Paulo", new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
ok(() => assert.equal(emPromocao({ name: "Smash", price: 20, precoDe: 25, availableDays: [diaQueNaoE] }, "America/Sao_Paulo"), false));

console.log(`✅ teste-multimarcas-pagina: ${casos} casos ok`);
