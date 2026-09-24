/**
 * Trava a divisão por categoria entre impressoras (lib/roteamento-de-impressao.ts).
 *
 *   npx tsx scripts/teste-roteamento-de-impressao.ts
 *
 * O caso é o da Ragnar Burger em 24/09/2026: a impressora do BAR (Drinks,
 * Refrigerantes) imprimia a comanda inteira de todo pedido sem bebida, porque
 * "nenhum item casou" virava "imprime tudo". A configuração abaixo é a da loja
 * naquele dia, e os pedidos são os do jantar.
 */
import { destinosDoPedido, type ImpressoraConfigurada } from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const LOJA = "cmtkosykk01jhk601arcsnu48";
const IFOOD_PIZZA = "ea2c4d55-efd2-4fa7-8aa7-fc1ecd6b8d52";
const IFOOD_BURGER = "469a9863-bf71-46ad-8c3e-2474b7cbe46b";

const RAGNAR: ImpressoraConfigurada[] = [
  { name: "BALCAO", modulos: ["salao"], categories: ["Cerveja", "Entretenimento e Presentes"] },
  { name: "COZINHA PIZZA", lojas: [`ifood:${IFOOD_PIZZA}`, `loja:${LOJA}`], modulos: ["delivery", "salao"], categories: ["Pizzas Especiais", "Pizzas Premium", "Pizzas Tradicionais", "Sucos", "Sobremesas", "Refrigerantes"] },
  { name: "COZINHA ENTREGA RAGNA", lojas: [`ifood:${IFOOD_BURGER}`, "ifood:17ce82cb-a22b-42f4-b95e-6b912c4ad278", `loja:${LOJA}`], modulos: ["delivery", "salao"], categories: ["Burgers", "Adicionais Burger", "Combos", "Entradas", "Refrigerantes"] },
  { name: "BAR", lojas: [`loja:${LOJA}`], modulos: ["salao", "delivery"], categories: ["Drinks", "Refrigerantes"] },
];

type Item = { name: string; category: string };
const pedido = (source: string, itens: [string, string][], extra: Record<string, unknown> = {}) => ({
  franchiseeId: LOJA,
  source,
  items: itens.map(([name, category]): Item => ({ name, category })),
  ...extra,
});

/** { impressora: [itens] } — o que sai em cada papel. */
const papel = (impressoras: ImpressoraConfigurada[], p: ReturnType<typeof pedido>) =>
  Object.fromEntries(destinosDoPedido(impressoras, p).map((d) => [d.impressora.name, d.itens.map((i) => i.name)]));

console.log("\n— Ragnar Burger, jantar de 24/09/2026 —");

confere(
  "#3 salão (burger, 2 sucos, batata): nada no BAR nem no BALCAO",
  papel(RAGNAR, pedido("PRESENCIAL", [["Thor", "Burgers"], ["Suco de Abacaxi", "Sucos"], ["Suco de Morango", "Sucos"], ["Batata Frita", "Entradas"]])),
  { "COZINHA PIZZA": ["Suco de Abacaxi", "Suco de Morango"], "COZINHA ENTREGA RAGNA": ["Thor", "Batata Frita"] }
);

confere(
  "#5 salão (só pastel): só a cozinha do burger",
  papel(RAGNAR, pedido("PRESENCIAL", [["Pastéis de Kattegat", "Entradas"]])),
  { "COZINHA ENTREGA RAGNA": ["Pastéis de Kattegat"] }
);

confere(
  "#7 salão (só caipiroska): só o BAR",
  papel(RAGNAR, pedido("PRESENCIAL", [["Caipiroska", "Drinks"]])),
  { BAR: ["Caipiroska"] }
);

confere(
  "#13 salão (combo, burger, drink): cada item na sua",
  papel(RAGNAR, pedido("PRESENCIAL", [["Combo Odin", "Combos"], ["Hel", "Burgers"], ["Hela", "Drinks"]])),
  { "COZINHA ENTREGA RAGNA": ["Combo Odin", "Hel"], BAR: ["Hela"] }
);

confere(
  "Refrigerante marcado em três: sai nas três, e só ele",
  papel(RAGNAR, pedido("PRESENCIAL", [["Coca-Cola Lata", "Refrigerantes"]])),
  { "COZINHA PIZZA": ["Coca-Cola Lata"], "COZINHA ENTREGA RAGNA": ["Coca-Cola Lata"], BAR: ["Coca-Cola Lata"] }
);

confere(
  "Cerveja no salão: só o BALCAO",
  papel(RAGNAR, pedido("PRESENCIAL", [["Heineken", "Cerveja"]])),
  { BALCAO: ["Heineken"] }
);

console.log("\n— O resgate continua valendo: item que NINGUÉM pediu não some —");

confere(
  "iFood da pizzaria (espelho, categoria \"iFood\"): pedido inteiro na cozinha da pizza",
  papel(RAGNAR, pedido("IFOOD", [["Pizza Pop + Guaraná 1l", "iFood"]], { ifoodStoreMerchant: IFOOD_PIZZA })),
  { "COZINHA PIZZA": ["Pizza Pop + Guaraná 1l"] }
);

confere(
  "iFood do burger (espelho): pedido inteiro na cozinha do burger",
  papel(RAGNAR, pedido("IFOOD", [["X-Egg", "iFood"]], { ifoodStoreMerchant: IFOOD_BURGER })),
  { "COZINHA ENTREGA RAGNA": ["X-Egg"] }
);

confere(
  "Categoria criada depois de configurar: vai para quem ficaria sem nada",
  papel(RAGNAR, pedido("PRESENCIAL", [["Thor", "Burgers"], ["Porção nova", "Petiscos"]])),
  { BALCAO: ["Porção nova"], "COZINHA PIZZA": ["Porção nova"], "COZINHA ENTREGA RAGNA": ["Thor"], BAR: ["Porção nova"] }
);

confere(
  "Item sem categoria nenhuma: idem",
  papel(RAGNAR, pedido("PRESENCIAL", [["Avulso", ""]])),
  { BALCAO: ["Avulso"], "COZINHA PIZZA": ["Avulso"], "COZINHA ENTREGA RAGNA": ["Avulso"], BAR: ["Avulso"] }
);

console.log("\n— Lojas com o desenho mais comum: CAIXA sem filtro + COZINHA filtrada —");

const CAIXA_COZINHA: ImpressoraConfigurada[] = [
  { name: "CAIXA", categories: [] },
  { name: "COZINHA", categories: ["Lanches", "Porções"] },
];

confere(
  "Lanche + refri: caixa tudo, cozinha só o lanche (igual a antes)",
  papel(CAIXA_COZINHA, pedido("ONLINE", [["X-Tudo", "Lanches"], ["Coca", "Bebidas"]])),
  { CAIXA: ["X-Tudo", "Coca"], COZINHA: ["X-Tudo"] }
);

confere(
  "Espelho do iFood: a cozinha continua recebendo o pedido inteiro",
  papel(CAIXA_COZINHA, pedido("IFOOD", [["X-Tudo", "iFood"], ["Coca", "iFood"]], { ifoodStoreMerchant: "x" })),
  { CAIXA: ["X-Tudo", "Coca"], COZINHA: ["X-Tudo", "Coca"] }
);

confere(
  "Espelho da Brendi (categoria \"Brendi\", source IFOOD): idem",
  papel(CAIXA_COZINHA, pedido("IFOOD", [["X-Tudo", "Brendi"]], { ifoodStoreMerchant: "x" })),
  { CAIXA: ["X-Tudo"], COZINHA: ["X-Tudo"] }
);

confere(
  "Só refri, e ninguém pediu Bebidas: a cozinha recebe (igual a antes)",
  papel(CAIXA_COZINHA, pedido("ONLINE", [["Coca", "Bebidas"]])),
  { CAIXA: ["Coca"], COZINHA: ["Coca"] }
);

console.log("\n— Chip de plataforma não rouba o pedido da cozinha —");

const COM_CHIP_IFOOD: ImpressoraConfigurada[] = [
  { name: "IFOOD", categories: ["iFood"] },
  { name: "COZINHA", categories: ["Lanches"] },
];

confere(
  "Espelho do iFood com impressora \"iFood\": as duas recebem",
  papel(COM_CHIP_IFOOD, pedido("IFOOD", [["X-Tudo", "iFood"]], { ifoodStoreMerchant: "x" })),
  { IFOOD: ["X-Tudo"], COZINHA: ["X-Tudo"] }
);

confere(
  "Jotajá (chip com acento, source sem): idem",
  papel([{ name: "JOTA", categories: ["Jotajá"] }, { name: "COZINHA", categories: ["Lanches"] }], pedido("JOTAJA", [["X-Tudo", "Jotajá"]])),
  { JOTA: ["X-Tudo"], COZINHA: ["X-Tudo"] }
);

console.log("\n— Só bebida e módulo —");

confere(
  "Só bebida recebe o pedido inteiro (o Assistente separa) e não rouba categoria",
  papel([{ name: "BAR", somenteBebidas: true }, { name: "COZINHA", categories: ["Lanches"] }], pedido("PRESENCIAL", [["X-Tudo", "Lanches"], ["Coca", "Bebidas"]])),
  { BAR: ["X-Tudo", "Coca"], COZINHA: ["X-Tudo"] }
);

confere(
  "Cerveja em pedido de delivery: o BALCAO (só salão) não conta como dono dela",
  papel(RAGNAR, pedido("ONLINE", [["Thor", "Burgers"], ["Heineken", "Cerveja"]])),
  { "COZINHA PIZZA": ["Heineken"], "COZINHA ENTREGA RAGNA": ["Thor"], BAR: ["Heineken"] }
);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
