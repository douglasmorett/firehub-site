/**
 * "Pedido misto: comanda inteira" na impressora (lib/roteamento-de-impressao.ts
 * → itensDaImpressora, campo `comandaInteiraNoMisto`).
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-pedido-misto-comanda-inteira.ts
 *
 * O caso da NIK Esfihas e Pizzas (Danilo, 14/10/2026): impressora "Pizza"
 * (categorias de pizza) e "Esfiha" (categorias de esfiha). O pedido com pizza
 * e esfiha saía dividido; a loja quer o pedido completo nas duas. Pedido só
 * de pizza continua só na Pizza; só de esfiha, só na Esfiha.
 *
 * Duas provas, sem banco: a fila da nuvem (destinosDoPedido, o que o servidor
 * manda em `destinos` ao Assistente) e o PAINEL (lib/print.ts) com um
 * Assistente falso — os dois trilhos têm de decidir igual.
 */
import { destinosDoPedido, restoDoPedido, type ImpressoraConfigurada } from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const PIZZA: ImpressoraConfigurada = { id: "pz", name: "PIZZA", categories: ["Pizzas Salgadas", "Pizzas Doces"] };
const ESFIHA: ImpressoraConfigurada = { id: "es", name: "ESFIHA", categories: ["Esfihas Salgadas", "Esfihas Doces"] };
const inteira = (p: ImpressoraConfigurada) => ({ ...p, comandaInteiraNoMisto: true });

const CALABRESA = { name: "Pizza Calabresa G", category: "Pizzas Salgadas", quantity: 1, qty: 1, price: 59.9 };
const ESF_CARNE = { name: "Esfiha de Carne", category: "Esfihas Salgadas", quantity: 6, qty: 6, price: 4.9 };
const COCA = { name: "Coca-Cola 2L", category: "Bebidas", quantity: 1, qty: 1, price: 14 };
const COMBO = {
  name: "Combo Família",
  category: "Combos",
  quantity: 1,
  qty: 1,
  price: 79.9,
  opcoesParaImpressao: [{ name: "Esfiha de Queijo", quantity: 4, category: "Esfihas Salgadas" }],
};

const pedido = (items: any[]) => ({ id: "nik-1", franchiseeId: "nik", source: "PRESENCIAL", deliveryType: "RETIRADA", items });
const MISTO = pedido([CALABRESA, ESF_CARNE, COCA]);
const SO_PIZZA = pedido([CALABRESA]);
const PIZZA_E_COCA = pedido([CALABRESA, COCA]);
const SO_ESFIHA = pedido([ESF_CARNE]);

// A fila da nuvem: impressora → nomes dos itens que ela recebe.
const fila = (impressoras: ImpressoraConfigurada[], p: any) =>
  Object.fromEntries(destinosDoPedido(impressoras, p).map((d) => [d.impressora.name, d.itens.map((i: any) => i.name)]));

console.log("\n— Fila da nuvem (destinos do Assistente) —");
confere(
  "desligada, misto: cada uma com a sua parte (a Coca, que ninguém pediu, não sai — regra de hoje)",
  fila([PIZZA, ESFIHA], MISTO),
  { PIZZA: ["Pizza Calabresa G"], ESFIHA: ["Esfiha de Carne"] }
);
confere(
  "ligada nas duas, misto: as duas com o pedido completo",
  fila([inteira(PIZZA), inteira(ESFIHA)], MISTO),
  { PIZZA: ["Pizza Calabresa G", "Esfiha de Carne", "Coca-Cola 2L"], ESFIHA: ["Pizza Calabresa G", "Esfiha de Carne", "Coca-Cola 2L"] }
);
confere(
  "ligada nas duas, só pizza: só a Pizza",
  fila([inteira(PIZZA), inteira(ESFIHA)], SO_PIZZA),
  { PIZZA: ["Pizza Calabresa G"] }
);
confere(
  "ligada nas duas, pizza + Coca: a Pizza leva inteiro e a Esfiha não tira papel só com a Coca (NIK, 14/10)",
  fila([inteira(PIZZA), inteira(ESFIHA)], PIZZA_E_COCA),
  { PIZZA: ["Pizza Calabresa G", "Coca-Cola 2L"] }
);
confere(
  "ligada nas duas, só esfiha: só a Esfiha",
  fila([inteira(PIZZA), inteira(ESFIHA)], SO_ESFIHA),
  { ESFIHA: ["Esfiha de Carne"] }
);
confere(
  "ligada só na Pizza, misto: a Pizza inteira, a Esfiha com a parte dela",
  fila([inteira(PIZZA), ESFIHA], MISTO),
  { PIZZA: ["Pizza Calabresa G", "Esfiha de Carne", "Coca-Cola 2L"], ESFIHA: ["Esfiha de Carne"] }
);
confere(
  "ligada nas duas, combo com esfiha escolhida + pizza: a escolha do combo conta como item da Esfiha",
  fila([inteira(PIZZA), inteira(ESFIHA)], pedido([CALABRESA, COMBO])),
  { PIZZA: ["Pizza Calabresa G", "Combo Família"], ESFIHA: ["Pizza Calabresa G", "Combo Família"] }
);
confere(
  "ligada nas duas, só bebida (de ninguém): o resgate de sempre",
  fila([inteira(PIZZA), inteira(ESFIHA)], pedido([COCA])),
  { PIZZA: ["Coca-Cola 2L"], ESFIHA: ["Coca-Cola 2L"] }
);

console.log("\n— Em outra impressora (restoDoPedido) —");
const destinos = destinosDoPedido([inteira(PIZZA), ESFIHA], MISTO as any);
const daPizza = destinos.find((d) => d.impressora.name === "PIZZA")!;
const daEsfiha = destinos.find((d) => d.impressora.name === "ESFIHA")!;
confere("comanda inteira: nada fica de fora", restoDoPedido(MISTO.items, daPizza.itens), undefined);
confere("a outra, sem a opção: a pizza e a Coca ficaram de fora", restoDoPedido(MISTO.items, daEsfiha.itens), { itens: 2, valor: 73.9 });

// ── O PAINEL (lib/print.ts) com um Assistente falso ─────────────────────────
async function painel() {
  console.log("\n— Painel (lib/print.ts): o que chega ao Assistente —");
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.endsWith("/status")) return new Response(JSON.stringify({ ok: true, versao: "1.2.34" }), { status: 200 });
    if (u.endsWith("/print")) {
      enviados.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  const { printOrder } = await import("../src/lib/print");
  const imprimir = async (printers: ImpressoraConfigurada[], p: any) => {
    enviados.length = 0;
    await (printOrder as any)(p, "NIK", { autoprint: true, printers }, {}, false);
    return Object.fromEntries(
      enviados.map((b) => [b.printer, { itens: b.order.items.map((i: any) => i.name), resto: b.order.restoDoPedido ?? null }])
    );
  };

  const tudo = ["Pizza Calabresa G", "Esfiha de Carne", "Coca-Cola 2L"];
  confere(
    "ligada nas duas, misto: as duas com o pedido completo, sem 'Em outra impressora'",
    await imprimir([inteira(PIZZA), inteira(ESFIHA)], MISTO),
    { PIZZA: { itens: tudo, resto: null }, ESFIHA: { itens: tudo, resto: null } }
  );
  confere(
    "ligada nas duas, só pizza: só a Pizza",
    await imprimir([inteira(PIZZA), inteira(ESFIHA)], SO_PIZZA),
    { PIZZA: { itens: ["Pizza Calabresa G"], resto: null } }
  );
  confere(
    "ligada só na Pizza, misto: a Pizza inteira, a Esfiha com a parte dela",
    await imprimir([inteira(PIZZA), ESFIHA], MISTO),
    {
      PIZZA: { itens: tudo, resto: null },
      ESFIHA: { itens: ["Esfiha de Carne"], resto: { itens: 2, valor: 73.9 } },
    }
  );
}

painel()
  .catch((e) => { falhas++; console.error("❌ painel:", e); })
  .finally(() => {
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
    process.exit(falhas ? 1 : 0);
  });
