/**
 * Trava o relatório "Vendas por período" (lib/relatorios/vendas.ts).
 *
 *   npx tsx scripts/teste-vendas.ts
 *
 * Os pedidos imitam a NIK de 17 a 23/09/2026: iFood com a taxa de serviço de
 * R$ 0,99 do app e desconto dividido entre loja e iFood, 99Food antigo só com
 * `discountTotal`, balcão com pagamento dividido, mesa com duas rodadas na
 * mesma conta, o rascunho do robô e o totem que não pagou. Depois, os casos
 * da revisão de 24/09/2026: o 99Food antigo com as promoções gravadas, o
 * pedido de R$ 1e17 da Pastel da Paulista, a mesa fechada com desconto e o
 * filtro de categoria que vinha do Itens vendidos.
 *
 * O Descontos, o Faturamento por dia, o Dia e hora e o Formas de pagamento
 * são conferidos AQUI contra esta conta (a régua única, seções 17 e 18):
 * se um deles mudar a régua sozinho, este teste acusa a divergência.
 */
import { montarMapasDoRelatorio } from "../src/lib/itens-do-relatorio";
import { itensVendidos } from "../src/lib/relatorios/itens-vendidos";
import { descontoDaMesa, descontoDoPedido as descontoDoRelatorioDeDescontos, DESCONTO_NA_MESA_DESDE as DESDE_NO_DESCONTOS } from "../src/lib/relatorios/descontos";
import { VALOR_IMPOSSIVEL as IMPOSSIVEL_NO_FATURAMENTO, faturamentoPorDia } from "../src/lib/relatorios/faturamento-por-dia";
import { vendasPorDiaEHora } from "../src/lib/relatorios/data-hora";
import { formasDePagamento } from "../src/lib/relatorios/formas-de-pagamento";
import { anteriorAteEsteHorario, atendimentosDaVenda } from "../src/lib/relatorios/regua-da-venda";
import {
  casaComBusca, descontoDoPedido, descontoNoFechamento, itensDoDetalhe, linhaDoPedido, outrasTaxasDoPedido, pagamentoDoPedido, paginar, quantidadeDeItens,
  pedidosDaLista, precisaDoDetalheDoDesconto, quemCancelou, resumoDeVendas, semFiltrosDeItem, situacaoDoPedido, somaDasLinhas, finalDoTelefone,
  temValorImpossivel, DESCONTO_NA_MESA_DESDE, VALOR_IMPOSSIVEL, type MesaFechada, type PedidoParaVendas,
} from "../src/lib/relatorios/vendas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const L = "nik";
const TZ = "America/Sao_Paulo";
let seq = 0;
const pedido = (x: Partial<PedidoParaVendas>): PedidoParaVendas => ({
  id: `p${String(++seq).padStart(2, "0")}`, franchiseeId: L, createdAt: "2026-09-18T22:00:00.000Z", status: "ENTREGUE", totalAmount: 0, items: [], ...x,
});

// iFood: itens 59,90 + entrega 6,99 − desconto 15,97 (loja 11,99 + iFood 3,98) + taxa do app 0,99 = 51,91
const ifood = pedido({
  source: "IFOOD", ifoodOrderId: "if-1", ifoodReference: "4F2A", deliveryType: "DELIVERY", dailyOrderNumber: 1,
  customerName: "João da Silva", customerPhone: "0800 705 0015 ID: 12345678", paymentMethod: "Crédito (Pago Online)",
  totalAmount: 51.91, deliveryFee: 6.99, discountTotal: 15.97, discountMerchant: 11.99, discountIfood: 3.98,
  items: [{ quantity: 1, price: 59.9 }],
});
// 99Food antigo: só `discountTotal`, sem as promoções — ninguém sabe de quem é.
const food99 = pedido({
  source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "266009", deliveryType: "DELIVERY", dailyOrderNumber: 2,
  customerName: "Maria", customerPhone: "11987654321", paymentMethod: "Pago Online (99Food)",
  totalAmount: 35, deliveryFee: 0, discountTotal: 10, items: [{ quantity: 1, price: 45 }],
});
// Balcão dividido: o texto do pedido ficou "Pix" (troca antiga), as partes são a verdade.
const balcao = pedido({
  source: "PRESENCIAL", deliveryType: "RETIRADA", dailyOrderNumber: 3, customerName: "Cliente Balcão", customerPhone: "",
  paymentMethod: "Pix", paymentMethods: [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 15 }],
  totalAmount: 35, items: [{ quantity: 2, price: 12 }, { quantity: 1, price: 11 }],
});
// Mesa: duas rodadas na MESMA conta, e uma terceira em outra conta.
const mesa1 = pedido({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s1", dailyOrderNumber: 4, customerName: "Mesa 5", paymentMethod: "N/A", totalAmount: 40, items: [{ quantity: 1, price: 40 }] });
const mesa2 = pedido({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s1", dailyOrderNumber: 5, customerName: "Mesa 5", paymentMethod: "N/A", totalAmount: 20, items: [{ quantity: 2, price: 10 }] });
const mesa3 = pedido({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s2", dailyOrderNumber: 6, customerName: "Mesa 2", paymentMethod: "N/A", totalAmount: 30, items: [{ quantity: 1, price: 30 }] });
// Madrugada: 01:30 do dia 19 no relógio da loja é do expediente do dia 18.
const madrugada = pedido({
  createdAt: "2026-09-19T04:30:00.000Z", source: "SITE", deliveryType: "DELIVERY", dailyOrderNumber: 7, customerName: "Zé", customerPhone: "(11) 91234-5678",
  paymentMethod: "Dinheiro", totalAmount: 55, deliveryFee: 5, items: [{ quantity: 1, price: 50 }],
});
// Cancelado, rascunho do robô e totem sem pagamento.
const cancelado = pedido({ status: "CANCELADO", source: "IFOOD", ifoodOrderId: "if-2", deliveryType: "DELIVERY", dailyOrderNumber: 8, customerName: "Ana", totalAmount: 80, items: [{ quantity: 1, price: 80 }] });
const canceladoIngles = pedido({ status: "CANCELLED", source: "SITE", deliveryType: "DELIVERY", dailyOrderNumber: 9, customerName: "Bia", totalAmount: 20, items: [{ quantity: 1, price: 20 }] });
const rascunho = pedido({ status: "CRIANDO_IA", source: "WHATSAPP_IA", deliveryType: "DELIVERY", customerName: "Carlos", totalAmount: 60, items: [{ quantity: 1, price: 60 }] });
const totemSemPagar = pedido({ status: "AGUARDANDO_PAGAMENTO", source: "TOTEM", totemLicenseId: "t1", deliveryType: "RETIRADA", dailyOrderNumber: 10, customerName: "Totem", totalAmount: 25, items: [{ quantity: 1, price: 25 }] });
// Item com quantidade zero (tirado na edição) não conta — a regra do Itens vendidos.
const editado = pedido({ source: "SITE", deliveryType: "RETIRADA", dailyOrderNumber: 11, customerName: "Edu", totalAmount: 30, items: [{ quantity: 1, price: 30 }, { quantity: 0, price: 99 }] });

const TODOS = [ifood, food99, balcao, mesa1, mesa2, mesa3, madrugada, cancelado, canceladoIngles, rascunho, totemSemPagar, editado];

console.log("\n1) Venda, cancelado e não concluído");
confere("as três situações", ["ENTREGUE", "CANCELADO", "canceled", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO", "SAIU_ENTREGA"].map(situacaoDoPedido),
  ["venda", "cancelado", "cancelado", "naoConcluido", "naoConcluido", "venda"]);
const r = resumoDeVendas(TODOS, [{ id: "s1", serviceFee: 6, waiterTip: 5 }, { id: "s2", serviceFee: 3, waiterTip: null }]);
confere("pedidos = só as vendas (8)", r.pedidos, 8);
confere("cancelados: as duas grafias, com o valor", r.cancelados, { pedidos: 2, valor: 100 });
confere("rascunho do robô e totem sem pagamento NÃO são cancelados", r.naoConcluidos, { pedidos: 2, valor: 85 });

console.log("\n2) A conta que fecha");
confere("taxa do app do iFood aparece como outra taxa (0,99)", outrasTaxasDoPedido(ifood), 0.99);
confere("total dos itens: 59,90 + 45 + 35 + 40 + 20 + 30 + 50 + 30", r.totalItens, 309.9);
confere("total dos pedidos", r.totalPedidos, 296.91);
confere("itens + entrega + outras − descontos = total",
  Math.round((r.totalItens + r.taxaEntrega.valor + r.outrasTaxas.valor - r.descontos.total) * 100) / 100, r.totalPedidos);
confere("taxa de entrega: soma e quantos pedidos tinham", r.taxaEntrega, { valor: 11.99, pedidos: 2 });
confere("serviço e gorjeta das mesas fechadas ficam FORA do total dos pedidos", [r.servico, r.totalComServico], [{ taxa: 9, gorjeta: 5, mesas: 2, descontoNaMesa: 0, mesasComDesconto: 0 }, 310.91]);
const comTaxaNegativa = resumoDeVendas([mesa1], [{ id: "s1", serviceFee: -48.91 }, { id: "s9", serviceFee: 4 }]);
confere("taxa de serviço negativa (conta antiga) é desconto na mesa, não taxa", [comTaxaNegativa.servico, comTaxaNegativa.totalComServico],
  [{ taxa: 4, gorjeta: 0, mesas: 2, descontoNaMesa: 48.91, mesasComDesconto: 1 }, -4.91]);
confere("taxa de serviço gravada sem arredondar soma crua, como o relatório de mesas (6,355 + 6,355 = 12,71, não 12,72)",
  resumoDeVendas([], [{ id: "a", serviceFee: 6.355 }, { id: "b", serviceFee: 6.355 }]).servico.taxa, 12.71);

console.log("\n3) Descontos: quem bancou");
confere("iFood: loja e plataforma como vieram", descontoDoPedido(ifood), { total: 15.97, loja: 11.99, plataforma: 3.98, naoIdentificado: 0 });
confere("99Food antigo sem as promoções: não identificado (não se empurra para a plataforma)", descontoDoPedido(food99), { total: 10, loja: 0, plataforma: 0, naoIdentificado: 10 });
confere("site com discountTotal sem dono: é da loja", descontoDoPedido(pedido({ source: "SITE", discountTotal: 5 })), { total: 5, loja: 5, plataforma: 0, naoIdentificado: 0 });
confere("resumo dos descontos", r.descontos, { total: 25.97, loja: 11.99, plataforma: 3.98, naoIdentificado: 10, pedidos: 2 });

console.log("\n4) Vendas (atendimentos) e ticket médio: a mesa conta uma vez");
confere("8 lançamentos, 7 vendas: as duas rodadas da mesa 5 são UMA venda; 2 mesas", [r.pedidos, r.atendimentos, r.mesas], [8, 7, 2]);
confere("ticket geral = valor ÷ VENDAS (296,91 ÷ 7), não ÷ lançamentos (era 37,11)", r.ticketMedio, 42.42);
const linhaMesa = r.porTipo.find((t) => t.tipo === "MESA");
confere("mesa: 3 lançamentos, 2 vendas (contas), R$ 90 → ticket R$ 45 por conta",
  [linhaMesa?.pedidos, linhaMesa?.vendas, linhaMesa?.valor, linhaMesa?.ticketMedio], [3, 2, 90, 45]);
confere("tipos na ordem da Saipos, só os que venderam, com vendas e lançamentos",
  r.porTipo.map((t) => [t.rotulo, t.vendas, t.pedidos]), [["Entrega", 3, 3], ["Retirada", 1, 1], ["Balcão", 1, 1], ["Mesa", 2, 3]]);
confere("lançado no caixa é Balcão mesmo marcado RETIRADA; o site que o cliente busca é Retirada (origemDaVenda)",
  [r.porTipo.find((t) => t.tipo === "BALCAO")?.valor, r.porTipo.find((t) => t.tipo === "RETIRADA")?.valor], [35, 30]);

console.log("\n5) Por canal");
confere("canais do maior para o menor, com a mesa separada do PDV (a mesa: 2 vendas em 3 lançamentos)",
  r.porCanal.map((c) => [c.canal, c.vendas, c.pedidos, c.valor]), [["MESA", 2, 3, 90], ["SITE", 2, 2, 85], ["IFOOD", 1, 1, 51.91], ["99FOOD", 1, 1, 35], ["PDV", 1, 1, 35]]);
confere("os % somam 100", Math.round(r.porCanal.reduce((s, c) => s + c.pct, 0)), 100);

console.log("\n6) Bate com o Itens vendidos");
const mapas = montarMapasDoRelatorio([]);
const doItens = itensVendidos(
  TODOS.filter((p) => situacaoDoPedido(p.status) === "venda").map((p) => ({ franchiseeId: p.franchiseeId, canal: "SITE", items: (p.items || []).map((i) => ({ ...i, productName: "X" })) })),
  { mapasDe: mapas, grupos: new Map(), vendaveisDe: () => new Map() },
  { porCategoria: false, opcoesPorProduto: false, apenasProdutos: false, juntarMesmoNome: true, percentualPor: "quantidade", categorias: new Set(), produtos: new Set(), gruposOcultos: new Set() },
);
confere("total dos itens = total do Itens vendidos, centavo a centavo", r.totalItens, doItens.total.valor);
confere("quantidade de itens também", r.quantidadeDeItens, doItens.total.quantidade);

console.log("\n7) Madrugada antes das 5h");
const lm = linhaDoPedido(madrugada, TZ);
confere("01:30 do dia 19 no relógio da loja, expediente do dia 18", [lm.data, lm.hora, lm.diaOperacional], ["19/09/2026", "01:30", "2026-09-18"]);
confere("pedido das 19h fica no mesmo dia", [linhaDoPedido(ifood, TZ).data, linhaDoPedido(ifood, TZ).hora, linhaDoPedido(ifood, TZ).diaOperacional], ["18/09/2026", "19:00", "2026-09-18"]);

console.log("\n8) Pagamento");
confere("dividido sai das partes, não do texto velho", pagamentoDoPedido(balcao), "Dividido: Pix R$ 20,00 + Dinheiro R$ 15,00");
confere("dividido conta UMA venda com o total do pedido", [r.porCanal.find((c) => c.canal === "PDV")?.vendas, r.porCanal.find((c) => c.canal === "PDV")?.valor], [1, 35]);
confere("mesa fechada: as formas das baixas da sessão", pagamentoDoPedido(mesa1, { id: "s1", status: "CLOSED", paymentMethods: [{ method: "Pix", amount: 50 }, { method: "Dinheiro", amount: 21 }, { method: "Pix", amount: 0.1 }] }), "Conta da mesa: Pix + Dinheiro");
confere("mesa aberta: ainda sem pagamento", pagamentoDoPedido(mesa3, { id: "s2", status: "OPEN" }), "Mesa ainda aberta");
confere("marketplace: o texto do pedido", pagamentoDoPedido(ifood), "Crédito (Pago Online)");

console.log("\n9) Busca");
confere("pelo número do dia, com ou sem #", [casaComBusca(balcao, "#3"), casaComBusca(balcao, "3"), casaComBusca(balcao, "33")], [true, true, false]);
confere("pelo número do iFood (sem caixa)", casaComBusca(ifood, "4f2a"), true);
confere("pelo número do 99 (parte)", casaComBusca(food99, "6600"), true);
confere("pelo nome sem acento", casaComBusca(ifood, "joao"), true);
confere("pelo final do telefone, com máscara", [casaComBusca(madrugada, "5678"), casaComBusca(madrugada, "91234-5678"), casaComBusca(madrugada, "567")], [true, true, false]);
confere("número curto não casa com telefone de outro", casaComBusca(food99, "7"), false);

console.log("\n10) Filtro de status da lista");
const idsDe = (l: PedidoParaVendas[]) => l.map((p) => p.dailyOrderNumber);
confere("todas: vendas e canceladas, sem os não concluídos, mais recente primeiro",
  idsDe(pedidosDaLista(TODOS, "", "")), [7, 1, 2, 3, 4, 5, 6, 8, 9, 11]);
confere("só canceladas: nunca o rascunho nem o totem sem pagamento", idsDe(pedidosDaLista(TODOS, "canceladas", "")), [8, 9]);
confere("não canceladas", pedidosDaLista(TODOS, "vendas", "").length, 8);
confere("busca e status juntos", idsDe(pedidosDaLista(TODOS, "canceladas", "ana")), [8]);
const soma = somaDasLinhas(pedidosDaLista(TODOS, "", "").map((p) => linhaDoPedido(p, TZ)));
confere("o rodapé da lista soma só as vendas e bate com o resumo", [soma.pedidos, soma.cancelados, soma.total, soma.totalItens], [8, 2, r.totalPedidos, r.totalItens]);
confere("e guarda o valor dos cancelados à parte, igual ao do resumo", soma.valorCancelado, r.cancelados.valor);

console.log("\n11) Paginação");
const cento = Array.from({ length: 120 }, (_, i) => i);
confere("120 linhas = 3 páginas, a última com 20", [paginar(cento, 3).paginas, paginar(cento, 3).itens.length, paginar(cento, 3).itens[0]], [3, 20, 100]);
confere("página fora do limite vai para a última; lixo vai para a primeira", [paginar(cento, 9).pagina, paginar(cento, NaN).pagina, paginar([], 2).pagina], [3, 1, 1]);

console.log("\n12) Detalhe e LGPD");
const det = itensDoDetalhe([
  { quantity: 1, price: 69.9, productName: "Pizza Grande | Borda Catupiry", comboSelections: JSON.stringify({ gs: { "1/2 Portuguesa": 1, "1/2 Calabresa": 1 }, gb: { "Borda Catupiry": 1 } }), notes: "sem cebola" },
  { quantity: 2, price: 12, productName: null, menuProduct: { name: "Coca Cola 1,5l" }, comboSelections: [{ name: "Gelada", quantity: 1, price: 0 }] },
]);
confere("pizza: nome sem a borda repetida, opções do site, observação",
  [det[0].nome, det[0].opcoes.map((o) => o.nome), det[0].observacao, det[0].total], ["Pizza Grande", ["1/2 Portuguesa", "1/2 Calabresa", "Borda Catupiry"], "sem cebola", 69.9]);
confere("item sem nome gravado usa o do cadastro; preço 0 da opção não aparece", [det[1].nome, det[1].total, det[1].opcoes[0].preco], ["Coca Cola 1,5l", 24, null]);
confere("planilha leva só o final do telefone", [finalDoTelefone("(11) 91234-5678"), finalDoTelefone(""), finalDoTelefone("12")], ["…5678", "", ""]);
confere("quem cancelou em frase, não em código", [quemCancelou("LOJA"), quemCancelou("IFOOD"), quemCancelou("SYSTEM_INACTIVITY"), quemCancelou(null)],
  ["pela loja", "pelo iFood", "pelo sistema (pedido parado sem resposta)", null]);
confere("o 00000000000 do balcão não é telefone de ninguém",
  [finalDoTelefone("00000000000"), linhaDoPedido(pedido({ customerPhone: "00000000000" }), TZ).telefone], ["", ""]);

console.log("\n13) Revisão: quem bancou o desconto do 99Food antigo (a régua do recibo e do Descontos)");
// O #266005 do Frangoso (12/09/2026) como está no banco: R$ 22,40 de desconto,
// sem as colunas; a promoção tipo 2 foi toda da loja, a tipo 11 toda do 99.
const food99Antigo = pedido({
  source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "266005", deliveryType: "DELIVERY", dailyOrderNumber: 12,
  totalAmount: 60.76, deliveryFee: 0, discountTotal: 22.4, discountMerchant: null, discountIfood: null,
  discountDetails: { cupom: 0, itens: 22.4, total: 22.4, entrega: 0, promocoes: [
    { promo_type: 2, promo_discount: 1600, shop_subside_price: 1600 },
    { promo_type: 11, promo_discount: 640, shop_subside_price: 0 },
  ] },
  items: [{ quantity: 1, price: 83.16 }],
});
confere("#266005: a loja bancou R$ 16,00 e o 99 R$ 6,40 (antes: R$ 22,40 todo na plataforma)",
  descontoDoPedido(food99Antigo), { total: 22.4, loja: 16, plataforma: 6.4, naoIdentificado: 0 });
const food99Novo = pedido({ source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryType: "DELIVERY", totalAmount: 30, discountTotal: 20, discountMerchant: 20, discountIfood: 0, items: [{ quantity: 1, price: 50 }] });
confere("99Food novo: valem as colunas gravadas", descontoDoPedido(food99Novo), { total: 20, loja: 20, plataforma: 0, naoIdentificado: 0 });
const wabiz = pedido({ source: "WABIZ", deliveryType: "DELIVERY", totalAmount: 45, discountTotal: 5, items: [{ quantity: 1, price: 50 }] });
confere("Wabiz sem as colunas: é app com a marca da loja, o desconto é da loja", descontoDoPedido(wabiz), { total: 5, loja: 5, plataforma: 0, naoIdentificado: 0 });
const brendiAntigo = pedido({ source: "BRENDI", deliveryType: "DELIVERY", totalAmount: 40, discountTotal: 10,
  discountDetails: [{ value: 6, merchant: 6, platform: 0 }, { value: 4, merchant: 0, platform: 4 }], items: [{ quantity: 1, price: 50 }] });
confere("benefício com dono no detalhe (Brendi/Jotajá antigos)", descontoDoPedido(brendiAntigo), { total: 10, loja: 6, plataforma: 4, naoIdentificado: 0 });
confere("a rota só busca o detalhe de quem tem desconto e nenhuma coluna de dono",
  [food99Antigo, food99Novo, ifood, food99, balcao, wabiz].map(precisaDoDetalheDoDesconto), [true, false, false, true, false, true]);
const paraConferir = [ifood, food99, food99Antigo, food99Novo, wabiz, brendiAntigo, balcao, pedido({ source: "SITE", discountTotal: 5 }),
  pedido({ source: "IFOOD", ifoodOrderId: "if-9", deliveryType: "DELIVERY", discountTotal: 12, discountMerchant: 5, discountIfood: 4 })];
confere("loja, plataforma e não identificado IGUAIS aos do relatório Descontos, pedido a pedido",
  paraConferir.map((p) => { const d = descontoDoPedido(p); return [d.loja, d.plataforma, d.naoIdentificado]; }),
  paraConferir.map((p) => { const d = descontoDoRelatorioDeDescontos(p as any); return [d.loja, d.plataforma, d.naoIdentificado]; }));
const comAntigo = resumoDeVendas([ifood, food99Antigo]);
confere("a conta continua fechando com a divisão nova",
  Math.round((comAntigo.totalItens + comAntigo.taxaEntrega.valor + comAntigo.outrasTaxas.valor - comAntigo.descontos.loja - comAntigo.descontos.plataforma - comAntigo.descontos.naoIdentificado) * 100) / 100,
  comAntigo.totalPedidos);

console.log("\n14) Revisão: valor impossível (o pedido de R$ 1e17 da Pastel da Paulista)");
const absurdo = pedido({ status: "CANCELADO", source: "SITE", deliveryType: "DELIVERY", dailyOrderNumber: 112, totalAmount: 100000000000000060, items: [{ quantity: 1, price: 1e17 }] });
const canceladoComum = pedido({ status: "CANCELADO", source: "SITE", deliveryType: "DELIVERY", dailyOrderNumber: 113, totalAmount: 20, items: [{ quantity: 1, price: 20 }] });
const vendaComum = pedido({ source: "SITE", deliveryType: "RETIRADA", dailyOrderNumber: 114, totalAmount: 30, items: [{ quantity: 1, price: 30 }] });
const rAbsurdo = resumoDeVendas([absurdo, canceladoComum, vendaComum]);
confere("fica fora das somas e das contagens, e é contado à parte (antes: cancelado de R$ 1e17 e o de R$ 20 sumia)",
  [rAbsurdo.cancelados, rAbsurdo.valoresImpossiveis, rAbsurdo.pedidos, rAbsurdo.totalPedidos], [{ pedidos: 1, valor: 20 }, 1, 1, 30]);
confere("item de R$ 1e17 também denuncia, mesmo com o total zerado", temValorImpossivel({ totalAmount: 0, items: [{ quantity: 1, price: 1e17 }] }), true);
confere("R$ 999.999,99 ainda é valor possível", temValorImpossivel({ totalAmount: 999999.99, items: [] }), false);
const linhasAbsurdas = pedidosDaLista([absurdo, canceladoComum, vendaComum], "canceladas", "").map((p) => linhaDoPedido(p, TZ));
confere("continua na lista, marcado, para o dono achar", linhasAbsurdas.map((l) => [l.numero, l.valorImpossivel]), [["#112", true], ["#113", false]]);
const somaAbsurda = somaDasLinhas(linhasAbsurdas);
confere("o rodapé de 'só canceladas' soma só o cancelado de verdade", [somaAbsurda.cancelados, somaAbsurda.valorCancelado, somaAbsurda.valoresImpossiveis], [1, 20, 1]);
confere("a régua é a mesma do Faturamento por dia", VALOR_IMPOSSIVEL, IMPOSSIVEL_NO_FATURAMENTO);

console.log("\n15) Revisão: desconto dado no fechamento da mesa");
// A mesa real da Pastel da Paulista: R$ 125,40 de consumo, fechada em 13/09/2026 sem nada pago.
const cortesia: MesaFechada = { id: "m1", serviceFee: 0, waiterTip: null, fechadaEm: "2026-09-13T21:43:50.480Z", pago: 0, pedidos: [{ status: "ENTREGUE", totalAmount: 125.4, discountTotal: null }] };
confere("consumo − (pago − serviço − gorjeta) = R$ 125,40", descontoNoFechamento(cortesia), 125.4);
const comum: MesaFechada = { id: "m2", serviceFee: 6.359, waiterTip: 5, fechadaEm: "2026-09-18T23:00:00.000Z", pago: 74.95,
  pedidos: [{ status: "ENTREGUE", totalAmount: 40 }, { status: "ENTREGUE", totalAmount: 23.59 }, { status: "CANCELADO", totalAmount: 99 }] };
confere("mesa paga certinho (com taxa crua e rodada cancelada): sem desconto", descontoNoFechamento(comum), 0);
const comDesconto: MesaFechada = { ...comum, id: "m3", pago: 64.95 };
confere("paga R$ 10 a menos: R$ 10 de desconto", descontoNoFechamento(comDesconto), 10);
confere("cliente deixou troco: sobra não é desconto", descontoNoFechamento({ ...comum, id: "m4", pago: 80 }), 0);
confere("antes de 13/09/2026 a mesa não tinha desconto: diferença era conta mal fechada",
  descontoNoFechamento({ ...cortesia, id: "m5", fechadaEm: "2026-09-12T20:00:00.000Z" }), 0);
confere("sem o pago gravado não se deduz nada", descontoNoFechamento({ ...cortesia, id: "m6", pago: null }), 0);
confere("pedido da conta que já traz desconto: não conta duas vezes",
  descontoNoFechamento({ ...cortesia, id: "m7", pedidos: [{ status: "ENTREGUE", totalAmount: 125.4, discountTotal: 12.54 }] }), 0);
const taxaNegativaRecente: MesaFechada = { id: "m8", serviceFee: -48.91, waiterTip: 0, fechadaEm: "2026-09-15T23:00:00.000Z", pago: 51.09, pedidos: [{ status: "ENTREGUE", totalAmount: 100 }] };
confere("taxa negativa numa mesa recente: as duas leituras dão o mesmo dinheiro, vale uma vez", descontoNoFechamento(taxaNegativaRecente), 48.91);
confere("a data de corte é a do relatório Descontos", DESCONTO_NA_MESA_DESDE, DESDE_NO_DESCONTOS);
const mesasParaConferir = [cortesia, comum, comDesconto, { ...comum, id: "m4", pago: 80 }, { ...cortesia, id: "m5", fechadaEm: "2026-09-12T20:00:00.000Z" }, taxaNegativaRecente];
confere("o mesmo desconto de mesa do relatório Descontos, mesa a mesa",
  mesasParaConferir.map(descontoNoFechamento),
  mesasParaConferir.map((m) => descontoDaMesa({ id: m.id, fechadaEm: m.fechadaEm as string, mesa: null, pago: m.pago ?? null, taxaServico: m.serviceFee ?? null, gorjeta: m.waiterTip ?? null, pedidos: (m.pedidos || []).map((o) => ({ totalAmount: o.totalAmount ?? null, status: o.status ?? null, discountTotal: o.discountTotal ?? null })) })));
// As duas travas que só o Descontos tinha até a revisão de 24/09/2026 (a mesma
// palavra com duas fórmulas): nunca mais que o consumo, e só acima de 1 centavo.
const pagouMenosQueATaxa: MesaFechada = { id: "m9", serviceFee: 10, waiterTip: 5, fechadaEm: "2026-09-15T23:00:00.000Z", pago: 0, pedidos: [{ status: "ENTREGUE", totalAmount: 100 }] };
confere("pago abaixo de taxa + gorjeta: o desconto para no consumo (R$ 100, não R$ 115)", descontoNoFechamento(pagouMenosQueATaxa), 100);
const taxaDeUmCentavo: MesaFechada = { id: "m10", serviceFee: -0.01, waiterTip: 0, fechadaEm: "2026-09-10T23:00:00.000Z", pago: 50, pedidos: [{ status: "ENTREGUE", totalAmount: 50 }] };
confere("taxa negativa de 1 centavo não é desconto (a trava de 1 centavo vale no valor final)", descontoNoFechamento(taxaDeUmCentavo), 0);
const bordas = [pagouMenosQueATaxa, taxaDeUmCentavo, { ...pagouMenosQueATaxa, id: "m11", serviceFee: -150 }];
confere("nas bordas, o mesmo número do relatório Descontos (em produção, 571 mesas fechadas em 24/09/2026 já davam iguais)",
  bordas.map(descontoNoFechamento),
  bordas.map((m) => descontoDaMesa({ id: m.id, fechadaEm: m.fechadaEm as string, mesa: null, pago: m.pago ?? null, taxaServico: m.serviceFee ?? null, gorjeta: m.waiterTip ?? null, pedidos: (m.pedidos || []).map((o) => ({ totalAmount: o.totalAmount ?? null, status: o.status ?? null, discountTotal: o.discountTotal ?? null })) })));
const rMesa = resumoDeVendas([pedido({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m1", totalAmount: 125.4, items: [{ quantity: 1, price: 125.4 }] })], [cortesia]);
confere("o total com serviço e gorjeta é o que entrou: R$ 0 (antes: R$ 125,40 que nunca entraram)",
  [rMesa.totalPedidos, rMesa.servico.descontoNaMesa, rMesa.servico.mesasComDesconto, rMesa.totalComServico], [125.4, 125.4, 1, 0]);

console.log("\n16) Revisão: filtro de categoria que vinha do Itens vendidos");
confere("a página tira categorias e produtos da query e mantém o resto",
  semFiltrosDeItem("de=2026-09-17&ate=2026-09-23&categorias=Bebidas&produtos=p1,p2&canais=IFOOD&status=canceladas"),
  "de=2026-09-17&ate=2026-09-23&canais=IFOOD&status=canceladas");

console.log("\n17) A régua única: quem abre uma venda (lib/relatorios/regua-da-venda.ts)");
// Três rodadas da mesma mesa, fora de ordem: a venda é do lançamento mais antigo.
const rodada = (id: string, createdAt: string, x: Partial<PedidoParaVendas> = {}) =>
  pedido({ id, createdAt, source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "sX", totalAmount: 10, items: [{ quantity: 1, price: 10 }], ...x });
const rodadas = [rodada("r2", "2026-09-18T23:30:00.000Z"), rodada("r1", "2026-09-18T23:00:00.000Z"), rodada("r3", "2026-09-19T00:10:00.000Z")];
const atMesa = atendimentosDaVenda(rodadas);
confere("mesa de 3 rodadas = 1 venda, aberta pela rodada mais antiga (r1), não pela primeira da lista",
  [atMesa.vendas, atMesa.mesas, atMesa.lancamentos, atMesa.lancamentosDeMesa, [...atMesa.abre]], [1, 1, 3, 3, ["r1"]]);
confere("rodada cancelada não abre a venda: a mais antiga das válidas abre",
  [...atendimentosDaVenda([rodada("c1", "2026-09-18T22:00:00.000Z", { status: "CANCELADO" }), ...rodadas]).abre], ["r1"]);
confere("empate no instante: o menor id (a conta não muda de uma consulta para outra)",
  [...atendimentosDaVenda([rodada("b", "2026-09-18T23:00:00.000Z"), rodada("a", "2026-09-18T23:00:00.000Z")]).abre], ["a"]);
const pai = pedido({ id: "pai", source: "IFOOD", ifoodOrderId: "if-p", deliveryType: "DELIVERY", totalAmount: 50, items: [{ quantity: 1, price: 50 }] });
const acrescimo = pedido({ id: "acr", parentOrderId: "pai", source: "IFOOD", ifoodOrderId: "if-a", deliveryType: "DELIVERY", totalAmount: 8, items: [{ quantity: 1, price: 8 }] });
const comAcrescimo = resumoDeVendas([pai, acrescimo]);
confere("acréscimo com o pai no recorte: soma no valor, não é venda nova",
  [atendimentosDaVenda([pai, acrescimo]).vendas, comAcrescimo.totalPedidos, comAcrescimo.atendimentos, comAcrescimo.pedidos], [1, 58, 1, 2]);
// O único acréscimo em produção (20/09/2026, 04h11) caiu num dia operacional
// diferente do pai: sozinho no recorte, é a única presença do cliente ali.
confere("acréscimo com o pai FORA do recorte (outro dia): é venda", [...atendimentosDaVenda([acrescimo]).abre], ["acr"]);
confere("valor impossível e não concluído não abrem venda",
  atendimentosDaVenda([pedido({ id: "x1", totalAmount: 2e6 }), pedido({ id: "x2", status: "AGUARDANDO_PAGAMENTO", totalAmount: 5 }), pedido({ id: "x3", totalAmount: 5 })]).vendas, 1);
confere("desconto no fechamento continua À PARTE: o valor vendido é o lançado (R$ 125,40); só o total com serviço desconta",
  [rMesa.totalPedidos, rMesa.atendimentos, rMesa.ticketMedio, rMesa.totalComServico], [125.4, 1, 125.4, 0]);

console.log("\n18) Os quatro relatórios batem entre si no mesmo recorte");
// A mesma semana nos quatro: valor vendido, vendas e total dos itens iguais,
// centavo a centavo. Era o que divergia em 24/09/2026 (Pastel da Paulista,
// 09–16/09: R$ 34.660,54 × 34.631,14 × 34.535,14; 635 × 495 × 494 "vendas").
// Um pedido com item de R$ 2 milhões e total gravado de R$ 50 fica fora dos
// quatro — até 24/09/2026 a rota do Formas não buscava os itens e o deixava lá.
const itemAbsurdo = pedido({ id: "absurdo", source: "PDV", deliveryType: "RETIRADA", totalAmount: 50, items: [{ quantity: 1, price: 2_000_000 }] });
const RECORTE = [...TODOS, ...rodadas, pai, acrescimo, itemAbsurdo];
// A mesa sX fechou com R$ 5 de desconto e R$ 2,50 de serviço: nada disso mexe no valor vendido.
const mesaSX: MesaFechada = { id: "sX", serviceFee: 2.5, waiterTip: 0, fechadaEm: "2026-09-19T01:00:00.000Z", pago: 27.5, pedidos: rodadas.map((o) => ({ status: o.status, totalAmount: o.totalAmount })) };
const rV = resumoDeVendas(RECORTE, [mesaSX]);
const rF = faturamentoPorDia({ de: "2026-09-18", ate: "2026-09-18", tz: TZ, hoje: "2026-09-25", pedidos: RECORTE, mesas: [mesaSX] });
const rD = vendasPorDiaEHora(RECORTE.map((p) => ({ ...p, itens: quantidadeDeItens(p) })), { tz: TZ, de: "2026-09-18", ate: "2026-09-18" });
const rP = formasDePagamento(RECORTE, [{
  id: "sX", fechadaEm: mesaSX.fechadaEm as string, totalPago: 27.5, taxaDeServico: 2.5, gorjeta: 0, pagamentos: [{ method: "Pix", amount: 27.5 }],
  pedidos: rodadas.map((o) => ({ id: o.id, status: o.status, totalAmount: o.totalAmount })),
}], { de: "2026-09-18", ate: "2026-09-18", tz: TZ });
confere("valor vendido: Vendas = Faturamento = Dia e hora = Formas de pagamento (296,91 + 30 das rodadas + 58 = R$ 384,91)",
  [rV.totalPedidos, rF.total.valor, rD.metricas.valor.total, rP.vendas.valor], [384.91, 384.91, 384.91, 384.91]);
confere("vendas (atendimentos) iguais nos quatro: as 7 de antes + a mesa sX + o pedido com acréscimo = 9",
  [rV.atendimentos, rF.total.vendas, rD.metricas.pedidos.total, rP.vendas.atendimentos], [9, 9, 9, 9]);
confere("lançamentos também (8 + 3 rodadas + pai + acréscimo)", [rV.pedidos, rF.total.lancamentos, rD.lancamentos, rP.vendas.pedidos], [13, 13, 13, 13]);
confere("total dos itens e quantidade: Vendas = Faturamento = Dia e hora",
  [rF.total.itens, rD.metricas.itens.total], [rV.totalItens, rV.quantidadeDeItens]);
confere("ticket médio: Vendas = Faturamento = Formas (valor ÷ vendas)", [rF.total.ticketMedio, rP.vendas.ticketMedio], [rV.ticketMedio, rV.ticketMedio]);
confere("o desconto da mesa sX (R$ 5) fica à parte nos dois e fora da coluna Descontos",
  [rV.servico.descontoNaMesa, rF.mesasFechadas.descontoNaMesa, rF.total.descontoNaMesa, rF.total.descontos], [5, 5, 5, rV.descontos.total]);
const naPonte = (k: string) => rP.diferenca.linhas.find((l) => l.chave === k)?.valor ?? 0;
confere("…e é o mesmo desconto e o mesmo serviço na ponte do Formas de pagamento",
  [-naPonte("DESCONTO_MESA"), naPonte("SERVICO"), rP.mesas.taxaDeServico], [rV.servico.descontoNaMesa, rV.servico.taxa, rV.servico.taxa]);
confere("o pedido com item de R$ 2 milhões fica fora dos quatro e é contado à parte",
  [rV.valoresImpossiveis, rF.valoresImpossiveis, rP.foraDaVenda.valoresImpossiveis], [1, 1, 1]);

console.log("\n19) A comparação com o período anterior corta no mesmo horário, nos dois relatórios que comparam");
// NIK, 24/09/2026 às 14h39: o Vendas comparava o "Hoje" (R$ 0) com o 23/09
// inteiro (R$ 6.475,28, "↓ 100%"); o Faturamento, com o 23/09 até as 14h39.
const agora = Date.parse("2026-09-24T17:39:00.000Z"); // 14h39 em São Paulo
const ontem = { inicio: new Date("2026-09-23T08:00:00.000Z"), fim: new Date("2026-09-24T08:00:00.000Z") };
const cortado = anteriorAteEsteHorario(ontem, { ate: "2026-09-24", hoje: "2026-09-24", recuo: 1, agora });
confere("período Hoje: o anterior (23/09) vai até as 14h39 de ontem", [cortado.ateEsteHorario, cortado.janela.inicio.toISOString(), cortado.janela.fim.toISOString()],
  [true, "2026-09-23T08:00:00.000Z", "2026-09-23T17:39:00.000Z"]);
const semana = anteriorAteEsteHorario({ inicio: new Date("2026-09-11T08:00:00.000Z"), fim: new Date("2026-09-18T08:00:00.000Z") }, { ate: "2026-09-24", hoje: "2026-09-24", recuo: 7, agora });
confere("7 dias (18–24/09): o anterior (11–17/09) vai até as 14h39 do dia 17", semana.janela.fim.toISOString(), "2026-09-17T17:39:00.000Z");
const passado = anteriorAteEsteHorario({ inicio: new Date("2026-09-01T08:00:00.000Z"), fim: new Date("2026-09-09T08:00:00.000Z") }, { ate: "2026-09-16", hoje: "2026-09-24", recuo: 8, agora });
confere("período que já acabou: o anterior é inteiro", [passado.ateEsteHorario, passado.janela.fim.toISOString()], [false, "2026-09-09T08:00:00.000Z"]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
