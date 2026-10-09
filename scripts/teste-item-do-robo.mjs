/**
 * Prova de que o item que o robô anota chega inteiro à cozinha (lib/item-do-robo.ts).
 *
 *   node scripts/teste-item-do-robo.mjs
 *
 * O defeito: sabor, tamanho, adicional e observação eram perguntados pelo robô e
 * descartados na gravação — a comanda saía só com o nome do produto.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/item-do-robo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { escolhasDoItem, trocoEObservacaoDoPedido, chaveDeNome } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const igual = (nome, obtido, esperado) => conferir(nome, JSON.stringify(obtido) === JSON.stringify(esperado), { obtido, esperado });

// O Nugget da Hakim: base R$ 0,00, o valor mora nas opções (incidente de 01/08/2026).
const nugget = {
  name: "Nugget",
  comboGroups: [{ id: "g_tamanho", title: "Tamanho", items: [
    { additionalPrice: 9.9, menuProduct: { name: "6 unidades" } },
    { additionalPrice: 19.9, menuProduct: { name: "15 unidades" } },
  ] }],
};
const pizza = {
  name: "Pizza Grande",
  comboGroups: [
    { id: "g_sabor", items: [{ additionalPrice: 0, menuProduct: { name: "Calabresa" } }, { additionalPrice: 5, menuProduct: { name: "Portuguesa" } }] },
    { id: "g_extra", items: [{ additionalPrice: 4, menuProduct: { name: "Bacon" } }, { additionalPrice: 8, menuProduct: { name: "Borda Recheada" } }] },
  ],
};

console.log("\n1) A escolha chega à cozinha");
const n = escolhasDoItem({ name: "nugget", options: ["15 unidades"] }, nugget);
igual("comboSelections no formato do cardápio", n.comboSelections, { g_tamanho: { "15 unidades": 1 } });
igual("soma das opções = 19,90", n.somaDasOpcoes, 19.9);
igual("productName leva a escolha", n.productName, "Nugget (15 unidades)");
igual("sem observação → notes nulo", n.notes, null);

console.log("\n2) Casa pelo nome do CADASTRO, sem acento nem caixa");
const p = escolhasDoItem({ options: ["portuguesa", "BACON", { name: "borda recheada" }] }, pizza);
igual("três opções, dois grupos", p.comboSelections, { g_sabor: { Portuguesa: 1 }, g_extra: { Bacon: 1, "Borda Recheada": 1 } });
igual("soma 5 + 4 + 8", p.somaDasOpcoes, 17);
igual("nome com as três", p.productName, "Pizza Grande (Portuguesa, Bacon, Borda Recheada)");

console.log("\n3) Opção repetida é quantidade");
const b = escolhasDoItem({ options: ["Bacon", "bacon"] }, pizza);
igual("2x Bacon", b.comboSelections, { g_extra: { Bacon: 2 } });
igual("cobrado duas vezes", b.somaDasOpcoes, 8);
igual("nome resume a quantidade", b.productName, "Pizza Grande (Bacon x2)");

console.log("\n3b) Quantidade dentro da opção: o combo de 10 esfirras não vira 1x de cada");
// A Hakim vende esfirra em combo: o cliente escolhe QUANTAS de cada sabor.
const esfirra = {
  name: "Combo 10 Esfirras",
  comboGroups: [{ id: "g_sabores", title: "Sabores", items: [
    { additionalPrice: 2.5, menuProduct: { name: "Esfirra de Queijo" } },
    { additionalPrice: 3, menuProduct: { name: "Esfirra de Calabresa" } },
  ] }],
};
const e1 = escolhasDoItem({ options: ["6x Esfirra de Queijo", "4x Esfirra de Calabresa"] }, esfirra);
igual("texto com 6x/4x", e1.comboSelections, { g_sabores: { "Esfirra de Queijo": 6, "Esfirra de Calabresa": 4 } });
igual("soma 6x2,50 + 4x3,00", e1.somaDasOpcoes, 27);
igual("nome resume", e1.productName, "Combo 10 Esfirras (Esfirra de Queijo x6, Esfirra de Calabresa x4)");
igual("nada de 'não está no cadastro'", e1.naoCasadas, []);
const e2 = escolhasDoItem({ options: [{ name: "Esfirra de Queijo", quantity: 6 }, { name: "Esfirra de Calabresa", qtd: 4 }] }, esfirra);
igual("objeto com quantity/qtd", e2.comboSelections, { g_sabores: { "Esfirra de Queijo": 6, "Esfirra de Calabresa": 4 } });
igual("mesma soma", e2.somaDasOpcoes, 27);
const e3 = escolhasDoItem({ options: ["Esfirra de Queijo x2", "Esfirra de Queijo (x3)", "2 × Esfirra de Calabresa"] }, esfirra);
igual("sufixo, parêntese e ×", e3.comboSelections, { g_sabores: { "Esfirra de Queijo": 5, "Esfirra de Calabresa": 2 } });
const e4 = escolhasDoItem({ options: ["50x Esfirra de Queijo"] }, esfirra);
igual("quantidade absurda é limitada a 30", e4.comboSelections, { g_sabores: { "Esfirra de Queijo": 30 } });
// Nome do cadastro que começa com número continua casando inteiro.
const n6 = escolhasDoItem({ options: ["6 unidades"] }, nugget);
igual("'6 unidades' é o nome, não 6 unidades da opção", n6.comboSelections, { g_tamanho: { "6 unidades": 1 } });
igual("cobrado uma vez", n6.somaDasOpcoes, 9.9);
const n2x = escolhasDoItem({ options: ["2x 6 unidades"] }, nugget);
igual("'2x 6 unidades' são duas", n2x.comboSelections, { g_tamanho: { "6 unidades": 2 } });
igual("cobradas as duas", n2x.somaDasOpcoes, 19.8);
const naoExiste = escolhasDoItem({ options: ["3x Esfirra de Chocolate"] }, esfirra);
igual("quantidade no que não existe: vai para conferência com o texto original", naoExiste.naoCasadas, ["3x Esfirra de Chocolate"]);
igual("e não é cobrada", naoExiste.somaDasOpcoes, 0);

console.log("\n4) O que não existe no cadastro não é cobrado — e não some");
const x = escolhasDoItem({ options: ["Calabresa", "cheddar extra"], notes: "  sem   cebola " }, pizza);
igual("só a que existe entra", x.comboSelections, { g_sabor: { Calabresa: 1 } });
igual("não cobra a inexistente", x.somaDasOpcoes, 0);
igual("lista a não casada", x.naoCasadas, ["cheddar extra"]);
igual("observação do cliente + aviso para a loja", x.notes, "sem cebola · pediu: cheddar extra (conferir — não está no cadastro)");
igual("nome só com o que casou", x.productName, "Pizza Grande (Calabresa)");

console.log("\n4b) Meio a meio escrito com '1/2' (Deeds, 02/10/2026, pedido #21)");
const grande = {
  name: "Pizza Grande 8 Pedaços - 2 Sabores",
  comboGroups: [
    { id: "g_sabores", items: [
      { additionalPrice: 39.9, menuProduct: { name: "Pizza Tradicional Calabresa" } },
      { additionalPrice: 41.9, menuProduct: { name: "Pizza Tradicional Calabresa Paulista" } },
      { additionalPrice: 45.9, menuProduct: { name: "Pizza Premium Dois Queijos" } },
      { additionalPrice: 47.9, menuProduct: { name: "Pizza Premium Calacheese LANÇAMENTO!" } },
    ] },
    { id: "g_broto", items: [{ additionalPrice: 19.9, menuProduct: { name: "BROTO BRIGADEIRO" } }] },
  ],
};
const d21 = escolhasDoItem({ options: ["1/2 Pizza Premium Dois Queijos", "1/2 Pizza Premium Calacheese LANÇAMENTO!", "BROTO BRIGADEIRO"], notes: "Dois queijos sem orégano" }, grande);
igual("os dois sabores e o broto casam", d21.comboSelections, { g_sabores: { "Pizza Premium Dois Queijos": 1, "Pizza Premium Calacheese LANÇAMENTO!": 1 }, g_broto: { "BROTO BRIGADEIRO": 1 } });
igual("nada para conferir", d21.naoCasadas, []);
igual("a observação do cliente fica", d21.notes, "Dois queijos sem orégano");
igual("'½', 'meia' e 'metade de' também", escolhasDoItem({ options: ["½ Pizza Premium Dois Queijos", "meia Pizza Premium Calacheese LANÇAMENTO!"] }, grande).comboSelections,
  { g_sabores: { "Pizza Premium Dois Queijos": 1, "Pizza Premium Calacheese LANÇAMENTO!": 1 } });
igual("'metade de' + nome curto que só UMA opção contém", escolhasDoItem({ options: ["metade de Calacheese", "1/2 dois queijos"] }, grande).comboSelections,
  { g_sabores: { "Pizza Premium Calacheese LANÇAMENTO!": 1, "Pizza Premium Dois Queijos": 1 } });
igual("nome curto com a versão simples e a composta: fica a simples", escolhasDoItem({ options: ["1/2 Calabresa"] }, grande).comboSelections, { g_sabores: { "Pizza Tradicional Calabresa": 1 } });

console.log("\n4c) O modelo pula a palavra do meio do sabor (Deeds, 08/10/2026, pedido #21)");
const deeds = {
  name: "Pizza Grande 8 Pedaços - 2 Sabores",
  comboGroups: [
    { id: "g_sabores", title: "Escolha os 2 sabores", minQty: 2, maxQty: 2, items: [
      { additionalPrice: 41.9, menuProduct: { name: "Pizza Tradicional Calabresa" } },
      { additionalPrice: 41.9, menuProduct: { name: "Pizza Tradicional Calabresa Paulista" } },
      { additionalPrice: 41.9, menuProduct: { name: "Pizza Tradicional Calabresa Argentina" } },
      { additionalPrice: 43.9, menuProduct: { name: "Pizza Tradicional Frango I" } },
      { additionalPrice: 45.9, menuProduct: { name: "Pizza Premium Frango Especial" } },
      { additionalPrice: 45.9, menuProduct: { name: "Pizza Premium Portuguesa" } },
      { additionalPrice: 47.9, menuProduct: { name: "Pizza Premium Portuguesa com Catupiry" } },
      { additionalPrice: 41.9, menuProduct: { name: "Pizza Tradicional Brócolis" } },
      { additionalPrice: 45.9, menuProduct: { name: "Pizza Premium Brócolis 2" } },
    ] },
    { id: "g_borda", title: "Borda", minQty: 0, maxQty: 1, items: [{ additionalPrice: 11.99, menuProduct: { name: "Borda de Catupiry Pizza Grande" } }] },
  ],
};
const d0810 = escolhasDoItem({ options: ["1/2 Pizza Frango I", "1/2 Pizza Calabresa"] }, deeds);
igual("'Pizza Frango I' e 'Pizza Calabresa' casam com as Tradicionais", d0810.comboSelections, { g_sabores: { "Pizza Tradicional Frango I": 1, "Pizza Tradicional Calabresa": 1 } });
igual("nada para conferir", d0810.naoCasadas, []);
igual("nenhuma pergunta obrigatória incompleta", d0810.grupoIncompleto, null);
igual("pedido #9 de 06/10: 'Portuguesa' e 'Calabresa'", escolhasDoItem({ options: ["1/2 Portuguesa", "1/2 Calabresa"] }, deeds).comboSelections,
  { g_sabores: { "Pizza Premium Portuguesa": 1, "Pizza Tradicional Calabresa": 1 } });
igual("'Brócolis' com Brócolis e Brócolis 2: a simples", escolhasDoItem({ options: ["brocolis"] }, deeds).comboSelections, { g_sabores: { "Pizza Tradicional Brócolis": 1 } });
igual("'Portuguesa com Catupiry' inteira casa com a composta", escolhasDoItem({ options: ["1/2 portuguesa com catupiry"] }, deeds).comboSelections, { g_sabores: { "Pizza Premium Portuguesa com Catupiry": 1 } });
const empate = escolhasDoItem({ options: ["1/2 Frango", "1/2 Calabresa"] }, deeds);
igual("'Frango' entre Frango I e Frango Especial (mesmo tamanho) não adivinha", empate.naoCasadas, ["1/2 Frango"]);
igual("…e a pergunta dos 2 sabores fica incompleta: a loja confere", empate.grupoIncompleto, "Escolha os 2 sabores");
igual("palavra que não existe em sabor nenhum", escolhasDoItem({ options: ["1/2 Pizza Frango Tropical"] }, deeds).naoCasadas, ["1/2 Pizza Frango Tropical"]);
igual("borda não casada não deixa a pergunta OPCIONAL incompleta", escolhasDoItem({ options: ["1/2 Pizza Frango I", "1/2 Pizza Calabresa", "borda de cheddar"] }, deeds).grupoIncompleto, null);
igual("sem opção nenhuma não é 'incompleta' (piso de sempre)", escolhasDoItem({ options: [] }, deeds).grupoIncompleto, null);

console.log("\n5) Bordas");
igual("options ausente", escolhasDoItem({ name: "Pizza" }, pizza).comboSelections, null);
igual("options não-array", escolhasDoItem({ options: "calabresa" }, pizza).comboSelections, null);
igual("produto sem grupos", escolhasDoItem({ options: ["gelo"] }, { name: "Coca 2L" }).productName, "Coca 2L");
igual("produto sem grupos: opção vira observação", escolhasDoItem({ options: ["gelo"] }, { name: "Coca 2L" }).notes, "pediu: gelo (conferir — não está no cadastro)");
igual("item nulo", escolhasDoItem(null, pizza).productName, "Pizza Grande");
igual("apelido 'observation' vale como notes", escolhasDoItem({ observation: "bem passado" }, pizza).notes, "bem passado");
conferir("observação cortada em 500", escolhasDoItem({ notes: "a".repeat(900) }, pizza).notes.length === 500);
igual("chaveDeNome", chaveDeNome("  Pão-de-Açúcar 2L "), "pao de acucar 2l");

console.log("\n6) Troco e observação do pedido");
igual("troco para 50 em pedido de 38, dinheiro", trocoEObservacaoDoPedido({ changeFor: 50, paymentMethod: "Dinheiro", total: 38 }).changeAmount, 50);
igual("'R$ 100,00' como texto", trocoEObservacaoDoPedido({ changeFor: "R$ 100,00", paymentMethod: "dinheiro", total: 38 }).changeAmount, 100);
igual("troco em pedido no cartão é ruído", trocoEObservacaoDoPedido({ changeFor: 50, paymentMethod: "Cartão", total: 38 }).changeAmount, null);
igual("nota menor que o total não é troco", trocoEObservacaoDoPedido({ changeFor: 20, paymentMethod: "Dinheiro", total: 38 }).changeAmount, null);
igual("valor absurdo é recusado", trocoEObservacaoDoPedido({ changeFor: 999999, paymentMethod: "Dinheiro", total: 38 }).changeAmount, null);
igual("sem troco", trocoEObservacaoDoPedido({ paymentMethod: "Dinheiro", total: 38 }).changeAmount, null);
igual("observação limpa e cortada", trocoEObservacaoDoPedido({ observation: "  portão   azul ", total: 1 }).observacao, "portão azul");
igual("sem observação", trocoEObservacaoDoPedido({ total: 1 }).observacao, null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
