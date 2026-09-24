/**
 * Trava a resolução da categoria de item de plataforma (lib/categoria-do-item.ts).
 *
 *   npx tsx scripts/teste-categoria-do-item.ts
 *
 * O caso é o da NIK em 16/09/2026: 54 espelhos de iFood com categoria "iFood",
 * uma tela de KDS filtrada por "Pizzas Tradicionais" mostrando "Nenhum pedido
 * na fila" enquanto a pizza do iFood #8073 aparecia na tela das esfihas.
 */
import { categoriaResolvida, chaveDoNome, ehCategoriaDeIntegracao, montarMapa } from "../src/lib/categoria-do-item";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// O cardápio real da loja, como foi importado do iFood, mais os espelhos que
// os pedidos criaram por cima.
const CARDAPIO = [
  { id: "cmt1", name: "Esfiha Carne e Bacon", category: "Esfihas Especiais" },
  { id: "cmt2", name: "Esfiha Calabresa", category: "Esfihas Tradicionais" },
  { id: "cmt3", name: "Pizza Tradicional + Guaraná Mineiro 1,5L", category: "Pizza Tradicional + Guaraná Mineiro 1,5L por R$59,90" },
  { id: "cmt4", name: "Guaraná Mineiro 1,5l", category: "Bebidas" },
  { id: "cmt5", name: "Combo 3", category: "Combos Esfihas" },
  // O sabor solto vive em "Sabores de Pizza" — categoria que NÃO está no
  // filtro da tela de pizza da NIK. É a armadilha do pedido #3.
  { id: "cmt7", name: "Bauru", category: "Sabores de Pizza" },
  // ...e a promoção, cujo nome de categoria a Wabiz repete como nome de grupo.
  { id: "cmt8", name: "Pizza Tradicional + Guaraná Mineiro 1,5L", category: "Pizza Tradicional + Guaraná Mineiro 1,5L por R$59,90" },
  // Espelhos: nunca entram no mapa, nem pelo prefixo nem pela categoria.
  { id: "ifood-aaa", name: "Esfiha Carne e Bacon", category: "iFood" },
  { id: "ifood-bbb", name: "PIZZA TRADICIONAL + GUARANÁ MINEIRO 1,5L 2 SABORES (8 PEDAÇOS)", category: "iFood" },
  { id: "99food_ccc", name: "Combo 3", category: "99Food" },
  // Espelho do Wabiz carrega o nome do GRUPO como categoria — só o prefixo denuncia.
  { id: "wabiz-ddd", name: "Esfiha Calabresa", category: "Esfihas" },
  // Produto sem categoria não ensina nada.
  { id: "cmt6", name: "Sachê", category: "" },
];
const mapa = montarMapa(CARDAPIO);

console.log("── o que é categoria de integração ──");
confere("iFood", ehCategoriaDeIntegracao("iFood"), true);
confere("IFOOD em maiúscula", ehCategoriaDeIntegracao("IFOOD"), true);
confere("99Food", ehCategoriaDeIntegracao("99Food"), true);
confere("Brendi", ehCategoriaDeIntegracao("Brendi"), true);
confere("Wabiz", ehCategoriaDeIntegracao("Wabiz"), true);
confere("Pizzas Tradicionais NÃO é", ehCategoriaDeIntegracao("Pizzas Tradicionais"), false);
confere("vazio NÃO é", ehCategoriaDeIntegracao(""), false);

console.log("\n── o mapa só tem produto real ──");
confere("espelho ifood- fica fora", mapa.porNome.has(chaveDoNome("PIZZA TRADICIONAL + GUARANÁ MINEIRO 1,5L 2 SABORES (8 PEDAÇOS)")), false);
confere("espelho wabiz- fica fora mesmo com categoria 'normal'", [...mapa.porNome.entries()].some(([, c]) => c === "Esfihas"), false);
confere("produto sem categoria fica fora", mapa.porNome.has(chaveDoNome("Sachê")), false);
confere("produto real entra", mapa.porNome.get(chaveDoNome("Esfiha Carne e Bacon")), "Esfihas Especiais");

// ── O PEDIDO #2 DA WABIZ NA NIK (22/09/2026) ──────────────────────────────
//
// Três esfihas gravadas, impressas e invisíveis nas QUATRO telas do KDS —
// medido no banco: "0 de 3 itens" em cada uma. O espelho da Wabiz nasce com a
// categoria igual ao nome do GRUPO dela ("Esfihas"), e a NIK filtra as telas
// por "Esfihas Tradicionais". "Esfihas" não casa com nada, e a tela esconde
// pedido sem item seu.
//
// A regra antiga só reescrevia categoria que FOSSE de integração, então
// "Esfihas" passava batido. Agora o prefixo `wabiz-` do id é a prova, e o nome
// acha a categoria real — que é exatamente a que a tela filtra.
console.log("\n── o item da Wabiz, cuja categoria NÃO se denuncia (pedido #2 da NIK) ──");
const daWabiz = (nome: string) => ({
  productName: nome,
  menuProduct: { id: `wabiz-cmtn5q78c00ebte01zsqrggqx-${nome.toLowerCase().replace(/\s+/g, "-")}`, name: nome, category: "Esfihas" },
});
confere("Esfiha Calabresa → Esfihas Tradicionais", categoriaResolvida(daWabiz("Esfiha Calabresa"), mapa), "Esfihas Tradicionais");

// ── E O PEDIDO #3, QUE DIZ O CONTRÁRIO ────────────────────────────────────
//
// Os dois pedidos da NIK se contradizem, e é isso que faz a regra.
//
// No #3 o grupo da Wabiz se chama igual a uma categoria DA LOJA ("Pizza
// Tradicional + Guaraná Mineiro 1,5L por R$49,90 (Segunda a Quinta)", que no
// cardápio real tem produto). Essa está no filtro da tela de pizza, e o
// pedido aparecia certo. Casar pelo NOME levaria "Bauru" para "Sabores de
// Pizza", que NÃO está no filtro — o #3 sumiria da cozinha justamente por
// causa da correção do #2.
//
// Por isso: categoria de espelho que EXISTE no cardápio da loja manda; a que
// não existe é nome de grupo do parceiro e cai fora.
confere(
  "grupo que É categoria da loja fica como está (o #3, 'Bauru')",
  categoriaResolvida(
    { productName: "Bauru | Guaraná Mineiro 1,5l", menuProduct: { id: "wabiz-x-bauru", name: "Bauru", category: "Pizza Tradicional + Guaraná Mineiro 1,5L por R$59,90" } },
    mapa,
  ),
  "Pizza Tradicional + Guaraná Mineiro 1,5L por R$59,90",
);
confere(
  "sem essa regra, 'Bauru' iria parar em Sabores de Pizza",
  mapa.porNome.get(chaveDoNome("Bauru")),
  "Sabores de Pizza",
);
confere(
  "grupo 'Bebidas' da Wabiz vira a categoria real da loja",
  categoriaResolvida({ productName: "Guaraná Mineiro 1,5l", menuProduct: { id: "wabiz-x-guarana", name: "Guaraná Mineiro 1,5l", category: "Bebidas" } }, mapa),
  "Bebidas",
);
confere(
  "sabor que a loja não tem cadastrado fica SEM categoria (aparece em toda tela)",
  categoriaResolvida({ productName: "Esfiha de Jaca", menuProduct: { id: "wabiz-x-jaca", name: "Esfiha de Jaca", category: "Esfihas" } }, mapa),
  "",
);
confere(
  "produto REAL chamado 'Esfihas' não é confundido com espelho",
  categoriaResolvida({ productName: "Esfiha Calabresa", menuProduct: { id: "cmt2", name: "Esfiha Calabresa", category: "Esfihas Tradicionais" } }, mapa),
  "Esfihas Tradicionais",
);

console.log("\n── o item do iFood herda a categoria do produto real ──");
confere(
  "esfiha do iFood → Esfihas Especiais (o caso do #6 da NIK)",
  categoriaResolvida({ productName: "Esfiha Carne e Bacon", menuProduct: { name: "Esfiha Carne e Bacon", category: "iFood" } }, mapa),
  "Esfihas Especiais",
);
confere(
  "casa sem acento e sem caixa",
  categoriaResolvida({ productName: "ESFIHA CALABRESA", menuProduct: { name: "esfiha calabresa", category: "iFood" } }, mapa),
  "Esfihas Tradicionais",
);
confere(
  "o nome do dia (productName) vale antes do nome do espelho",
  categoriaResolvida({ productName: "Combo 3", menuProduct: { name: "Combo 3 + 2 Bebidas (nome velho)", category: "iFood" } }, mapa),
  "Combos Esfihas",
);
confere(
  "sem productName, vale o nome do espelho",
  categoriaResolvida({ menuProduct: { name: "Guaraná Mineiro 1,5l", category: "iFood" } }, mapa),
  "Bebidas",
);

console.log("\n── o preço no nome não conta ──");
confere(
  "'por R$59,90' no pedido casa com 'por R$49,90' no cadastro (o combo de esfihas da NIK)",
  categoriaResolvida(
    { productName: "6 Esfihas Tradicionais + Guaraná Mineiro 1,5l por R$59,90", menuProduct: { name: "6 Esfihas Tradicionais + Guaraná Mineiro 1,5l por R$59,90", category: "iFood" } },
    montarMapa([...CARDAPIO, { id: "cmt9", name: "6 Esfihas Tradicionais + Guaraná Mineiro 1,5L por R$49,90", category: "6 Esfihas Tradicionais + Guaraná Mineiro 1,5L por R$49,90" }]),
  ),
  "6 Esfihas Tradicionais + Guaraná Mineiro 1,5L por R$49,90",
);
confere("chave ignora o preço", chaveDoNome("Combo X por R$ 39,90"), chaveDoNome("Combo X"));

console.log("\n── nome enfeitado casa pelo INÍCIO com o produto real ──");
confere(
  "o combo de pizza do iFood #8073 → categoria da pizza (era o pedido invisível na tela de pizza)",
  categoriaResolvida({ productName: "PIZZA TRADICIONAL + GUARANÁ MINEIRO 1,5L 2 SABORES (8 PEDAÇOS)", menuProduct: { name: "PIZZA TRADICIONAL + GUARANÁ MINEIRO 1,5L 2 SABORES (8 PEDAÇOS)", category: "iFood" } }, mapa),
  "Pizza Tradicional + Guaraná Mineiro 1,5L por R$59,90",
);
confere(
  "prefixo curto demais NÃO puxa categoria ('Esfiha' sozinho)",
  categoriaResolvida({ productName: "Esfiha Surpresa do Chef", menuProduct: { name: "Esfiha Surpresa do Chef", category: "iFood" } }, montarMapa([{ id: "c1", name: "Esfiha", category: "Esfihas Tradicionais" }])),
  "",
);
confere(
  "prefixo tem que ser palavra inteira ('Combo 3' não casa 'Combo 30 Esfihas')",
  categoriaResolvida({ productName: "Combo 30 Esfihas Mistas", menuProduct: { name: "Combo 30 Esfihas Mistas", category: "iFood" } }, montarMapa([{ id: "c1", name: "Combo 3 Esfihas Top", category: "Combos Esfihas" }])),
  "",
);
confere(
  "o prefixo mais LONGO vence (o mais específico)",
  categoriaResolvida({ productName: "Pizza Doce Chocolate com Morango Grande", menuProduct: { name: "Pizza Doce Chocolate com Morango Grande", category: "iFood" } },
    montarMapa([{ id: "c1", name: "Pizza Doce Chocolate", category: "Pizzas Doces" }, { id: "c2", name: "Pizza Doce Chocolate com Morango", category: "Pizzas Doces Premium" }])),
  "Pizzas Doces Premium",
);

console.log("\n── quem não casa de jeito nenhum fica SEM categoria (visível em toda tela), nunca invisível ──");
confere("espelho de 99Food sem par → vazio", categoriaResolvida({ productName: "Marmita X", menuProduct: { name: "Marmita X", category: "99Food" } }, mapa), "");
confere("tamanho de pizza solto do iFood ('GRANDE (8 PEDAÇOS)') → vazio", categoriaResolvida({ productName: "GRANDE (8 PEDAÇOS)", menuProduct: { name: "GRANDE (8 PEDAÇOS)", category: "iFood" } }, mapa), "");

console.log("\n── produto real não é tocado ──");
confere(
  "item do balcão mantém a categoria",
  categoriaResolvida({ productName: null, menuProduct: { name: "Esfiha Calabresa", category: "Esfihas Tradicionais" } }, mapa),
  "Esfihas Tradicionais",
);
confere("item sem categoria nenhuma continua vazio", categoriaResolvida({ productName: "Coisa", menuProduct: { name: "Coisa", category: "" } }, mapa), "");
confere("item sem menuProduct não explode", categoriaResolvida({ productName: "Coisa" }, mapa), "");

// ── Pizza da Wabiz: antes só o sabor, desde 24/09/2026 com "Pizza" na frente ──
// O nome antigo ("1/2 Costela…") e o novo ("Pizza 1/2 Costela…") caem na
// mesma categoria; o novo não pode virar "pizza pizza costela".
{
  const pizzas = montarMapa([
    { id: "p1", name: "Pizza Costela com Catupiry", category: "Pizzas Especiais" },
    { id: "p2", name: "Pizza Frango Catupiry", category: "Pizzas Especiais" },
    { id: "p3", name: "Pizza Calabresa", category: "Pizzas Tradicionais" },
    { id: "e1", name: "Esfiha Costela com Catupiry", category: "Esfihas Especiais" },
  ]);
  const espelho = (nome: string) => ({ productName: nome, menuProduct: { id: "wabiz-x", active: false, name: nome, category: "Pizzas Grande" } });
  confere("Wabiz meio a meio, nome antigo", categoriaResolvida(espelho("1/2 Costela com Catupiry + 1/2 Frango Catupiry"), pizzas), "Pizzas Especiais");
  confere("Wabiz meio a meio, nome novo", categoriaResolvida(espelho("Pizza 1/2 Costela com Catupiry + 1/2 Frango Catupiry"), pizzas), "Pizzas Especiais");
  confere("Wabiz inteira, nome novo casa direto", categoriaResolvida(espelho("Pizza Calabresa"), pizzas), "Pizzas Tradicionais");
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
