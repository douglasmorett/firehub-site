/**
 * FORMAS DE PAGAMENTO PRÓPRIAS DA LOJA (lib/formas-proprias.ts) — a Macaíba da
 * Pizzaria 17 (17/10/2026).
 *
 *   npx tsx scripts/teste-formas-proprias.ts
 *
 * Sem banco. Prova:
 *  1. o cadastro (nome, repetido, parêntese, forma do sistema, canais);
 *  2. os canais: o que cada tela oferece e a recusa do servidor;
 *  3. a régua: a marca vem antes de tudo ("Vale Macaíba" não é vale) e o
 *     dividido continua lido pelas partes;
 *  4. o caixa: a forma própria tem linha com o nome, fora da conferência,
 *     NUNCA no Dinheiro — no pedido, no dividido e na baixa da mesa;
 *  5. o relatório Formas de pagamento e o papel do fechamento;
 *  6. a nota fiscal: "99 Outros" com o nome.
 */
import {
  CANAIS_AO_CRIAR, ehFormaPropria, formaPropriaPeloNome, formasNoCanal, lerFormasProprias, nomeDaFormaPropria,
  problemaDaFormaPropria, textoDaFormaPropria, textosNoCanal, validarFormasProprias,
} from "../src/lib/formas-proprias";
import { formaDoTexto, formaDoPedido, formasDePagamento, type PedidoParaFormas } from "../src/lib/relatorios/formas-de-pagamento";
import { formaCanonica, ehPagoOnline } from "../src/lib/pagamento-na-entrega";
import { validarDivisao } from "../src/lib/pagamento-dividido";
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { formaDaNota } from "../src/lib/fiscal-emissao";
import { chaveDaFormaDePagamento } from "../src/lib/fiscal-momento";
import { ehCreditoNaMaquininha } from "../src/lib/acrescimo-no-credito";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const MACAIBA = textoDaFormaPropria("Macaíba");
const loja = {
  PIX: { rate: 0, active: true },
  formasProprias: [
    { id: "fp1", nome: "Macaíba", ativo: true, canais: { pdv: true, mesa: false, site: false, robo: false } },
    { id: "fp2", nome: "Vale da Casa", ativo: true, canais: { pdv: true, mesa: true, site: true, robo: true } },
    { id: "fp3", nome: "Permuta", ativo: false, canais: { pdv: true, mesa: true, site: true, robo: true } },
  ],
};

// ── 1. O cadastro ───────────────────────────────────────────────────────────
console.log("\n— 1. O cadastro —");
confere("ao criar, só o Caixa/PDV vem marcado", CANAIS_AO_CRIAR, { pdv: true, mesa: false, site: false, robo: false });
confere("lista boa passa", validarFormasProprias(loja.formasProprias).ok, true);
confere("sem nome recusa", validarFormasProprias([{ nome: "  " }]).ok, false);
confere("repetido (acento e caixa) recusa", validarFormasProprias([{ nome: "Macaíba" }, { nome: "MACAIBA" }]).ok, false);
confere("parêntese recusa (é a marca)", validarFormasProprias([{ nome: "Macaíba (social)" }]).ok, false);
confere("'Pix' próprio recusa", validarFormasProprias([{ nome: "pix" }]).ok, false);
confere("'Dinheiro' próprio recusa", validarFormasProprias([{ nome: "Dinheiro" }]).ok, false);
confere("canais ausentes = desmarcados", (validarFormasProprias([{ nome: "Macaíba" }]) as any).formas[0].canais, { pdv: false, mesa: false, site: false, robo: false });
confere("nulo = lista vazia", validarFormasProprias(null), { ok: true, formas: [] });
confere("loja sem nada lê []", lerFormasProprias({ PIX: { active: true } }), []);
confere("leitura tolera lixo", lerFormasProprias({ formasProprias: [{ nome: "" }, { nome: "A" }, { nome: "a" }, null] }).map((f) => f.nome), ["A"]);

// ── 2. Os canais ────────────────────────────────────────────────────────────
console.log("\n— 2. Os canais —");
confere("PDV oferece Macaíba e Vale da Casa (Permuta desligada)", textosNoCanal(loja, "pdv"), [MACAIBA, textoDaFormaPropria("Vale da Casa")]);
confere("mesa só o Vale da Casa", formasNoCanal(loja, "mesa").map((f) => f.nome), ["Vale da Casa"]);
confere("site só o Vale da Casa", formasNoCanal(loja, "site").map((f) => f.nome), ["Vale da Casa"]);
confere("PDV aceita Macaíba", problemaDaFormaPropria(loja, [MACAIBA], "pdv"), null);
confere("site RECUSA Macaíba (canal desmarcado)", typeof problemaDaFormaPropria(loja, [MACAIBA], "site"), "string");
confere("a recusa diz o canal", /cardápio do site/.test(String(problemaDaFormaPropria(loja, [MACAIBA], "site"))), true);
// A Pizzaria 17 como vai ser gravada (lojista, 17/10: "o cliente pode colocar também").
const p17 = { formasProprias: [{ id: "fp-macaiba", nome: "Macaíba", ativo: true, canais: { pdv: true, mesa: true, site: true, robo: true } }] };
confere("P17: o cardápio oferece a Macaíba", textosNoCanal(p17, "site"), [MACAIBA]);
confere("P17: o servidor do site ACEITA a Macaíba", problemaDaFormaPropria(p17, [MACAIBA], "site"), null);
confere("P17: a mesa aceita", problemaDaFormaPropria(p17, [MACAIBA], "mesa"), null);
confere("P17: robô 'macaiba' vira o texto marcado", formaPropriaPeloNome(p17, "macaiba", "robo"), MACAIBA);
confere("mesa RECUSA Macaíba", typeof problemaDaFormaPropria(loja, [MACAIBA], "mesa"), "string");
confere("forma desligada recusa em todo canal", /desligada/.test(String(problemaDaFormaPropria(loja, [textoDaFormaPropria("Permuta")], "pdv"))), true);
confere("forma apagada recusa", /não existe mais/.test(String(problemaDaFormaPropria(loja, [textoDaFormaPropria("Bitcoin")], "pdv"))), true);
confere("texto comum não é assunto daqui", problemaDaFormaPropria(loja, ["Dinheiro", "PIX", "DINHEIRO", null, undefined], "site"), null);
confere("dividido: a parte própria do canal errado recusa", typeof problemaDaFormaPropria(loja, ["Dinheiro", MACAIBA], "mesa"), "string");
confere("robô: 'macaiba' não é do robô → null", formaPropriaPeloNome(loja, "macaiba", "robo"), null);
confere("robô: 'vale da casa' vira o texto marcado", formaPropriaPeloNome(loja, "vale da casa", "robo"), textoDaFormaPropria("Vale da Casa"));
confere("PDV: 'MACAIBA' vira o texto marcado", formaPropriaPeloNome(loja, "MACAIBA", "pdv"), MACAIBA);

// ── 3. A régua ──────────────────────────────────────────────────────────────
console.log("\n— 3. A régua —");
confere("texto gravado", MACAIBA, "Macaíba (forma própria)");
confere("é forma própria", ehFormaPropria(MACAIBA), true);
confere("sem acento também", ehFormaPropria("Macaiba (forma propria)"), true);
confere("nome sai sem a marca", nomeDaFormaPropria(MACAIBA), "Macaíba");
confere("resumo do dividido NÃO é forma própria", ehFormaPropria(`Dividido: Dinheiro R$ 10,00 + ${MACAIBA} R$ 5,00`), false);
confere("formaDoTexto → PROPRIA", formaDoTexto(MACAIBA), "PROPRIA");
confere("'Vale Macaíba' não é vale-refeição", formaDoTexto(textoDaFormaPropria("Vale Macaíba")), "PROPRIA");
confere("'Dinheiro social' não é dinheiro", formaDoTexto(textoDaFormaPropria("Dinheiro social")), "PROPRIA");
confere("formaCanonica → null (não é nenhuma das cinco)", formaCanonica(textoDaFormaPropria("Vale Macaíba")), null);
confere("não é pago online", ehPagoOnline({ paymentMethod: MACAIBA }), false);
confere("PDV com Macaíba → PROPRIA", formaDoPedido({ paymentMethod: MACAIBA, source: "PDV" }), "PROPRIA");
confere("site com Macaíba → PROPRIA (não online)", formaDoPedido({ paymentMethod: MACAIBA, source: "ONLINE" }), "PROPRIA");
confere("'Crédito social' não leva acréscimo do crédito", ehCreditoNaMaquininha(textoDaFormaPropria("Crédito social")), false);
const div = validarDivisao([{ method: "Dinheiro", amount: 20 }, { method: "Macaiba (forma propria)", amount: 15 }], 35);
confere("divisão com forma própria passa", div.ok, true);
confere("a parte grava o texto marcado", div.ok ? div.partes.map((p) => p.method) : null, ["Dinheiro", "Macaiba (forma própria)"]);
confere("divisão com forma inventada sem marca recusa", validarDivisao([{ method: "Dinheiro", amount: 20 }, { method: "Macaíba", amount: 15 }], 35).ok, false);

// ── 4. O caixa ──────────────────────────────────────────────────────────────
console.log("\n— 4. O caixa —");
const h = (hhmm: string) => new Date(`2026-10-17T${hhmm}:00-03:00`);
const base = { discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null, openDeliveryChannel: null, discountDetails: null,
  ifoodOrderId: null, ifoodReference: null, openDeliveryOrderId: null, openDeliveryReference: null, paymentMethods: null, paymentPaidAt: null, gatewayProvider: null,
  customerName: "Cliente", employeeName: null, deliveryBy: null, motoboyId: null, motoboyFee: null, deliveryDistance: null, totemLicenseId: null, deliveryFee: 0 };
const item = (price: number, quantity = 1) => ({ price, quantity });
const pedidos: any[] = [
  // Balcão em dinheiro, R$ 30.
  { ...base, id: "p1", dailyOrderNumber: 1, createdAt: h("19:00"), status: "ENTREGUE", source: "PDV", deliveryType: "BALCAO", paymentMethod: "Dinheiro", totalAmount: 30, items: [item(30)] },
  // Balcão inteiro em Macaíba, R$ 40.
  { ...base, id: "p2", dailyOrderNumber: 2, createdAt: h("19:10"), status: "ENTREGUE", source: "PDV", deliveryType: "BALCAO", paymentMethod: MACAIBA, totalAmount: 40, items: [item(40)] },
  // Balcão dividido: R$ 20 em dinheiro + R$ 15 em Macaíba.
  { ...base, id: "p3", dailyOrderNumber: 3, createdAt: h("19:20"), status: "ENTREGUE", source: "PDV", deliveryType: "BALCAO",
    paymentMethod: `Dividido: Dinheiro R$ 20,00 + ${MACAIBA} R$ 15,00`, paymentMethods: [{ method: "Dinheiro", amount: 20 }, { method: MACAIBA, amount: 15 }], totalAmount: 35, items: [item(35)] },
  // Pedido de mesa (a forma está na conta).
  { ...base, id: "p4", dailyOrderNumber: 4, createdAt: h("19:30"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "mesa-1", paymentMethod: "N/A", totalAmount: 50, items: [item(50)] },
];
// Mesa: R$ 50 de consumo, R$ 25 em Vale da Casa + R$ 30 em dinheiro (R$ 5 de troco).
const VALE_DA_CASA = textoDaFormaPropria("Vale da Casa");
const mesas: any[] = [
  { id: "mesa-1", closedAt: h("20:00"), serviceFee: 0, waiterTip: 0, totalPaid: 55, paymentMethods: [{ method: VALE_DA_CASA, amount: 25 }, { method: "Dinheiro", amount: 30 }],
    orders: [{ id: "p4", status: "ENTREGUE", totalAmount: 50, discountTotal: 0 }] },
];
const a = apurarVendasDoTurno(pedidos, mesas);
confere("Dinheiro esperado = 30 + 20 + (30 − 5 de troco) = 75 (sem a Macaíba)", a.expected.cash, 75);
confere("nenhuma outra linha da conferência ganhou a forma própria", [a.expected.pix, a.expected.debit, a.expected.credit, a.expected.voucher], [0, 0, 0, 0]);
confere("total da conferência = só as formas da gaveta", a.expected.total, 75);
confere("forma própria em linha com o nome, fora da conferência", a.foraDaConferencia.proprias, [
  { nome: "Macaíba", valor: 55, qtd: 2 },
  { nome: "Vale da Casa", valor: 25, qtd: 1 },
]);
confere("não virou 'não identificada'", a.foraDaConferencia.naoIdentificado, 0);
const porForma = new Map(a.retrato.porForma.map((f) => [f.nome, f.valor]));
confere("papel: recebido por forma tem 'Macaíba'", porForma.get("Macaíba"), 55);
confere("papel: recebido por forma tem 'Vale da Casa'", porForma.get("Vale da Casa"), 25);
confere("papel: Dinheiro do recebido = 75", porForma.get("Dinheiro"), 75);
confere("recebido total = 75 + 55 + 25 = 155", a.retrato.recebido.valor, 155);

// ── 5. O relatório e o papel ────────────────────────────────────────────────
console.log("\n— 5. O relatório Formas de pagamento —");
const r = formasDePagamento(pedidos as PedidoParaFormas[], [
  { id: "mesa-1", fechadaEm: h("20:00"), totalPago: 55, taxaDeServico: 0, gorjeta: 0, pagamentos: mesas[0].paymentMethods, pedidos: [{ id: "p4", totalAmount: 50, status: "ENTREGUE", discountTotal: 0 }] },
], { de: "2026-10-17", ate: "2026-10-17", tz: "America/Sao_Paulo" });
const linhaPropria = r.formas.find((f) => f.chave === "PROPRIA")!;
confere("linha PROPRIA com o valor das duas", linhaPropria.valor, 80);
confere("rótulo com os nomes", linhaPropria.rotulo, "Macaíba / Vale da Casa");
confere("grupo: fora do 'recebido na loja'", linhaPropria.grupo, "SEM_DINHEIRO");
confere("Dinheiro do relatório = o do caixa", r.formas.find((f) => f.chave === "DINHEIRO")!.valor, 75);

console.log("\n— O papel do fechamento —");
const { cupomDeFechamentoDeCaixa } = require("../src/lib/cupom-do-caixa");
const cupom = cupomDeFechamentoDeCaixa({
  sessionId: "s1", loja: "Pizzaria 17", fuso: "America/Sao_Paulo", operador: "Antonio",
  abertoEm: h("18:00"), fechadoEm: h("23:00"), trocoInicial: 0,
  valores: {
    esperado: { ...a.expected }, contado: { cash: 75, debit: null, credit: null, pix: null, voucher: null }, diferenca: 0, semConferencia: false,
    online: { ifood: 0, food99: 0 }, onlineEsperado: 0, foraDaConferencia: a.foraDaConferencia,
  },
});
const textoDoPapel = JSON.stringify(cupom);
confere("o papel tem a linha 'Macaíba (2)'", textoDoPapel.includes("Macaíba (2)"), true);
confere("o papel diz que é fora da gaveta", /fora da gaveta/.test(textoDoPapel), true);

// ── 6. A nota fiscal ────────────────────────────────────────────────────────
console.log("\n— 6. A nota fiscal —");
confere("NFC-e: forma própria = 99 Outros com o nome", formaDaNota(MACAIBA), { codigo: "99", descricao: "Macaíba" });
confere("NFC-e: 'Vale Macaíba' não vira vale-refeição (11)", formaDaNota(textoDaFormaPropria("Vale Macaíba"))?.codigo, "99");
confere("emissão automática: não é nenhuma das 5 chaves", chaveDaFormaDePagamento(textoDaFormaPropria("Vale Macaíba")), null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
