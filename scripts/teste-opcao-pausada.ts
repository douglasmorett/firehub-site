/**
 * Opção de combo pausada (src/lib/opcao-pausada.ts): some do robô, é recusada
 * no POST do site e do totem, e o combo que a pausa travou é marcado.
 *
 *   npx tsx scripts/teste-opcao-pausada.ts
 */
import {
  marcarTravadoPelaPausa,
  mensagemDaPausaNaTag,
  pausaNaTagDoRobo,
  fraseDaOpcaoIndisponivel,
  opcaoPausada,
  opcoesPausadasEscolhidas,
  perguntaTravadaPelaPausa,
  produtoTravadoPelaPausa,
  semOpcoesPausadas,
} from "../src/lib/opcao-pausada";
import { aplicarPrecoNoCardapio } from "../src/lib/preco-por-canal";
import { pisoDoPreco, precoMinimoDoProduto } from "../src/lib/preco-combo";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

const opcao = (id: string, name: string, extra: Record<string, unknown> = {}, active = true) =>
  ({ additionalPrice: 0, ...extra, menuProduct: { id, name, price: 0, active } });

// ── opcaoPausada / semOpcoesPausadas ─────────────────────────────────────────
confere("só active === false pausa", opcaoPausada(opcao("a", "A", {}, false)) && !opcaoPausada(opcao("a", "A")));
confere("sem a coluna (consulta antiga) vale como ativa", !opcaoPausada({ menuProduct: { name: "A" } }) && !opcaoPausada(null));

const esfihas = {
  id: "combo", name: "Esfiha Combo", price: 20,
  comboGroups: [
    { id: "g1", title: "Sabor", maxQty: 1, minQty: 1, items: [opcao("c", "Calabresa", {}, false), opcao("q", "Queijo"), opcao("f", "Frango")] },
    { id: "g2", title: "Bebida", maxQty: 1, minQty: 0, items: [opcao("k", "Coca Lata", { additionalPrice: 5 })] },
  ],
};
const semPausa = { id: "p", name: "Pastel", price: 10, comboGroups: [{ id: "g", title: "Sabor", maxQty: 1, minQty: 1, items: [opcao("x", "Carne")] }] };
confere("nada pausado: devolve o MESMO objeto", semOpcoesPausadas(semPausa) === semPausa);
const filtrado = semOpcoesPausadas(esfihas);
confere("a pausada sai da pergunta", filtrado.comboGroups[0].items.map((i) => i.menuProduct.name).join(",") === "Queijo,Frango", filtrado.comboGroups[0].items);
confere("…sem mexer no original", esfihas.comboGroups[0].items.length === 3);

// ── pergunta travada pela pausa ──────────────────────────────────────────────
confere("sobrou opção ativa: a pergunta fecha", !perguntaTravadaPelaPausa(esfihas.comboGroups[0]));
const tudoPausado = { ...esfihas.comboGroups[0], items: esfihas.comboGroups[0].items.map((i) => ({ ...i, menuProduct: { ...i.menuProduct, active: false } })) };
confere("obrigatória com tudo pausado: travada", perguntaTravadaPelaPausa(tudoPausado));
confere("opcional com tudo pausado não trava", !perguntaTravadaPelaPausa({ ...tudoPausado, minQty: 0 }));
confere("pergunta que já nasceu vazia não é culpa da pausa", !perguntaTravadaPelaPausa({ title: "Vazia", maxQty: 1, minQty: 1, items: [] }));

// O combo fixo: exige 3, cada item no máximo 1. Pausar SÓ a Coca já trava.
const fixo = {
  title: "Itens do combo", maxQty: 3, minQty: null,
  items: [opcao("b", "X-Burger", { maxPerItem: 1 }), opcao("t", "Batata", { maxPerItem: 1 }), opcao("k", "Coca Lata", { maxPerItem: 1 }, false)],
};
confere("combo fixo sem a Coca: travado (2 ativas, cada uma 1x, exige 3)", perguntaTravadaPelaPausa(fixo));
const repetivel = { ...fixo, items: fixo.items.map((i) => ({ ...i, maxPerItem: null })) };
confere("…mas se a opção repete até o teto, 1 ativa ainda fecha", !perguntaTravadaPelaPausa(repetivel));
confere("produtoTravadoPelaPausa diz QUAL pergunta", produtoTravadoPelaPausa({ comboGroups: [esfihas.comboGroups[1], tudoPausado] }) === "Sabor");
confere("produto que fecha: null", produtoTravadoPelaPausa(esfihas) === null);

// ── o cardápio do robô (marcarTravadoPelaPausa + semOpcoesPausadas) ──────────
// Nugget da Hakim: base R$ 0,00, o valor todo no tamanho.
const nugget = {
  id: "n", name: "Nugget", price: 0, isCombo: true,
  comboGroups: [{ id: "t", title: "Tamanho", maxQty: 1, minQty: 1, items: [
    opcao("n6", "6 Nuggets", { additionalPrice: 9.9 }, false),
    opcao("n15", "15 Nuggets", { additionalPrice: 19.9 }),
  ] }],
};
const [noCanal] = aplicarPrecoNoCardapio([nugget], "delivery");
const doRobo = marcarTravadoPelaPausa(noCanal);
confere("robô: produto que fecha não leva a marca e fica igual", doRobo === noCanal && doRobo.perguntaTravadaPelaPausa === undefined);
confere("robô: a pausada FICA na lista que casa o nome (o pedido já enviado com ela não quebra)",
  doRobo.comboGroups[0].items.length === 2, doRobo.comboGroups[0].items);
const ofertado = semOpcoesPausadas(doRobo);
confere("robô: o que ele OFERECE passa pelo preço por canal sem perder o active", ofertado.comboGroups[0].items.length === 1, ofertado.comboGroups[0].items);
confere("robô: o 'a partir de' ofertado sobe para a opção que sobrou", precoMinimoDoProduto(ofertado) === 19.9, precoMinimoDoProduto(ofertado));
confere("robô: a escolha NOVA do tamanho pausado é pega na gravação",
  opcoesPausadasEscolhidas(doRobo, { t: { "6 Nuggets": 1 } })[0] === "6 Nuggets");

const nuggetEsgotado = { ...nugget, comboGroups: [{ ...nugget.comboGroups[0], items: nugget.comboGroups[0].items.map((i) => ({ ...i, menuProduct: { ...i.menuProduct, active: false } })) }] };
const travado = marcarTravadoPelaPausa(aplicarPrecoNoCardapio([nuggetEsgotado], "delivery")[0]);
confere("robô: tudo pausado → marcado com a pergunta", travado.perguntaTravadaPelaPausa === "Tamanho", travado.perguntaTravadaPelaPausa);
confere("…e continua com as opções: o piso não cai a R$ 0,00", pisoDoPreco(travado) === 9.9, pisoDoPreco(travado));
confere("…o que ele oferece desse combo fica vazio (a lista o mostra como proibido)", semOpcoesPausadas(travado).comboGroups[0].items.length === 0);

// ── a tag final do robô ──────────────────────────────────────────────────────
const cardapioDoRobo = aplicarPrecoNoCardapio([esfihas, nuggetEsgotado, semPausa], "delivery").map((p) => marcarTravadoPelaPausa(p));
const comCalabresa = { menuProductId: "combo", comboSelections: { g1: { Calabresa: 1 } } };
const comQueijo = { menuProductId: "combo", comboSelections: { g1: { Queijo: 1 } } };
const recusaNova = pausaNaTagDoRobo([comCalabresa], cardapioDoRobo);
confere("tag nova com o sabor pausado: recusada",
  recusaNova?.tipo === "opcao" && recusaNova.produto === "Esfiha Combo" && recusaNova.opcoes[0] === "Calabresa", recusaNova);
confere("…e o cliente ouve o motivo, não 'problema técnico'",
  mensagemDaPausaNaTag(recusaNova!) === 'Poxa, "Calabresa" está indisponível agora em "Esfiha Combo". 😕 Quer escolher outra opção?',
  mensagemDaPausaNaTag(recusaNova!));
confere("sabor ativo passa", pausaNaTagDoRobo([comQueijo], cardapioDoRobo) === null);
confere("pedido ENVIADO com a Calabresa antes da pausa + 'acrescenta um pastel': passa",
  pausaNaTagDoRobo([comCalabresa, { menuProductId: "p", comboSelections: { g: { Carne: 1 } } }], cardapioDoRobo, [comCalabresa]) === null);
confere("…mas trocar o Queijo enviado pela Calabresa pausada é escolha nova: recusa",
  pausaNaTagDoRobo([comCalabresa], cardapioDoRobo, [comQueijo])?.tipo === "opcao");
const recusaCombo = pausaNaTagDoRobo([{ menuProductId: "n", comboSelections: null }], cardapioDoRobo);
confere("combo travado pela pausa, pedido novo: recusado com a pergunta",
  recusaCombo?.tipo === "combo" && recusaCombo.pergunta === "Tamanho", recusaCombo);
confere("…mensagem do combo", mensagemDaPausaNaTag(recusaCombo!).includes('acabaram as opções de "Tamanho"'), mensagemDaPausaNaTag(recusaCombo!));
confere("…já estava no pedido enviado: passa", pausaNaTagDoRobo([{ menuProductId: "n" }], cardapioDoRobo, [{ menuProductId: "n" }]) === null);
confere("item que não casou com o cardápio não é assunto daqui", pausaNaTagDoRobo([{ menuProductId: "sumiu" }], cardapioDoRobo) === null);

// ── a escolha que chega no POST ──────────────────────────────────────────────
confere("site: { grupo: { nome: qtd } } com o sabor pausado",
  JSON.stringify(opcoesPausadasEscolhidas(esfihas, { g1: { Calabresa: 1 } })) === '["Calabresa"]');
confere("site: sabor ativo passa", opcoesPausadasEscolhidas(esfihas, { g1: { Queijo: 1 }, g2: { "Coca Lata": 1 } }).length === 0);
confere("site: escolha em texto JSON (sacola antiga)", opcoesPausadasEscolhidas(esfihas, JSON.stringify({ g1: { Calabresa: 1 } }) as any)[0] === "Calabresa");
confere("PDV / Repetir pedido: lista sem grupo",
  opcoesPausadasEscolhidas(esfihas, [{ name: "Calabresa", quantity: 1 }])[0] === "Calabresa");
confere("grupo que o formulário recriou (id velho na sacola): casa pelo nome",
  opcoesPausadasEscolhidas(esfihas, { "id-velho": { Calabresa: 1 } })[0] === "Calabresa");
const duasPerguntas = {
  price: 20,
  comboGroups: [
    { id: "a", title: "1ª", maxQty: 1, minQty: 1, items: [opcao("c1", "Calabresa", {}, false), opcao("q", "Queijo")] },
    { id: "b", title: "2ª", maxQty: 1, minQty: 1, items: [opcao("c2", "Calabresa"), opcao("q2", "Queijo")] },
  ],
};
confere("mesmo nome ativo em outra pergunta, escolha sem grupo: a favor do cliente",
  opcoesPausadasEscolhidas(duasPerguntas, [{ name: "Calabresa", quantity: 1 }]).length === 0);
confere("…com o grupo dito, vale o grupo",
  opcoesPausadasEscolhidas(duasPerguntas, { a: { Calabresa: 1 } })[0] === "Calabresa" && opcoesPausadasEscolhidas(duasPerguntas, { b: { Calabresa: 1 } }).length === 0);
confere("sem escolha / produto sem pausa: nada", opcoesPausadasEscolhidas(esfihas, null).length === 0 && opcoesPausadasEscolhidas(semPausa, { g: { Carne: 1 } }).length === 0);

// ── a frase da recusa ────────────────────────────────────────────────────────
confere("frase com uma opção", fraseDaOpcaoIndisponivel("Esfiha Combo", ["Calabresa"]) === '"Calabresa" está indisponível agora em "Esfiha Combo".',
  fraseDaOpcaoIndisponivel("Esfiha Combo", ["Calabresa"]));
confere("frase com três", fraseDaOpcaoIndisponivel("Pizza", ["A", "B", "C"]) === '"A", "B" e "C" estão indisponíveis agora em "Pizza".',
  fraseDaOpcaoIndisponivel("Pizza", ["A", "B", "C"]));

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
