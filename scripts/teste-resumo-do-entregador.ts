/**
 * Teste do resumo do entregador (lib/resumo-do-entregador.ts) — a soma que o
 * relatório faz no servidor e que a tela refaz quando o lojista filtra o
 * cartão do motoboy por integração. Rodar: npx tsx scripts/teste-resumo-do-entregador.ts
 */
import { resumoDasEntregas, partesDaEntrega, type EntregaDoResumo } from "../src/lib/resumo-do-entregador";
import { chaveDoCanal } from "../src/lib/canal-do-pedido";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const tz = "America/Sao_Paulo";
type Pedido = EntregaDoResumo & { source?: string; openDeliveryChannel?: string };
const pedidos: Pedido[] = [
  // iFood pago no app: nada a prestar contas, corrida conta
  { source: "IFOOD", status: "FINALIZADO", createdAt: "2026-10-01T22:00:00Z", deliveryDistance: 2.5, totalAmount: 58.9, paymentMethod: "Pago Online", ganho: 6 },
  // 99Food em dinheiro com troco para 50
  { source: "99FOOD", status: "FINALIZADO", createdAt: "2026-10-01T23:10:00Z", deliveryDistance: 3, totalAmount: 41.5, paymentMethod: "Dinheiro", changeAmount: 50, ganho: 7 },
  // Site próprio, débito na maquininha
  { source: "SITE", status: "FINALIZADO", createdAt: "2026-10-02T00:30:00Z", deliveryDistance: 1.2, totalAmount: 35, paymentMethod: "Cartão de Débito", ganho: 5 },
  // Balcão, troco escrito na observação — madrugada (01h40 de 02/10 em Brasília
  // = mesmo expediente de 01/10, que vira às 5h)
  { source: "PRESENCIAL", status: "FINALIZADO", createdAt: "2026-10-02T04:40:00Z", deliveryDistance: 4, totalAmount: 30, paymentMethod: "Dinheiro", notes: "Troco p/ R$ 100,00", ganho: 8 },
  // iFood cancelado com o motoboy: corrida conta, dinheiro não
  { source: "IFOOD", status: "CANCELADO", createdAt: "2026-10-02T20:00:00Z", deliveryDistance: 2, totalAmount: 20, paymentMethod: "Dinheiro", ganho: 6 },
];

confere("canais", pedidos.map((p) => chaveDoCanal(p as any)), ["IFOOD", "99FOOD", "SITE", "PDV", "IFOOD"]);

const tudo = resumoDasEntregas(pedidos, tz);
confere("tudo: entregas", tudo.totalDeliveries, 5);
confere("tudo: dias (expediente das 5h)", tudo.uniqueDays, 2);
confere("tudo: dinheiro a entregar", tudo.cashCollectedSum, 150);
confere("tudo: troco levado", tudo.changeGivenSum, 78.5);
confere("tudo: débito", [tudo.debitTotal, tudo.debitCount], [35, 1]);
confere("tudo: pago online", [tudo.onlineTotal, tudo.onlineCount], [58.9, 1]);
confere("tudo: ganho (cancelado conta)", tudo.feeTotal, 32);
confere("tudo: 4 entregues + 1 cancelada", [tudo.entreguesCount, tudo.canceladasCount, tudo.canceladasValor], [4, 1, 20]);
// Valor dos pedidos: todas as formas (online, dinheiro, débito), sem o troco e sem o cancelado.
confere("tudo: valor dos pedidos", tudo.valorDosPedidos, 165.4);

const so = (canal: string) => resumoDasEntregas(pedidos.filter((p) => chaveDoCanal(p as any) === canal), tz);
const ifood = so("IFOOD"), noventaENove = so("99FOOD"), site = so("SITE"), balcao = so("PDV");
confere("só iFood: 2 entregas, 1 online, sem dinheiro", [ifood.totalDeliveries, ifood.onlineCount, ifood.cashCollectedSum, ifood.feeTotal], [2, 1, 0, 12]);
confere("só 99: dinheiro 50 com troco 8,50", [noventaENove.cashCollectedSum, noventaENove.changeGivenSum], [50, 8.5]);
confere("só balcão: troco da observação", [balcao.cashCollectedSum, balcao.changeGivenSum], [100, 70]);

// As partes somam o todo: filtrar não pode criar nem sumir dinheiro.
const partes = [ifood, noventaENove, site, balcao];
const soma = (campo: keyof typeof tudo) => Math.round(partes.reduce((s, p) => s + (p[campo] as number), 0) * 100) / 100;
for (const campo of ["totalDeliveries", "cashCollectedSum", "changeGivenSum", "debitTotal", "onlineTotal", "feeTotal", "totalDistance", "valorDosPedidos", "canceladasCount"] as const) {
  confere(`partes = todo: ${campo}`, soma(campo), Math.round((tudo[campo] as number) * 100) / 100);
}

// ── A CAIXA DE CADA ENTREGA É A DO FECHAMENTO DE CAIXA ───────────────────────
// Delícia de Casa (10/10/2026): o "Pago Online" do acerto não batia com a soma
// das notas pagas online. A leitura antiga mandava o pago no app com "Cartão",
// "Débito" ou "Vale" no nome para a maquininha, e o Pix da porta, o "A
// combinar" e o pedido sem forma para o Pago Online.
const caixa = (p: Partial<EntregaDoResumo>) => partesDaEntrega({ totalAmount: 10, ...p }).map((x) => x.caixa).join("+");
const casos: [string, Partial<EntregaDoResumo>, string][] = [
  ["iFood cartão pago no app", { source: "IFOOD", paymentMethod: "Cartão (Pago Online)" }, "ONLINE"],
  ["iFood débito pago no app", { source: "IFOOD", paymentMethod: "Débito (Pago Online)" }, "ONLINE"],
  ["iFood vale pago no app", { source: "IFOOD", paymentMethod: "Vale Refeição (Pago Online)" }, "ONLINE"],
  ["iFood crédito sem acento pago no app", { source: "IFOOD", paymentMethod: "Credito (Pago Online)" }, "ONLINE"],
  ["iFood Pix pago no app (código cru)", { source: "IFOOD", paymentMethod: "PIX" }, "ONLINE"],
  ["99 pago online", { source: "99FOOD", paymentMethod: "Pago Online (99Food)" }, "ONLINE"],
  ["site: Pix pago pelo cardápio (Asaas)", { source: "ONLINE", paymentMethod: "PIX", gatewayProvider: "asaas", paymentPaidAt: "2026-10-09T22:00:00Z" }, "ONLINE"],
  ["iFood trocado para Pix na porta", { source: "IFOOD", paymentMethod: "Pix" }, "PIX"],
  ["site: Pix na entrega", { source: "ONLINE", paymentMethod: "PIX_ENTREGA" }, "PIX"],
  ["A combinar", { source: "ONLINE", paymentMethod: "A combinar (Cobrar na Entrega)" }, "OUTROS"],
  ["sem forma gravada", { source: "ONLINE", paymentMethod: null }, "OUTROS"],
  ["iFood dinheiro na porta", { source: "IFOOD", paymentMethod: "Dinheiro (Cobrar na Entrega)" }, "DINHEIRO"],
  ["iFood crédito na porta", { source: "IFOOD", paymentMethod: "Crédito (Cobrar na Entrega)" }, "CREDITO"],
  ["Wabiz débito abreviado", { source: "WABIZ", paymentMethod: "Cartão Deb Master (Cobrar na Entrega)" }, "DEBITO"],
  ["troca para Vale-refeição", { source: "IFOOD", paymentMethod: "Vale-refeição" }, "VALE"],
  ["fiado", { source: "ONLINE", paymentMethod: "Fiado" }, "FIADO"],
  ["dividido: dinheiro + Pix", { source: "IFOOD", paymentMethod: "Dinheiro + Pix", paymentMethods: [{ method: "Dinheiro", amount: 6 }, { method: "Pix", amount: 4 }] }, "DINHEIRO+PIX"],
];
for (const [nome, p, esperado] of casos) confere(`caixa: ${nome}`, caixa(p), esperado);

const turno: Pedido[] = [
  { source: "IFOOD", status: "FINALIZADO", createdAt: "2026-10-09T22:00:00Z", totalAmount: 40, paymentMethod: "Cartão (Pago Online)", ganho: 5 },
  { source: "IFOOD", status: "FINALIZADO", createdAt: "2026-10-09T22:10:00Z", totalAmount: 30, paymentMethod: "PIX", ganho: 5 },
  { source: "IFOOD", status: "FINALIZADO", createdAt: "2026-10-09T22:20:00Z", totalAmount: 25, paymentMethod: "Pix", ganho: 5 },
  { source: "ONLINE", status: "FINALIZADO", createdAt: "2026-10-09T22:30:00Z", totalAmount: 20, paymentMethod: null, ganho: 5 },
  // Dividido: R$ 30 em dinheiro com nota de 50, R$ 20 no Pix.
  { source: "IFOOD", status: "FINALIZADO", createdAt: "2026-10-09T22:40:00Z", totalAmount: 50, changeAmount: 50, paymentMethod: "Dinheiro + Pix", paymentMethods: [{ method: "Dinheiro", amount: 30 }, { method: "Pix", amount: 20 }], ganho: 5 },
];
const r = resumoDasEntregas(turno, tz);
confere("turno: pago online só o do app", [r.onlineTotal, r.onlineCount], [70, 2]);
confere("turno: maquininha vazia", r.cardPosTotal, 0);
confere("turno: Pix na entrega (trocado + parte)", [r.pixTotal, r.pixCount], [45, 2]);
confere("turno: forma não identificada", [r.naoIdentificadoTotal, r.naoIdentificadoCount], [20, 1]);
confere("turno: dinheiro da parte com a nota de 50", [r.cashCollectedSum, r.changeGivenSum, r.cashOrdersValueSum], [50, 20, 30]);
// Toda entrega cai em alguma caixa: as caixas somam o valor dos pedidos.
const somaDasCaixas = Math.round((r.cashOrdersValueSum + r.cardPosTotal + r.pixTotal + r.onlineTotal + r.fiadoTotal + r.naoIdentificadoTotal) * 100) / 100;
confere("turno: caixas = valor dos pedidos", somaDasCaixas, r.valorDosPedidos);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
