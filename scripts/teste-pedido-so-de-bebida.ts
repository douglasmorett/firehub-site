/**
 * Trava a impressora de "pedido só de bebida" (lib/roteamento-de-impressao.ts).
 *
 *   npx tsx scripts/teste-pedido-so-de-bebida.ts
 *
 * O caso é o da NIK Pizzas em 27/09/2026: refrigerante vendido sozinho no
 * balcão tem de sair na impressora do balcão; pedido com pizza e refrigerante
 * sai INTEIRO na cozinha. Estava saindo refrigerante sozinho na cozinha do
 * delivery.
 */
import {
  destinosDoPedido,
  impressorasPeloPedidoSoDeBebida,
  pedidoEhSoBebida,
  type ImpressoraConfigurada,
} from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const NIK: ImpressoraConfigurada[] = [
  { name: "COZINHA", categories: [] },
  { name: "BALCAO", modulos: ["salao"], pedidoSoDeBebida: true },
];

const item = (name: string, category: string, extra: Record<string, unknown> = {}) => ({ name, category, quantity: 1, price: 10, ...extra });
const COCA = item("Coca-Cola Lata", "Refrigerantes");
const GUARANA_2L = item("Guaraná Antarctica 2L", "Bebidas");
const SUCO = item("Suco de Laranja", "Sucos");
const PIZZA = item("Pizza Calabresa G", "Pizzas Tradicionais");
const COMBO = item("Combo Pizza G + Coca 2L", "Combos");

const para = (impressoras: ImpressoraConfigurada[], pedido: { source?: string; items: any[] }, palavras?: string) =>
  destinosDoPedido(impressoras, pedido, undefined, { palavrasDeBebida: palavras }).map((d) => `${d.impressora.name}:${d.itens.map((i: any) => i.name).join("+")}`);

// ── O pedido da NIK ──
confere("balcão, só refrigerante → só no BALCAO", para(NIK, { source: "PRESENCIAL", items: [COCA] }), ["BALCAO:Coca-Cola Lata"]);
confere("balcão, três bebidas → as três no BALCAO", para(NIK, { source: "PRESENCIAL", items: [COCA, GUARANA_2L, SUCO] }), ["BALCAO:Coca-Cola Lata+Guaraná Antarctica 2L+Suco de Laranja"]);
confere("balcão, pizza + refrigerante → tudo na COZINHA, nada no BALCAO", para(NIK, { source: "PRESENCIAL", items: [PIZZA, COCA] }), ["COZINHA:Pizza Calabresa G+Coca-Cola Lata"]);
confere("balcão, só pizza → COZINHA", para(NIK, { source: "PRESENCIAL", items: [PIZZA] }), ["COZINHA:Pizza Calabresa G"]);
confere("combo com coca no nome é comida (categoria Combos) → COZINHA", para(NIK, { source: "PRESENCIAL", items: [COMBO] }), ["COZINHA:Combo Pizza G + Coca 2L"]);
confere("mesa (também salão), só cerveja → BALCAO", para(NIK, { source: "MESA", items: [item("Heineken Long Neck", "Cervejas")] }), ["BALCAO:Heineken Long Neck"]);

// ── O módulo limita a regra ──
confere("iFood, só refrigerante → COZINHA (o BALCAO só atende salão)", para(NIK, { source: "IFOOD", items: [COCA] }), ["COZINHA:Coca-Cola Lata"]);
confere("site, pizza + refrigerante → COZINHA", para(NIK, { source: "SITE", items: [PIZZA, COCA] }), ["COZINHA:Pizza Calabresa G+Coca-Cola Lata"]);

// ── O que é bebida ──
confere("produto marcado como bebida, fora de categoria de bebida", pedidoEhSoBebida({ items: [item("Mate Gelado", "Promoções", { isBeverage: true })] }), true);
confere("refrigerante em categoria de comida conta como comida", pedidoEhSoBebida({ items: [item("Coca-Cola Lata", "Promoções")] }), false);
confere("sem categoria: pelo nome", pedidoEhSoBebida({ items: [item("Coca-Cola Lata", "")] }), true);
confere("sem categoria, nome de combo com +: comida", pedidoEhSoBebida({ items: [item("Pizza + Coca", "")] }), false);
confere("espelho do iFood (categoria iFood): pelo nome", pedidoEhSoBebida({ source: "IFOOD", items: [item("Guaraná 2L", "iFood")] }), true);
confere("categoria vinda do produto (menuProduct)", pedidoEhSoBebida({ items: [{ name: "Água sem gás", menuProduct: { category: "Águas" } }] }), true);
confere("palavra da loja vale sem categoria", pedidoEhSoBebida({ items: [item("Guaracamp", "")] }, "guaracamp"), true);
confere("pedido vazio não é só bebida", pedidoEhSoBebida({ items: [] }), false);

// ── Loja sem a opção: nada muda ──
const SEM_OPCAO: ImpressoraConfigurada[] = [{ name: "COZINHA" }, { name: "BALCAO", modulos: ["salao"] }];
confere("sem a opção, refrigerante sozinho no balcão sai nas duas (como sempre)", para(SEM_OPCAO, { source: "PRESENCIAL", items: [COCA] }), ["COZINHA:Coca-Cola Lata", "BALCAO:Coca-Cola Lata"]);
confere("sem a opção, a lista de impressoras não muda", impressorasPeloPedidoSoDeBebida(SEM_OPCAO, { source: "PRESENCIAL", items: [PIZZA] }).map((p) => p.name), ["COZINHA", "BALCAO"]);

// ── Convivência com o que já existia ──
const COM_CATEGORIAS: ImpressoraConfigurada[] = [
  { name: "PIZZA", categories: ["Pizzas Tradicionais"] },
  { name: "BAR", categories: ["Refrigerantes"] },
  { name: "BALCAO", modulos: ["salao"], pedidoSoDeBebida: true, categories: ["Cervejas"] },
];
confere("com divisão por categoria, pedido misto segue dividido e o BALCAO fica fora", para(COM_CATEGORIAS, { source: "PRESENCIAL", items: [PIZZA, COCA] }), ["PIZZA:Pizza Calabresa G", "BAR:Coca-Cola Lata"]);
confere("a categoria marcada no BALCAO não vale: refrigerante sozinho sai inteiro nele", para(COM_CATEGORIAS, { source: "PRESENCIAL", items: [COCA] }), ["BALCAO:Coca-Cola Lata"]);
// A categoria "Cervejas" marcada no BALCAO não conta como pedida: a cerveja do
// pedido misto não pode sumir de todas as impressoras. Ninguém a pediu, então
// sai na que ficaria sem nada (regra de sempre).
confere("cerveja num pedido misto não some", para(COM_CATEGORIAS, { source: "PRESENCIAL", items: [PIZZA, item("Heineken", "Cervejas")] }), ["PIZZA:Pizza Calabresa G", "BAR:Heineken"]);

// ── A MESMA impressora cadastrada duas vezes (o que a NIK vai fazer) ──
// Uma linha como sempre foi (o balcão tira via de todo pedido do salão), outra
// com "pedido só de bebida". A deduplicação pela impressora física não pode
// engolir uma das duas regras — nem sair papel em dobro.
const NIK_DUAS_LINHAS: ImpressoraConfigurada[] = [
  { name: "COZINHA", modulos: ["salao", "delivery"] },
  { name: "BALCAO", modulos: ["salao"] },
  { name: "BALCAO", modulos: ["salao"], pedidoSoDeBebida: true },
];
const INVERTIDA = [NIK_DUAS_LINHAS[0], NIK_DUAS_LINHAS[2], NIK_DUAS_LINHAS[1]];
for (const [nome, lista] of [["normal antes", NIK_DUAS_LINHAS], ["só bebida antes", INVERTIDA]] as const) {
  confere(`duas linhas (${nome}): refrigerante sozinho → só no BALCAO, uma vez`, para(lista, { source: "PRESENCIAL", items: [COCA] }), ["BALCAO:Coca-Cola Lata"]);
  confere(`duas linhas (${nome}): pizza + refrigerante → COZINHA e a via do BALCAO, como sempre`, para(lista, { source: "PRESENCIAL", items: [PIZZA, COCA] }), ["COZINHA:Pizza Calabresa G+Coca-Cola Lata", "BALCAO:Pizza Calabresa G+Coca-Cola Lata"]);
  confere(`duas linhas (${nome}): iFood só refrigerante → COZINHA`, para(lista, { source: "IFOOD", items: [COCA] }), ["COZINHA:Coca-Cola Lata"]);
}

if (falhas > 0) {
  console.log(`\n❌ ${falhas} falha(s)`);
  process.exit(1);
}
console.log("\n✅ tudo certo");
