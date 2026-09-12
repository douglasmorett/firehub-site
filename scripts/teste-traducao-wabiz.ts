/**
 * scripts/teste-traducao-wabiz.ts
 *
 * Trava a tradução do pedido da Wabiz para o CustomerOrder. Não há teste
 * automatizado neste repositório; rode à mão antes de mexer em
 * lib/wabiz-traducao.ts:
 *
 *   npx tsx scripts/teste-traducao-wabiz.ts
 *
 * Os pedidos abaixo são os exemplos da documentação oficial
 * (docs.believery.com.br → Pedidos Pendentes → Consulta), copiados como vieram.
 */
import { traduzirPedidoWabiz, horaLocalParaInstante } from "../src/lib/wabiz-traducao";

const ctx = { lojaId: "loja-teste", fuso: "America/Sao_Paulo", autoAcceptOrders: true };

const cliente = { name: "Anderson Zanardi", email: "dev@wabiz.com.br", phoneCode: "11", phoneNumber: "99999999", document: "88931477180" };

// Exemplo "Delivery": 1 pizza inteira sem opções + 2 refrigerantes, dinheiro com troco para 100.
const delivery: any = {
  orderNumber: 3378, status: 1, internalKey: "b32bb1f2-5ee7-702d-ef7c-7965db3f8923", dateTime: "2018-03-16 14:21:08", obs: null, customer: cliente,
  items: [
    { groupName: "Pizzas", subGroupName: "Pizzas", products: [{ pos: 1, qty: 1, price: 40, unity: "grande", parts: [{ name: "Alho e Óleo", price: 40, externalCode: "111", customization: { additionals: [], edge: {}, others: [] }, obs: null }] }] },
    { groupName: "Bebidas", subGroupName: "Refrigerantes e outros", products: [{ pos: 1, qty: 2, price: 9, unity: "un", parts: [{ name: "Coca-Cola Normal 2 Litros", price: 9, externalCode: "998", customization: null, obs: null }] }] },
  ],
  service: { type: "delivery", delivery: { address: "Rua Principal", number: 123, compl: null, region: "Almerinda Chaves", postalCode: "12345678", city: "Jundiaí", state: "SP", tax: 4, referencePoint: null, payment: { type: 1, name: "Dinheiro", value: 100, externalCode: "DIN" } } },
  priceRules: null, total: 62, discounts: 0,
};

// Exemplo "Retirada no Balcão": inteira com adicional e borda + meio-a-meio com adicionais, bordas, massa e obs.
const retirada: any = {
  orderNumber: 3379, status: 1, internalKey: "d926068f-e7de-832d-a9e6-af148829fc75", dateTime: "2018-03-16 14:26:43", obs: null, customer: cliente,
  items: [{ groupName: "Pizzas", subGroupName: "Pizzas", products: [
    { pos: 1, qty: 1, price: 46.9, unity: "grande", parts: [{ name: "Alho e Óleo", price: 40, externalCode: "111", customization: { additionals: [{ name: "Adicionais", options: [{ externalCode: "1001", name: "Bacon", price: 3 }] }], edge: { name: "Borda", options: [{ externalCode: "3003", name: "Cheddar", price: 3.9 }] }, others: [{ name: "Tipo de massa", options: [] }] }, obs: null }] },
    { pos: 2, qty: 1, price: 60.9, unity: "grande", parts: [
      { name: "Aliche", price: 48, externalCode: "222", customization: { additionals: [{ name: "Adicionais", options: [{ externalCode: "1001", name: "Bacon", price: 3 }] }], edge: { name: "Borda", options: [] }, others: [{ name: "Tipo de massa", options: [] }] }, obs: null },
      { name: "Americana", price: 35.9, externalCode: "444", customization: { additionals: [{ name: "Adicionais", options: [{ externalCode: "1003", name: "Alho Frito", price: 1 }, { externalCode: "1001", name: "Bacon", price: 3 }] }], edge: { name: "Borda", options: [{ externalCode: "3002", name: "Catupiry", price: 3.9 }] }, others: [{ name: "Tipo de massa", options: [{ externalCode: "2003", name: "Grossa", price: 2 }] }] }, obs: "Sem cebola" },
    ] },
  ] }],
  service: { type: "pickup" }, priceRules: null, total: 107.8, discounts: 0,
};

// Exemplo "Pedido na mesa" e "Encomenda para Delivery" (agendada).
const mesa: any = {
  orderNumber: 3381, status: 1, internalKey: "bd33c5f6-045b-7989-8e14-5d7491174577", dateTime: "2018-03-19 14:55:01", obs: null, customer: cliente,
  items: [{ groupName: "Pizzas", subGroupName: "Pizzas", products: [{ pos: 1, qty: 1, price: 30, unity: "grande", parts: [{ name: "Alho e Óleo", price: 29, externalCode: "111", customization: { additionals: [], edge: { name: "Borda", options: [{ externalCode: "3001", name: "Sem recheio", price: 0 }] }, others: [{ name: "Tipo de massa", options: [{ externalCode: "2002", name: "Média", price: 1 }] }] }, obs: null }] }] }],
  service: { type: "table", tableCode: "0001", tablePassword: "12345" }, priceRules: null, total: 30, discounts: 0,
};

const encomenda: any = {
  ...mesa, orderNumber: 3383, internalKey: "555a213b-4b86-561a-c4b9-1f38ae008319", dateTime: "2018-03-19 16:01:37",
  service: { type: "scheduleOrder_delivery", scheduleDatetime: "2018-03-20 12:00:00", delivery: { address: "Rua Principal", number: 123, compl: null, region: "Almerinda Chaves", postalCode: "12345678", city: "Jundiaí", state: "SP", tax: 4, referencePoint: null, payment: { type: 1, name: "Dinheiro", value: 50, externalCode: "DIN" } } },
  total: 34,
};

const maquininha: any = { ...delivery, service: { ...delivery.service, delivery: { ...delivery.service.delivery, payment: { type: 3, name: "Cartão (trazer maquininha)", value: 62, externalCode: "MAS", cardFlag: "Visa" } } } };
const online: any = { ...delivery, service: { ...delivery.service, delivery: { ...delivery.service.delivery, payment: { type: 4, name: "Pagamento Online", value: 62, externalCode: "ONL" } } } };

// Pedido REAL nº 1 da sandbox (unidade 110), 12/09/2026, copiado de orders/pending.
// Diferenças para a doc: borda em `others` ("Bordas"), `groupExternalCode`,
// `acceptPartition`, `priceRules` preenchido e `unity: "un"` numa pizza.
const real1: any = {"orderNumber":1,"status":1,"internalKey":"743615e4-05a4-c278-de7e-433da1835c62","dateTime":"2026-09-12 20:25:54","obs":"PEDIDO DE TESTE DA INTEGRACAO FIREHUB - nao produzir","customer":{"name":"Teste FireHub","email":null,"phoneCode":"11","phoneNumber":"987654321","document":null},"items":[{"groupName":"Pizzas Grande","groupExternalCode":"35265889","subGroupName":"Pizzas Tradicionais","sugGroupExternalCode":null,"products":[{"pos":1,"qty":1,"price":68.9,"unity":"un","parts":[{"name":"Calabresa","price":56.9,"externalCode":"35265889.23734216","customization":{"additionals":[],"edge":{},"others":[{"name":"Bordas","options":[{"externalCode":"35265889.23734132","name":"Catupiry Original","acceptPartition":false,"price":12.0}]}]},"obs":"TESTE FIREHUB - sem cebola"}]}]}],"service":{"type":"delivery","delivery":{"address":"Rua Barão de Jundiaí","number":"100","compl":"Apto 12 - TESTE FIRE","region":"Centro","postalCode":"13201010","city":"Jundiaí","state":"SP","tax":5,"referencePoint":"Pedido de teste da integração","payment":{"type":1,"name":"Dinheiro","value":100,"externalCode":"1"}}},"priceRules":{"partitionPriceMode":"highest","extrasPriceMode":"proportionalToFinal"},"total":73.9,"discounts":0};

let falhas = 0;
function confere(rotulo: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${rotulo}${ok ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     obtido:   ${JSON.stringify(obtido)}`}`);
}

{
  const { dados, items } = traduzirPedidoWabiz(delivery, ctx);
  confere("delivery: ids", [dados.openDeliveryOrderId, dados.openDeliveryReference, dados.source, dados.openDeliveryChannel], ["b32bb1f2-5ee7-702d-ef7c-7965db3f8923", "3378", "WABIZ", "WABIZ"]);
  confere("delivery: tipo, total e taxa", [dados.deliveryType, dados.totalAmount, dados.deliveryFee], ["DELIVERY", 62, 4]);
  confere("delivery: soma dos itens + taxa = total", items.reduce((s: number, i: any) => s + i.price * i.quantity, 0) + dados.deliveryFee, 62);
  confere("delivery: nomes dos itens", items.map((i: any) => [i.productName, i.quantity, i.price]), [["Alho e Óleo (grande)", 1, 40], ["Coca-Cola Normal 2 Litros", 2, 9]]);
  confere("delivery: dinheiro com troco para 100", [dados.paymentMethod, dados.changeAmount], ["Dinheiro (Cobrar na Entrega)", 100]);
  confere("delivery: endereço completo", dados.customerAddress, "Rua Principal, 123 - Almerinda Chaves - Jundiaí/SP - CEP 12345678");
  confere("delivery: telefone com DDD", dados.customerPhone, "1199999999");
  confere("delivery: aceite automático → ACEITO", dados.status, "ACEITO");
  confere("delivery: refrigerante marcado como bebida", items[1].menuProduct.connectOrCreate.create.isBeverage, true);
  confere("delivery: espelho carrega a loja no id", items[0].menuProduct.connectOrCreate.where.id, "wabiz-loja-teste-111");
}

{
  const { dados, items } = traduzirPedidoWabiz(retirada, ctx);
  confere("retirada: tipo e pagamento sem dados", [dados.deliveryType, dados.deliveryFee, dados.changeAmount], ["RETIRADA", 0, null]);
  confere("retirada: soma dos itens = total", items.reduce((s: number, i: any) => s + i.price * i.quantity, 0), 107.8);
  confere("retirada: inteira com borda e adicional", items[0].productName, "Alho e Óleo (grande) | Borda Cheddar | Bacon");
  confere(
    "retirada: meio-a-meio diz de qual metade é cada opção",
    items[1].productName,
    "1/2 Aliche + 1/2 Americana (grande) | Aliche: Bacon | Americana: Borda Catupiry | Americana: Grossa | Americana: Alho Frito | Americana: Bacon"
  );
  confere("retirada: obs da metade vai para as notas", dados.notes.includes("📝 Americana: Sem cebola"), true);
  confere("retirada: comboSelections é JSON", JSON.parse(items[1].comboSelections).length, 5);
}

{
  const { dados } = traduzirPedidoWabiz(mesa, { ...ctx, autoAcceptOrders: false });
  confere("mesa: número e senha nas notas", dados.notes.includes("MESA 0001 (senha 12345)"), true);
  confere("mesa: sem aceite automático → NOVO", dados.status, "NOVO");
}

{
  const { dados } = traduzirPedidoWabiz(encomenda, ctx);
  confere("encomenda: é entrega", dados.deliveryType, "DELIVERY");
  confere("encomenda: horário agendado no fuso da loja (12h SP = 15h UTC)", dados.scheduledDatetime.toISOString(), "2018-03-20T15:00:00.000Z");
  confere("encomenda: nota de agendamento", dados.notes.includes("AGENDADO"), true);
  confere("encomenda: dinheiro para 50 em total 34 → troco", dados.changeAmount, 50);
}

{
  const { dados, items } = traduzirPedidoWabiz(real1, ctx);
  confere("real nº1: borda que vem em `others` sai com rótulo", items.map((i: any) => [i.productName, i.quantity, i.price]), [["Calabresa | Borda Catupiry Original", 1, 68.9]]);
  confere("real nº1: item + taxa = total", items[0].price + dados.deliveryFee, 73.9);
  confere("real nº1: troco, telefone e referência", [dados.changeAmount, dados.customerPhone, dados.notes.includes("Referência: Pedido de teste")], [100, "11987654321", true]);
  confere("real nº1: hora local SP → UTC", traduzirPedidoWabiz({ ...real1, service: { type: "scheduleOrder_pickup", scheduleDatetime: "2026-09-12 20:25:54" } }, ctx).dados.scheduledDatetime.toISOString(), "2026-09-12T23:25:54.000Z");
}

{
  // Pedido REAL nº 2: meio-a-meio com uma metade SEM código, 2 Cocas com código null, débito.
  const real2: any = {"orderNumber":2,"status":1,"internalKey":"916e6fd1-6071-5dd0-6d16-3aead462f8bb","dateTime":"2026-09-12 20:34:04","obs":"TESTE 2 FIREHUB - sera cancelado","customer":{"name":"Teste FireHub","email":null,"phoneCode":"11","phoneNumber":"987654321","document":null},"items":[{"groupName":"Pizzas Grande","groupExternalCode":"35265889","subGroupName":"Pizzas Tradicionais","sugGroupExternalCode":null,"products":[{"pos":1,"qty":1,"price":73.9,"unity":"un","parts":[{"name":"Portuguesa","price":57.9,"externalCode":"35265889.23734253","customization":{"additionals":[{"name":"Adicionais","options":[{"externalCode":"35265889.23734120","name":"Bacon","acceptPartition":true,"price":8.0}]}],"edge":{},"others":[]},"obs":null},{"name":"Muçarela","price":54.9,"externalCode":"","customization":{"additionals":[],"edge":{},"others":[{"name":"Bordas","options":[{"externalCode":"35265889.23734147","name":"Cheddar","acceptPartition":false,"price":12.0}]}]},"obs":"metade muçarela bem assada"}]}]},{"groupName":"Bebidas","groupExternalCode":null,"subGroupName":"Refrigerantes","sugGroupExternalCode":null,"products":[{"pos":1,"qty":2,"price":14.5,"unity":"un","parts":[{"name":"Coca Cola 2l","price":14.5,"externalCode":null,"customization":null,"obs":null}]}]}],"service":{"type":"delivery","delivery":{"address":"Rua Barão de Jundiaí","number":"100","compl":"Apto 12 - TESTE FIRE","region":"Centro","postalCode":"13201010","city":"Jundiaí","state":"SP","tax":5,"referencePoint":"Pedido de teste da integração","payment":{"type":3,"name":"Cartão (trazer maquininha)","value":107.9,"externalCode":"3","cardFlag":"Débito"}}},"priceRules":{"partitionPriceMode":"highest","extrasPriceMode":"proportionalToFinal"},"total":107.9,"discounts":0};
  const { dados, items } = traduzirPedidoWabiz(real2, ctx);
  confere("real nº2: nomes", items.map((i: any) => [i.productName, i.quantity, i.price]), [["1/2 Portuguesa + 1/2 Muçarela | Portuguesa: Bacon | Muçarela: Borda Cheddar", 1, 73.9], ["Coca Cola 2l", 2, 14.5]]);
  confere("real nº2: itens + taxa = total", items.reduce((s: number, i: any) => s + i.price * i.quantity, 0) + dados.deliveryFee, 107.9);
  confere("real nº2: espelho do meio-a-meio NÃO é o da Portuguesa inteira", items[0].menuProduct.connectOrCreate.where.id, "wabiz-loja-teste-35265889.23734253+mucarela");
  confere("real nº2: débito na maquininha, sem troco", [dados.paymentMethod, dados.changeAmount], ["Cartão Débito (Cobrar na Entrega)", null]);
  confere("real nº2: Coca sem código vira espelho pelo nome e é bebida", [items[1].menuProduct.connectOrCreate.where.id, items[1].menuProduct.connectOrCreate.create.isBeverage], ["wabiz-loja-teste-coca-cola-2l", true]);
}

confere("maquininha: cobra na entrega com bandeira", traduzirPedidoWabiz(maquininha, ctx).dados.paymentMethod, "Cartão Visa (Cobrar na Entrega)");
confere("online: chega pago", traduzirPedidoWabiz(online, ctx).dados.paymentMethod, "Pagamento Online (Wabiz) (Pago Online)");
confere("hora local de Manaus (UTC-4)", horaLocalParaInstante("2026-09-12 20:00:00", "America/Manaus")?.toISOString(), "2026-09-13T00:00:00.000Z");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
