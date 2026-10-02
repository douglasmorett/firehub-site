/**
 * "Não imprimir as bebidas lançadas na mesa" (lib/bebida-da-mesa.ts) e
 * "Selecionar itens para impressão" (lib/selecao-de-impressao.ts).
 *
 *   npx tsx scripts/teste-bebida-da-mesa.ts
 *
 * O caso da Delícia de Casa (02/10/2026): no salão o garçom serve a bebida da
 * geladeira; a comanda "2x Coca Lata" só atrapalha a cozinha. Delivery e
 * balcão não mudam, a conta da mesa continua com tudo, e a bebida que o
 * atendente MARCAR na seleção manual imprime.
 */
import { comandaDaMesaSemBebida, mesaSemBebidaNaComanda } from "../src/lib/bebida-da-mesa";
import { escolherItensDaMesa } from "../src/lib/selecao-de-impressao";
import { destinosDoPedido } from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const nomes = (p: { items?: any[] | null } | null) => (p ? (p.items || []).map((i) => i.name) : null);

const LIGADA = { mesaSemBebidaNaComanda: true };
const DESLIGADA = {};

// Itens no formato da fila da nuvem (item do banco com o produto inteiro).
const xBurguer = { name: "X-Burguer", quantity: 2, price: 28, menuProduct: { name: "X-Burguer", category: "Lanches", isBeverage: false } };
const cocaLata = { name: "Coca-Cola Lata 350ml", quantity: 2, price: 7, menuProduct: { name: "Coca-Cola Lata 350ml", category: "Bebidas", isBeverage: true } };
const heineken = { name: "Heineken Long Neck", quantity: 1, price: 12, menuProduct: { name: "Heineken Long Neck", category: "Cervejas", isBeverage: false } };
// Marcado como bebida no cadastro, mas numa categoria que não diz nada.
const aguaDeCoco = { name: "Água de Coco", quantity: 1, price: 8, menuProduct: { name: "Água de Coco", category: "Diversos", isBeverage: true } };
// Nome com palavra de bebida, categoria de comida: é comida.
const fileAoVinho = { name: "Filé ao Molho de Vinho", quantity: 1, price: 59, menuProduct: { name: "Filé ao Molho de Vinho", category: "Pratos", isBeverage: false } };
const comboFamilia = {
  name: "Combo Família",
  quantity: 1,
  price: 89,
  menuProduct: { name: "Combo Família", category: "Combos", isBeverage: false },
  comboSelections: [{ name: "Batata Frita", quantity: 1 }, { name: "Guaraná 2L", quantity: 1 }],
  opcoesParaImpressao: [
    { name: "Batata Frita", quantity: 1, category: "Porções" },
    { name: "Guaraná 2L", quantity: 1, category: "Bebidas" },
  ],
};

const naMesa = (items: any[], extra: Record<string, unknown> = {}) => ({
  id: "ped1",
  source: "PRESENCIAL",
  deliveryType: "MESA",
  tableSessionId: "sess_mesa_7",
  totalAmount: items.reduce((s, i) => s + i.price * i.quantity, 0),
  items,
  ...extra,
});

console.log("\n— A opção é por loja e nasce desligada —");
confere("sem a chave = desligada", mesaSemBebidaNaComanda(DESLIGADA), false);
confere("\"true\" em texto não liga", mesaSemBebidaNaComanda({ mesaSemBebidaNaComanda: "true" }), false);
confere("só true liga", mesaSemBebidaNaComanda(LIGADA), true);
const pedidoMisto = naMesa([xBurguer, cocaLata]);
confere("desligada: o mesmo pedido, intocado", comandaDaMesaSemBebida(pedidoMisto, DESLIGADA) === pedidoMisto, true);

console.log("\n— Ligada, lançamento na mesa —");
const semCoca = comandaDaMesaSemBebida(pedidoMisto, LIGADA);
confere("X-Burguer + Coca → só o X-Burguer", nomes(semCoca), ["X-Burguer"]);
confere("o total do papel desconta a Coca (70 − 14 = 56)", semCoca?.totalAmount, 56);
confere("o pedido original não é alterado", nomes(pedidoMisto), ["X-Burguer", "Coca-Cola Lata 350ml"]);
confere("só bebida (Coca + Heineken pela categoria Cervejas) → nenhum papel", comandaDaMesaSemBebida(naMesa([cocaLata, heineken]), LIGADA), null);
confere("isBeverage do cadastro em categoria \"Diversos\" também sai", nomes(comandaDaMesaSemBebida(naMesa([xBurguer, aguaDeCoco]), LIGADA)), ["X-Burguer"]);
confere("\"Filé ao Molho de Vinho\" em Pratos continua (é comida)", nomes(comandaDaMesaSemBebida(naMesa([fileAoVinho, cocaLata]), LIGADA)), ["Filé ao Molho de Vinho"]);
const combo = comandaDaMesaSemBebida(naMesa([comboFamilia]), LIGADA);
confere("combo com Guaraná sai inteiro", nomes(combo), ["Combo Família"]);
confere("…mas sem a linha do Guaraná para a impressora de bebidas", combo?.items?.[0]?.opcoesParaImpressao, [{ name: "Batata Frita", quantity: 1, category: "Porções" }]);
confere("…e as escolhas do combo no papel ficam como estão", combo?.items?.[0]?.comboSelections, comboFamilia.comboSelections);
const soComida = naMesa([xBurguer, fileAoVinho]);
confere("sem bebida nenhuma: o mesmo objeto", comandaDaMesaSemBebida(soComida, LIGADA) === soComida, true);

console.log("\n— Ligada, mas não é lançamento na mesa —");
const delivery = { source: "SITE", deliveryType: "DELIVERY", tableSessionId: null, totalAmount: 70, items: [xBurguer, cocaLata] };
confere("delivery do site: intocado", comandaDaMesaSemBebida(delivery, LIGADA) === delivery, true);
const balcao = { source: "PRESENCIAL", deliveryType: "RETIRADA", totalAmount: 14, items: [cocaLata] };
confere("refrigerante no balcão: intocado", comandaDaMesaSemBebida(balcao, LIGADA) === balcao, true);
const mesa20DoPdv = { source: "PRESENCIAL", deliveryType: "MESA", customerAddress: "Mesa 20", totalAmount: 14, items: [cocaLata] };
confere("\"Mesa 20\" digitado no balcão (sem conta aberta): intocado", comandaDaMesaSemBebida(mesa20DoPdv, LIGADA) === mesa20DoPdv, true);

console.log("\n— Escolha explícita vence —");
const selecao = naMesa([cocaLata], { selecaoManual: true });
confere("seleção manual com a Coca: imprime a Coca", nomes(comandaDaMesaSemBebida(selecao, LIGADA)), ["Coca-Cola Lata 350ml"]);

console.log("\n— Navegador: o item de papel não leva isBeverage —");
// Formato do GlobalPrintListener: name/qty/price/category, sem o produto.
const papelAgua = { name: "Água de Coco", qty: 1, price: 8, category: "Diversos" };
const papelBurguer = { name: "X-Burguer", qty: 2, price: 28, category: "Lanches" };
const doFeed = [{ menuProduct: { isBeverage: false } }, { menuProduct: { isBeverage: true } }];
const pedidoDoNavegador = { source: "PRESENCIAL", tableSessionId: "sess_mesa_7", totalAmount: 64, items: [papelBurguer, papelAgua] };
confere("sem a dica do cadastro, \"Água de Coco\" em Diversos fica (na dúvida é comida)", nomes(comandaDaMesaSemBebida(pedidoDoNavegador, LIGADA)), ["X-Burguer", "Água de Coco"]);
confere("com a dica pela posição (poll traz isBeverage), sai — igual à fila",
  nomes(comandaDaMesaSemBebida(pedidoDoNavegador, LIGADA, (_i, k) => doFeed[k]?.menuProduct?.isBeverage === true)), ["X-Burguer"]);

console.log("\n— Com as impressoras de verdade (roteamento da fila) —");
const cozinha = { name: "ELGIN COZINHA", categories: ["Lanches", "Pratos", "Combos"], modulos: [] as any[] };
const bar = { name: "EPSON BAR", categories: ["Bebidas", "Cervejas"], modulos: [] as any[] };
const destinos = (p: any) => (p ? destinosDoPedido([cozinha, bar], p).map((d) => `${d.impressora.name}: ${d.itens.map((i: any) => i.name).join(", ")}`) : []);
confere("desligada: cozinha com o burguer, bar com a Coca", destinos(pedidoMisto), ["ELGIN COZINHA: X-Burguer", "EPSON BAR: Coca-Cola Lata 350ml"]);
confere("ligada: só a cozinha, e só o burguer", destinos(comandaDaMesaSemBebida(pedidoMisto, LIGADA)), ["ELGIN COZINHA: X-Burguer"]);
// A armadilha "de ninguém": a loja tira Bebidas de todas as impressoras
// achando que resolve. A Coca vira item que ninguém pediu e sai em TODAS.
const cozinhaSemBebida = { name: "ELGIN COZINHA", categories: ["Lanches"], modulos: [] as any[] };
const balcaoImp = { name: "EPSON BALCAO", categories: ["Sobremesas"], modulos: [] as any[] };
const soCoca = naMesa([cocaLata]);
confere("só configuração (Bebidas desmarcada em todas): a Coca sozinha sai nas DUAS",
  destinosDoPedido([cozinhaSemBebida, balcaoImp], soCoca).map((d) => d.impressora.name), ["ELGIN COZINHA", "EPSON BALCAO"]);
confere("com a opção: nenhum papel", comandaDaMesaSemBebida(soCoca, LIGADA), null);
const comboNoBar = destinos(comandaDaMesaSemBebida(naMesa([comboFamilia]), LIGADA));
confere("combo com Guaraná, ligada: só a cozinha (sem \"Guaraná (do Combo)\" no bar)", comboNoBar, ["ELGIN COZINHA: Combo Família"]);
confere("seleção manual da Coca, ligada: sai no bar, a impressora de sempre dela",
  destinos(comandaDaMesaSemBebida(naMesa([cocaLata], { selecaoManual: true }), LIGADA)), ["EPSON BAR: Coca-Cola Lata 350ml"]);

console.log("\n— Selecionar itens para impressão —");
const pedidosDaMesa = [
  { id: "o14", dailyOrderNumber: 14, status: "ACEITO", createdAt: "2026-10-02T20:40:00Z", items: [{ id: "i4", nome: "Pudim" }] },
  { id: "o12", dailyOrderNumber: 12, status: "ACEITO", createdAt: "2026-10-02T20:05:00Z", items: [{ id: "i1", nome: "X-Burguer" }, { id: "i2", nome: "Coca" }] },
  { id: "o13", dailyOrderNumber: 13, status: "CANCELADO", createdAt: "2026-10-02T20:20:00Z", items: [{ id: "i3", nome: "Batata" }] },
];
const ok = escolherItensDaMesa(pedidosDaMesa, ["i4", "i2", "i1"]);
confere("na ordem da mesa (pedido mais antigo primeiro), não na dos cliques", ok.ok ? ok.itens.map((x) => x.item.id) : ok, ["i1", "i2", "i4"]);
confere("número de dois pedidos no topo do papel", ok.ok ? ok.numeros : ok, "12/14");
const um = escolherItensDaMesa(pedidosDaMesa, ["i2"]);
confere("um pedido só: o número dele", um.ok ? um.numeros : um, "12");
confere("clique repetido conta uma vez", (() => { const r = escolherItensDaMesa(pedidosDaMesa, ["i1", "i1"]); return r.ok ? r.itens.length : r; })(), 1);
confere("nada marcado: recusa", escolherItensDaMesa(pedidosDaMesa, []).ok, false);
confere("corpo malformado: recusa", escolherItensDaMesa(pedidosDaMesa, "i1").ok, false);
confere("item de pedido cancelado: recusa a seleção inteira", escolherItensDaMesa(pedidosDaMesa, ["i1", "i3"]).ok, false);
confere("item que não é desta mesa: recusa", escolherItensDaMesa(pedidosDaMesa, ["i1", "outro"]).ok, false);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
