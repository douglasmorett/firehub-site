/**
 * Prova do casamento produto do FireHub ↔ item do iFood/99 (lib/casar-itens-dos-apps.ts),
 * usado pelo Bill para pausar nos apps.
 *
 *   npx tsx scripts/teste-casar-itens-dos-apps.ts
 */
import {
  casarProdutosComItens, corpoDoStatus99, itensDoCardapio99, itensDoCatalogoIfood, normalizarNome, type ProdutoParaCasar,
} from "../src/lib/casar-itens-dos-apps";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const produto = (id: string, nome: string, extra: Partial<ProdutoParaCasar> = {}): ProdutoParaCasar => ({
  id, nome, codigos: [id], nomesNoApp: [], idsNoApp: [], ...extra,
});

confere("normaliza acento, caixa e pontuação", normalizarNome("  Esfirra de FRANGO c/ Catupiry! "), "esfirra de frango c catupiry");

// ── iFood ──
const catalogo = [
  { id: "c1", name: "Esfirras", items: [
    { id: "it-frango", name: "Esfirra de Frango", externalCode: "" },
    { id: "it-frango-cat", name: "Esfirra de Frango c/ Catupiry", externalCode: "" },
    { id: "it-carne", name: "Esfirra Carne", externalCode: "12" },
  ] },
  { id: "c2", name: "Bebidas", items: [
    { id: "it-coca-1", name: "Coca-Cola Lata", externalCode: "" },
    { id: "it-coca-2", name: "Coca Cola lata", externalCode: "" },
    { id: "it-guarana", name: "Guaraná 2L", externalCode: "" },
  ] },
];
const itensIfood = itensDoCatalogoIfood(catalogo);
confere("lê os itens de todas as categorias", itensIfood.map((i) => i.id), ["it-frango", "it-frango-cat", "it-carne", "it-coca-1", "it-coca-2", "it-guarana"]);

const r = casarProdutosComItens(
  [
    produto("p1", "Esfirra de frango"), // nome, sem acento/caixa
    produto("p2", "Esfirra de Carne", { codigos: ["12", "p2"] }), // Código PDV
    produto("p3", "Coca lata", { idsNoApp: ["it-coca-1", "id-que-sumiu"] }), // espelho vinculado
    produto("p4", "Coca-Cola Lata"), // dois itens com o mesmo nome
    produto("p5", "Pastel"), // não existe
    produto("p6", "Guarana", { nomesNoApp: ["Guaraná 2L"] }), // nome do espelho
  ],
  itensIfood,
);
confere("casados", r.casados, [
  { produtoId: "p1", nome: "Esfirra de frango", itemIds: ["it-frango"] },
  { produtoId: "p2", nome: "Esfirra de Carne", itemIds: ["it-carne"] },
  { produtoId: "p3", nome: "Coca lata", itemIds: ["it-coca-1"] },
  { produtoId: "p6", nome: "Guarana", itemIds: ["it-guarana"] },
]);
confere("ambíguo não pausa", r.ambiguos, ["Coca-Cola Lata"]);
confere("não achado", r.naoAchados, ["Pastel"]);

// ── 99 ──
const cardapio99 = {
  items: [
    { app_item_id: "99-x", item_name: "X-Burguer", is_sold_separately: true, app_external_id: "" },
    { app_item_id: "99-batata-opcao", item_name: "Batata Frita", is_sold_separately: false },
    { app_item_id: "99-batata", item_name: "Batata frita", is_sold_separately: true },
    { app_item_id: "", item_name: "Marmita Feijoada", is_sold_separately: true },
    { app_item_id: "99-suco", item_name: "Suco", is_sold_separately: true, app_external_id: "7" },
  ],
};
const r99 = casarProdutosComItens(
  [
    produto("q1", "X Burguer"),
    produto("q2", "Batata Frita"), // avulso vence a opção de complemento
    produto("q3", "Marmita - Feijoada"), // 99 sem código
    produto("q4", "Suco de laranja", { codigos: ["7", "q4"] }),
  ],
  itensDoCardapio99(cardapio99),
);
confere("99: casados", r99.casados.map((c) => [c.produtoId, c.itemIds]), [["q1", ["99-x"]], ["q2", ["99-batata"]], ["q4", ["99-suco"]]]);
confere("99: item sem app_item_id vai para semCodigo", r99.semCodigo, ["Marmita - Feijoada"]);
confere("99: corpo do updateItemStatus (pausar)", corpoDoStatus99("tok", ["a", "b"], false), { auth_token: "tok", app_item_ids: ["a", "b"], status: 2 });
confere("99: corpo do updateItemStatus (reativar)", corpoDoStatus99("tok", ["a"], true).status, 1);
confere("cardápio vazio/estranho não quebra", [itensDoCardapio99(null).length, itensDoCatalogoIfood({}).length], [0, 0]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
