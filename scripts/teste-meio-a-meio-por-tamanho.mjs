/**
 * Teste da meia pizza que custa conforme o tamanho (lib/meio-a-meio.ts +
 * `precoPorEscolha` em lib/preco-combo.ts). Serpa Pizzaria, 27/09/2026.
 *
 *   node --experimental-strip-types scripts/teste-meio-a-meio-por-tamanho.mjs
 */
import { precoUnitarioDoItem, precoMinimoDoProduto, pisoDoPreco, precoVariaPorEscolha, precoDaOpcaoNaTela, adicionaisDetalhados } from "../src/lib/preco-combo.ts";
import { meiaNaPizza, TITULO_DO_MEIO, regraDoTitulo } from "../src/lib/meio-a-meio.ts";

let ok = 0;
let falhou = 0;
function igual(nome, obtido, esperado) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) ok++;
  else {
    falhou++;
    console.log(`✖ ${nome}\n    esperado ${JSON.stringify(esperado)}\n    obtido   ${JSON.stringify(obtido)}`);
  }
}

const tamanho = (g) => ({ id: "tam", title: "Tamanho", minQty: 1, maxQty: 1, items: [
  { additionalPrice: 0, menuProduct: { name: "Pequena" } },
  { additionalPrice: g, menuProduct: { name: "Grande" } },
] });
const borda = { id: "borda", title: "Borda recheada", minQty: 0, maxQty: 1, items: [
  { additionalPrice: 8, menuProduct: { name: "Borda de Cheddar" } },
] };
const calabresa = { id: "cal", name: "Calabresa", price: 40, comboGroups: [tamanho(20), borda] };
const camarao = { id: "cam", name: "Camarão", price: 50, comboGroups: [tamanho(40), borda] };
const margueritha = { id: "mar", name: "Margueritha", price: 40, comboGroups: [tamanho(10), borda] };

// ── A conta da meia ──
const meiaCam = meiaNaPizza(calabresa, camarao, "media");
igual("meia Camarão na Calabresa", meiaCam, {
  nome: "1/2 Camarão", additionalPrice: 5, precoPorEscolha: { Pequena: 5, Grande: 15 },
  optionNote: "Pequena R$ 45,00 · Grande R$ 75,00",
});
const meiaMar = meiaNaPizza(calabresa, margueritha, "media");
igual("meia mais barata desconta só no Grande", meiaMar.precoPorEscolha, { Pequena: 0, Grande: -5 });
igual("maior: Camarão na Calabresa", meiaNaPizza(calabresa, camarao, "maior").precoPorEscolha, { Pequena: 10, Grande: 30 });
igual("maior: Calabresa no Camarão não desconta", meiaNaPizza(camarao, calabresa, "maior").precoPorEscolha, { Pequena: 0, Grande: 0 });
igual("sem tamanho = acréscimo fixo", meiaNaPizza({ name: "A", price: 60 }, { name: "B", price: 80 }, "media"),
  { nome: "1/2 B", additionalPrice: 10, precoPorEscolha: null, optionNote: "Meio a meio sai por R$ 70,00" });
igual("regra lida do título (média)", regraDoTitulo(TITULO_DO_MEIO.media), "media");
igual("regra lida do título (maior)", regraDoTitulo(TITULO_DO_MEIO.maior), "maior");
igual("título antigo da Ragnar = média", regraDoTitulo("Meio a meio? Escolha a outra metade — deixe em branco para pizza inteira"), "media");

// ── O motor cobrando ──
const meio = { id: "meio", title: TITULO_DO_MEIO.media, minQty: 0, maxQty: 1, items: [
  { ...meiaCam, menuProduct: { name: meiaCam.nome } },
  { ...meiaMar, menuProduct: { name: meiaMar.nome } },
] };
const pizza = { price: 40, comboGroups: [tamanho(20), meio, borda] };

igual("cardápio: P + meia Camarão", precoUnitarioDoItem(pizza, { tam: { Pequena: 1 }, meio: { "1/2 Camarão": 1 } }), 45);
igual("cardápio: G + meia Camarão", precoUnitarioDoItem(pizza, { tam: { Grande: 1 }, meio: { "1/2 Camarão": 1 } }), 75);
igual("cardápio: G + meia Camarão + borda", precoUnitarioDoItem(pizza, { tam: { Grande: 1 }, meio: { "1/2 Camarão": 1 }, borda: { "Borda de Cheddar": 1 } }), 83);
igual("cardápio: G + meia Margueritha", precoUnitarioDoItem(pizza, { tam: { Grande: 1 }, meio: { "1/2 Margueritha": 1 } }), 55);
igual("cardápio: G inteira", precoUnitarioDoItem(pizza, { tam: { Grande: 1 } }), 60);
// Balcão e mesa mandam a lista sem grupo.
igual("mesa (lista): G + meia Camarão", precoUnitarioDoItem(pizza, [{ name: "Grande", quantity: 1 }, { name: "1/2 Camarão", quantity: 1 }]), 75);
igual("mesa (lista): P + meia Camarão", precoUnitarioDoItem(pizza, [{ name: "Pequena", quantity: 1 }, { name: "1/2 Camarão", quantity: 1 }]), 45);
// Sem tamanho escolhido (não deveria acontecer: é obrigatório) vale o additionalPrice.
igual("sem tamanho: vale o additionalPrice", precoUnitarioDoItem(pizza, { meio: { "1/2 Camarão": 1 } }), 45);
// Tabela vinda do banco como texto.
igual("tabela em texto", precoDaOpcaoNaTela({ additionalPrice: 5, precoPorEscolha: '{"Grande":15}' }, { tam: { Grande: 1 } }), 15);
igual("tela: preço da meia muda com o tamanho",
  [precoDaOpcaoNaTela(meio.items[0], { tam: { Pequena: 1 } }), precoDaOpcaoNaTela(meio.items[0], { tam: { Grande: 1 } })], [5, 15]);
// O detalhe da comanda soma o total.
const det = adicionaisDetalhados(pizza, { tam: { Grande: 1 }, meio: { "1/2 Camarão": 1 } });
igual("comanda: detalhe", det.map((d) => [d.nome, d.precoUnitario]), [["Grande", 20], ["1/2 Camarão", 15]]);

// ── Vitrine e piso ──
igual("a partir de = Pequena inteira", precoMinimoDoProduto(pizza), 40);
igual("piso ≤ menor preço válido (P + meia Marg. = 40)", pisoDoPreco(pizza) <= 40, true);
igual("piso conta o desconto do Grande", pisoDoPreco(pizza), 35);
igual("preço varia por escolha", precoVariaPorEscolha({ price: 40, comboGroups: [{ items: [{ additionalPrice: 0, precoPorEscolha: { Grande: 3 } }] }] }), true);

console.log(`${ok} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
