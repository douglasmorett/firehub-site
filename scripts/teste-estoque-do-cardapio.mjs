/**
 * Teste da conta do estoque disponível (src/lib/estoque-do-cardapio.ts).
 *
 *   node --experimental-strip-types scripts/teste-estoque-do-cardapio.mjs
 */
import {
  calcularEstoque,
  controlaEstoque,
  esgotado,
  faltasDoPedido,
  mensagemDasFaltas,
  somarPorProduto,
} from "../src/lib/estoque-do-cardapio.ts";

/** O restante de cada produto, no formato antigo do teste: [[id, restam]]. */
const resto = (produtos, vendas) => new Map([...calcularEstoque(produtos, vendas)].map(([id, e]) => [id, e.restam]));

let ok = 0;
let falhou = 0;
function igual(nome, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) ok++;
  else {
    falhou++;
    console.log(`✖ ${nome}\n    esperado ${b}\n    obtido   ${a}`);
  }
}

const reposto = "2026-09-24T18:00:00Z";
const antes = "2026-09-24T17:59:59Z";
const depois = "2026-09-24T19:00:00Z";
const costela = { id: "costela", name: "Costela Suprema", estoqueQtd: 12, estoqueDesde: reposto };
const xbacon = { id: "xbacon", name: "X-Bacon", estoqueQtd: 3, estoqueDesde: reposto };
const livre = { id: "livre", name: "X-Salada", estoqueQtd: null, estoqueDesde: null };

// ── quem controla
igual("nulo não controla", controlaEstoque(livre), false);
igual("zero controla (esgotado de propósito)", controlaEstoque({ estoqueQtd: 0 }), true);
igual("negativo não controla", controlaEstoque({ estoqueQtd: -1 }), false);
igual("undefined não controla", controlaEstoque({}), false);

// ── restante
let r = resto([costela, xbacon, livre], []);
igual("sem venda, resta o informado", [...r], [["costela", 12], ["xbacon", 3]]);
igual("sem controle fica fora do mapa", r.has("livre"), false);

r = resto([costela], [
  { menuProductId: "costela", quantity: 2, criadoEm: depois },
  { menuProductId: "costela", quantity: 1, criadoEm: depois },
]);
igual("duas vendas descontam 3", r.get("costela"), 9);

r = resto([costela], [{ menuProductId: "costela", quantity: 5, criadoEm: antes }]);
igual("venda de antes da reposição não conta", r.get("costela"), 12);

r = resto([costela], [{ menuProductId: "costela", quantity: 1, criadoEm: reposto }]);
igual("venda no mesmo instante da reposição conta", r.get("costela"), 11);

r = resto([xbacon], [
  { menuProductId: "xbacon", quantity: 2, criadoEm: depois },
  { menuProductId: "xbacon", quantity: 2, criadoEm: depois },
]);
igual("vendeu mais que o estoque: fica 0, não −1", r.get("xbacon"), 0);
igual("e está esgotado", esgotado("xbacon", calcularEstoque([xbacon], [{ menuProductId: "xbacon", quantity: 3, criadoEm: depois }])), true);
igual("produto sem controle nunca esgota", esgotado("livre", calcularEstoque([livre], [])), false);

// ── "zerou, pausar?" = NÃO
const semPausa = { ...xbacon, estoquePausar: false };
const e0 = calcularEstoque([semPausa], [{ menuProductId: "xbacon", quantity: 5, criadoEm: depois }]);
igual("não pausar: o número abate até zero", e0.get("xbacon"), { restam: 0, pausaAoZerar: false });
igual("não pausar: zerado não fecha o item", esgotado("xbacon", e0), false);
igual("não pausar: pedido acima do restante passa", faltasDoPedido(new Map([["xbacon", 9]]), e0), []);
igual("pausar nulo conta como SIM", calcularEstoque([{ ...xbacon, estoquePausar: null }], []).get("xbacon").pausaAoZerar, true);

r = resto([costela], [{ menuProductId: "outro", quantity: 9, criadoEm: depois }]);
igual("venda de outro produto não mexe", r.get("costela"), 12);

r = resto([{ id: "p", estoqueQtd: 4, estoqueDesde: null }], [{ menuProductId: "p", quantity: 1, criadoEm: antes }]);
igual("sem data de reposição conta tudo", r.get("p"), 3);

r = resto([costela], [{ menuProductId: "costela", quantity: "2", criadoEm: depois }, { menuProductId: null, quantity: 3, criadoEm: depois }]);
igual("quantidade em texto e item sem produto", r.get("costela"), 10);

// ── pedido
const pedido = somarPorProduto([
  { menuProductId: "xbacon", quantity: 2 },
  { menuProductId: "xbacon", quantity: 2 },
  { menuProductId: "livre", quantity: 9 },
  { menuProductId: null, quantity: 1 },
  { menuProductId: "costela", quantity: 0 },
]);
igual("mesmo produto em duas linhas soma", [...pedido], [["xbacon", 4], ["livre", 9]]);

const restantes = new Map([["xbacon", { restam: 3, pausaAoZerar: true }], ["costela", { restam: 0, pausaAoZerar: true }]]);
const nomes = new Map([["xbacon", "X-Bacon"], ["costela", "Costela Suprema"]]);
let faltas = faltasDoPedido(pedido, restantes, nomes);
igual("2 + 2 com 3 na prateleira falta", faltas, [{ menuProductId: "xbacon", nome: "X-Bacon", pedido: 4, restam: 3 }]);
igual("produto sem controle nunca falta", faltas.some((f) => f.menuProductId === "livre"), false);
igual("exatamente o que resta passa", faltasDoPedido(new Map([["xbacon", 3]]), restantes, nomes), []);
igual("esgotado com pausa fecha", esgotado("costela", restantes), true);

faltas = faltasDoPedido(new Map([["costela", 1], ["xbacon", 4]]), restantes, nomes);
igual(
  "mensagem",
  mensagemDasFaltas(faltas),
  "Costela Suprema esgotou. Só restam 3 de X-Bacon (você pediu 4)."
);
igual(
  "mensagem no singular",
  mensagemDasFaltas([{ menuProductId: "x", nome: "Pudim", pedido: 2, restam: 1 }]),
  "Só resta 1 de Pudim (você pediu 2)."
);

console.log(`\n${ok} ok, ${falhou} falha(s)`);
process.exit(falhou ? 1 : 0);
