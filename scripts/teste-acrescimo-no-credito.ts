/**
 * Acréscimo no crédito (lib/acrescimo-no-credito.ts): a loja repassa um % a
 * quem paga no crédito da maquininha (Pizzou153, Maxuel, 14/10/2026).
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-acrescimo-no-credito.ts
 *
 * Sem banco. Prova a régua (qual texto é crédito, o %, a conta e o
 * arredondamento), a etiqueta que o servidor grava e lê de volta, e os quatro
 * lugares que leem o valor: a comanda (serviceFee do Assistente), a conta da
 * tela (contaDoPedido), a edição de itens (recalcularTotal) e a NFC-e (vOutro,
 * com a conferência "total da nota = o que o cliente pagou").
 */
import {
  acrescimoNoCredito,
  acrescimoGravadoNoPedido,
  camposDoAcrescimoParaImpressao,
  ehCreditoNaMaquininha,
  etiquetaDoAcrescimo,
  percentualDoAcrescimoNoCredito,
  valorDoAcrescimoGravado,
} from "../src/lib/acrescimo-no-credito";
import { contaDoPedido } from "../src/lib/conta-do-pedido";
import { contaDoDescontoDaEdicao, recalcularTotal } from "../src/lib/edicao-de-pedido";
import { montarCorpoDaNfce, valoresDaNota, type ConfiguracaoFiscal, type ItemDaNota, type PedidoParaNota } from "../src/lib/fiscal-emissao";
import { pedidoParaNota } from "../src/lib/fiscal-itens";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const LOJA = { CREDITO: { rate: 3, active: true, acrescimo: 3.86 } };

// ── 1. A config ──────────────────────────────────────────────────────────────
console.log("\n— percentual da loja");
confere("3,86 gravado", percentualDoAcrescimoNoCredito(LOJA), 3.86);
confere("sem paymentFees = 0 (todas as lojas hoje)", percentualDoAcrescimoNoCredito(null), 0);
confere("CREDITO sem acrescimo = 0", percentualDoAcrescimoNoCredito({ CREDITO: { rate: 3 } }), 0);
confere("negativo = 0", percentualDoAcrescimoNoCredito({ CREDITO: { acrescimo: -2 } }), 0);
confere("texto com vírgula", percentualDoAcrescimoNoCredito({ CREDITO: { acrescimo: "4,5" } }), 4.5);
confere("lixo = 0", percentualDoAcrescimoNoCredito({ CREDITO: { acrescimo: "abc" } }), 0);
confere("acima do teto vira 20", percentualDoAcrescimoNoCredito({ CREDITO: { acrescimo: 38.6 } }), 20);
confere("a taxa da maquininha (rate) NÃO é o acréscimo", percentualDoAcrescimoNoCredito({ CREDITO: { rate: 4.99 } }), 0);

// ── 2. Qual texto é crédito na maquininha ────────────────────────────────────
console.log("\n— forma de pagamento");
const credito = ["CREDITO", "Cartão de Crédito", "Crédito (Entrega)", "credito na entrega", "Cartão Crédito", "CREDIT_CARD", "crédito"];
const naoCredito = [
  "CREDITO_ONLINE", "Cartão de Crédito (Online)", "Cartão pelo site", "DEBITO", "Cartão de Débito", "Crédito + Débito",
  "DINHEIRO", "PIX", "PIX_ENTREGA", "VOUCHER_VR", "Vale-refeição", "", null, "CARTAO_ONLINE", "Fiado",
];
for (const t of credito) confere(`"${t}" é crédito`, ehCreditoNaMaquininha(t), true);
for (const t of naoCredito) confere(`"${t}" não é`, ehCreditoNaMaquininha(t), false);

// ── 3. A conta ───────────────────────────────────────────────────────────────
console.log("\n— a conta");
// Pizza 74,90 + entrega 5,10 = 80,00 → 3,86% = 3,088 → R$ 3,09.
const a = acrescimoNoCredito({ paymentFees: LOJA, paymentMethod: "CREDITO", base: 80 });
confere("80,00 no crédito a 3,86% = R$ 3,09", a, { percentual: 3.86, valor: 3.09, rotulo: "Acréscimo no crédito (3,86%)" });
confere("meio centavo sobe (100 × 2,345% = 2,345)", acrescimoNoCredito({ paymentFees: { CREDITO: { acrescimo: 2.345 } }, paymentMethod: "CREDITO", base: 100 })?.valor, 2.35);
confere("débito não leva", acrescimoNoCredito({ paymentFees: LOJA, paymentMethod: "DEBITO", base: 80 }), null);
confere("cartão pelo site não leva", acrescimoNoCredito({ paymentFees: LOJA, paymentMethod: "CREDITO_ONLINE", base: 80 }), null);
confere("loja sem % não leva", acrescimoNoCredito({ paymentFees: {}, paymentMethod: "CREDITO", base: 80 }), null);
confere("base zero não leva", acrescimoNoCredito({ paymentFees: LOJA, paymentMethod: "CREDITO", base: 0 }), null);
confere("base negativa não leva", acrescimoNoCredito({ paymentFees: LOJA, paymentMethod: "CREDITO", base: -10 }), null);
confere("% inteiro sai sem vírgula no rótulo", acrescimoNoCredito({ paymentFees: { CREDITO: { acrescimo: 5 } }, paymentMethod: "CREDITO", base: 50 })?.rotulo, "Acréscimo no crédito (5%)");

// ── 4. A etiqueta: grava e lê de volta ───────────────────────────────────────
console.log("\n— etiqueta nas observações");
const etiqueta = etiquetaDoAcrescimo(a!);
confere("etiqueta", etiqueta, "[Acréscimo no crédito (3,86%): +R$ 3,09]");
const notas = `${etiqueta} [Cupom: PIZZA10] sem cebola`;
confere("lê de volta do meio das notas", acrescimoGravadoNoPedido({ notes: notas }), a);
confere("valor", valorDoAcrescimoGravado({ notes: notas }), 3.09);
confere("pedido sem etiqueta = 0", valorDoAcrescimoGravado({ notes: "[Cupom: X] sem cebola" }), 0);
confere("notes nulo = 0", valorDoAcrescimoGravado({ notes: null }), 0);
confere("valor acima de mil (1.234,56)", valorDoAcrescimoGravado({ notes: "[Acréscimo no crédito (5%): +R$ 1.234,56]" }), 1234.56);
confere("lê sem acento (texto colado de outro lugar)", valorDoAcrescimoGravado({ notes: "[Acrescimo no credito (3,86%): +R$ 3,09]" }), 3.09);

// ── 5. Comanda: campos do Assistente ─────────────────────────────────────────
console.log("\n— comanda");
confere("serviceFee + rótulo ASCII", camposDoAcrescimoParaImpressao({ notes: notas }), {
  serviceFee: 3.09,
  serviceFeeLabel: "Acrescimo no credito (3,86%):",
});
confere("pedido sem acréscimo não manda nada", camposDoAcrescimoParaImpressao({ notes: "sem cebola" }), {});

// A conta que o Assistente faz no bloco de totais (server.js): o desconto que
// fecha = subtotal + entrega + serviceFee − total. Com o acréscimo, dá zero.
const PEDIDO = {
  items: [{ price: 74.9, quantity: 1 }],
  deliveryFee: 5.1,
  totalAmount: 83.09,
  discountTotal: 0,
  notes: notas,
};
const campos = camposDoAcrescimoParaImpressao(PEDIDO) as { serviceFee: number };
confere("Assistente: subtotal + entrega + acréscimo − total = 0 (sem \"Outros valores\")",
  Math.round((74.9 + 5.1 + campos.serviceFee - PEDIDO.totalAmount) * 100) / 100, 0);

// ── 6. Conta da tela (contaDoPedido) ─────────────────────────────────────────
console.log("\n— conta da tela");
const conta = contaDoPedido(PEDIDO);
confere("linha própria, sem 'Outros valores'", conta.ajustes, [{ rotulo: "Acréscimo no crédito (3,86%)", valor: 3.09 }]);
const comCupom = contaDoPedido({ ...PEDIDO, discountTotal: 7.49, discountMerchant: 7.49, totalAmount: 75.6 });
confere("com cupom: desconto e acréscimo lado a lado", comCupom.ajustes, [
  { rotulo: "Desconto (cupom da loja)", valor: -7.49 },
  { rotulo: "Acréscimo no crédito (3,86%)", valor: 3.09 },
]);
confere("pedido sem etiqueta continua igual", contaDoPedido({ ...PEDIDO, notes: null, totalAmount: 80 }).ajustes, []);

// ── 7. Edição de itens: o acréscimo fica de pé em reais ──────────────────────
console.log("\n— edição de itens");
confere("tirar a Coca (12,00): total cai só a Coca",
  recalcularTotal({ itens: [{ price: 74.9, quantity: 1 }], deliveryFee: 5.1, discountTotal: 0, acrescimo: 3.09 }), 83.09);
confere("sem acréscimo, a conta de sempre",
  recalcularTotal({ itens: [{ price: 74.9, quantity: 1 }], deliveryFee: 5.1, discountTotal: 0 }), 80);
confere("desconto na edição mantém o acréscimo",
  contaDoDescontoDaEdicao({ itens: [{ price: 74.9, quantity: 1 }], deliveryFee: 5.1, discountTotal: 0, acrescimo: 3.09, desconto: { tipo: "valor", valor: 4.9, motivo: "atraso" } as any }).total,
  78.19);

// ── 8. NFC-e: o acréscimo vai em vOutro, nunca como produto ──────────────────
console.log("\n— NFC-e");
const item = (descricao: string, valorUnitario: number, quantidade = 1): ItemDaNota => ({
  codigo: descricao.toLowerCase().replace(/\W+/g, "-"),
  descricao,
  ncm: "21069090",
  cfop: "5102",
  unidadeComercial: "UN",
  quantidade,
  valorUnitario,
  valorTotal: Number((valorUnitario * quantidade).toFixed(2)),
  origem: 0,
  csosn: "102",
});
const CONFIG: ConfiguracaoFiscal = {
  provedor: "focusnfe",
  tokenDoProvedor: "token-de-teste",
  cnpj: "11.222.333/0001-81",
  inscricaoEstadual: "12.345.678",
  razaoSocial: "PIZZOU LTDA",
  nomeFantasia: "Pizzou",
  regimeTributario: 1,
  logradouro: "Rua Teste",
  numero: "100",
  bairro: "Centro",
  municipio: "Rio das Ostras",
  codigoMunicipio: "3304524",
  uf: "RJ",
  cep: "28890-000",
  serie: 1,
  ambiente: 2,
  cscId: "1",
  csc: "abc",
  temCertificado: true,
};
const nota: PedidoParaNota = {
  id: "p1",
  numero: 7,
  itens: [item("Pizza Calabresa G", 74.9)],
  valorTotal: 83.09,
  taxaEntrega: 5.1,
  acrescimo: 3.09,
  formaDePagamento: "CREDITO",
  canal: "SITE" as any,
};
const v = valoresDaNota(nota);
confere("produtos ficam 74,90 (acréscimo não é produto)", v.produtos, 7490);
confere("vOutro = entrega + acréscimo", v.outrasDespesas, 510 + 309);
confere("vNF = o que o cliente pagou", v.total, 8309);
const m = montarCorpoDaNfce(nota, CONFIG, new Date("2026-10-15T15:00:00Z"));
confere("a nota monta (sem a pendência 'total diferente do cobrado')", m.ok, true);
if (m.ok) {
  const itens = m.corpo.items as any[];
  confere("um item só na nota", itens.length, 1);
  confere("valor_outras_despesas do corpo", m.corpo.valor_outras_despesas, 8.19);
  confere("valor_total do corpo", m.corpo.valor_total, 83.09);
} else {
  console.log("   pendências:", JSON.stringify(m.pendencias));
}
const semAcrescimoNaNota = montarCorpoDaNfce({ ...nota, acrescimo: undefined }, CONFIG, new Date("2026-10-15T15:00:00Z"));
confere("sem o acréscimo na nota, o total não fecharia (prova de que a linha importa)", semAcrescimoNaNota.ok, false);
// O pedido como vem do banco: a etiqueta nas observações chega à nota.
const doBanco = pedidoParaNota({
  id: "p1",
  dailyOrderNumber: 7,
  items: [{ productName: "Pizza Calabresa G", price: 74.9, quantity: 1 } as any],
  totalAmount: 83.09,
  deliveryFee: 5.1,
  discountTotal: 0,
  paymentMethod: "CREDITO",
  deliveryType: "PICKUP",
  source: "SITE",
  notes: notas,
} as any);
confere("pedidoParaNota lê o acréscimo da etiqueta", doBanco.acrescimo, 3.09);

console.log(`\n${falhas === 0 ? "✅ tudo certo" : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
