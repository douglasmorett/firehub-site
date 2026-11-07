/**
 * scripts/teste-preco-da-opcao-em-todas.ts — a pergunta "aplicar este valor em
 * todos os produtos que oferecem esta opção?" (lib/preco-da-opcao-em-todas.ts).
 *
 *   npx tsx scripts/teste-preco-da-opcao-em-todas.ts
 *
 * Caso real: Charlie Brown Pizzas, 07/11/2026 — "Borda de Catupiry" a R$ 14 no
 * produto, mas +8 no brotinho e +12 nas grandes, onde o cliente paga.
 */
import { ondeAOpcaoAparece, conferirOpcoesParaAplicar } from "../src/lib/preco-da-opcao-em-todas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

const LOJA = "charlie";
const borda = { id: "catupiry", name: "Borda de Catupiry", price: 14, franchiseeId: LOJA };
const item = (id: string, additionalPrice: number, extra: any = {}) => ({ id, menuProductId: "catupiry", menuProduct: { id: "catupiry" }, additionalPrice, ...extra });
const pizza = (id: string, name: string, itens: any[], franchiseeId = LOJA) => ({ id, name, franchiseeId, comboGroups: [{ title: "Borda?", items: itens }] });

const produtos = [
  borda,
  pizza("brotinho", "Pizza Brotinho (4 pedaços) - 1 sabor", [item("gi-broto", 8), item("gi-outra", 6, { menuProductId: "cheddar", menuProduct: { id: "cheddar" } })]),
  pizza("grande1", "Pizza Grande (8 pedaços) - 1 sabor", [item("gi-g1", 12)]),
  pizza("grande2", "Pizza Grande (8 pedaços) - 2 sabores", [item("gi-g2", 14)]),
  pizza("canal", "Pizza Média", [item("gi-canal", 10, { additionalPriceDelivery: 11 })]),
  pizza("tamanho", "Pizza Família", [item("gi-tam", 10, { precoPorEscolha: { Grande: 15 } })]),
  pizza("vizinha", "Pizza da Outra Loja", [item("gi-fora", 9)], "outra-loja"),
];

const lista = ondeAOpcaoAparece(produtos, borda, 14);
confere("lista só onde a borda aparece, na mesma loja, e cobra diferente de R$ 14",
  lista.map((o) => [o.produto, o.grupo, o.acrescimoAtual, o.bloqueio === null]),
  [
    ["Pizza Brotinho (4 pedaços) - 1 sabor", "Borda?", 8, true],
    ["Pizza Grande (8 pedaços) - 1 sabor", "Borda?", 12, true],
    ["Pizza Média", "Borda?", 10, false],
    ["Pizza Família", "Borda?", 10, false],
  ]);
confere("preço por canal fica de fora, com aviso", lista.find((o) => o.itemId === "gi-canal")?.bloqueio?.startsWith("tem preço por canal"), true);
confere("preço conforme o tamanho fica de fora, com aviso", lista.find((o) => o.itemId === "gi-tam")?.bloqueio?.startsWith("o preço muda conforme"), true);
confere("preço zero não pergunta nada", ondeAOpcaoAparece(produtos, borda, 0), []);
confere("produto que não é opção em lugar nenhum: lista vazia", ondeAOpcaoAparece(produtos, { id: "nada", franchiseeId: LOJA }, 10), []);
confere("meia pizza não entra (o meio a meio recalcula sozinho)", ondeAOpcaoAparece(produtos, { ...borda, name: "1/2 Calabresa" }, 30), []);
confere("ADMIN vendo todas as lojas: só a loja do produto",
  ondeAOpcaoAparece(produtos, { ...borda, franchiseeId: "outra-loja" }, 14).map((o) => o.itemId), ["gi-fora"]);

// ── A rota confere o que a tela mandou ─────────────────────────────────────
const doBanco = (id: string, loja: string | null, extra: any = {}) => ({ id, menuProductId: "catupiry", comboGroup: { menuProduct: { franchiseeId: loja } }, ...extra });
const linhas = [
  doBanco("gi-broto", LOJA),
  doBanco("gi-g1", LOJA),
  doBanco("gi-canal", LOJA, { additionalPriceSalao: 9 }),
  doBanco("gi-fora", "outra-loja"),
  { ...doBanco("gi-cheddar", LOJA), menuProductId: "cheddar" },
];
confere("da loja e sem preço próprio: aplica",
  conferirOpcoesParaAplicar(["gi-broto", "gi-g1"], linhas, "catupiry", LOJA),
  { aplicar: ["gi-broto", "gi-g1"], comPrecoProprio: [], recusadas: [] });
confere("com preço por canal: pula, não sobrescreve",
  conferirOpcoesParaAplicar(["gi-broto", "gi-canal"], linhas, "catupiry", LOJA),
  { aplicar: ["gi-broto"], comPrecoProprio: ["gi-canal"], recusadas: [] });
confere("de outra loja, de outra opção ou inexistente: recusa",
  conferirOpcoesParaAplicar(["gi-fora", "gi-cheddar", "gi-sumiu"], linhas, "catupiry", LOJA).recusadas,
  ["gi-fora", "gi-cheddar", "gi-sumiu"]);
confere("produto sem loja: recusa tudo",
  conferirOpcoesParaAplicar(["gi-broto"], linhas, "catupiry", null).recusadas, ["gi-broto"]);
confere("id repetido conta uma vez",
  conferirOpcoesParaAplicar(["gi-broto", "gi-broto"], linhas, "catupiry", LOJA).aplicar, ["gi-broto"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
