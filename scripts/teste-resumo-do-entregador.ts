/**
 * Teste do resumo do entregador (lib/resumo-do-entregador.ts) — a soma que o
 * relatório faz no servidor e que a tela refaz quando o lojista filtra o
 * cartão do motoboy por integração. Rodar: npx tsx scripts/teste-resumo-do-entregador.ts
 */
import { resumoDasEntregas, type EntregaDoResumo } from "../src/lib/resumo-do-entregador";
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

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
