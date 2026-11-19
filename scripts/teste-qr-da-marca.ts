/**
 * QR da comanda e mensagem de volta pela MARCA do pedido (Multimarcas, Lucas 13/11/2026):
 * lib/multimarcas/marca-do-pedido.ts, MarcaDaPagina.lojas (pagina.ts) e o ?marca= no QR (campanha-converter.ts).
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-qr-da-marca.ts
 */
import assert from "node:assert/strict";
import { limparConfig, marcasDoQr } from "../src/lib/multimarcas/pagina";
import { linkComMarca, marcaDoPedido, textoComLinkDaMarca } from "../src/lib/multimarcas/marca-do-pedido";
import { camposDaCampanha, camposDaCampanhaSemDestino, urlDaCampanha } from "../src/lib/campanha-converter";

let casos = 0;
const ok = (f: () => void) => { f(); casos++; };

// ─── MarcaDaPagina.lojas: limpa, minúscula, uma loja numa marca só ───
const config = limparConfig({
  marcas: [
    { id: "frangoso", nome: "Frangoso", categorias: ["Frango"], lojas: ["IFOOD:B743D1F7-aaaa", "99food:5764", "loja:abc", "javascript:x", 7] },
    { id: "braseou", nome: "Braseou", categorias: ["Burguers"], lojas: ["ifood:69faa133-bbbb", "ifood:b743d1f7-aaaa"] },
    { id: "salz", nome: "Salzburg", categorias: ["Salz"], lojas: ["99food:9999"], oculta: true },
    { id: "velha", nome: "Sem lojas", categorias: [] },
  ],
});
ok(() => assert.deepEqual(config.marcas[0].lojas, ["ifood:b743d1f7-aaaa", "99food:5764"]));
ok(() => assert.deepEqual(config.marcas[1].lojas, ["ifood:69faa133-bbbb"])); // a do Frangoso não vem junto
ok(() => assert.deepEqual(config.marcas[3].lojas, [])); // config antiga, sem o campo
const marcas = marcasDoQr(config);
ok(() => assert.equal(marcas.some((m) => m.id === "salz"), false)); // escondida não leva QR

// ─── marcaDoPedido ───
ok(() => assert.equal(marcaDoPedido(marcas, { source: "IFOOD", ifoodStoreMerchant: "69FAA133-BBBB" }), "braseou"));
ok(() => assert.equal(marcaDoPedido(marcas, { source: "IFOOD", ifoodStoreMerchant: "b743d1f7-aaaa" }), "frangoso"));
ok(() => assert.equal(marcaDoPedido(marcas, { source: "99FOOD", food99AppShopId: "5764" }), "frangoso"));
ok(() => assert.equal(marcaDoPedido(marcas, { source: "99FOOD", food99ShopId: "5764" }), "frangoso"));
ok(() => assert.equal(marcaDoPedido(marcas, { source: "IFOOD", ifoodStoreMerchant: "outra-loja" }), null));
// Pedido do site: a marca no nome do item; duas marcas = nenhuma.
ok(() => assert.equal(marcaDoPedido(marcas, { source: "SITE", franchiseeId: "x", items: [{ productName: "[BRASEOU] X-Brasa" }, { productName: "Coca 2L" }] }), "braseou"));
ok(() => assert.equal(marcaDoPedido(marcas, { source: "SITE", franchiseeId: "x", items: [{ productName: "[BRASEOU] X-Brasa" }, { productName: "[FRANGOSO] Frango" }] }), null));
// Loja sem Multimarcas: sem marca, sempre.
ok(() => assert.equal(marcaDoPedido([], { source: "IFOOD", ifoodStoreMerchant: "69faa133-bbbb" }), null));

// ─── links ───
ok(() => assert.equal(linkComMarca("https://firehubfood.com.br/loja/x", "braseou"), "https://firehubfood.com.br/loja/x?marca=braseou"));
ok(() => assert.equal(linkComMarca("https://firehubfood.com.br/loja/x?cupom=A", "braseou"), "https://firehubfood.com.br/loja/x?cupom=A&marca=braseou"));
ok(() => assert.equal(linkComMarca("https://firehubfood.com.br/loja/x", null), "https://firehubfood.com.br/loja/x"));
ok(() => assert.equal(urlDaCampanha("x", "VOLTA10"), "https://firehubfood.com.br/loja/x?cupom=VOLTA10"));
ok(() => assert.equal(urlDaCampanha("x", "VOLTA10", undefined, "braseou"), "https://firehubfood.com.br/loja/x?cupom=VOLTA10&marca=braseou"));

const L = "https://firehubfood.com.br/loja/frangoso-trindade";
ok(() => assert.equal(textoComLinkDaMarca(`Volta!\n${L}`, L, "braseou"), `Volta!\n${L}?marca=braseou`));
ok(() => assert.equal(textoComLinkDaMarca(`Peça: ${L}.`, L, "braseou"), `Peça: ${L}?marca=braseou.`));
ok(() => assert.equal(textoComLinkDaMarca(`Veja ${L}/produto/1`, L, "braseou"), `Veja ${L}/produto/1`)); // link com caminho fica
ok(() => assert.equal(textoComLinkDaMarca(`Veja ${L}?cupom=A`, L, "braseou"), `Veja ${L}?cupom=A`));
ok(() => assert.equal(textoComLinkDaMarca(`Volta!\n${L}`, L, null), `Volta!\n${L}`));

// ─── a campanha na comanda ───
const loyalty = { converter: { active: true, tipo: "fixo", valor: 10, codigo: "VOLTA10", impressora: "Caixa" } };
const doBraseou = { source: "IFOOD", ifoodStoreMerchant: "69faa133-bbbb" };
ok(() => assert.equal(camposDaCampanha(doBraseou, loyalty, "x", "Caixa", false, marcas).campanha?.url, "https://firehubfood.com.br/loja/x?cupom=VOLTA10&marca=braseou"));
ok(() => assert.equal(camposDaCampanha(doBraseou, loyalty, "x", "Caixa").campanha?.url, "https://firehubfood.com.br/loja/x?cupom=VOLTA10")); // sem marcas: igual a antes
ok(() => assert.equal(camposDaCampanhaSemDestino(doBraseou, loyalty, "x", marcas).campanha?.url, "https://firehubfood.com.br/loja/x?cupom=VOLTA10&marca=braseou"));
const deOutraLoja = { source: "IFOOD", ifoodStoreMerchant: "nao-ligada" };
ok(() => assert.equal(camposDaCampanha(deOutraLoja, loyalty, "x", "Caixa", false, marcas).campanha?.url, "https://firehubfood.com.br/loja/x?cupom=VOLTA10"));

console.log(`✅ teste-qr-da-marca: ${casos} casos ok`);
