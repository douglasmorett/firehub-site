/**
 * scripts/teste-traducao-cardapioweb.ts
 *
 * Trava o tradutor do CardápioWeb (src/lib/cardapioweb/traducao.ts) e o id do
 * pedido (src/lib/cardapioweb/id-do-pedido.ts). Puro: sem banco, sem rede.
 *
 *   npx tsx scripts/teste-traducao-cardapioweb.ts
 *
 * Os dois primeiros pedidos são os EXEMPLOS DA DOC, copiados como estão
 * (docs.cardapioweb.com → Consultar detalhes do pedido), inclusive o combo com
 * `items` aninhados que o schema não declara e os totais das etapas que não
 * fecham com as opções delas. Doc é promessa: o primeiro pedido real do
 * Sandbox entra aqui também.
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

import { traduzirPedidoCardapioWeb, filtroDoPedidoCW, marketplaceDoPedido, statusDoFireHubPara, type PedidoCW } from "../src/lib/cardapioweb/traducao";
import { idDoPedidoCW, lerIdDoPedidoCW, chaveDaLojaCW } from "../src/lib/cardapioweb/id-do-pedido";
import { chavesDeLojaDoPedido, impressoraAtendeLoja } from "../src/lib/loja-de-origem";
import { chaveDoCanal, canalDoPedido } from "../src/lib/canal-do-pedido";
import { ehProdutoDeIntegracao } from "../src/lib/cardapio-interno";

let falhas = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) console.log(`✅ ${nome}`);
  else {
    falhas++;
    console.log(`❌ ${nome}\n   esperado: ${b}\n   obtido:   ${a}`);
  }
}

const agora = new Date("2023-06-25T13:40:40Z");
const ctx = { lojaId: "loja-teste", fuso: "America/Sao_Paulo", autoAcceptOrders: false, ambiente: "producao" as const, companyId: "1", agora };
const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── Exemplo 1 da doc: retirada pelo portal, 2x Hamburguer com opções ────────
const docRetirada: PedidoCW = {
  id: 7637462,
  display_id: 48,
  merchant_id: 1,
  status: "confirmed",
  order_type: "takeout",
  order_timing: "immediate",
  sales_channel: "portal",
  customer_origin: null,
  driver_id: null,
  driver_fee: null,
  table_number: null,
  estimated_time: null,
  cancellation_reason: null,
  fiscal_document: null,
  observation: null,
  delivery_fee: 0,
  service_fee: 0,
  additional_fee: 0,
  total: 103.8,
  created_at: "2023-06-25T10:40:33.744-03:00",
  updated_at: "2023-06-25T10:40:34.207-03:00",
  schedule: null,
  customer: null,
  delivery_address: null,
  items: [
    {
      item_id: 208907,
      external_code: null,
      name: "Hamburguer",
      quantity: 2,
      unit_price: 12.9,
      total_price: 103.8,
      kind: "regular_item",
      status: "waiting",
      observation: null,
      options: [
        { option_id: 130101, external_code: null, name: "Brioche", quantity: 1, unit_price: 10, option_group_id: 18845, option_group_name: "Tipo de pão" },
        { option_id: 142, external_code: null, name: "Bacon", quantity: 1, unit_price: 4, option_group_id: 44476, option_group_name: "Adicionais Pagos" },
        { option_id: 147, external_code: null, name: "Latinha de Coca Cola", quantity: 1, unit_price: 5, option_group_id: 54310, option_group_name: "Selecione o Refri" },
        { option_id: 149, external_code: null, name: "Guaraná Antarctica Zero", quantity: 2, unit_price: 10, option_group_id: 54310, option_group_name: "Selecione o Refri" },
      ],
      items: [],
    },
  ],
  discounts: [],
  payments: [{ total: 103.8, payment_type: "offline", change_for: null, status: "pending", payment_method: "pix", card_number: null, card_brand: null, observation: null, payment_fee: 0 }],
};

// ── Exemplo 2 da doc: entrega agendada, combo aninhado, 3 pagamentos com taxa ─
const docEntrega: PedidoCW = {
  id: 7637461,
  display_id: 47,
  merchant_id: 1,
  status: "scheduled_confirmed",
  order_type: "delivery",
  order_timing: "scheduled",
  sales_channel: "portal",
  customer_origin: null,
  delivered_by: "merchant",
  driver_id: 42,
  driver_fee: 10.25,
  table_number: null,
  estimated_time: null,
  cancellation_reason: null,
  fiscal_document: null,
  observation: null,
  delivery_fee: 5,
  service_fee: 0,
  additional_fee: 8,
  total: 181.3,
  created_at: "2023-06-24T02:01:06.102-03:00",
  updated_at: "2023-06-24T02:01:07.414-03:00",
  schedule: { scheduled_date_time_start: "2023-06-27T07:40:00-03:00", scheduled_date_time_end: "2023-06-27T07:50:00-03:00" },
  customer: { id: 1574794, phone: "85994197929", name: "Matheus Lessa" },
  delivery_address: {
    street: "Av. Jovita Feitosa",
    number: "2992",
    address_block: null,
    address_lot: null,
    neighborhood: "Parquelândia",
    complement: "",
    reference: "Teste",
    postal_code: null,
    city: "Fortaleza",
    state: "CE",
    latitude: "-3.7413208",
    longitude: "-38.5645481",
  },
  items: [
    {
      item_id: 208907,
      external_code: null,
      name: "Hamburguer",
      quantity: 1,
      unit_price: 12.9,
      total_price: 28.9,
      kind: "regular_item",
      status: "waiting",
      observation: null,
      options: [
        { option_id: 130101, external_code: null, name: "Brioche", quantity: 1, total_price: 10, option_group_id: 18845, option_group_name: "Tipo de pão" },
        { option_id: 16298, external_code: "10", name: "Cebola", quantity: 1, total_price: 1, option_group_id: 44476, option_group_name: "Adicionais Pagos" },
        { option_id: 147, external_code: null, name: "Latinha de Coca Cola", quantity: 1, total_price: 5, option_group_id: 54310, option_group_name: "Selecione o Refri" },
      ],
      items: [],
    },
    {
      item_id: 208909,
      external_code: null,
      name: "Hamburguer + Pizza",
      quantity: 1,
      unit_price: 0,
      total_price: 137.9,
      kind: "combo",
      status: "waiting",
      observation: null,
      options: [],
      items: [
        {
          item_id: 208907,
          external_code: null,
          name: "Hamburguer",
          quantity: 1,
          unit_price: 12.9,
          total_price: 41,
          kind: "regular_item",
          status: "waiting",
          observation: null,
          options: [
            { option_id: 130102, external_code: null, name: "Pão Gergelim", quantity: 1, total_price: 10, option_group_id: 18845, option_group_name: "Tipo de pão" },
            { option_id: 16298, external_code: "10", name: "Cebola", quantity: 1, total_price: 1, option_group_id: 44476, option_group_name: "Adicionais Pagos" },
            { option_id: 147, external_code: null, name: "Latinha de Coca Cola", quantity: 1, total_price: 5, option_group_id: 54310, option_group_name: "Selecione o Refri" },
            { option_id: 149, external_code: null, name: "Guaraná Antarctica Zero", quantity: 1, total_price: 10, option_group_id: 54310, option_group_name: "Selecione o Refri" },
          ],
          items: [],
        },
        {
          item_id: 208908,
          external_code: null,
          name: "Pizza",
          quantity: 1,
          unit_price: 10,
          total_price: 96.9,
          kind: "regular_item",
          status: "waiting",
          observation: null,
          options: [
            { option_id: 336125, external_code: null, name: "Mussarela", quantity: 1, total_price: 40.95, option_group_id: 56843, option_group_name: "ESCOLHA O SABOR DA SUA PIZZA" },
            { option_id: 336126, external_code: null, name: "Portuguesa", quantity: 1, total_price: 40.95, option_group_id: 56843, option_group_name: "ESCOLHA O SABOR DA SUA PIZZA" },
          ],
          items: [],
        },
      ],
    },
  ],
  discounts: [{ kind: "discount", category: "other", total: 3, total_points: 0, coupon_id: null, coupon_name: null, item_id: null, item_name: null }],
  payments: [
    { total: 50, payment_fee: 0, payment_type: "offline", change_of: null, status: "pending", payment_method: "pix", card_number: null, card_brand: null, observation: null },
    { total: 31.5, payment_fee: 1.5, payment_type: "offline", change_of: null, status: "pending", payment_method: "credit_card", card_number: null, card_brand: null, observation: null },
    { total: 99.8, payment_fee: 3, payment_type: "offline", change_of: null, status: "pending", payment_method: "debit_card", card_number: null, card_brand: null, observation: null },
  ],
};

console.log("\n── Exemplo 1 da doc (retirada, opções, pix na entrega) ──");
{
  const decisao = filtroDoPedidoCW(docRetirada, { receberMarketplaces: false });
  confere("o filtro deixa entrar, já aceito lá", decisao, { importar: true, marketplace: null, statusInicial: "ACEITO" });
  const t = traduzirPedidoCardapioWeb(copia(docRetirada), { ...ctx, statusInicial: decisao.importar ? decisao.statusInicial : null });
  const d = t.dados;
  confere("canal, id com a loja, número curto", [d.source, d.openDeliveryChannel, d.openDeliveryOrderId, d.openDeliveryReference], ["CARDAPIOWEB", "CARDAPIOWEB", "cardapioweb_1_7637462", "48"]);
  confere("retirada", [d.deliveryType, d.customerAddress, d.deliveryBy], ["RETIRADA", "", "MERCHANT"]);
  confere("já confirmado lá → entra ACEITO mesmo sem aceite automático", d.status, "ACEITO");
  confere("1 linha, 2 unidades, preço da unidade = total ÷ 2", [t.items.length, t.items[0].quantity, t.items[0].price], [1, 2, 51.9]);
  confere("nome com as opções (Guaraná 2x por unidade)", t.items[0].productName, "Hamburguer | Brioche | Bacon | Latinha de Coca Cola | 2x Guaraná Antarctica Zero");
  confere(
    "opções com preço UNITÁRIO e quantidade por unidade do item",
    JSON.parse(t.items[0].comboSelections),
    [
      { id: "130101", name: "Brioche", quantity: 1, price: 10 },
      { id: "142", name: "Bacon", quantity: 1, price: 4 },
      { id: "147", name: "Latinha de Coca Cola", quantity: 1, price: 5 },
      { id: "149", name: "Guaraná Antarctica Zero", quantity: 2, price: 10 },
    ],
  );
  confere("espelho com a loja do FireHub e a do CardápioWeb", t.espelhos[0], { id: "cardapioweb-loja-teste-1-208907", nome: "Hamburguer" });
  confere("espelho inativo, categoria do canal", [t.items[0].menuProduct.connectOrCreate.create.active, t.items[0].menuProduct.connectOrCreate.create.category], [false, "CardápioWeb"]);
  confere("pix manual pendente: cobrar na entrega", [d.paymentMethod, d.changeAmount], ["Pix (Cobrar na Entrega)", null]);
  confere("sem cliente (portal): nome padrão, sem telefone", [d.customerName, d.customerPhone], ["Cliente CardápioWeb", ""]);
  confere("total conferido sem aviso", [d.totalAmount, t.avisos], [103.8, []]);
}

console.log("\n── Exemplo 2 da doc (entrega agendada, combo aninhado, 3 pagamentos) ──");
{
  const t = traduzirPedidoCardapioWeb(copia(docEntrega), { ...ctx, statusInicial: "ACEITO" });
  const d = t.dados;
  confere("entrega da loja", [d.deliveryType, d.deliveryBy], ["DELIVERY", "MERCHANT"]);
  confere("endereço no formato que os relatórios leem", d.customerAddress, "Av. Jovita Feitosa, 2992 - Ref: Teste - Parquelândia - Fortaleza");
  confere("ponto do mapa vindo como texto", d.customerLatLng, { lat: -3.7413208, lng: -38.5645481 });
  confere("cliente e telefone", [d.customerName, d.customerPhone], ["Matheus Lessa", "85994197929"]);
  confere("agendado: prazo = início da janela", new Date(d.scheduledDatetime).toISOString(), "2023-06-27T10:40:00.000Z");
  confere("agendado anotado", String(d.notes).includes("📅 AGENDADO"), true);
  confere("itens: Hamburguer 28,90 e combo 137,90 (pelo total do combo)", t.items.map((i: any) => [i.quantity, i.price]), [[1, 28.9], [1, 137.9]]);
  confere(
    "combo: cada etapa vira opção irmã de preço 0, com as escolhas dela embaixo",
    JSON.parse(t.items[1].comboSelections).map((o: any) => [o.name, o.quantity, o.price]),
    [
      ["Hamburguer", 1, 0],
      ["Pão Gergelim", 1, 0],
      ["Cebola", 1, 0],
      ["Latinha de Coca Cola", 1, 0],
      ["Guaraná Antarctica Zero", 1, 0],
      ["Pizza", 1, 0],
      ["Mussarela", 1, 0],
      ["Portuguesa", 1, 0],
    ],
  );
  confere("combo: nome na comanda", t.items[1].productName, "Hamburguer + Pizza | Hamburguer | Pão Gergelim | Cebola | Latinha de Coca Cola | Guaraná Antarctica Zero | Pizza | Mussarela | Portuguesa");
  confere("opção com total_price (sem unit_price) vira unitário", JSON.parse(t.items[0].comboSelections).map((o: any) => o.price), [10, 1, 5]);
  confere("taxa de entrega", d.deliveryFee, 5);
  confere("desconto sem patrocínio é da loja", [d.discountTotal, d.discountMerchant, d.discountIfood], [3, 3, null]);
  confere("três formas na porta", d.paymentMethod, "Pix + Crédito + Débito (Cobrar na Entrega)");
  confere("taxa adicional e da forma de pagamento: da LOJA, cada uma com o nome", [String(d.notes).includes("💳 Taxa adicional: R$8.00 (fica com a loja)"), String(d.notes).includes("💳 Taxa da forma de pagamento: R$4.50 (fica com a loja)"), String(d.notes).includes("fica com a plataforma")], [true, true, false]);
  confere("total 181,30 fecha com as partes (itens + entrega + taxas − desconto)", [d.totalAmount, t.avisos], [181.3, []]);
}

console.log("\n── Pagamento ──");
const base = (extra: Partial<PedidoCW>): PedidoCW => ({ ...copia(docRetirada), status: "waiting_confirmation", ...extra });
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "online", status: "paid", payment_method: "pix_auto", payment_fee: 0 }] }), ctx);
  confere("pix automático pago: pago online", t.dados.paymentMethod, "Pix (Pago Online)");
  confere("aguardando confirmação + loja sem aceite automático → NOVO", t.dados.status, "NOVO");
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "online", status: "authorized", payment_method: "online_credit_card", card_brand: "Visa", card_number: "1234", payment_fee: 0 }] }), ctx);
  confere("cartão online autorizado: pago online com a bandeira", t.dados.paymentMethod, "Crédito Visa (Pago Online)");
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "online", status: "pending", payment_method: "pix_auto", payment_fee: 0 }] }), ctx);
  confere("online PENDENTE não é pago: cobra, e avisa", [t.dados.paymentMethod, String(t.dados.notes).includes("COBRAR na entrega")], ["Pix (Cobrar na Entrega)", true]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "paid", payment_method: "pix", payment_fee: 0 }] }), ctx);
  confere("offline marcado pago no portal: continua cobrando, com o aviso", [t.dados.paymentMethod, String(t.dados.notes).includes("marcado como PAGO no CardápioWeb")], ["Pix (Cobrar na Entrega)", true]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "pending", payment_method: "money", change_for: 150, payment_fee: 0 }] }), ctx);
  confere("dinheiro com change_for: troco para 150", [t.dados.paymentMethod, t.dados.changeAmount, t.avisos], ["Dinheiro (Cobrar na Entrega)", 150, []]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "pending", payment_method: "money", change_of: 150, payment_fee: 0 }] }), ctx);
  confere("dinheiro com change_of maior que o valor: troco para 150, com aviso", [t.dados.changeAmount, t.avisos.some((a) => a.includes("change_of"))], [150, true]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "pending", payment_method: "money", change_of: 46.2, payment_fee: 0 }] }), ctx);
  confere("change_of menor que o valor é o troco: nota de 150", [t.dados.changeAmount, t.avisos.some((a) => a.includes("TROCO"))], [150, true]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "pending", payment_method: "money", change_for: 103.8, payment_fee: 0 }] }), ctx);
  confere("nota igual ao valor não é troco", t.dados.changeAmount, null);
}
{
  const formas = ["bank_transfer", "bank_slip", "debt_book", "picpay", "meal_voucher", "food_voucher"];
  const nomes = formas.map((f) => traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "pending", payment_method: f, payment_fee: 0 }] }), ctx).dados.paymentMethod);
  confere("formas extras com nome (fiado é a palavra que o caixa lê)", nomes, [
    "Transferência (Cobrar na Entrega)",
    "Boleto (Cobrar na Entrega)",
    "Fiado (Cobrar na Entrega)",
    "PicPay (Cobrar na Entrega)",
    "Vale Refeição (Cobrar na Entrega)",
    "Vale Alimentação (Cobrar na Entrega)",
  ]);
  const estranha = traduzirPedidoCardapioWeb(base({ payments: [{ total: 103.8, payment_type: "offline", status: "pending", payment_method: "cripto", payment_fee: 0 }] }), ctx);
  confere("forma desconhecida: 'Não informado' e aviso (nunca 'Cartão')", [estranha.dados.paymentMethod, estranha.avisos.some((a) => a.includes("desconhecida"))], ["Não informado", true]);
}

console.log("\n── Desconto: loja × plataforma ──");
{
  const t = traduzirPedidoCardapioWeb(
    base({
      total: 93.8,
      discounts: [{ kind: "discount", category: "coupon", sponsorship: "merchant", total: 10, coupon_code: "pizza10", coupon_name: "Cupom da casa" }],
      payments: [{ total: 93.8, payment_type: "offline", status: "pending", payment_method: "pix", payment_fee: 0 }],
    }),
    ctx,
  );
  confere("cupom da loja: loja paga, com o código", [t.dados.discountTotal, t.dados.discountMerchant, t.dados.discountIfood, t.dados.discountDetails?.[0]?.description], [10, 10, null, "Cupom PIZZA10"]);
  confere("total fecha", t.avisos, []);
}
{
  const t = traduzirPedidoCardapioWeb(
    base({
      total: 98.8,
      discounts: [{ kind: "discount", category: "other", sponsorship: "ifood", total: 5 }],
      payments: [{ total: 98.8, payment_type: "offline", status: "pending", payment_method: "pix", payment_fee: 0 }],
    }),
    ctx,
  );
  confere("desconto patrocinado pela plataforma vai para a coluna da plataforma", [t.dados.discountTotal, t.dados.discountMerchant, t.dados.discountIfood], [5, null, 5]);
}
{
  const t = traduzirPedidoCardapioWeb(
    base({
      total: 93.8,
      discounts: [{ kind: "item", category: "loyalty", total: 10, total_points: 120, item_name: "Refrigerante" }],
      payments: [{ total: 93.8, payment_type: "offline", status: "pending", payment_method: "pix", payment_fee: 0 }],
    }),
    ctx,
  );
  confere("fidelidade anotada", String(t.dados.notes).includes("🎁 Fidelidade do CardápioWeb: Refrigerante (-R$10.00, 120 pontos)"), true);
}

console.log("\n── Itens: cancelado, observação, pizza por média, consumo no local ──");
{
  const p = base({});
  p.items = [
    ...(p.items || []),
    { item_id: 1, name: "Item cancelado", quantity: 1, unit_price: 9, total_price: 9, kind: "regular_item", status: "canceled", options: [] },
  ];
  const t = traduzirPedidoCardapioWeb(p, ctx);
  confere("item cancelado não entra (e o total continua fechando)", [t.items.length, t.avisos], [1, []]);
}
{
  const p = base({
    total: 50,
    items: [
      {
        item_id: 900,
        name: "Pizza Grande",
        quantity: 1,
        unit_price: 0,
        total_price: 50,
        kind: "regular_item",
        status: "waiting",
        observation: "Bem assada",
        options: [
          { option_id: 1, name: "Calabresa", quantity: 1, unit_price: 45, option_group_total_selected_options: 2 },
          { option_id: 2, name: "Frango", quantity: 1, unit_price: 55, option_group_total_selected_options: 2 },
        ],
      },
    ],
    payments: [{ total: 50, payment_type: "offline", status: "pending", payment_method: "money", payment_fee: 0 }],
  });
  const t = traduzirPedidoCardapioWeb(p, ctx);
  confere("sabor de grupo pela média: preço 0, vale o total do item", [t.items[0].price, JSON.parse(t.items[0].comboSelections).map((o: any) => o.price)], [50, [0, 0]]);
  confere("observação do item vai junto", [t.items[0].notes, String(t.dados.notes).includes("Pizza Grande: Bem assada")], ["Bem assada", true]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ order_type: "onsite" }), ctx);
  confere("consumo no local: retirada com a nota", [t.dados.deliveryType, String(t.dados.notes).includes("CONSUMO NO LOCAL")], ["RETIRADA", true]);
}
{
  const t = traduzirPedidoCardapioWeb(base({ customer: { id: 5, name: "John", phone: "2025550123", ddi: "1" }, fiscal_document: "70887267009" }), ctx);
  confere("DDI estrangeiro vai junto; CPF da nota no pedido", [t.dados.customerPhone, t.dados.customerCpfCnpj], ["12025550123", "70887267009"]);
}
{
  const p = copia(docEntrega);
  p.delivered_by = "ifood_shipping";
  p.estimated_time = 45;
  p.order_timing = "immediate";
  p.schedule = null;
  const t = traduzirPedidoCardapioWeb(p, ctx);
  confere("entregador de outra empresa: LOGISTICS + aviso", [t.dados.deliveryBy, String(t.dados.notes).includes("iFood Sob Demanda")], ["LOGISTICS", true]);
  confere("estimated_time vira o prazo (criação + 45 min)", new Date(t.dados.scheduledDatetime).toISOString(), "2023-06-24T05:46:06.102Z");
}

console.log("\n── Filtros (o que não entra) ──");
const f = (p: Partial<PedidoCW>, opcoes: { receberMarketplaces?: boolean; importarDesde?: Date | null } = {}) => {
  const d = filtroDoPedidoCW(base(p), { receberMarketplaces: !!opcoes.receberMarketplaces, importarDesde: opcoes.importarDesde ?? null });
  return d.importar ? `entra${d.statusInicial ? `:${d.statusInicial}` : ""}${d.marketplace ? `:${d.marketplace}` : ""}` : `${d.motivo}${d.alertar ? "!" : ""}`;
};
confere("canais próprios entram", ["catalog", "store_front_catalog", "portal", "whatsapp_extension"].map((c) => f({ sales_channel: c })), ["entra", "entra", "entra", "entra"]);
confere("mesa/comanda nunca", f({ order_type: "closed_table" }), "mesa");
confere("iFood repassado: fora por padrão", f({ sales_channel: "ifood", external_order_id: "abc" }), "marketplace");
confere("pagamento do iFood denuncia o marketplace", f({ payments: [{ total: 103.8, payment_type: "online", status: "paid", payment_method: "ifood" }] }), "marketplace");
confere("pagamento da 99 também", f({ payments: [{ total: 103.8, payment_type: "online", status: "paid", payment_method: "food99_voucher" }] }), "marketplace");
confere("external_order_id sozinho também", f({ external_order_id: "99-123" }), "marketplace");
confere("com a opção ligada, marketplace entra (marcado)", f({ sales_channel: "ifood", external_order_id: "abc" }, { receberMarketplaces: true }), "entra:iFood");
confere("canal desconhecido: não entra e avisa", f({ sales_channel: "totem_novo" }), "canal-desconhecido!");
confere("pagamento pendente espera", [f({ status: "pending_online_payment" }), f({ status: "pending_payment", sales_channel: "store_front_catalog" })], ["aguardando-pagamento", "aguardando-pagamento"]);
confere("em cancelamento espera; cancelado não entra", [f({ status: "canceling" }), f({ status: "canceled" })], ["cancelando", "cancelado"]);
confere("já aceito lá entra ACEITO", [f({ status: "confirmed" }), f({ status: "scheduled_confirmed" })], ["entra:ACEITO", "entra:ACEITO"]);
confere("já passou da cozinha: não entra (não fazer de novo) e avisa", ["ready", "released", "waiting_to_catch", "delivered", "closed"].map((s) => f({ status: s })), Array(5).fill("passou-da-cozinha!"));
confere("status que ninguém conhece: não entra e avisa", f({ status: "novo_status" }), "status-desconhecido!");
confere(
  "pedido de antes da conexão não entra (a 1ª conexão traz 8 h de histórico)",
  [f({}, { importarDesde: new Date("2023-06-25T14:00:00Z") }), f({}, { importarDesde: new Date("2023-06-25T13:00:00Z") })],
  ["antes-da-conexao", "entra"],
);
confere("de qual marketplace", [marketplaceDoPedido(base({ sales_channel: "ifood" })), marketplaceDoPedido(base({})), marketplaceDoPedido(base({ payments: [{ payment_method: "food99" }] }))], ["iFood", null, "99Food"]);

console.log("\n── Status de lá → FireHub (só avança, quem decide é o evento) ──");
confere(
  "mapa de status",
  ["waiting_confirmation", "confirmed", "scheduled_confirmed", "ready", "waiting_to_catch", "released", "delivered", "closed", "canceled", "canceling", "pending_payment"].map(statusDoFireHubPara),
  [null, "ACEITO", "ACEITO", "PRONTO", "SAIU_ENTREGA", "SAIU_ENTREGA", "ENTREGUE", "ENTREGUE", "CANCELADO", null, null],
);

console.log("\n── O id do pedido carrega a loja do CardápioWeb ──");
confere("produção", idDoPedidoCW("producao", 3268, 237456), "cardapioweb_3268_237456");
confere("sandbox ganha prefixo (os dois bancos do CardápioWeb repetem ids)", idDoPedidoCW("sandbox", 3268, 237456), "cardapioweb_sandbox-3268_237456");
confere("lê de volta", [lerIdDoPedidoCW("cardapioweb_3268_237456"), lerIdDoPedidoCW("cardapioweb_sandbox-3268_237456")], [
  { ambiente: "producao", companyId: "3268", orderId: "237456", chaveDaLoja: "3268" },
  { ambiente: "sandbox", companyId: "3268", orderId: "237456", chaveDaLoja: "sandbox-3268" },
]);
confere("id de outro canal não é do CardápioWeb", [lerIdDoPedidoCW("keeta_123"), lerIdDoPedidoCW("123"), lerIdDoPedidoCW("cardapioweb_"), lerIdDoPedidoCW(null)], [null, null, null, null]);
let lancou = false;
try {
  idDoPedidoCW("producao", "12_3", 1);
} catch {
  lancou = true;
}
confere("id de loja com '_' é recusado (quebraria a leitura de volta)", [lancou, chaveDaLojaCW("producao", "77")], [true, "77"]);

console.log("\n── Canal, loja de origem e espelho ──");
const pedidoCW = { source: "CARDAPIOWEB", openDeliveryChannel: "CARDAPIOWEB", openDeliveryOrderId: "cardapioweb_3268_1", openDeliveryReference: "48", franchiseeId: "loja-teste" };
confere("canal-do-pedido: CardápioWeb, antes do 'todo openDeliveryOrderId é JotaJá'", [chaveDoCanal(pedidoCW), chaveDoCanal({ openDeliveryOrderId: "cardapioweb_9_9" }), chaveDoCanal({ openDeliveryOrderId: "abc-uuid" })], ["CARDAPIOWEB", "CARDAPIOWEB", "JOTAJA"]);
confere("selo do painel", [canalDoPedido(pedidoCW).nome, canalDoPedido(pedidoCW).ehMarketplace, canalDoPedido(pedidoCW).referencia], ["CardápioWeb", true, "48"]);
confere("loja de origem = a marca do CardápioWeb, não a própria loja", chavesDeLojaDoPedido(pedidoCW), ["cardapioweb:3268"]);
confere("sandbox separado", chavesDeLojaDoPedido({ ...pedidoCW, openDeliveryOrderId: "cardapioweb_sandbox-3268_1" }), ["cardapioweb:sandbox-3268"]);
confere("pedido do CardápioWeb sem o id (objeto incompleto): sem chave, toda impressora recebe", chavesDeLojaDoPedido({ source: "CARDAPIOWEB", franchiseeId: "loja-teste" }), []);
confere("site continua sendo a própria loja", chavesDeLojaDoPedido({ source: "ONLINE", franchiseeId: "loja-teste" }), ["loja:loja-teste"]);
confere(
  "impressora de uma marca recebe só a sua",
  [impressoraAtendeLoja({ lojas: ["cardapioweb:3268"] }, pedidoCW), impressoraAtendeLoja({ lojas: ["cardapioweb:4000"] }, pedidoCW), impressoraAtendeLoja({ lojas: ["loja:loja-teste"] }, pedidoCW)],
  [true, false, false],
);
confere("espelho do CardápioWeb é de integração (categoria e prefixo)", [ehProdutoDeIntegracao("CardápioWeb"), ehProdutoDeIntegracao(null, "cardapioweb-loja-1-208907", false)], [true, true]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
