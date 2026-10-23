/**
 * scripts/teste-traducao-anotaai.ts
 *
 * Trava o tradutor do Anota AI (src/lib/anotaai/traducao.ts), o id do pedido
 * e a escada de status. Puro: sem banco, sem rede.
 *
 *   npx tsx scripts/teste-traducao-anotaai.ts
 *
 * Os pedidos são os EXEMPLOS DA DOC (integ-public-platform-docs.anota.ai →
 * Cardápio e pedidos), copiados como estão — inclusive o item com nome
 * começando por "." da loja de teste deles. Doc é promessa: o primeiro pedido
 * real entra aqui também (o payload cru fica em PayloadDoParceiro).
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

import { traduzirPedidoAnotaAi, filtroDoPedidoAnotaAi, statusDoFireHubParaCheck, horaLocalNoDia, type PedidoAnotaAi } from "../src/lib/anotaai/traducao";
import { idDoPedidoAnotaAi, lerIdDoPedidoAnotaAi } from "../src/lib/anotaai/id-do-pedido";
import { passosDaEscadaAnotaAi, ehPedidoAnotaAi } from "../src/lib/anotaai/status";
import { idPageDoToken } from "../src/lib/anotaai/api";
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

const PAGINA = "61a77161bcf7d30011d41aa2";
const agora = new Date("2022-02-11T18:36:20Z");
const ctx = { lojaId: "loja-teste", fuso: "America/Sao_Paulo", autoAcceptOrders: false, pageId: PAGINA, agora };
const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── Exemplo 1 da doc: entrega, Lanchão com bacon e ovo, cupom de 5 ──────────
const docEntrega: PedidoAnotaAi = {
  menu_version: 2,
  _id: "6206ac9b25a2c30013c23e1b",
  id: "6206ac9b25a2c30013c23e1b",
  check: 1,
  shortReference: 53,
  createdAt: "2022-02-11T18:36:11.974Z",
  type: "DELIVERY",
  time_max: "2022-02-11T18:36:11.974Z",
  merchant: { restaurantId: "", name: "Beto Anota AI", id: "61a770b9795722001915cfe2", unit: "61a77161bcf7d30011d41aa2" } as any,
  payments: [{ name: "money", code: "money", value: "20", cardSelected: "", externalId: "", changeFor: 20, prepaid: false }],
  customer: { id: "61a774139e0ac80011430a7d", name: "Beto", phone: "9999999999" },
  items: [
    {
      id: 0,
      name: ".Lanchão",
      quantity: 1,
      observation: "",
      externalId: "null",
      price: 13,
      total: 17.5,
      subItems: [
        { name: ".Bacon", quantity: 1, externalId: "null", price: 2.5, total: 2.5, externalCode: "extra", id: 1, id_parent: 0 },
        { name: ".Ovo", quantity: 1, externalId: "null", price: 2, total: 2, externalCode: "extra", id: 2, id_parent: 0 },
      ],
    },
  ],
  total: 12.5,
  deliveryFee: 0,
  pdv: { status: false },
  deliveryAddress: {
    formattedAddress: "Rua Brasil, Nº 99",
    country: "Brasil",
    state: "RS",
    city: "Canoas",
    coordinates: { latitude: -29.9224717, longitude: -51.1871155 },
    neighborhood: "Centro",
    streetName: "Rua Brasil",
    streetNumber: "99",
    postalCode: "92310-150",
    reference: "Ao lado do mercado",
    complement: "999",
  },
  discounts: [{ amount: 5, tag: "CUPOMTESTE" }],
};

const t1 = traduzirPedidoAnotaAi(copia(docEntrega), { ...ctx, statusInicial: "ACEITO" });
const d1 = t1.dados;
confere("entrega: id no banco com a página", d1.openDeliveryOrderId, `anotaai_${PAGINA}_6206ac9b25a2c30013c23e1b`);
confere("entrega: canal", [d1.source, d1.openDeliveryChannel], ["ANOTAAI", "ANOTAAI"]);
confere("entrega: número curto", d1.openDeliveryReference, "53");
confere("entrega: tipo", d1.deliveryType, "DELIVERY");
confere("entrega: status inicial ACEITO (check 1 = já aceito lá)", d1.status, "ACEITO");
confere("entrega: total", d1.totalAmount, 12.5);
confere("entrega: desconto do cupom da loja", [d1.discountTotal, d1.discountMerchant, d1.discountIfood], [5, 5, null]);
confere("entrega: sem aviso (a conta fecha)", t1.avisos, []);
confere("entrega: item = linha (13 + 2,50 + 2)", [t1.items[0].price, t1.items[0].quantity], [17.5, 1]);
confere("entrega: nome do item com os adicionais", t1.items[0].productName, ".Lanchão | .Bacon | .Ovo");
confere(
  "entrega: opções com preço unitário",
  JSON.parse(t1.items[0].comboSelections).map((o: any) => [o.name, o.quantity, o.price]),
  [[".Bacon", 1, 2.5], [".Ovo", 1, 2]],
);
confere("entrega: espelho pelo nome (item.id é posição, não id)", t1.espelhos[0].id, `anotaai-loja-teste-${PAGINA}-nome-lanchao`);
confere("entrega: pagamento em dinheiro na entrega", d1.paymentMethod, "Dinheiro (Cobrar na Entrega)");
confere("entrega: troco para igual ao valor não é troco", d1.changeAmount, null);
confere("entrega: endereço no formato dos relatórios", d1.customerAddress, "Rua Brasil, 99 - Comp: 999 - Ref: Ao lado do mercado - Centro - Canoas");
confere("entrega: telefone", d1.customerPhone, "9999999999");
confere("entrega: nota com o cupom", /Cupom CUPOMTESTE: -R\$5\.00/.test(d1.notes), true);
confere("canal do pedido gravado", chaveDoCanal(d1 as any), "ANOTAAI");
confere("canal do pedido só pelo id (sem source)", chaveDoCanal({ openDeliveryOrderId: d1.openDeliveryOrderId } as any), "ANOTAAI");
confere("selo do canal", canalDoPedido(d1 as any).nome, "Anota AI");
confere("espelho é produto de integração (categoria e prefixo)", [ehProdutoDeIntegracao("Anota AI"), ehProdutoDeIntegracao(null, t1.espelhos[0].id, false)], [true, true]);

// ── Quantidade 2, troco, pix online, pizza em fração ───────────────────────
const doisRefri: PedidoAnotaAi = {
  _id: "66be05445f126a2b68d3c8ca",
  check: 0,
  shortReference: 200,
  createdAt: "2022-02-11T18:36:00.000Z",
  type: "TAKE",
  customer: { name: "Ana", phone: "5543999990000", taxPayerIdentificationNumber: "49539197007" },
  items: [
    { _id: "x1", id: 0, name: "Refrigerante 1L", quantity: 2, internalId: "65d4a428f784bb001956f919", externalId: "|3|", price: 10, total: 20, subItems: [] },
    {
      _id: "x2",
      id: 1,
      name: "Pizza G",
      quantity: 1,
      internalId: "pz1",
      price: 0,
      total: 40,
      subItems: [
        { _id: "s1", name: "1/2 Calabresa", quantity: 1, price: 36, total: 18, externalCode: "flavor", quantityFraction: 0.5 },
        { _id: "s2", name: "1/2 Portuguesa", quantity: 1, price: 44, total: 22, externalCode: "flavor", quantityFraction: 0.5 },
      ],
    },
  ],
  payments: [{ name: "money", code: "money", value: "60", changeFor: 100, prepaid: false }],
  total: 60,
  deliveryFee: 0,
};
const t2 = traduzirPedidoAnotaAi(copia(doisRefri), ctx);
confere("retirada: tipo", t2.dados.deliveryType, "RETIRADA");
confere("retirada: status NOVO sem aceite automático", t2.dados.status, "NOVO");
confere("2x refrigerante: preço da UNIDADE", [t2.items[0].price, t2.items[0].quantity], [10, 2]);
confere("espelho pelo internalId", t2.espelhos[0].id, `anotaai-loja-teste-${PAGINA}-65d4a428f784bb001956f919`);
confere("pizza: sabor pela fração (total do subitem)", JSON.parse(t2.items[1].comboSelections).map((o: any) => o.price), [18, 22]);
confere("pizza: preço = total da linha", t2.items[1].price, 40);
confere("troco para 100", t2.dados.changeAmount, 100);
confere("telefone sem o 55", t2.dados.customerPhone, "43999990000");
confere("CPF", t2.dados.customerCpfCnpj, "49539197007");
confere("conta fecha", t2.avisos, []);

const pixOnline = copia(doisRefri);
pixOnline.payments = [{ name: "pix", code: "pix", value: "60", changeFor: 0, prepaid: true }];
confere("pix pago online", traduzirPedidoAnotaAi(pixOnline, ctx).dados.paymentMethod, "Pix (Pago Online)");

const cartaoNaEntrega = copia(doisRefri);
cartaoNaEntrega.payments = [{ name: "card", code: "card", value: "60", cardSelected: "Visa", prepaid: false }];
confere("cartão na entrega com bandeira", traduzirPedidoAnotaAi(cartaoNaEntrega, ctx).dados.paymentMethod, "Crédito Visa (Cobrar na Entrega)");

const formaEstranha = copia(doisRefri);
formaEstranha.payments = [{ name: "none", code: "none", value: "60", prepaid: false }];
const tEstranha = traduzirPedidoAnotaAi(formaEstranha, ctx);
confere("forma desconhecida = Não informado (nunca Cartão)", tEstranha.dados.paymentMethod, "Não informado");
confere("forma desconhecida vira aviso", tEstranha.avisos.some((a) => /forma de pagamento desconhecida/.test(a)), true);

// ── Taxas: entrega, taxa do pagamento online, fidelidade ───────────────────
const comTaxas = copia(docEntrega);
comTaxas.deliveryFee = 6;
comTaxas.additionalFees = [{ type: "addition_pol", description: "Taxa de serviço do POL", value: 0.99 }];
comTaxas.discounts = [{ amount: 5, tag: "Fidelidade" }];
comTaxas.total = 17.5 + 6 + 0.99 - 5;
const t3 = traduzirPedidoAnotaAi(comTaxas, ctx);
confere("taxa de entrega", t3.dados.deliveryFee, 6);
confere("conta fecha com taxa do pagamento online", t3.avisos, []);
confere("taxa do pagamento online fica com a plataforma", /Taxa de serviço Anota AI: R\$0\.99 \(fica com a plataforma\)/.test(t3.dados.notes), true);
confere("fidelidade não vira 'Cupom Fidelidade'", /Cupom Fidelidade/.test(t3.dados.notes), false);
confere("fidelidade vira nota", /🏷️ Fidelidade do Anota AI: -R\$5\.00/.test(t3.dados.notes), true);

const totalErrado = copia(docEntrega);
totalErrado.total = 99;
confere("total que não fecha vira aviso, não conta inventada", (() => { const t = traduzirPedidoAnotaAi(totalErrado, ctx); return [t.dados.totalAmount, t.avisos.some((a) => /total 99\.00/.test(a))]; })(), [99, true]);

// ── Agendado ────────────────────────────────────────────────────────────────
confere("hora local no dia (13:00 em SP = 16:00Z)", horaLocalNoDia(new Date("2023-01-01T15:30:00.000Z"), "13:00", "America/Sao_Paulo")?.toISOString(), "2023-01-01T16:00:00.000Z");
const agendado = copia(docEntrega);
agendado.check = 0;
agendado.schedule_order = { date: "2023-01-01T15:30:00.000Z", start: "13:00", end: "13:15", timezone: "America/Sao_Paulo" };
const t4 = traduzirPedidoAnotaAi(agendado, ctx);
confere("agendado: prazo = início da janela", new Date(t4.dados.scheduledDatetime).toISOString(), "2023-01-01T16:00:00.000Z");
confere("agendado: nota", /📅 AGENDADO/.test(t4.dados.notes), true);

// ── Filtro ──────────────────────────────────────────────────────────────────
const f = (mud: Partial<PedidoAnotaAi>, desde?: Date) => {
  const d = filtroDoPedidoAnotaAi({ ...copia(docEntrega), ...mud }, { importarDesde: desde ?? null });
  return d.importar ? `importa${d.statusInicial ? `-${d.statusInicial}` : ""}` : d.motivo;
};
confere("filtro: check 0 importa NOVO", f({ check: 0 }), "importa");
confere("filtro: check 1 importa ACEITO", f({ check: 1 }), "importa-ACEITO");
confere("filtro: iFood repassado não entra", f({ salesChannel: "ifood" }), "ifood");
confere("filtro: mesa não entra", f({ type: "LOCAL", qr_description: "Mesa 5" }), "mesa");
confere("filtro: garçom não entra", f({ from: "waiter-app", type: "DELIVERY" }), "mesa");
confere("filtro: de antes da conexão não entra", f({ check: 0 }, new Date("2022-02-12T00:00:00Z")), "antes-da-conexao");
confere("filtro: aguardando pagamento espera", f({ check: -1 }), "aguardando-pagamento");
confere("filtro: negado não entra", f({ check: 5 }), "cancelado");
confere("filtro: já pronto lá não entra", f({ check: 2 }), "passou-da-cozinha");
confere("filtro: check estranho não entra", f({ check: 77 }), "status-desconhecido");

// ── Status ──────────────────────────────────────────────────────────────────
confere("check → FireHub", [1, 2, 3, 4, 5, 6, -2, 0].map(statusDoFireHubParaCheck), ["ACEITO", "PRONTO", "ENTREGUE", "CANCELADO", "CANCELADO", null, "ACEITO", null]);
confere("escada: aceitar", passosDaEscadaAnotaAi({ alvo: "ACEITO", check: 0 }), ["accept"]);
confere("escada: pronto a partir da análise", passosDaEscadaAnotaAi({ alvo: "PRONTO", check: 0 }), ["accept", "ready"]);
confere("escada: saiu = pronto lá", passosDaEscadaAnotaAi({ alvo: "SAIU_ENTREGA", check: 1 }), ["ready"]);
confere("escada: entregue", passosDaEscadaAnotaAi({ alvo: "ENTREGUE", check: 2 }), ["finalize"]);
confere("escada: entregue a partir da produção", passosDaEscadaAnotaAi({ alvo: "ENTREGUE", check: 1 }), ["ready", "finalize"]);
confere("escada: já finalizado não manda nada", passosDaEscadaAnotaAi({ alvo: "ENTREGUE", check: 3 }), []);
confere("escada: agendado aceito não pula para pronto", passosDaEscadaAnotaAi({ alvo: "PRONTO", check: -2 }), []);
confere("escada: cancelado lá não manda nada", passosDaEscadaAnotaAi({ alvo: "PRONTO", check: 4 }), []);

// ── Ids ─────────────────────────────────────────────────────────────────────
const idBanco = idDoPedidoAnotaAi(PAGINA, "6206ac9b25a2c30013c23e1b");
confere("id de volta", lerIdDoPedidoAnotaAi(idBanco), { pageId: PAGINA, orderId: "6206ac9b25a2c30013c23e1b" });
confere("id de outro canal não é Anota AI", lerIdDoPedidoAnotaAi("cardapioweb_1_2"), null);
confere("ehPedidoAnotaAi pelo id", ehPedidoAnotaAi({ openDeliveryOrderId: idBanco }), true);
confere("ehPedidoAnotaAi não pega JotaJá", ehPedidoAnotaAi({ openDeliveryOrderId: "abc-123" }), false);
const jwt = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
confere("idpage do Token da unidade", idPageDoToken(jwt({ idpartner: "p", idpage: "507f1f77bcf86cd799439011", iat: 1 })), "507f1f77bcf86cd799439011");
confere("token sem idpage", idPageDoToken(jwt({ foo: 1 })), null);
confere("texto que não é JWT", idPageDoToken("abc"), null);

console.log(falhas === 0 ? "\n🎉 Tudo certo." : `\n💥 ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
