/**
 * Trava a regra de QUANDO a NFC-e sai e o que não pode acontecer depois:
 * lib/fiscal-momento.ts (momento, forma de pagamento, nota do pedido e da
 * conta da mesa, uma nota por chave, retentativa) e a trava e o aviso de
 * lib/edicao-de-pedido.ts.
 *
 *   npx tsx scripts/teste-fiscal-momento.ts
 *
 * Tudo puro: nenhum banco, nenhuma chamada ao provedor. As formas de
 * pagamento são as que existem no banco (30 dias até 24/09/2026).
 */
import {
  agruparPorNota,
  alertaDoCancelamento,
  chavesDaConta,
  chavesDoPagamento,
  contaDaMesaEsquecida,
  decidirRetentativa,
  descontoDaContaPeloPago,
  deveEmitirNoStatus,
  deveRetentar,
  ehEntregaEmDomicilio,
  formaEntraNaAutomatica,
  ehNotaDaConta,
  idDaNotaDaMesa,
  idDaNotaDoPedido,
  inicioDaVarredura,
  juntarItensIguais,
  mercadoriaJaSaiu,
  momentoDaEmissao,
  montarNotaDaMesa,
  montarNotaDoPedido,
  notasAnterioresComA,
  pagamentosDaConta,
  pagamentosDoRestante,
  pedidoDeMesaExigeNotaDaConta,
  pedidoTemTentativaDeNota,
  refDaReemissao,
  retentativaCabeNaEmissaoAtual,
  statusQuePodemEmitir,
  MAXIMO_DE_TENTATIVAS_AUTOMATICAS,
} from "../src/lib/fiscal-momento";
import {
  avaliarEdicao,
  avisoDaNotaNaTrocaDePagamento,
  cancelamentoDaNota,
  notaParaTela,
  registroDaDevolucao,
  travaDaNotaFiscal,
  CAMPOS_DA_NOTA_NA_TELA,
} from "../src/lib/edicao-de-pedido";
import { montarCorpoDaNfce, type ConfiguracaoFiscal, type ItemDaNota } from "../src/lib/fiscal-emissao";
import { montarItensDaNota } from "../src/lib/fiscal-itens";
import { readFileSync } from "fs";
import { join } from "path";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── 1. O momento ─────────────────────────────────────────────────────────────
console.log("\n— Momento da emissão —");
confere("sem configuração vale a saída", momentoDaEmissao({}), "saida");
confere("configuração nula vale a saída", momentoDaEmissao(null), "saida");
confere("aceite é lido", momentoDaEmissao({ momentoDaEmissao: "aceite" }), "aceite");
confere("valor desconhecido vale a saída", momentoDaEmissao({ momentoDaEmissao: "quando der" }), "saida");

const emite = (status: string, deliveryType: string, momento: "aceite" | "saida" | "conclusao", tableSessionId: string | null = null) =>
  deveEmitirNoStatus({ status, deliveryType, tableSessionId }, momento);

// Saída (padrão): entrega no "Saiu", retirada na conclusão.
confere("saída: entrega ACEITO ainda não", emite("ACEITO", "DELIVERY", "saida"), false);
confere("saída: entrega PRONTO ainda não", emite("PRONTO", "DELIVERY", "saida"), false);
confere("saída: entrega SAIU_ENTREGA emite", emite("SAIU_ENTREGA", "DELIVERY", "saida"), true);
confere("saída: entrega SAIU_PARA_ENTREGA emite", emite("SAIU_PARA_ENTREGA", "DELIVERY", "saida"), true);
confere("saída: entrega que pulou a rua emite no ENTREGUE", emite("ENTREGUE", "DELIVERY", "saida"), true);
confere("saída: CANCELADO nunca", emite("CANCELADO", "DELIVERY", "saida"), false);
// O KDS grava SAIU_ENTREGA na retirada para dizer "pronto no balcão".
confere("saída: retirada SAIU_ENTREGA (pronto do KDS) não é saída", emite("SAIU_ENTREGA", "RETIRADA", "saida"), false);
confere("saída: retirada ENTREGUE emite", emite("ENTREGUE", "RETIRADA", "saida"), true);
confere("saída: TAKEOUT do totem ENTREGUE emite", emite("ENTREGUE", "TAKEOUT", "saida"), true);
confere("saída: PICKUP PRONTO ainda não", emite("PRONTO", "PICKUP", "saida"), false);
// Aceite.
confere("aceite: NOVO ainda não", emite("NOVO", "DELIVERY", "aceite"), false);
confere("aceite: AGUARDANDO_PAGAMENTO não é pedido", emite("AGUARDANDO_PAGAMENTO", "RETIRADA", "aceite"), false);
confere("aceite: ACEITO emite", emite("ACEITO", "DELIVERY", "aceite"), true);
confere("aceite: pedido que nasceu PREPARANDO emite", emite("PREPARANDO", "RETIRADA", "aceite"), true);
// Conclusão (o comportamento antigo).
confere("conclusão: entrega SAIU_ENTREGA ainda não", emite("SAIU_ENTREGA", "DELIVERY", "conclusao"), false);
confere("conclusão: ENTREGUE emite", emite("ENTREGUE", "DELIVERY", "conclusao"), true);
// Mesa: nunca pedido a pedido.
confere("mesa: pedido da conta não emite sozinho (saída)", emite("ENTREGUE", "MESA", "saida", "sessao1"), false);
confere("mesa: pedido da conta não emite sozinho (aceite)", emite("ACEITO", "MESA", "aceite", "sessao1"), false);
confere("varredura da saída olha rua e finalizados", statusQuePodemEmitir("saida"), ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA", "ENTREGUE", "ENCERRADO"]);

// ── 2. A forma de pagamento ─────────────────────────────────────────────────
console.log("\n— Forma de pagamento —");
const chaves = (paymentMethod: string | null, extra: Record<string, unknown> = {}) =>
  chavesDoPagamento({ paymentMethod, ...extra }).sort();
confere("iFood Pix (Pago Online) é PIX e ONLINE", chaves("Pix (Pago Online)"), ["ONLINE", "PIX"]);
confere("iFood carteira só casa com ONLINE", chaves("iFood App (Pago Online)"), ["ONLINE"]);
confere("99Food pago online", chaves("Pago Online (99Food)"), ["ONLINE"]);
confere("99Food carteira DiDi", chaves("Carteira DiDi (99Food Pago Online)"), ["ONLINE"]);
confere("Wabiz pago online", chaves("Pagamento Online (Wabiz) (Pago Online)"), ["ONLINE"]);
confere("crédito cobrado na entrega não é online", chaves("Crédito (Cobrar na Entrega)"), ["CREDIT_CARD"]);
confere("débito da bandeira na entrega", chaves("Cartão Deb Master (Cobrar na Entrega)"), ["DEBIT_CARD"]);
confere("dinheiro na entrega", chaves("Dinheiro (Cobrar na Entrega)"), ["MONEY"]);
confere("vale do site", chaves("VOUCHER_Ticket"), ["VOUCHER"]);
confere("PIX_ENTREGA do site é pix na porta", chaves("PIX_ENTREGA"), ["PIX"]);
confere("'Cartão' sem dizer qual vira crédito", chaves("Cartão"), ["CREDIT_CARD"]);
confere("mesa grava N/A no pedido: nada", chaves("N/A"), []);
confere("conta de funcionário: nada", chaves("Conta Funcionário"), []);
confere("fiado: nada", chaves("FIADO"), []);
confere("site com gateway é PIX e ONLINE", chaves("PIX", { gatewayPaymentId: "mp_123" }), ["ONLINE", "PIX"]);
confere(
  "balcão dividido lê as partes",
  chaves("Dividido: Pix R$ 20,00 + Dinheiro R$ 15,00", { paymentMethods: [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 15 }] }),
  ["MONEY", "PIX"]
);

const LISTA_DA_HAKIM = ["PIX", "CREDITO_ONLINE", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER"];
confere("Hakim: CREDITO_ONLINE antigo cobre a carteira do iFood", formaEntraNaAutomatica(chavesDoPagamento({ paymentMethod: "iFood App (Pago Online)" }), LISTA_DA_HAKIM), true);
confere("Hakim: dinheiro fica fora", formaEntraNaAutomatica(chavesDoPagamento({ paymentMethod: "Dinheiro" }), LISTA_DA_HAKIM), false);
confere("lista nova com ONLINE cobre 99Food", formaEntraNaAutomatica(chavesDoPagamento({ paymentMethod: "Pago Online (99Food)" }), ["ONLINE"]), true);
confere("dividido entra se UMA parte está marcada", formaEntraNaAutomatica(["MONEY", "PIX"], ["MONEY"]), true);
confere("lista vazia não emite nada", formaEntraNaAutomatica(["PIX"], []), false);
confere("lista que não é lista não emite nada", formaEntraNaAutomatica(["PIX"], "PIX"), false);

// ── 3. A nota da conta da mesa ──────────────────────────────────────────────
console.log("\n— Nota da conta da mesa —");
const item = (codigo: string, descricao: string, quantidade: number, valorUnitario: number, valorTotal = quantidade * valorUnitario): ItemDaNota => ({
  codigo, descricao, ncm: "22030000", cfop: "5102", unidadeComercial: "UN",
  quantidade, valorUnitario, valorTotal, origem: 0, csosn: "102", cst: null, pis: "49", cofins: "49",
});
const pedidosDaMesa = [
  { id: "A", status: "ENTREGUE", totalAmount: 20, customerCpfCnpj: null, itens: [item("cerv", "Cerveja 600", 2, 10)] },
  { id: "B", status: "ENTREGUE", totalAmount: 60, customerCpfCnpj: "12345678909", itens: [item("cerv", "Cerveja 600", 1, 10), item("piz", "Pizza G", 1, 50)] },
  { id: "C", status: "CANCELADO", totalAmount: 30, customerCpfCnpj: null, itens: [item("piz", "Pizza G", 1, 30)] },
];
// Conta: consumo 80, desconto de 10% (8), taxa de 10% sobre 72 (7,20),
// total 79,20; pagaram 40 no Pix e 40 em dinheiro (troco de 0,80).
const conta = {
  sessionId: "S1",
  pedidos: pedidosDaMesa,
  pagamentos: [{ method: "Pix", amount: 40 }, { method: "Dinheiro", amount: 40 }],
  desconto: 8,
  taxaDeServico: 7.2,
  nomeDoCliente: "Mesa do João",
};
const m = montarNotaDaMesa(conta);
if (!m.ok) {
  falhas++;
  console.log(`❌ a nota da conta não montou: ${m.motivo}`);
} else {
  confere("uma nota para a conta, pela ref da sessão", m.nota.id, "mesa-S1");
  confere("pedido cancelado fica fora da nota", m.pedidos, ["A", "B"]);
  confere("cervejas iguais viram uma linha de 3", m.nota.itens.map((i) => [i.descricao, i.quantidade, i.valorTotal]), [["Cerveja 600", 3, 30], ["Pizza G", 1, 50]]);
  confere("desconto da conta vai para a nota", m.nota.desconto, 8);
  confere("taxa de serviço fica fora por padrão (Lei 13.419/2017)", m.nota.taxaEntrega, 0);
  confere("total da nota = consumo cobrado", m.nota.valorTotal, 72);
  // Antes: Pix 36 + Dinheiro 36 (rateio proporcional) — o Pix cobrou 40, e é
  // 40 que o banco informa na DIMP. Agora o Pix vai exato; a taxa (7,20) e o
  // troco (0,80) saem do dinheiro.
  confere("Pix exato, taxa e troco saem do dinheiro", m.nota.pagamentos, [{ forma: "Pix", valor: 40 }, { forma: "Dinheiro", valor: 32.8 }]);
  const soma = (m.nota.pagamentos || []).reduce((s, f) => s + Math.round(f.valor * 100), 0);
  confere("soma das formas − troco fecha com o total ao centavo", soma - 80, 7200);
  confere("o dinheiro entregue vai como 'troco para'", m.nota.trocoPara, 32.8);
  confere("CPF de quem pediu na nota vai para a nota", m.nota.documentoDoCliente, "12345678909");
  confere("mesa é presencial", m.nota.entregaEmDomicilio, false);
}
const comTaxa = montarNotaDaMesa({ ...conta, taxaDeServicoNaNota: true });
confere("loja que pede a taxa na nota: total com a taxa", comTaxa.ok ? [comTaxa.nota.valorTotal, comTaxa.nota.taxaEntrega] : comTaxa, [79.2, 7.2]);
const tresFormas = montarNotaDaMesa({ ...conta, desconto: 0, pagamentos: [{ method: "Pix", amount: 33.33 }, { method: "Cartão Crédito", amount: 33.33 }, { method: "Pix", amount: 33.34 }] });
if (tresFormas.ok) {
  const soma = (tresFormas.nota.pagamentos || []).reduce((s, f) => s + Math.round(f.valor * 100), 0);
  confere("três baixas, duas formas: Pix juntado e soma exata", [tresFormas.nota.pagamentos?.length, soma], [2, 8000]);
  confere("forma principal é a de maior valor", tresFormas.nota.formaDePagamento, "Pix");
}
confere("conta só com cancelado não monta", montarNotaDaMesa({ ...conta, pedidos: [pedidosDaMesa[2]] }).ok, false);
confere(
  "linha de combo com centavo rateado não é juntada",
  juntarItensIguais([item("x", "Parte", 2, 5, 10.01), item("x", "Parte", 2, 5, 10.01)]).length,
  2
);

// A nota da conta passa pela mesma conferência que a SEFAZ faz (lib/fiscal-emissao).
const CONFIG: ConfiguracaoFiscal = {
  provedor: "focusnfe", tokenDoProvedor: "token-de-teste", cnpj: "11.222.333/0001-81", inscricaoEstadual: "12.345.678",
  razaoSocial: "HAKIM CENTRO LTDA", nomeFantasia: "Hakim Centro", regimeTributario: 1, logradouro: "Rua Teixeira e Souza",
  numero: "100", bairro: "Centro", municipio: "Rio das Ostras", codigoMunicipio: "3304524", uf: "RJ", cep: "28890-000",
  serie: 1, ambiente: 2, cscId: "1", csc: "abc", temCertificado: true,
};
if (m.ok) {
  const corpo = montarCorpoDaNfce(m.nota, CONFIG);
  confere("nota da conta monta o corpo da NFC-e", corpo.ok ? [corpo.corpo.valor_total, corpo.corpo.presenca_comprador] : corpo.pendencias, [72, 1]);
  confere(
    "no corpo: Pix 40 (17), dinheiro 32,80 (01) e troco 0,80",
    corpo.ok ? [corpo.corpo.formas_pagamento.map((f: any) => [f.forma_pagamento, f.valor_pagamento]), (corpo.corpo as any).valor_troco] : corpo.pendencias,
    [[["17", 40], ["01", 32.8]], 0.8]
  );
}

// ── 3a. DIMP: cartão e Pix exatos, troco só do dinheiro ─────────────────────
// O valor de cartão/Pix na nota é cruzado com o que a instituição de
// pagamento informa à SEFAZ (DIMP, Convênio ICMS 134/16). O rateio
// proporcional reduzia o cartão em toda conta com troco.
console.log("\n— DIMP: formas exatas na nota da conta —");
const formasDoCorpo = (nota: any) => {
  const c = montarCorpoDaNfce(nota, CONFIG);
  return c.ok
    ? { formas: c.corpo.formas_pagamento.map((f: any) => [f.forma_pagamento, f.valor_pagamento]), troco: (c.corpo as any).valor_troco ?? 0, total: c.corpo.valor_total }
    : { pendencias: c.pendencias.map((p) => p.mensagem) };
};
const umPedido = (total: number) => [{ id: "P", status: "ENTREGUE", totalAmount: total, customerCpfCnpj: null, itens: [item("x", "Consumo", 1, total)] }];
// O caso da revisão: conta de R$ 143, R$ 100 no cartão e R$ 50 em dinheiro.
confere(
  "conta de 143 (cartão 100 + dinheiro 50): cartão 100, dinheiro 50, troco 7",
  pagamentosDaConta({ totalDaNota: 143, pagos: [{ method: "Cartão Crédito", amount: 100 }, { method: "Dinheiro", amount: 50 }] }),
  { pagamentos: [{ forma: "Cartão Crédito", valor: 100 }, { forma: "Dinheiro", valor: 50 }], troco: 7, eletronicoReduzido: 0 }
);
const conta143 = montarNotaDaMesa({ sessionId: "S143", pedidos: umPedido(143), pagamentos: [{ method: "Cartão Crédito", amount: 100 }, { method: "Dinheiro", amount: 50 }] });
confere(
  "conta de 143 no corpo da NFC-e: 03 = 100, 01 = 50, valor_troco 7",
  conta143.ok ? formasDoCorpo(conta143.nota) : conta143,
  { formas: [["03", 100], ["01", 50]], troco: 7, total: 143 }
);
// Consumo 130 + 10% (13) fora da nota, pago com 100 no cartão e 50 em dinheiro:
// a taxa e o troco saem do dinheiro, o cartão fica exato.
const comTaxaFora = montarNotaDaMesa({
  sessionId: "S130", pedidos: umPedido(130), taxaDeServico: 13,
  pagamentos: [{ method: "Cartão Crédito", amount: 100 }, { method: "Dinheiro", amount: 50 }],
});
confere(
  "taxa fora da nota paga junto: cartão 100, dinheiro 37, troco 7, nota 130",
  comTaxaFora.ok ? [formasDoCorpo(comTaxaFora.nota), comTaxaFora.eletronicoReduzido] : comTaxaFora,
  [{ formas: [["03", 100], ["01", 37]], troco: 7, total: 130 }, 0]
);
// Os 10% pagos no cartão, sem dinheiro nenhum (277 de 552 contas do Pastel da
// Paulista em 30 dias): não há como o cartão ficar exato com a taxa fora da
// nota — a diferença é a taxa, e fica registrada.
const soCartao = montarNotaDaMesa({ sessionId: "S130c", pedidos: umPedido(130), taxaDeServico: 13, pagamentos: [{ method: "Cartão Crédito", amount: 143 }] });
confere(
  "taxa paga no cartão com a taxa fora da nota: cartão = nota, e a redução de 13 fica registrada",
  soCartao.ok ? [formasDoCorpo(soCartao.nota), soCartao.eletronicoReduzido] : soCartao,
  [{ formas: [["03", 130]], troco: 0, total: 130 }, 13]
);
const taxaNaNota = montarNotaDaMesa({ sessionId: "S143t", pedidos: umPedido(130), taxaDeServico: 13, taxaDeServicoNaNota: true, pagamentos: [{ method: "Cartão Crédito", amount: 143 }] });
confere(
  "loja com a taxa na nota: cartão exato (143)",
  taxaNaNota.ok ? [formasDoCorpo(taxaNaNota.nota), taxaNaNota.eletronicoReduzido] : taxaNaNota,
  [{ formas: [["03", 143]], troco: 0, total: 143 }, 0]
);
// Só dinheiro, com troco: a conta de R$ 38,83 paga com nota de R$ 100 (Pastel
// da Paulista, 07–13/09/2026) — o troco vai pelo "troco para".
const soDinheiro = montarNotaDaMesa({ sessionId: "S38", pedidos: umPedido(38.83), pagamentos: [{ method: "Dinheiro", amount: 100 }] });
confere(
  "só dinheiro: 01 = 100 e troco 61,17",
  soDinheiro.ok ? formasDoCorpo(soDinheiro.nota) : soDinheiro,
  { formas: [["01", 100]], troco: 61.17, total: 38.83 }
);
// Misto real do Pastel (lançado 332,60): 82,78 em dinheiro + 251,45 no crédito.
const mistoReal = montarNotaDaMesa({ sessionId: "SPP", pedidos: umPedido(332.6), pagamentos: [{ method: "Dinheiro", amount: 82.78 }, { method: "Crédito", amount: 251.45 }] });
confere(
  "misto do Pastel: crédito 251,45 exato, dinheiro 82,78, troco 1,63",
  mistoReal.ok ? formasDoCorpo(mistoReal.nota) : mistoReal,
  { formas: [["01", 82.78], ["03", 251.45]], troco: 1.63, total: 332.6 }
);
confere(
  "troco de 1 centavo sai do dinheiro (não do cartão, que é a maior linha)",
  pagamentosDaConta({ totalDaNota: 50, pagos: [{ method: "Cartão Débito", amount: 30 }, { method: "Dinheiro", amount: 20.01 }] }).pagamentos,
  [{ forma: "Cartão Débito", valor: 30 }, { forma: "Dinheiro", valor: 20 }]
);
confere(
  "duas baixas em dinheiro (grafias diferentes) viram uma linha, com o troco",
  pagamentosDaConta({ totalDaNota: 45, pagos: [{ method: "Dinheiro", amount: 20 }, { method: "Pix", amount: 10 }, { method: "dinheiro", amount: 30 }] }),
  { pagamentos: [{ forma: "Dinheiro", valor: 50 }, { forma: "Pix", valor: 10 }], troco: 15, eletronicoReduzido: 0 }
);
confere(
  "gorjeta com dinheiro na mesa: sai do dinheiro, Pix exato",
  pagamentosDaConta({ totalDaNota: 100, pagos: [{ method: "Pix", amount: 90 }, { method: "Dinheiro", amount: 20 }], foraDaNota: 5 }),
  { pagamentos: [{ forma: "Pix", valor: 90 }, { forma: "Dinheiro", valor: 15 }], troco: 5, eletronicoReduzido: 0 }
);
confere(
  "falta de 1 centavo (tolerância do fechamento) vai no dinheiro",
  pagamentosDaConta({ totalDaNota: 60, pagos: [{ method: "Crédito", amount: 40 }, { method: "Dinheiro", amount: 19.99 }] }).pagamentos,
  [{ forma: "Crédito", valor: 40 }, { forma: "Dinheiro", valor: 20 }]
);
confere(
  "montarNotaDaMesa passa a gorjeta adiante (não entra na nota)",
  (() => {
    const g = montarNotaDaMesa({ sessionId: "SG", pedidos: umPedido(100), gorjeta: 10, pagamentos: [{ method: "Pix", amount: 110 }] });
    return g.ok ? [g.nota.valorTotal, g.nota.pagamentos, g.eletronicoReduzido] : g;
  })(),
  [100, [{ forma: "Pix", valor: 100 }], 10]
);
confere("chaves da conta", chavesDaConta([{ method: "Pix" }, { method: "Dinheiro" }, { method: "Conta Funcionário" }]).sort(), ["MONEY", "PIX"]);

// ── 3b. A nota do pedido comum ──────────────────────────────────────────────
// A emissão automática montava o objeto à mão, sem canal e sem endereço: nos
// 140 pedidos ENTREGUE da Hakim Centro de 21 a 24/09/2026 nenhuma entrega
// montava (0 de 97 do iFood, 0 de 21 do site), nem a retirada do iFood.
console.log("\n— Nota do pedido comum —");
const CPF = "52998224725";
const MERCHANT = "0b6a0f4e-1d4c-4d9b-9f55-4a3e2f1c0d11";
// O pedido como o Prisma devolve (findUnique com items.menuProduct).
const pedidoDoIfood = {
  id: "cm-7jxhqv",
  dailyOrderNumber: 17,
  source: "IFOOD",
  ifoodOrderId: "ifood-1",
  ifoodReference: "7JXH",
  status: "SAIU_ENTREGA",
  deliveryType: "DELIVERY",
  deliveryBy: "MERCHANT",
  totalAmount: 10.89, // 24,90 − 20,99 + 5,99 + 0,99 de taxa de serviço do iFood
  deliveryFee: 5.99,
  discountTotal: 20.99,
  discountIfood: 10.01,
  discountDetails: [{ target: "ITEM", value: 20.99, ifood: 10.01, merchant: 10.98, description: "Cupom" }],
  paymentMethod: "Pix (Pago Online)",
  paymentMethods: null,
  changeAmount: null,
  gatewayPaymentId: null,
  ifoodStoreMerchant: null,
  customerCpfCnpj: CPF,
  customerName: "João Lima",
  customerAddress: "R. Itaperu, 107 - Comp: casa 1 - Ref: uma vila próximo ao colégio conceito - Centro - Rio das Ostras",
  items: [{ id: "i1", productName: "Pizza broto", quantity: 1, price: 24.9, menuProduct: { id: "pb", name: "Pizza broto", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" } }],
};
const loja = { ifoodMerchantId: MERCHANT, food99MerchantId: null };
const notaIfood = montarNotaDoPedido(pedidoDoIfood, loja);
confere("iFood: canal, pago online e merchant da loja", [notaIfood.canal, notaIfood.pagoOnline, notaIfood.idNaPlataforma], ["IFOOD", true, MERCHANT]);
const corpoIfood = montarCorpoDaNfce(notaIfood, CONFIG);
confere(
  "iFood entrega com a taxa de serviço no total: monta, vNF 19,91 com o endereço lido",
  corpoIfood.ok ? [corpoIfood.corpo.valor_total, corpoIfood.corpo.presenca_comprador, corpoIfood.corpo.logradouro_destinatario] : corpoIfood.pendencias.map((p) => p.campo),
  [19.91, 4, "R. Itaperu"]
);
// O objeto que a emissão automática montava: o mesmo pedido não passava.
const aMao = montarCorpoDaNfce({
  id: pedidoDoIfood.id, numero: 17, itens: montarItensDaNota(pedidoDoIfood.items), valorTotal: pedidoDoIfood.totalAmount,
  taxaEntrega: pedidoDoIfood.deliveryFee, desconto: pedidoDoIfood.discountTotal, formaDePagamento: pedidoDoIfood.paymentMethod,
  documentoDoCliente: CPF, nomeDoCliente: pedidoDoIfood.customerName, entregaEmDomicilio: ehEntregaEmDomicilio(pedidoDoIfood.deliveryType),
}, CONFIG);
confere(
  "(o objeto antigo, feito à mão, recusava pelo total e pelo endereço)",
  aMao.ok ? "montou" : [...new Set(aMao.pendencias.map((p) => p.campo))].sort(),
  ["enderecoDoCliente", "valorTotal"]
);
const retiradaIfood = montarCorpoDaNfce(
  montarNotaDoPedido({ ...pedidoDoIfood, deliveryType: "RETIRADA", deliveryFee: 0, totalAmount: 4.9, customerCpfCnpj: null, customerAddress: null }, loja),
  CONFIG
);
confere("iFood retirada sem CPF: monta, presencial, com intermediador", retiradaIfood.ok ? [retiradaIfood.corpo.presenca_comprador, retiradaIfood.corpo.indicador_intermediario] : retiradaIfood.pendencias, [1, 1]);
const doSite = {
  id: "site-1", dailyOrderNumber: 8, source: "ONLINE", status: "SAIU_ENTREGA", deliveryType: "DELIVERY",
  totalAmount: 64.9, deliveryFee: 5, discountTotal: 0, paymentMethod: "PIX_ENTREGA", paymentMethods: null,
  customerCpfCnpj: CPF, customerName: "Maria Souza",
  customerAddress: "Rua Nova Iguaçu, 668 - Atlântica (BL A AP 203 - Cond. Caravelas)",
  items: [{ id: "i2", productName: "Pizza grande", quantity: 1, price: 59.9, menuProduct: { id: "pg", name: "Pizza grande", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" } }],
};
const corpoSite = montarCorpoDaNfce(montarNotaDoPedido(doSite), CONFIG);
confere("site entrega com CPF: monta com o endereço", corpoSite.ok ? [corpoSite.corpo.valor_total, corpoSite.corpo.bairro_destinatario] : corpoSite.pendencias, [64.9, "Atlântica"]);
const semCpf = montarCorpoDaNfce(montarNotaDoPedido({ ...doSite, customerCpfCnpj: null }), CONFIG);
confere("site entrega sem CPF: a única pendência é o CPF (787)", semCpf.ok ? "montou" : semCpf.pendencias.map((p) => p.campo), ["documentoDoCliente"]);

// ── 4. A trava ──────────────────────────────────────────────────────────────
console.log("\n— Trava da nota autorizada —");
const producao = { fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "3".repeat(44), nfceNumber: 12, ambiente: 1 } };
confere("sem nota: segue como antes", travaDaNotaFiscal({ fiscalStatus: "PENDING", fiscalInfo: null }, "cancelar o pedido"), null);
confere("nota que falhou não trava", travaDaNotaFiscal({ fiscalStatus: "FAILED", fiscalInfo: { ultimoErro: "x" } }, "cancelar o pedido"), null);
confere("nota cancelada não trava", travaDaNotaFiscal({ fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "1", ambiente: 1 } }, "cancelar o pedido"), null);
confere("campos ausentes não travam", travaDaNotaFiscal({}, "cancelar o pedido"), null);
const frase = travaDaNotaFiscal(producao, "cancelar o pedido") || "";
confere("autorizada em produção trava", frase.startsWith("Este pedido tem NFC-e autorizada nº 12."), true);
// Sem status nem hora da autorização (a tela que só tem o status fiscal): a
// regra inteira, sem prometer cancelamento.
confere(
  "sem status e sem hora: diz as duas condições e o caminho do contador",
  [frase.includes("enquanto a mercadoria não saiu"), frase.includes("Se ainda der, cancele a nota em Fiscal → Notas fiscais antes de cancelar o pedido"), frase.includes("NF-e de devolução")],
  [true, true, true]
);

// ── 4a. Cancelar só antes da saída e em 30 minutos ──────────────────────────
// Ajuste SINIEF 19/16, cl. 15ª: "desde que não tenha havido a saída da
// mercadoria, em prazo não superior a 30 minutos". No modo padrão a nota da
// entrega é autorizada no SAIU_ENTREGA — a frase antiga ("cancele em até 30
// minutos") prometia o que a SEFAZ não aceita.
console.log("\n— Cancelamento: saída e prazo —");
const agoraDaTrava = new Date("2026-09-24T20:00:00-03:00");
const autorizadaHa = (min: number) => new Date(agoraDaTrava.getTime() - min * 60_000).toISOString();
const notaDe = (status: string, deliveryType: string | null, min: number | null, extra: Record<string, unknown> = {}) => ({
  status, deliveryType, fiscalStatus: "EMITTED",
  fiscalInfo: { nfceKey: "3".repeat(44), nfceNumber: 12, ambiente: 1, ...(min == null ? {} : { emittedAt: autorizadaHa(min) }), ...extra },
});
confere("saída: entrega na rua saiu", mercadoriaJaSaiu({ status: "SAIU_ENTREGA", deliveryType: "DELIVERY" }), true);
confere("saída: retirada SAIU_ENTREGA (pronto do KDS) não saiu", mercadoriaJaSaiu({ status: "SAIU_ENTREGA", deliveryType: "RETIRADA" }), false);
confere("saída: retirada ENTREGUE saiu", mercadoriaJaSaiu({ status: "ENTREGUE", deliveryType: "RETIRADA" }), true);
confere("saída: PREPARANDO não saiu", mercadoriaJaSaiu({ status: "PREPARANDO", deliveryType: "DELIVERY" }), false);
confere("saída: na rua sem o tipo de entrega, não se sabe", mercadoriaJaSaiu({ status: "EM_ROTA" }), null);
confere("saída: sem status, não se sabe", mercadoriaJaSaiu({}), null);

confere("entrega que saiu há 5 min: não cancela (saiu)", cancelamentoDaNota(notaDe("SAIU_ENTREGA", "DELIVERY", 5), agoraDaTrava), { cabe: false, porque: "saiu" });
confere("nota do aceite, pedido na cozinha há 10 min: cancela, restam 20", cancelamentoDaNota(notaDe("PREPARANDO", "DELIVERY", 10), agoraDaTrava), { cabe: true, restamMin: 20 });
confere("nota do aceite há 40 min, pedido na cozinha: prazo passou", cancelamentoDaNota(notaDe("PREPARANDO", "DELIVERY", 40), agoraDaTrava), { cabe: false, porque: "prazo" });
confere("retirada pronta no balcão há 5 min: cancela", cancelamentoDaNota(notaDe("SAIU_ENTREGA", "RETIRADA", 5), agoraDaTrava).cabe, true);
confere("retirada já levada: não cancela", cancelamentoDaNota(notaDe("ENTREGUE", "RETIRADA", 1), agoraDaTrava), { cabe: false, porque: "saiu" });
confere("nota da conta da mesa: a conta foi consumida", cancelamentoDaNota(notaDe("ENTREGUE", "MESA", 1, { notaDaConta: { tableSessionId: "S1" } }), agoraDaTrava), { cabe: false, porque: "saiu" });
confere("sem hora da autorização: incerto", cancelamentoDaNota(notaDe("PREPARANDO", "DELIVERY", null), agoraDaTrava), { cabe: "incerto" });

// O caso real da rota de status: cancelar o pedido de entrega que já saiu.
const saiuFrase = travaDaNotaFiscal(notaDe("SAIU_ENTREGA", "DELIVERY", 5), "cancelar o pedido", agoraDaTrava) || "";
confere(
  "cancelar entrega que saiu: não manda cancelar a nota, cita a regra e manda ao contador",
  [saiuFrase.includes("Cancele a nota"), saiuFrase.includes("não pode mais ser cancelada"), saiuFrase.includes("Ajuste SINIEF 19/16, cláusula 15ª"), saiuFrase.includes("NF-e de devolução/estorno"), saiuFrase.includes("não dá para cancelar o pedido aqui")],
  [false, true, true, true, true]
);
// O mesmo caso é, juridicamente, "retorno de mercadoria não entregue": cl. 9ª,
// parágrafo único — guardar o DANFE NFC-e com o motivo no verso. É da loja,
// na hora; a frase antiga só falava em devolução com o contador.
confere(
  "entrega que saiu e voltou: guardar o DANFE com o motivo no verso (cl. 9ª, parágrafo único), antes do contador",
  [saiuFrase.includes("guarde agora o DANFE NFC-e que foi com a entrega, com o motivo escrito no verso"), saiuFrase.includes("cláusula 9ª, parágrafo único"), saiuFrase.indexOf("verso") < saiuFrase.indexOf("NF-e de devolução")],
  [true, true, true]
);
const retiradaLevada = travaDaNotaFiscal(notaDe("ENTREGUE", "RETIRADA", 5), "cancelar o pedido", agoraDaTrava) || "";
confere("retirada levada pelo cliente: não há retorno de entrega, só devolução", [retiradaLevada.includes("verso"), retiradaLevada.includes("NF-e de devolução/estorno")], [false, true]);
const contaDaMesaFrase = travaDaNotaFiscal(notaDe("ENTREGUE", "MESA", 5, { notaDaConta: { tableSessionId: "S1" } }), "cancelar o pedido", agoraDaTrava) || "";
confere("nota da conta da mesa: consumida no salão, sem retorno de entrega", contaDaMesaFrase.includes("verso"), false);
const cabeFrase = travaDaNotaFiscal(notaDe("PREPARANDO", "DELIVERY", 10), "cancelar o pedido", agoraDaTrava) || "";
confere(
  "antes da saída e no prazo: manda cancelar a nota, com o que resta do teto",
  [cabeFrase.includes("Cancele a nota em Fiscal → Notas fiscais antes de cancelar o pedido"), cabeFrase.includes("restam no máximo 20 min")],
  [true, true]
);
// Cl. 15ª: "em prazo não superior a 30 minutos, podendo ser reduzido a
// critério de cada unidade federada". 30 é o teto, não a promessa.
confere(
  "o prazo é dito como teto nacional que o estado pode reduzir",
  [cabeFrase.includes("o teto nacional; o seu estado pode ter prazo menor"), cabeFrase.includes("restam 20 min")],
  [true, false]
);
const prazoFrase = travaDaNotaFiscal(notaDe("PREPARANDO", "DELIVERY", 40), "editar os itens", agoraDaTrava) || "";
confere(
  "fora do prazo: não promete cancelamento, manda ao contador",
  [prazoFrase.includes("Cancele a nota"), prazoFrase.includes("Já passaram os 30 minutos"), prazoFrase.includes("contador")],
  [false, true, true]
);
const contingenciaSaiu = travaDaNotaFiscal(
  { status: "SAIU_ENTREGA", deliveryType: "DELIVERY", fiscalStatus: "PENDING", fiscalInfo: { processando: true, contingencia: true, ambiente: 1 } },
  "cancelar o pedido"
) || "";
confere("contingência de entrega que saiu: não promete cancelar", [contingenciaSaiu.includes("não vai poder ser cancelada"), contingenciaSaiu.includes("cancele-a")], [true, false]);
confere("contingência de entrega que saiu: também manda guardar o DANFE com o motivo no verso", contingenciaSaiu.includes("motivo escrito no verso"), true);
// A emissão automática grava a contingência como EMITTED (a tela mostra o
// DANFE) com a marca `contingencia`: a trava tem de ler a marca.
const contingenciaEmitida = { status: "PREPARANDO", deliveryType: "DELIVERY", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "3".repeat(44), contingencia: true, ambiente: 1 } };
confere(
  "EMITTED com a marca de contingência: a trava fala da contingência, não de nota autorizada",
  ((f) => [f.includes("emitida em contingência"), f.includes("autorizada")])(travaDaNotaFiscal(contingenciaEmitida, "cancelar o pedido") || ""),
  [true, false]
);
confere(
  "efetivada (sem a marca): volta a ser nota autorizada",
  (travaDaNotaFiscal({ ...contingenciaEmitida, fiscalInfo: { nfceKey: "3".repeat(44), ambiente: 1, emittedAt: autorizadaHa(5) } }, "cancelar o pedido", agoraDaTrava) || "").startsWith("Este pedido tem NFC-e autorizada"),
  true
);
confere(
  "contingência recusada (FAILED, marca desligada): não trava",
  travaDaNotaFiscal({ ...contingenciaEmitida, fiscalStatus: "FAILED", fiscalInfo: { nfceKey: "3".repeat(44), contingencia: false, ambiente: 1 } }, "cancelar o pedido"),
  null
);
confere(
  "edição do pedido entregue com nota: o motivo diz que não cancela mais",
  (avaliarEdicao({ source: "ONLINE", paymentMethod: "Pix", ...notaDe("ENTREGUE", "DELIVERY", 50) }, { role: "FRANCHISEE" }).motivo || "").includes("não pode mais ser cancelada"),
  true
);
confere("homologação não trava", travaDaNotaFiscal({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "1", ambiente: 2 } }, "x"), null);
confere("EMITTED sem fiscalInfo (tela) trava", travaDaNotaFiscal({ fiscalStatus: "EMITTED" }, "x") !== null, true);
confere("EMITTED sem chave não é nota", travaDaNotaFiscal({ fiscalStatus: "EMITTED", fiscalInfo: { ambiente: 1 } }, "x"), null);
confere(
  "processando trava",
  (travaDaNotaFiscal({ fiscalStatus: "PENDING", fiscalInfo: { processando: true, ambiente: 1 } }, "trocar a forma de pagamento") || "").includes("em processamento"),
  true
);
confere(
  "contingência off-line trava com a frase dela",
  (travaDaNotaFiscal({ fiscalStatus: "PENDING", fiscalInfo: { processando: true, contingencia: true, ambiente: 1 } }, "cancelar o pedido") || "").includes("contingência"),
  true
);
confere(
  "nota da conta da mesa avisa que é da conta",
  (travaDaNotaFiscal({ fiscalStatus: "EMITTED", fiscalInfo: { ...producao.fiscalInfo, notaDaConta: { tableSessionId: "S1" } } }, "x") || "").includes("conta da mesa"),
  true
);

const dono = { role: "FRANCHISEE" };
const pedidoDoSite = { status: "ENTREGUE", source: "ONLINE", paymentMethod: "Dinheiro" };
confere("edição: pedido do site sem nota continua COMPLETO", avaliarEdicao(pedidoDoSite, dono), { modo: "COMPLETO", totalMuda: true });
confere("edição: com nota em produção, BLOQUEADO", avaliarEdicao({ ...pedidoDoSite, ...producao }, dono).modo, "BLOQUEADO");
confere("edição: com nota de homologação, COMPLETO", avaliarEdicao({ ...pedidoDoSite, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "1", ambiente: 2 } }, dono).modo, "COMPLETO");
const doIfood = { status: "SAIU_ENTREGA", source: "IFOOD", ifoodOrderId: "x", paymentMethod: "Pix (Pago Online)" };
const semNota = avaliarEdicao(doIfood, dono);
confere("edição: iFood pago online sem nota continua MARKETPLACE", [semNota.modo, semNota.totalMuda], ["MARKETPLACE", false]);
confere(
  "edição: sem permissão, a frase continua a da permissão",
  (avaliarEdicao({ ...pedidoDoSite, ...producao }, { role: "STAFF", permissions: "" }).motivo || "").startsWith("Você não tem permissão"),
  true
);
confere("edição: cancelado continua dizendo cancelado", avaliarEdicao({ ...pedidoDoSite, status: "CANCELADO", ...producao }, dono).motivo, "Este pedido já foi cancelado.");

// A forma de pagamento NÃO trava: é ela que acerta o caixa e o motoboy. Caso
// real (22/09/2026): "Débito (Cobrar na Entrega)" pago em dinheiro, informado
// 63 min depois — a nota da saída já não cancelaria mais.
console.log("\n— Troca de forma com nota —");
const cobrarNaEntrega = { paymentMethod: "Débito (Cobrar na Entrega)" };
confere("sem nota: nada a avisar", avisoDaNotaNaTrocaDePagamento({ ...cobrarNaEntrega, fiscalStatus: "PENDING", fiscalInfo: null }, "Dinheiro"), null);
confere("nota falhou: nada a avisar", avisoDaNotaNaTrocaDePagamento({ ...cobrarNaEntrega, fiscalStatus: "FAILED", fiscalInfo: { ultimoErro: "x", ambiente: 1 } }, "Dinheiro"), null);
confere("nota de homologação: nada a avisar", avisoDaNotaNaTrocaDePagamento({ ...cobrarNaEntrega, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "1", ambiente: 2 } }, "Dinheiro"), null);
const avisoAutorizada = avisoDaNotaNaTrocaDePagamento({ ...cobrarNaEntrega, ...producao }, "Dinheiro");
confere(
  "autorizada: a troca vale e o aviso diz que a nota fica com a forma de antes",
  avisoAutorizada && [
    avisoAutorizada.aviso.startsWith("A NFC-e nº 12 saiu com Débito (Cobrar na Entrega) e continua assim: a troca para Dinheiro vale para o pedido"),
    avisoAutorizada.rastro,
  ],
  [true, "NFC-e nº 12 continua com Débito (Cobrar na Entrega)"]
);
confere(
  "a forma gravada na emissão vale mais que a do pedido (segunda troca)",
  avisoDaNotaNaTrocaDePagamento({ paymentMethod: "Dinheiro", fiscalStatus: "EMITTED", fiscalInfo: { ...producao.fiscalInfo, formaNaNota: "Débito (Cobrar na Entrega)" } }, "Pix")?.rastro,
  "NFC-e nº 12 continua com Débito (Cobrar na Entrega)"
);
confere(
  "processando: avisa que a nota em processamento sai com a forma de antes",
  avisoDaNotaNaTrocaDePagamento({ ...cobrarNaEntrega, fiscalStatus: "PENDING", fiscalInfo: { processando: true, ambiente: 1 } }, "Dinheiro")?.aviso.startsWith("A NFC-e em processamento na SEFAZ saiu com Débito"),
  true
);
// A trava continua onde o VALOR muda: itens e cancelamento.
confere("itens: com nota autorizada continua travado", (travaDaNotaFiscal(producao, "editar os itens") || "").includes("antes de editar os itens"), true);

// ── 5. Retentativa ──────────────────────────────────────────────────────────
console.log("\n— Retentativa —");
const agora = new Date("2026-09-24T20:00:00-03:00");
const ha = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();
confere("rejeição não se reemite sozinha", deveRetentar({ motivo: "rejeitada", ultimaTentativaEm: ha(60) }, agora), false);
confere("produto sem NCM não se reemite sozinho", deveRetentar({ motivo: "dados_incompletos", ultimaTentativaEm: ha(60) }, agora), false);
confere("comunicação: 1 min depois da 1ª tentativa ainda espera", deveRetentar({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 1, ultimaTentativaEm: ha(1) }, agora), false);
confere("comunicação: 3 min depois da 1ª tentativa reemite", deveRetentar({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 1, ultimaTentativaEm: ha(3) }, agora), true);
confere("comunicação: 3ª tentativa espera 8 min", deveRetentar({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 3, ultimaTentativaEm: ha(7) }, agora), false);
confere("comunicação: 3ª tentativa, 9 min depois, reemite", deveRetentar({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 3, ultimaTentativaEm: ha(9) }, agora), true);
confere("teto de tentativas", deveRetentar({ motivo: "erro_de_comunicacao", tentativasAutomaticas: MAXIMO_DE_TENTATIVAS_AUTOMATICAS, ultimaTentativaEm: ha(600) }, agora), false);
confere("falha do botão Emitir (sem contagem) também reemite", deveRetentar({ motivo: "erro_de_comunicacao", ultimaTentativaEm: ha(5) }, agora), true);
// A fila: esgotada, já encerrada e falha que não é de comunicação saem de vez,
// com o motivo — antes ocupavam o `take: 40` do cron por 24 h.
confere("esgotada: encerra, dizendo por quê", decidirRetentativa({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 5, ultimaTentativaEm: ha(600) }, agora).acao, "encerrar");
confere(
  "o motivo da esgotada fala em emitir pela tela",
  ((d) => (d.acao === "encerrar" ? d.motivo.includes("5 tentativas") && d.motivo.includes("tela Fiscal") : d))(decidirRetentativa({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 5 }, agora)),
  true
);
confere("já encerrada: continua encerrada", decidirRetentativa({ motivo: "erro_de_comunicacao", retentativaEncerrada: true, motivoDoFimDaRetentativa: "x" }, agora), { acao: "encerrar", motivo: "x" });
confere("na espera: espera (não encerra)", decidirRetentativa({ motivo: "erro_de_comunicacao", tentativasAutomaticas: 2, ultimaTentativaEm: ha(1) }, agora), { acao: "esperar" });
confere("rejeição: encerra", decidirRetentativa({ motivo: "rejeitada" }, agora).acao, "encerrar");
// A reemissão usa o ambiente e o token de agora: só a falha do mesmo
// ambiente, de venda posterior ao carimbo `emissaoLigadaEm`.
const ligadaHa5 = ha(5);
const cabeNaAtual = (info: unknown, vendaEm: string, ambienteAtual: number, emissaoLigadaEm?: string) =>
  retentativaCabeNaEmissaoAtual({ fiscalInfo: info, vendaEm, ambienteAtual, emissaoLigadaEm });
confere("mesmo ambiente, venda depois de ligar: reemite", cabeNaAtual({ ambiente: 1 }, ha(3), 1, ligadaHa5), { cabe: true });
confere(
  "falha de homologação com a loja em produção: não reemite, e diz por quê",
  ((r) => (r.cabe ? r : [r.cabe, r.motivo.includes("em homologação e a loja agora emite em produção")]))(cabeNaAtual({ ambiente: 2 }, ha(3), 1)),
  [false, true]
);
confere(
  "venda anterior ao carimbo: não reemite (a mesma régua da varredura)",
  ((r) => (r.cabe ? r : [r.cabe, r.motivo.includes("anterior a quando a emissão foi ligada em produção")]))(cabeNaAtual({ ambiente: 1 }, ha(40), 1, ligadaHa5)),
  [false, true]
);
confere("falha do botão (sem ambiente gravado), venda depois de ligar: reemite", cabeNaAtual({ motivo: "erro_de_comunicacao" }, ha(3), 2, ligadaHa5), { cabe: true });
confere("sem carimbo e sem ambiente: reemite (vale só a janela)", cabeNaAtual({}, ha(600), 1), { cabe: true });
confere("ref do pedido comum é o id", idDaNotaDoPedido({ id: "p1", fiscalInfo: null }), "p1");
confere("ref do pedido da mesa é a da conta", idDaNotaDoPedido({ id: "p1", fiscalInfo: { idDaNota: "mesa-S1" } }), "mesa-S1");

// ── 6. Uma nota, vários pedidos ─────────────────────────────────────────────
// A nota da conta fica gravada nos pedidos da mesa com a mesma chave; listar
// por pedido contava a mesa de quatro rodadas como quatro notas.
console.log("\n— Uma entrada por nota —");
const CHAVE_DA_MESA = "3".repeat(44);
const daConta = (id: string, totalAmount: number) => ({
  id, totalAmount, fiscalStatus: "EMITTED",
  fiscalInfo: { nfceKey: CHAVE_DA_MESA, nfceNumber: 30, ambiente: 1, idDaNota: "mesa-S1", valorDaNota: 72 },
});
const notas = agruparPorNota([
  daConta("A", 20),
  { id: "X", totalAmount: 35, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "4".repeat(44), ambiente: 1 } },
  daConta("B", 60),
  { id: "Y", totalAmount: 50, fiscalStatus: "FAILED", fiscalInfo: { ultimoErro: "x" } },
  { id: "Z", totalAmount: 12, fiscalStatus: "EMITTED", fiscalInfo: { ambiente: 1 } },
]);
confere("mesa com dois pedidos + um avulso: duas notas", notas.map((n) => [n.principal.id, n.pedidos.map((p) => p.id)]), [["A", ["A", "B"]], ["X", ["X"]]]);
confere("a nota da conta vale o vNF gravado, não a soma dos pedidos (80)", notas[0]?.valor, 72);
confere("nota sem valor gravado (botão Emitir) vale o total do pedido", notas[1]?.valor, 35);
confere("sem nota, falha ou EMITTED sem chave: fora", agruparPorNota([{ id: "Y", fiscalStatus: "PENDING", fiscalInfo: null }]).length, 0);

// ── 7. A conta de mesa esquecida ────────────────────────────────────────────
// A nota da mesa era tentada uma vez, sem esperar, no fechamento; a varredura
// dos esquecidos filtrava `tableSessionId: null`.
console.log("\n— Conta de mesa esquecida —");
const semNada = { status: "ENTREGUE", fiscalStatus: "PENDING", fiscalInfo: null };
confere("conta fechada sem tentativa nenhuma: esquecida", contaDaMesaEsquecida([semNada, { ...semNada }]), true);
confere("o desconto gravado no fechamento não conta como tentativa", contaDaMesaEsquecida([{ ...semNada, fiscalInfo: { contaDaMesa: { desconto: 5 } } }]), true);
confere("pedido com falha: não é da varredura", contaDaMesaEsquecida([semNada, { status: "ENTREGUE", fiscalStatus: "FAILED", fiscalInfo: { motivo: "rejeitada" } }]), false);
confere("pedido processando: não é da varredura", contaDaMesaEsquecida([{ ...semNada, fiscalInfo: { processando: true } }]), false);
confere("conta com nota: não é da varredura", contaDaMesaEsquecida([{ status: "ENTREGUE", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "1" } }]), false);
confere("conta marcada sem nota (total zero): não é da varredura", contaDaMesaEsquecida([{ ...semNada, fiscalInfo: { semNotaAutomatica: { motivo: "zero" } } }]), false);
confere("pedido cancelado não conta; só cancelado, nada a emitir", contaDaMesaEsquecida([{ status: "CANCELADO", fiscalStatus: "PENDING", fiscalInfo: null }]), false);
confere("tentativa pelo fiscalInfo, mesmo sem status", pedidoTemTentativaDeNota({ fiscalStatus: null, fiscalInfo: { ultimaTentativaEm: "x" } }), true);
// O desconto sem registro: min(lançado, pago − taxa − gorjeta).
confere("sem troco, com desconto: o pago manda", descontoDaContaPeloPago({ lancado: 100, pago: 99, taxaDeServico: 9, gorjeta: 0 }), 10);
confere("com troco, sem desconto: o lançado manda", descontoDaContaPeloPago({ lancado: 38.83, pago: 100 }), 0);
confere("gorjeta não vira desconto", descontoDaContaPeloPago({ lancado: 50, pago: 60, gorjeta: 10 }), 0);
const agoraDaVarredura = Date.parse("2026-09-24T20:00:00-03:00");
confere("janela padrão: 2 h", inicioDaVarredura({ agora: agoraDaVarredura }).toISOString(), new Date(agoraDaVarredura - 2 * 3600_000).toISOString());
confere(
  "nunca antes de ligar a emissão",
  inicioDaVarredura({ agora: agoraDaVarredura, desde: new Date(agoraDaVarredura - 10 * 3600_000), emissaoLigadaEm: new Date(agoraDaVarredura - 3600_000).toISOString() }).toISOString(),
  new Date(agoraDaVarredura - 3600_000).toISOString()
);
confere("nunca mais que 24 h", inicioDaVarredura({ agora: agoraDaVarredura, desde: new Date(0) }).toISOString(), new Date(agoraDaVarredura - 24 * 3600_000).toISOString());

// ── 8. Nota avulsa de pedido de mesa ────────────────────────────────────────
console.log("\n— Nota avulsa de pedido de mesa —");
confere("pedido comum: nota avulsa vale", pedidoDeMesaExigeNotaDaConta({ tableSessionId: null }), null);
const daMesa = pedidoDeMesaExigeNotaDaConta({ tableSessionId: "S9" });
confere("pedido de mesa: exige a nota da conta, pela ref da sessão", daMesa && [daMesa.tableSessionId, daMesa.idDaNota, daMesa.mensagem.includes("conta inteira")], ["S9", "mesa-S9", true]);
confere("tableSessionId em branco não é mesa", pedidoDeMesaExigeNotaDaConta({ tableSessionId: "  " }), null);

// ── 9. Identidade da nota: reemissão depois do cancelamento ─────────────────
// A ref é a idempotência do provedor: reenviar a ref de uma nota cancelada
// devolve a cancelada. A nota nova precisa de ref nova.
console.log("\n— Identidade da nota e reemissão —");
confere("conta da mesa: primeira nota e reemissões", [idDaNotaDaMesa("S1"), idDaNotaDaMesa("S1", 1), idDaNotaDaMesa("S1", 2)], ["mesa-S1", "mesa-S1", "mesa-S1-2"]);
confere(
  "ehNotaDaConta: a primeira, as reemissões, e nada de outra mesa com prefixo parecido",
  [ehNotaDaConta("mesa-S1", "S1"), ehNotaDaConta("mesa-S1-3", "S1"), ehNotaDaConta("mesa-S10", "S1"), ehNotaDaConta("mesa-S1-x", "S1"), ehNotaDaConta(undefined, "S1")],
  [true, true, false, false, false]
);
confere(
  "refDaReemissao: base → -2 → -3, na conta e no pedido comum",
  [refDaReemissao("mesa-S1", "mesa-S1"), refDaReemissao("mesa-S1-2", "mesa-S1"), refDaReemissao("p9", "p9"), refDaReemissao("p9-2", "p9")],
  ["mesa-S1-2", "mesa-S1-3", "p9-2", "p9-3"]
);
const cancelada = {
  id: "p9",
  fiscalInfo: {
    nfceKey: "K1", nfceNumber: 7, serie: 1, emittedAt: "2026-09-24T12:00:00.000Z", ambiente: 1, xmlUrl: "https://api.focusnfe.com.br/a.xml",
    canceladaEm: "2026-09-24T12:10:00.000Z", protocoloCancelamento: "P", xmlCancelamentoUrl: "https://api.focusnfe.com.br/c.xml", valorDaNota: 30,
    notasAnteriores: [{ idDaNota: "p9-0", nfceKey: "K0" }],
    processando: false, ultimoErro: "lixo que não vai",
  },
};
const anteriores = notasAnterioresComA(cancelada);
confere(
  "a cancelada vai para notasAnteriores com o que o contador precisa (e sem as marcas de tentativa)",
  [anteriores.length, anteriores[0].nfceKey, anteriores[1].idDaNota, anteriores[1].xmlCancelamentoUrl, anteriores[1].valorDaNota, "ultimoErro" in anteriores[1]],
  [2, "K0", "p9", "https://api.focusnfe.com.br/c.xml", 30, false]
);

// ── 10. A nota do restante da conta ─────────────────────────────────────────
console.log("\n— Nota do restante da conta (rodada com nota própria) —");
confere(
  "conta paga numa forma só: a nota da rodada sai dela",
  pagamentosDoRestante([{ method: "Pix", amount: 40 }], [{ nome: "#1", valor: 20, forma: "N/A" }]),
  { ok: true, pagos: [{ method: "Pix", amount: 20 }] }
);
confere(
  "a nota da rodada saiu no cartão: sai do cartão, o dinheiro fica (DIMP)",
  pagamentosDoRestante([{ method: "Dinheiro", amount: 30 }, { method: "Cartão Crédito", amount: 25 }], [{ nome: "#1", valor: 15, forma: "Crédito" }]),
  { ok: true, pagos: [{ method: "Dinheiro", amount: 30 }, { method: "Cartão Crédito", amount: 10 }] }
);
const semForma = pagamentosDoRestante([{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 20 }], [{ nome: "#1", valor: 20, forma: "N/A" }]);
confere("duas formas e a da rodada desconhecida: recusa, sem chutar, mandando ao contador", [semForma.ok, !semForma.ok && /contador/.test(semForma.motivo)], [false, true]);
const naoCabe = pagamentosDoRestante([{ method: "Pix", amount: 10 }], [{ nome: "#1", valor: 20, forma: "Pix" }]);
confere("a nota da rodada maior que o pago naquela forma: recusa", naoCabe.ok, false);

// ── 11. Pedido cancelado pelo parceiro com a nota de pé ─────────────────────
console.log("\n— Aviso de cancelamento com nota —");
const comNota = { fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", nfceNumber: 12, ambiente: 1 } };
const aviso = alertaDoCancelamento(comNota, "iFood", new Date("2026-09-24T20:00:00.000Z"));
confere(
  "nota autorizada de produção: avisa, com a origem, a chave e o caminho (30 min ou contador)",
  aviso && [aviso.origem, aviso.nfceKey, aviso.quando, /30 minutos/.test(String(aviso.mensagem)), /contador/.test(String(aviso.mensagem)), /nº 12/.test(String(aviso.mensagem))],
  ["iFood", "K", "2026-09-24T20:00:00.000Z", true, true, true]
);
confere("nota de homologação: não avisa (é teste)", alertaDoCancelamento({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", ambiente: 2 } }, "iFood"), null);
confere("nota já cancelada: não avisa", alertaDoCancelamento({ fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "K", ambiente: 1 } }, "iFood"), null);
confere("sem nota: não avisa", alertaDoCancelamento({ fiscalStatus: "FAILED", fiscalInfo: { ultimoErro: "x" } }, "iFood"), null);
confere("com devolução registrada: não avisa", alertaDoCancelamento({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", devolucao: { quando: "x" } } }, "iFood"), null);
const avisoProcessando = alertaDoCancelamento({ fiscalStatus: "PENDING", fiscalInfo: { processando: true, ambiente: 1 } }, "99Food");
confere("nota em processamento: avisa também (ela pode sair autorizada)", Boolean(avisoProcessando && /processamento/.test(String(avisoProcessando.mensagem))), true);

// ── 12. Uma linha por nota, inclusive a cancelada ───────────────────────────
console.log("\n— agruparPorNota com as canceladas —");
const notasDaConta = [
  { id: "a", totalAmount: 30, fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "KC", valorDaNota: 45 } },
  { id: "b", totalAmount: 20, fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "KC", valorDaNota: 45 } },
  { id: "c", totalAmount: 10, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KA" } },
];
confere("sem a opção, a cancelada fica fora (quem lista notas VÁLIDAS)", agruparPorNota(notasDaConta).map((n) => n.chave), ["KA"]);
confere(
  "com comCanceladas: a nota da conta cancelada é UMA, com o valor da nota",
  agruparPorNota(notasDaConta, { comCanceladas: true }).map((n) => [n.chave, n.pedidos.length, n.valor]),
  [["KC", 2, 45], ["KA", 1, 10]]
);

// ── 13. Devolução registrada: a saída do pedido travado ─────────────────────
console.log("\n— Devolução registrada pelo contador —");
const agoraD = new Date("2026-09-24T21:00:00.000Z");
const entregue = { status: "ENTREGUE", deliveryType: "DELIVERY", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", nfceNumber: 5, ambiente: 1, emittedAt: "2026-09-24T20:00:00.000Z" } };
confere("antes: a nota que não cancela trava o cancelamento do pedido", Boolean(travaDaNotaFiscal(entregue, "cancelar o pedido", agoraD)), true);
const reg = registroDaDevolucao(entregue, { quem: "Dono", observacao: "NF-e de devolução nº 88 emitida pelo escritório" }, agoraD);
confere("registro com observação: aceito, com quem e quando", reg.ok && [reg.devolucao.quem, reg.devolucao.quando], ["Dono", agoraD.toISOString()]);
const comDevolucao = { ...entregue, fiscalInfo: { ...entregue.fiscalInfo, devolucao: reg.ok ? reg.devolucao : null } };
confere("depois: a trava sai (editar e cancelar voltam)", [travaDaNotaFiscal(comDevolucao, "cancelar o pedido", agoraD), avaliarEdicao({ ...comDevolucao, source: "SITE" }, { role: "FRANCHISEE" }).modo], [null, "COMPLETO"]);
confere("observação curta: recusa", registroDaDevolucao(entregue, { quem: "Dono", observacao: "ok" }, agoraD).ok, false);
confere("devolução já registrada: recusa a segunda", registroDaDevolucao(comDevolucao, { quem: "Dono", observacao: "de novo, a mesma coisa" }, agoraD).ok, false);
const aindaCancela = { status: "PREPARANDO", deliveryType: "DELIVERY", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", ambiente: 1, emittedAt: "2026-09-24T20:50:00.000Z" } };
const recusaCancela = registroDaDevolucao(aindaCancela, { quem: "Dono", observacao: "NF-e de devolução nº 88" }, agoraD);
confere("a nota ainda cancela (não saiu, dentro dos 30 min): manda cancelar, não registrar devolução", [recusaCancela.ok, !recusaCancela.ok && /cancele a nota/.test(recusaCancela.mensagem)], [false, true]);
confere("contingência: espera a SEFAZ", registroDaDevolucao({ ...entregue, fiscalInfo: { ...entregue.fiscalInfo, contingencia: true } }, { quem: "Dono", observacao: "NF-e de devolução nº 88" }, agoraD).ok, false);
confere("homologação: não há o que liberar", registroDaDevolucao({ ...entregue, fiscalInfo: { ...entregue.fiscalInfo, ambiente: 2 } }, { quem: "Dono", observacao: "NF-e de devolução nº 88" }, agoraD).ok, false);

// ── 14. O documento da nota da conta ────────────────────────────────────────
console.log("\n— Documento na nota da conta —");
{
  const item = { codigo: "x", descricao: "Pastel", ncm: "19059090", cfop: "5102", unidadeComercial: "UN", quantidade: 1, valorUnitario: 10, valorTotal: 10, origem: 0, csosn: "102" };
  const montada = montarNotaDaMesa({
    sessionId: "S-CPF",
    pedidos: [
      { id: "a", status: "ENTREGUE", totalAmount: 10, customerCpfCnpj: "00000000000", itens: [item] },
      { id: "b", status: "ENTREGUE", totalAmount: 10, customerCpfCnpj: "529.982.247-25", itens: [item] },
    ],
    pagamentos: [{ method: "Pix", amount: 20 }],
  });
  confere(
    "o \"00000000000\" (sem CPF, do JotaJá) não ganha do CPF de verdade de outra rodada",
    montada.ok && montada.nota.documentoDoCliente,
    "52998224725"
  );
}

// ── 15. O painel de pedidos lê a mesma trava que a API ──────────────────────
// O feed do painel (api/customer-order/poll) mandava só o fiscalStatus, e a
// trava tratava todo EMITTED sem fiscalInfo como nota autorizada de produção:
// o lápis e a aba "Editar itens" ficavam escondidos no pedido com a devolução
// registrada (a API aceitava) e no pedido com nota de homologação.
console.log("\n— Feed do painel: o recorte da nota —");
{
  const dono = { role: "FRANCHISEE" };
  const doSite = { source: "SITE", paymentMethod: "Pix", status: "SAIU_ENTREGA", deliveryType: "DELIVERY" };
  const comDevolucaoCompleta = {
    ...doSite,
    fiscalStatus: "EMITTED",
    fiscalInfo: {
      nfceKey: "K", nfceNumber: 5, ambiente: 1, emittedAt: "2026-09-24T20:00:00.000Z", xmlUrl: "https://x/xml", pdfUrl: "https://x/danfe",
      devolucao: { quando: "2026-09-24T22:00:00.000Z", quem: "Dono", observacao: "NF-e de devolução nº 88 emitida pelo escritório" },
    },
  };
  // Reproduz o defeito: o objeto que o feed mandava.
  confere(
    "antes: só o status (o que o feed mandava) esconde o editar, embora a API aceite",
    [avaliarEdicao({ ...doSite, fiscalStatus: "EMITTED" }, dono).modo, avaliarEdicao(comDevolucaoCompleta, dono).modo],
    ["BLOQUEADO", "COMPLETO"]
  );
  const recorte = notaParaTela(comDevolucaoCompleta.fiscalInfo);
  confere("com o recorte: devolução registrada → o painel mostra o editar", avaliarEdicao({ ...doSite, fiscalStatus: "EMITTED", fiscalInfo: recorte }, dono).modo, "COMPLETO");
  confere(
    "o recorte leva só o que a trava lê (sem URLs nem a observação)",
    recorte,
    { ambiente: 1, nfceKey: "K", nfceNumber: 5, emittedAt: "2026-09-24T20:00:00.000Z", devolucao: true }
  );
  confere(
    "nota de homologação: o painel mostra o editar (a API nunca travou)",
    avaliarEdicao({ ...doSite, fiscalStatus: "EMITTED", fiscalInfo: notaParaTela({ nfceKey: "K", ambiente: 2, pdfUrl: "u" }) }, dono).modo,
    "COMPLETO"
  );
  confere(
    "nota de produção sem devolução: continua escondido",
    avaliarEdicao({ ...doSite, fiscalStatus: "EMITTED", fiscalInfo: notaParaTela({ nfceKey: "K", ambiente: 1 }) }, dono).modo,
    "BLOQUEADO"
  );
  confere(
    "processando (PENDING com a marca): o painel também esconde",
    avaliarEdicao({ ...doSite, fiscalStatus: "PENDING", fiscalInfo: notaParaTela({ processando: true, ambiente: 1, ultimaTentativaEm: "x" }) }, dono).modo,
    "BLOQUEADO"
  );
  confere("pedido sem nota: sem recorte", [notaParaTela(null), notaParaTela({ ultimoErro: "x", motivo: "rejeitada" })], [null, null]);
  // A trava com o recorte diz exatamente o que diz com o fiscalInfo inteiro.
  const agoraP = new Date("2026-09-24T20:10:00.000Z");
  const casos: { status: string; deliveryType: string; fiscalStatus: string; fiscalInfo: Record<string, unknown> }[] = [
    { status: "PREPARANDO", deliveryType: "DELIVERY", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", nfceNumber: 7, ambiente: 1, emittedAt: "2026-09-24T20:00:00.000Z", xmlUrl: "u" } },
    { status: "ENTREGUE", deliveryType: "DELIVERY", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", ambiente: 1, emittedAt: "2026-09-24T19:00:00.000Z" } },
    { status: "SAIU_ENTREGA", deliveryType: "DELIVERY", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", ambiente: 1, contingencia: true, contingenciaDesde: "x" } },
    { status: "ENTREGUE", deliveryType: "MESA", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K", ambiente: 1, notaDaConta: { tableSessionId: "S", pedidos: ["a", "b"] } } },
    { status: "ENTREGUE", deliveryType: "RETIRADA", fiscalStatus: "PENDING", fiscalInfo: { processando: true, contingencia: true, ambiente: 1 } },
  ];
  confere(
    "travaDaNotaFiscal: a mesma frase com o recorte e com o fiscalInfo inteiro, caso a caso",
    casos.map((c) => travaDaNotaFiscal({ ...c, fiscalInfo: notaParaTela(c.fiscalInfo) }, "editar os itens", agoraP) === travaDaNotaFiscal(c, "editar os itens", agoraP)),
    casos.map(() => true)
  );
  const comForma = { ...casos[0], paymentMethod: "Pix", fiscalInfo: { ...casos[0].fiscalInfo, formaNaNota: "Pix" } };
  confere(
    "aviso da troca de pagamento: o mesmo com o recorte",
    avisoDaNotaNaTrocaDePagamento({ ...comForma, fiscalInfo: notaParaTela(comForma.fiscalInfo) }, "Dinheiro"),
    avisoDaNotaNaTrocaDePagamento(comForma, "Dinheiro")
  );
  // Um campo novo lido pela trava e esquecido na lista sumiria do feed sem
  // aviso — o painel voltaria a divergir da API. Confere no código-fonte.
  const fonteEdicao = readFileSync(join(__dirname, "../src/lib/edicao-de-pedido.ts"), "utf8");
  const lidos = [...new Set([...fonteEdicao.matchAll(/\binfo\??\.(\w+)/g)].map((m) => m[1]))].sort();
  confere(
    "todo `info.<campo>` que edicao-de-pedido lê está em CAMPOS_DA_NOTA_NA_TELA",
    lidos.filter((c) => !(CAMPOS_DA_NOTA_NA_TELA as readonly string[]).includes(c)),
    []
  );
  // E o feed usa o recorte (umas linhas no poll, que outra frente também mexe).
  const fontePoll = readFileSync(join(__dirname, "../src/app/api/customer-order/poll/route.ts"), "utf8");
  confere(
    "o feed do painel (poll) anexa o recorte da nota",
    /notasParaOPainel\(orders\)/.test(fontePoll) && /o\.fiscalInfo = notas\.get\(o\.id\)/.test(fontePoll),
    true
  );
  const fonteAuto = readFileSync(join(__dirname, "../src/lib/fiscal-automatico.ts"), "utf8");
  confere(
    "o recorte no banco usa a mesma lista e passa por notaParaTela",
    /CAMPOS_DA_NOTA_NA_TELA\.map\(/.test(fonteAuto) && /notaParaTela\(l\.nota\)/.test(fonteAuto),
    true
  );
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
if (falhas > 0) process.exit(1);
