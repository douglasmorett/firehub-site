/**
 * scripts/teste-traducao-open-delivery.ts
 *
 * Trava a BASE Open Delivery (src/lib/open-delivery/traducao.ts). Cada caso é
 * um furo que já aconteceu em outro canal — o nome do caso diz qual.
 *
 *   npx tsx scripts/teste-traducao-open-delivery.ts
 *
 * Os pedidos seguem o contrato Open Delivery 1.x (Abrasel). O exemplo REAL da
 * Keeta entra em scripts/teste-traducao-keeta.ts quando a loja de teste
 * mandar o primeiro pedido — doc é promessa.
 */
import {
  traduzirPedidoOpenDelivery,
  opcoesDoItem,
  lerPagamento,
  lerDescontos,
  enderecoDoPedido,
  tipoDoPedido,
  type PedidoOD,
} from "../src/lib/open-delivery/traducao";

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

const agora = new Date("2026-10-12T22:00:00Z");
const ctx = {
  lojaId: "loja-teste",
  fuso: "America/Sao_Paulo",
  autoAcceptOrders: false,
  canal: { chave: "KEETA", nome: "Keeta", prefixo: "keeta" },
  agora,
};

const brl = (value: number) => ({ value, currency: "BRL" });

// ── Pedido de entrega típico ────────────────────────────────────────────────
const entrega: PedidoOD = {
  id: "8f1c-0001",
  type: "DELIVERY",
  displayId: "4821",
  createdAt: "2026-10-12T22:00:00Z",
  orderTiming: "INSTANT",
  merchant: { id: "m-1", name: "Loja Teste" },
  items: [
    {
      id: "it-burger",
      name: "X-Bacon",
      quantity: 2,
      unitPrice: brl(25),
      optionsPrice: brl(4),
      totalPrice: brl(58),
      specialInstructions: "sem cebola",
      options: [{ id: "op-ponto", name: "Ao ponto", quantity: 1, unitPrice: brl(0), totalPrice: brl(0) }],
      // Adicional pago em OUTRA lista — o furo da Brendi (19/09/2026).
      additions: [{ id: "op-bacon", name: "Bacon extra", quantity: 2, unitPrice: brl(2), totalPrice: brl(4) }],
    } as any,
    { id: "it-coca", name: "Coca-Cola 2L", quantity: 1, unitPrice: brl(12), totalPrice: brl(12) },
  ],
  otherFees: [
    { type: "DELIVERY_FEE", receivedBy: "MERCHANT", price: brl(6) },
    { type: "SERVICE_FEE", receivedBy: "MARKETPLACE", price: brl(1.99) },
  ],
  discounts: [
    {
      amount: brl(10),
      target: "CART",
      sponsorshipValues: [
        { name: "MERCHANT", amount: brl(4), discountCode: "bemvindo" },
        { name: "MARKETPLACE", amount: brl(6) },
      ],
    },
  ],
  // 58 + 12 + 6 + 1,99 − 10 = 67,99
  total: { itemsPrice: brl(70), otherFees: brl(7.99), discount: brl(10), orderAmount: brl(67.99) },
  payments: { prepaid: 0, pending: 67.99, methods: [{ value: 67.99, currency: "BRL", type: "PENDING", method: "CASH", changeFor: 100 }] },
  customer: { name: "Maria Cliente", documentNumber: "12345678909", phone: { number: "0800 123 4567", localizer: "12345678" } },
  delivery: {
    deliveredBy: "MERCHANT",
    estimatedDeliveryDateTime: "2026-10-12T22:45:00Z",
    deliveryAddress: {
      street: "Rua das Flores",
      number: "120",
      complement: "Apto 32",
      reference: "Portão azul",
      district: "Centro",
      city: "Rio das Ostras",
      coordinates: { latitude: -22.520318, longitude: -41.944127 },
    },
  },
  extraInfo: "Interfone quebrado",
};

{
  const t = traduzirPedidoOpenDelivery(entrega, ctx);
  const d = t.dados;
  confere("sem avisos num pedido que fecha", t.avisos, []);
  confere("id no banco tem o prefixo do canal", d.openDeliveryOrderId, "keeta_8f1c-0001");
  confere("número curto é o displayId", d.openDeliveryReference, "4821");
  confere("canal gravado em source e openDeliveryChannel", [d.source, d.openDeliveryChannel], ["KEETA", "KEETA"]);
  confere("aceite automático desligado → NOVO", d.status, "NOVO");
  confere("total é o declarado", d.totalAmount, 67.99);
  confere("taxa de entrega", d.deliveryFee, 6);
  confere("desconto com dono", [d.discountTotal, d.discountMerchant, d.discountIfood], [10, 4, 6]);
  confere("cupom sem porcentagem na descrição", d.discountDetails[0].description, "Cupom BEMVINDO");
  confere("dinheiro com troco para 100", [d.paymentMethod, d.changeAmount], ["Dinheiro (Cobrar na Entrega)", 100]);
  confere("endereço no formato que os relatórios leem", d.customerAddress, "Rua das Flores, 120 - Comp: Apto 32 - Ref: Portão azul - Centro - Rio das Ostras");
  confere("ponto do parceiro", d.customerLatLng, { lat: -22.520318, lng: -41.944127 });
  confere("entrega da loja", d.deliveryBy, "MERCHANT");
  confere("prazo é o prometido pelo parceiro", d.scheduledDatetime.toISOString(), "2026-10-12T22:45:00.000Z");
  confere("telefone só dígitos", d.customerPhone, "08001234567");
  confere("preço da linha = total ÷ qtd", t.items.map((i) => i.price), [29, 12]);
  confere("nome do dia com as opções das DUAS listas", t.items[0].productName, "X-Bacon | Ao ponto | 2x Bacon extra");
  confere(
    "opção com preço UNITÁRIO",
    JSON.parse(t.items[0].comboSelections),
    [
      { id: "op-ponto", name: "Ao ponto", quantity: 1, price: 0 },
      { id: "op-bacon", name: "Bacon extra", quantity: 2, price: 2 },
    ],
  );
  confere("observação do item na linha do item", t.items[0].notes, "sem cebola");
  confere("espelho: id com a LOJA, nome BASE, categoria do canal, inativo", t.items[0].menuProduct.connectOrCreate.create, {
    id: "keeta-loja-teste-it-burger",
    franchiseeId: "loja-teste",
    name: "X-Bacon",
    description: "",
    price: 25,
    category: "Keeta",
    isBeverage: false,
    active: false,
  });
  confere("refrigerante é bebida", t.items[1].menuProduct.connectOrCreate.create.isBeverage, true);
  confere("observação e código do telefone vão para as notas", d.notes.includes("📝 OBS: Interfone quebrado") && d.notes.includes("Código do telefone: 12345678"), true);
  confere("taxa de serviço explicada nas notas", d.notes.includes("Taxa de serviço Keeta: R$1.99"), true);
}

// ── Aceite automático ───────────────────────────────────────────────────────
confere("aceite automático ligado → ACEITO", traduzirPedidoOpenDelivery(entrega, { ...ctx, autoAcceptOrders: true }).dados.status, "ACEITO");

// ── Total que não fecha vira aviso, não conta inventada ─────────────────────
{
  const torto = { ...entrega, total: { ...entrega.total, orderAmount: brl(80) } };
  const t = traduzirPedidoOpenDelivery(torto, ctx);
  confere("total torto: grava o declarado", t.dados.totalAmount, 80);
  confere("total torto: avisa", t.avisos.some((a) => a.startsWith("total 80.00 ≠ partes 67.99")), true);
}

// ── Opções ──────────────────────────────────────────────────────────────────
confere(
  "opção repetida soma; filhas entram pelo grupo; preço pelo total ÷ qtd quando falta o unitário",
  opcoesDoItem({
    name: "Combo 6 esfihas",
    options: [
      { id: "g1", name: "Sabores", options: [{ id: "e1", name: "Esfiha Carne", quantity: 2 }, { id: "e2", name: "Esfiha Queijo", quantity: 4 }] },
      { id: "e1", name: "Esfiha Carne", quantity: 1 },
      { id: "b1", name: "Borda", quantity: 2, totalPrice: brl(6) },
    ],
  }).map((o) => [o.nome, o.quantidade, o.precoUnitario]),
  [["Esfiha Carne", 3, 0], ["Esfiha Queijo", 4, 0], ["Borda", 2, 3]],
);
confere("booleano não é preço (addition: true da Brendi)", opcoesDoItem({ name: "x", options: [{ name: "Maionese", unitPrice: true as any }] })[0].precoUnitario, 0);

// ── Pagamento ───────────────────────────────────────────────────────────────
const pag = (payments: PedidoOD["payments"]) => lerPagamento({ payments } as PedidoOD, 50, "Keeta");
confere("pix pago no app", pag({ prepaid: 50, pending: 0, methods: [{ value: 50, type: "PREPAID", method: "PIX" }] }).paymentMethod, "Pix (Pago Online)");
confere("crédito com bandeira na porta", pag({ pending: 50, methods: [{ value: 50, type: "PENDING", method: "CREDIT", brand: "VISA" }] }).paymentMethod, "Crédito VISA (Cobrar na Entrega)");
confere("forma desconhecida na porta → Não informado (nunca Cartão)", pag({ pending: 50, methods: [{ value: 50, type: "PENDING", method: "BITCOIN" }] }).paymentMethod, "Não informado");
confere("forma desconhecida paga no app → nome do canal", pag({ prepaid: 50, methods: [{ value: 50, type: "PREPAID", method: "XYZ" }] }).paymentMethod, "Keeta App (Pago Online)");
confere("PREPAID com pending > 0 NÃO é pago online", pag({ prepaid: 50, pending: 10, methods: [{ value: 50, type: "PREPAID", method: "PIX" }] }).pagoOnline, false);
{
  const misto = pag({ prepaid: 20, pending: 30, methods: [{ value: 20, type: "PREPAID", method: "PIX" }, { value: 30, type: "PENDING", method: "DEBIT" }] });
  confere("misto: cobra a parte da porta e diz quanto já foi pago", [misto.paymentMethod, misto.parteOnline], ["Débito (Cobrar na Entrega)", 20]);
}
confere("troco igual ao valor não é troco (Brendi 6018)", pag({ pending: 50, methods: [{ value: 50, type: "PENDING", method: "CASH", changeFor: 50 }] }).changeAmount, null);
confere("sem forma nenhuma → Não informado + aviso", [pag({}).paymentMethod, pag({}).avisos], ["Não informado", ["pedido sem forma de pagamento"]]);

// ── Descontos ───────────────────────────────────────────────────────────────
confere("desconto sem patrocínio é da loja", lerDescontos({ discounts: [{ value: 5 }] } as PedidoOD).loja, 5);

// ── Endereço e tipo ─────────────────────────────────────────────────────────
confere(
  "endereço na grafia da spec (streetName/streetNumber/neighborhood)",
  enderecoDoPedido({ streetName: "Av. Brasil", streetNumber: "10", neighborhood: "Costazul", city: "Rio das Ostras" }),
  "Av. Brasil, 10 - Costazul - Rio das Ostras",
);
confere("bairro que já está na rua não repete", enderecoDoPedido({ street: "Rua Centro", number: "1", district: "Centro", city: "X" }), "Rua Centro, 1 - X");
confere("INDOOR é MESA (furo da Wabiz)", tipoDoPedido({ type: "INDOOR" }), "MESA");
confere("TAKEOUT é RETIRADA", tipoDoPedido({ type: "TAKEOUT" }), "RETIRADA");
{
  const mesa = traduzirPedidoOpenDelivery({ ...entrega, type: "INDOOR", indoor: { place: "12" }, delivery: null }, ctx);
  confere("mesa: sem endereço, sem ponto, nota com a mesa", [mesa.dados.customerAddress, "customerLatLng" in mesa.dados, mesa.dados.notes.includes("🍽️ MESA 12")], ["", false, true]);
}

// ── Entregador da plataforma ────────────────────────────────────────────────
{
  const t = traduzirPedidoOpenDelivery({ ...entrega, delivery: { ...entrega.delivery, deliveredBy: "MARKETPLACE", pickupCode: "7731" } }, ctx);
  confere("entregador da plataforma → LOGISTICS + código de coleta", [t.dados.deliveryBy, t.dados.openDeliveryPickupCode], ["LOGISTICS", "7731"]);
}

// ── Agendado ────────────────────────────────────────────────────────────────
{
  const t = traduzirPedidoOpenDelivery(
    { ...entrega, orderTiming: "SCHEDULED", schedule: { scheduledDateTimeStart: "2026-10-13T15:00:00Z", scheduledDateTimeEnd: "2026-10-13T15:30:00Z" } },
    ctx,
  );
  confere("agendado: prazo é o início da janela", t.dados.scheduledDatetime.toISOString(), "2026-10-13T15:00:00.000Z");
  confere("agendado: nota no horário da loja", t.dados.notes.includes("📅 AGENDADO para 13/10/2026"), true);
}

// ── Prazo implausível cai na régua de 50 min ────────────────────────────────
{
  const t = traduzirPedidoOpenDelivery({ ...entrega, delivery: { ...entrega.delivery, estimatedDeliveryDateTime: "2026-10-12T22:01:00Z" } }, ctx);
  confere("prazo de 1 min não é prazo → +50 min", t.dados.scheduledDatetime.toISOString(), "2026-10-12T22:50:00.000Z");
}

// ── Pedido sem itens ────────────────────────────────────────────────────────
confere("pedido sem itens avisa", traduzirPedidoOpenDelivery({ ...entrega, items: [] }, ctx).avisos.includes("pedido sem itens"), true);

// ── Keeta: dado cifrado que não foi decifrado não vai para a comanda ────────
{
  const cifrado = traduzirPedidoOpenDelivery(
    {
      ...entrega,
      customer: { name: "João", phone: { number: "ENC_#MQesaE=#1#" } },
      delivery: { ...entrega.delivery, deliveryAddress: { street: "Rua A", number: "ENC_#x#", district: "ENC_#y#", city: "Niterói" } },
    },
    ctx,
  );
  confere("ENC_ fica de fora (telefone e endereço)", [cifrado.dados.customerPhone, cifrado.dados.customerAddress], ["", "Rua A - Niterói"]);
}

// ── Peso não é unidade (quantidade do item no banco é inteira) ──────────────
{
  const t = traduzirPedidoOpenDelivery(
    { ...entrega, items: [{ id: "acai", name: "Açaí", unit: "KG", quantity: 0.5, unitPrice: brl(40), totalPrice: brl(20) }], total: { orderAmount: brl(17.99) } },
    ctx,
  );
  confere("0,5 kg vira 1 linha com o preço da linha e o peso no nome", [t.items[0].quantity, t.items[0].price, t.items[0].productName], [1, 20, "0,5 KG Açaí"]);
  confere("o espelho continua com o nome BASE", t.items[0].menuProduct.connectOrCreate.create.name, "Açaí");
}

// ── Complemento do pedido mínimo entra na conta ─────────────────────────────
{
  const t = traduzirPedidoOpenDelivery(
    {
      ...entrega,
      otherFees: [...(entrega.otherFees || []), { type: "MIN_ORDER_FEE", receivedBy: "MERCHANT", price: brl(3) }],
      total: { ...entrega.total, orderAmount: brl(70.99) },
    },
    ctx,
  );
  confere("MIN_ORDER_FEE fecha a conta e aparece nas notas", [t.avisos, t.dados.notes.includes("Complemento do pedido mínimo: R$3.00")], [[], true]);
}

// ── CHAIN (rede) é desconto do lado da loja ─────────────────────────────────
confere(
  "CHAIN conta como loja",
  lerDescontos({ discounts: [{ amount: brl(8), target: "CART", sponsorshipValues: [{ name: "CHAIN", amount: brl(8) }] }] } as PedidoOD).loja,
  8,
);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
