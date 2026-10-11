/**
 * Teste do resumo do entregador (lib/resumo-do-entregador.ts) — a soma que o
 * relatório faz no servidor e que a tela refaz quando o lojista filtra o
 * cartão do motoboy por integração. Rodar: npx tsx scripts/teste-resumo-do-entregador.ts
 */
import { resumoDasEntregas, partesDaEntrega, composicaoDoGanho, canceladoComCorrida, type EntregaDoResumo } from "../src/lib/resumo-do-entregador";
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
  { source: "IFOOD", status: "ENTREGUE", createdAt: "2026-10-01T22:00:00Z", deliveryDistance: 2.5, totalAmount: 58.9, paymentMethod: "Pago Online", ganho: 6 },
  // 99Food em dinheiro com troco para 50
  { source: "99FOOD", status: "ENTREGUE", createdAt: "2026-10-01T23:10:00Z", deliveryDistance: 3, totalAmount: 41.5, paymentMethod: "Dinheiro", changeAmount: 50, ganho: 7 },
  // Site próprio, débito na maquininha
  { source: "SITE", status: "ENTREGUE", createdAt: "2026-10-02T00:30:00Z", deliveryDistance: 1.2, totalAmount: 35, paymentMethod: "Cartão de Débito", ganho: 5 },
  // Balcão, troco escrito na observação — madrugada (01h40 de 02/10 em Brasília
  // = mesmo expediente de 01/10, que vira às 5h). Ainda na rua.
  { source: "PRESENCIAL", status: "SAIU_ENTREGA", createdAt: "2026-10-02T04:40:00Z", deliveryDistance: 4, totalAmount: 30, paymentMethod: "Dinheiro", notes: "Troco p/ R$ 100,00", ganho: 8 },
  // iFood cancelado DEPOIS de o motoboy sair: a corrida conta, o dinheiro não.
  { source: "IFOOD", status: "CANCELADO", createdAt: "2026-10-02T20:00:00Z", dispatchedAt: "2026-10-02T20:20:00Z", cancelledAt: "2026-10-02T20:40:00Z", deliveryDistance: 2, totalAmount: 20, paymentMethod: "Dinheiro", ganho: 6 },
  // iFood cancelado ANTES de sair (03/10): não é corrida — nem entrega, nem dia, nem ganho.
  { source: "IFOOD", status: "CANCELADO", createdAt: "2026-10-03T20:00:00Z", cancelledAt: "2026-10-03T20:05:00Z", deliveryDistance: 5, totalAmount: 33, paymentMethod: "Pago Online", ganho: 9 },
];

confere("canais", pedidos.map((p) => chaveDoCanal(p as any)), ["IFOOD", "99FOOD", "SITE", "PDV", "IFOOD", "IFOOD"]);
confere("cancelado depois de sair é corrida; antes, não", [canceladoComCorrida(pedidos[4]), canceladoComCorrida(pedidos[5])], [true, false]);

const tudo = resumoDasEntregas(pedidos, tz);
confere("tudo: entregas = corridas (5: 4 não canceladas + 1 cancelada depois de sair)", tudo.totalDeliveries, 5);
confere("tudo: dias (expediente das 5h; o cancelado antes de sair não conta dia)", tudo.uniqueDays, 2);
confere("tudo: km só das corridas", tudo.totalDistance, 12.7);
confere("tudo: dinheiro a entregar", tudo.cashCollectedSum, 150);
confere("tudo: troco levado", tudo.changeGivenSum, 78.5);
confere("tudo: débito", [tudo.debitTotal, tudo.debitCount], [35, 1]);
confere("tudo: pago online", [tudo.onlineTotal, tudo.onlineCount], [58.9, 1]);
confere("tudo: ganho (o cancelado depois de sair conta; o de antes não)", tudo.feeTotal, 32);
confere("tudo: 3 entregues, 1 na rua, 2 canceladas (1 depois de sair, 1 antes)",
  [tudo.entreguesCount, tudo.emAndamentoCount, tudo.canceladasCount, tudo.canceladasComCorridaCount, tudo.canceladasSemCorridaCount, tudo.canceladasValor], [3, 1, 2, 1, 1, 53]);
// Valor dos pedidos: todas as formas (online, dinheiro, débito), sem o troco e sem o cancelado.
confere("tudo: valor dos pedidos", tudo.valorDosPedidos, 165.4);

const so = (canal: string) => resumoDasEntregas(pedidos.filter((p) => chaveDoCanal(p as any) === canal), tz);
const ifood = so("IFOOD"), noventaENove = so("99FOOD"), site = so("SITE"), balcao = so("PDV");
confere("só iFood: 2 corridas, 1 online, sem dinheiro", [ifood.totalDeliveries, ifood.onlineCount, ifood.cashCollectedSum, ifood.feeTotal], [2, 1, 0, 12]);
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

// ── A COMPOSIÇÃO DO PAGAMENTO POR ORIGEM ─────────────────────────────────────
// "Por entrega: R$ 0,00 × 10 entregas = R$ 40,00" (Diária + Entrega sem valor
// por entrega cadastrado, ganho vindo da tabela da loja): cada linha é uma
// origem, e "R$ X × N" só quando todas valem o mesmo.
const comp = composicaoDoGanho([
  ...Array.from({ length: 10 }, () => ({ origemDoGanho: "REGRA_DA_LOJA", ganhoDoMotoboy: 4, deliveryDistance: 2, corrida: true })),
  { origemDoGanho: "POR_ENTREGA", ganhoDoMotoboy: 5, deliveryDistance: 1, corrida: true },
  { origemDoGanho: "POR_ENTREGA", ganhoDoMotoboy: 5, deliveryDistance: 1, corrida: true },
  { origemDoGanho: "TAXA_DO_CLIENTE", ganhoDoMotoboy: 6.99, deliveryDistance: 3, corrida: true },
  { origemDoGanho: "TAXA_DO_CLIENTE", ganhoDoMotoboy: 4.5, deliveryDistance: 3, corrida: true },
  { origemDoGanho: "REGRA_DA_LOJA", ganhoDoMotoboy: 0, deliveryDistance: 9, corrida: false },
]);
confere("composição: uma linha por origem, na ordem", comp.map((c) => [c.origem, c.qtd, c.valor, c.cadaUma]),
  [["POR_ENTREGA", 2, 10, 5], ["REGRA_DA_LOJA", 10, 40, 4], ["TAXA_DO_CLIENTE", 2, 11.49, null]]);
confere("composição: a soma das linhas é o total das taxas", Math.round(comp.reduce((s, c) => s + c.valor, 0) * 100) / 100, 61.49);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
