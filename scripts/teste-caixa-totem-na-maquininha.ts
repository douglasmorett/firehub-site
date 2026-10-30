/**
 * O PEDIDO DO TOTEM PAGO NA MAQUININHA DA LOJA É CRÉDITO/DÉBITO/PIX, NÃO "PAGO ONLINE".
 *
 *   npx tsx scripts/teste-caixa-totem-na-maquininha.ts
 *
 * O app do FireHub na maquininha (POST /api/pos/terminal/resultado) grava no
 * pedido gatewayProvider = provider do terminal ("CIELO_APP", "PAGBANK_APP"),
 * gatewayPaymentId = autorização, paymentPaidAt e "Cartão CREDITO (maquininha)".
 * A Stone pela nuvem grava "STONE_CONNECT" e "Cartão Crédito (maquininha)" /
 * "Pix (maquininha)"; o Mercado Pago Point, "MERCADOPAGO_POINT" e "Cartão
 * (Maquininha)". Esse dinheiro cai na adquirente DA LOJA: no caixa, no Início,
 * no relatório Formas de pagamento e no financeiro ele é a forma do cartão.
 * O Pix do site (Asaas) e o pago no iFood/99 continuam "pago online".
 *
 * Sem banco: os pedidos são fictícios e passam pelas funções reais de cada tela.
 */
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { formaDoPedido, formasDePagamento, type PedidoParaFormas } from "../src/lib/relatorios/formas-de-pagamento";
import { formaDoPedidoNaLista, formasDoInicio, type PedidoDoInicio } from "../src/lib/numeros-do-inicio";
import { entraNaVenda, situacaoDoPedido } from "../src/lib/relatorios/regua-da-venda";
import { partesDaEntrega } from "../src/lib/resumo-do-entregador";
import { somarConferidoNaMaquininha } from "../src/lib/cobranca-da-entrega-na-maquininha";
import { ehPagoOnline, pagoNaMaquininha } from "../src/lib/pagamento-na-entrega";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok    " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

const h = (hhmm: string) => `2026-10-30T${hhmm}:00-03:00`;
let seq = 0;
const ped = (nome: string, hora: string, p: Record<string, unknown>) => ({
  nome,
  id: `p${++seq}`, createdAt: h(hora), status: "ENTREGUE", deliveryType: "TAKEOUT", source: "TOTEM", paymentMethod: "Dinheiro",
  totalAmount: 10, deliveryFee: 0, discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null,
  paymentMethods: null, paymentPaidAt: null, gatewayProvider: null, gatewayPaymentId: null, posDadosTransacao: null,
  openDeliveryChannel: null, ifoodOrderId: null, customerName: "Cliente", customerPhone: "", items: [{ price: Number(p.totalAmount ?? 10), quantity: 1 }], ...p,
});
const dados = (provedor: string, tipo: string | null, bandeira = "VISA") =>
  ({ terminal: "Caixa 1", terminalId: "t1", provedor, bandeira, nsu: "123", autorizacao: "A1B2C3", parcelas: 1, tipo, referencia: null, idsDaAdquirente: null, em: h("19:00") });

const pedidos: any[] = [
  // App do FireHub na maquininha (terminal/resultado): os três textos possíveis.
  ped("Totem Cielo app — crédito", "19:00", { paymentMethod: "Cartão CREDITO (maquininha)", gatewayProvider: "CIELO_APP", gatewayPaymentId: "A1B2C3", paymentPaidAt: h("19:01"), posDadosTransacao: dados("CIELO_APP", "CREDITO"), totalAmount: 41.9 }),
  ped("Totem PagBank app — débito", "19:05", { paymentMethod: "Cartão DEBITO (maquininha)", gatewayProvider: "PAGBANK_APP", gatewayPaymentId: "778899", paymentPaidAt: h("19:06"), posDadosTransacao: dados("PAGBANK_APP", "DEBITO", "MASTERCARD"), totalAmount: 29.9 }),
  ped("Totem app sem o tipo", "19:10", { paymentMethod: "Cartão (maquininha)", gatewayProvider: "GETNET_APP", gatewayPaymentId: "445566", paymentPaidAt: h("19:11"), posDadosTransacao: dados("GETNET_APP", null), totalAmount: 19.9 }),
  // Stone pela nuvem (lib/cobranca-stone-do-totem.ts).
  ped("Totem Stone nuvem — crédito", "19:15", { paymentMethod: "Cartão Crédito (maquininha)", gatewayProvider: "STONE_CONNECT", gatewayPaymentId: "or_abc", paymentPaidAt: h("19:16"), totalAmount: 54.9 }),
  ped("Totem Stone nuvem — Pix", "19:20", { paymentMethod: "Pix (maquininha)", gatewayProvider: "STONE_CONNECT", gatewayPaymentId: "or_def", paymentPaidAt: h("19:21"), totalAmount: 24.9 }),
  // Mercado Pago Point (api/totem/payment/start).
  ped("Totem Mercado Pago Point", "19:25", { paymentMethod: "Cartão (Maquininha)", gatewayProvider: "MERCADOPAGO_POINT", gatewayPaymentId: "mp_123", paymentPaidAt: h("19:26"), totalAmount: 34.9 }),
  // Controles: continuam pago online.
  ped("Site — Pix Asaas pago", "19:30", { source: "ONLINE", deliveryType: "DELIVERY", paymentMethod: "PIX", gatewayProvider: "asaas", gatewayPaymentId: "pay_1", paymentPaidAt: h("19:31"), totalAmount: 33 }),
  ped("iFood — pago no app", "19:35", { source: "IFOOD", deliveryType: "DELIVERY", ifoodOrderId: "if-1", deliveryBy: "IFOOD", paymentMethod: "Crédito (Pago Online)", totalAmount: 70 }),
  ped("99Food — pago no app", "19:40", { source: "99FOOD", deliveryType: "DELIVERY", openDeliveryChannel: "99FOOD", deliveryBy: "99FOOD", paymentMethod: "Pago Online (99Food)", totalAmount: 30 }),
];

const ESPERADO: Record<string, string> = {
  "Totem Cielo app — crédito": "CREDITO",
  "Totem PagBank app — débito": "DEBITO",
  "Totem app sem o tipo": "CREDITO",
  "Totem Stone nuvem — crédito": "CREDITO",
  "Totem Stone nuvem — Pix": "PIX",
  "Totem Mercado Pago Point": "CREDITO",
  "Site — Pix Asaas pago": "ONLINE",
  "iFood — pago no app": "ONLINE",
  "99Food — pago no app": "ONLINE",
};

// ── Pedido a pedido, em cada régua ─────────────────────────────────────────
console.log("\n— Cada pedido, em cada tela —");
console.log("pedido | régua da venda | caixa (retrato) | Início (lista) | relatório/financeiro (partesDaEntrega) | ehPagoOnline | pagoNaMaquininha");
for (const p of pedidos) {
  const so = apurarVendasDoTurno([p], []);
  const noRetrato = so.retrato.porForma.map((f) => f.nome).join(" + ");
  const naLista = formaDoPedidoNaLista(p as PedidoDoInicio);
  const partes = partesDaEntrega(p).map((x) => x.caixa).join(" + ");
  console.log(`  ${p.nome} | ${situacaoDoPedido(p.status)}${entraNaVenda(p) ? "" : " (fora)"} | ${noRetrato} | ${naLista} | ${partes} | ${ehPagoOnline(p)} | ${pagoNaMaquininha(p)}`);
  confere(`${p.nome}: formaDoPedido = ${ESPERADO[p.nome]}`, formaDoPedido(p), ESPERADO[p.nome]);
  confere(`${p.nome}: financeiro (partesDaEntrega) = ${ESPERADO[p.nome]}`, partes, ESPERADO[p.nome]);
}

// ── O turno inteiro ────────────────────────────────────────────────────────
const caixa = apurarVendasDoTurno(pedidos, []);
const e = caixa.expected;
console.log("\n— Fechamento do caixa (apurarVendasDoTurno) —");
console.log("  esperado:", JSON.stringify({ credito: r2(e.credit), debito: r2(e.debit), pix: r2(e.pix), dinheiro: r2(e.cash), ifoodOnline: r2(e.ifoodOnline), food99Online: r2(e.food99Online), onlineProprio: r2(caixa.onlineProprio) }));
confere("Crédito = 41,90 (Cielo) + 19,90 (sem tipo) + 54,90 (Stone) + 34,90 (Point)", r2(e.credit), 151.6);
confere("Débito = 29,90 (PagBank)", r2(e.debit), 29.9);
confere("Pix = 24,90 (Stone Pix)", r2(e.pix), 24.9);
confere("Dinheiro = 0", r2(e.cash), 0);
confere("iFood + site online = 70 + 33 (nenhum totem)", r2(e.ifoodOnline), 103);
confere("99Food online = 30", r2(e.food99Online), 30);
confere("online próprio = só o site (33)", r2(caixa.onlineProprio), 33);

console.log("\n— Números do Início (formasDoInicio) —");
const inicio = formasDoInicio(pedidos as PedidoDoInicio[]);
console.log("  " + inicio.map((l) => `${l.chave} ${l.valor} (${l.contas})`).join(" · "));
const doInicio = (k: string) => inicio.find((l) => l.chave === k)?.valor ?? 0;
confere("Início: Crédito 151,60", doInicio("CREDITO"), 151.6);
confere("Início: Débito 29,90", doInicio("DEBITO"), 29.9);
confere("Início: Pix 24,90", doInicio("PIX"), 24.9);
confere("Início: Pago online = 33 + 70 + 30", doInicio("ONLINE"), 133);

console.log("\n— Relatório Formas de pagamento (formasDePagamento) —");
const rel = formasDePagamento(pedidos as PedidoParaFormas[], [], { de: "2026-10-30", ate: "2026-10-30", tz: "America/Sao_Paulo" });
const doRel = (k: string) => rel.formas.find((f) => f.chave === k)?.valor ?? 0;
console.log("  " + rel.formas.filter((f) => f.valor > 0).map((f) => `${f.chave} ${f.valor}`).join(" · "));
confere("Relatório: Crédito 151,60", doRel("CREDITO"), 151.6);
confere("Relatório: Débito 29,90", doRel("DEBITO"), 29.9);
confere("Relatório: Pix 24,90", doRel("PIX"), 24.9);
confere("Relatório: Pago online 133", doRel("ONLINE"), 133);

console.log("\n— \"✓ conferido na maquininha\" do caixa (somarConferidoNaMaquininha) —");
const conf = somarConferidoNaMaquininha(pedidos);
console.log("  " + JSON.stringify(conf));
confere("conferido no crédito: 4 passadas, 151,60", conf.credit, { valor: 151.6, qtd: 4 });
confere("conferido no débito: 1 passada, 29,90", conf.debit, { valor: 29.9, qtd: 1 });
confere("conferido no Pix: 1 passada, 24,90 (o Pix do site não entra)", conf.pix, { valor: 24.9, qtd: 1 });
// O do motoboy continua igual: as passadas dele.
const doMotoboy = { posDadosTransacao: { maquininha: { passadas: [{ forma: "Cartão Débito", valor: 12.5 }] } }, source: "ONLINE", paymentMethod: "Cartão Débito" };
confere("motoboy: a passada dele continua no débito", somarConferidoNaMaquininha([doMotoboy]).debit, { valor: 12.5, qtd: 1 });

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
