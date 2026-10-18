/**
 * Teste das escolhas na edição do pedido (lib/escolhas-na-edicao.ts): reabrir
 * o item com o que estava marcado, a troca no histórico e a busca pelo
 * adicional. Caso: Lapastine, 17/10/2026 — adicional da pizza na edição.
 * Rodar: npx tsx scripts/teste-escolhas-na-edicao.ts
 */
import {
  escolhasParaReabrir,
  escolhasEmTexto,
  descricaoDaTroca,
  planoDaTroca,
  opcaoQueCasa,
} from "../src/lib/escolhas-na-edicao";
import { edicoesDosItens } from "../src/lib/historico-do-pedido";
import { precoUnitarioDoItem } from "../src/lib/preco-combo";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const opcao = (name: string, additionalPrice = 0) => ({ additionalPrice, menuProduct: { name } });
const pizza = {
  price: 43,
  comboGroups: [
    { id: "g-borda", title: "Borda", minQty: 0, maxQty: 1, items: [opcao("Catupiry", 8), opcao("Cheddar", 8)] },
    { id: "g-extra", title: "Adicionais", minQty: 0, maxQty: 3, items: [opcao("Bacon extra", 6), opcao("Porção de batata", 15), opcao("Coca-Cola 2L", 14)] },
  ],
};

// ── Reabrir ─────────────────────────────────────────────────────────────
confere("formato do cardápio volta igual", escolhasParaReabrir(pizza as any, { "g-borda": { Catupiry: 1 } }), { "g-borda": { Catupiry: 1 } });
confere(
  "id de grupo velho reancora pelo nome",
  escolhasParaReabrir(pizza as any, { "velho-1": { "Bacon extra": 2 } }),
  { "g-extra": { "Bacon extra": 2 } }
);
confere(
  "lista do PDV vai para a pergunta que tem a opção",
  escolhasParaReabrir(pizza as any, [{ name: "Cheddar", quantity: 1 }, { name: "Coca-Cola 2L", quantity: 1 }] as any),
  { "g-borda": { Cheddar: 1 }, "g-extra": { "Coca-Cola 2L": 1 } }
);
confere("opção que saiu do cardápio fica de fora", escolhasParaReabrir(pizza as any, { "g-extra": { Azeitona: 1 } }), {});
confere("texto JSON também lê", escolhasParaReabrir(pizza as any, JSON.stringify({ "g-borda": { Catupiry: 1 } })), { "g-borda": { Catupiry: 1 } });
const duasPerguntas = {
  price: 10,
  comboGroups: [
    { id: "a", items: [opcao("Bacon")] },
    { id: "b", items: [opcao("Bacon")] },
  ],
};
confere("nome em duas perguntas sem grupo não chuta", escolhasParaReabrir(duasPerguntas as any, [{ name: "Bacon", quantity: 1 }] as any), {});
confere("sem escolha gravada", escolhasParaReabrir(pizza as any, null), {});

// ── Preço do remontado: a régua de sempre ──────────────────────────────
const remontada = { "g-borda": { Catupiry: 1 }, "g-extra": { "Bacon extra": 1 } };
confere("pizza 43 + borda 8 + bacon 6", precoUnitarioDoItem(pizza as any, remontada), 57);

// ── Histórico da troca ─────────────────────────────────────────────────
const parte = descricaoDaTroca(1, "PIZZA GUAJARÁ", { "g-borda": { Catupiry: 1 } }, remontada);
confere("texto da troca", parte, "✎1x PIZZA GUAJARÁ (antes: Catupiry; agora: Catupiry / Bacon extra)");
confere("vírgula no nome não quebra a parte", escolhasEmTexto({ g: { "Calabresa, cebola": 2 } }), "Calabresa cebola x2");
const quando = "2026-10-17T22:00:00.000Z";
const { marcasDe, removidos } = edicoesDosItens([
  { quando, quem: "Phabio", acao: "ESCOLHAS", descricao: `${parte}, +1x Coca 2L`, totalAntes: 86, totalDepois: 100 },
]);
confere(
  "comanda marca a pizza como escolhas trocadas",
  marcasDe("PIZZA GUAJARÁ").map((m) => [m.tipo, (m as any).antes, (m as any).depois]),
  [["ESCOLHAS", "Catupiry", "Catupiry / Bacon extra"]]
);
confere("o resto da linha continua lido", marcasDe("Coca 2L").map((m) => m.tipo), ["ACRESCENTADO"]);
confere("troca não vira item removido", removidos, []);
confere("sem escolhas antes", descricaoDaTroca(2, "X-Tudo", null, { g: { Ovo: 1 } }), "✎2x X-Tudo (antes: sem escolhas; agora: Ovo)");

// ── Quantas unidades ganham as escolhas novas ──────────────────────────
confere("todas: troca no lugar", planoDaTroca({ id: "i", quantity: 2 }, 2), { tipo: "NO_LUGAR", itemId: "i", quantidade: 2 });
confere("uma das duas: separa", planoDaTroca({ id: "i", quantity: 2 }, 1), { tipo: "SEPARA", itemId: "i", ficam: 1, remontadas: 1 });
confere("mais unidades: no lugar com a quantidade nova", planoDaTroca({ id: "i", quantity: 1 }, 3), { tipo: "NO_LUGAR", itemId: "i", quantidade: 3 });
confere("zero não vale", planoDaTroca({ id: "i", quantity: 2 }, 0), null);
confere("texto não vale", planoDaTroca({ id: "i", quantity: 2 }, "x"), null);

// ── Busca pelo adicional ───────────────────────────────────────────────
confere("'bacon' acha o adicional da pizza", opcaoQueCasa(pizza as any, "bacon"), "Bacon extra");
confere("sem acento: 'porcao'", opcaoQueCasa(pizza as any, "porcao"), "Porção de batata");
confere("'coca' acha o refri da pergunta", opcaoQueCasa(pizza as any, "COCA"), "Coca-Cola 2L");
confere("uma letra não busca", opcaoQueCasa(pizza as any, "b"), null);
confere("produto sem pergunta", opcaoQueCasa({ comboGroups: [] }, "bacon"), null);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
