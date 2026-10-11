/**
 * Trava o Relatório de Mesas e o relatório do garçom (módulo Garçons) —
 * lib/relatorios/relatorio-de-mesas.ts, usado por api/store/mesas/relatorio e
 * api/store/waiters/[id]/report.
 *
 *   npx tsx scripts/teste-relatorio-de-mesas.ts
 *
 * Os casos são os da auditoria de 11/10/2026:
 *  - E2: o troco contado como consumo (Delicias da Maria, mesa de R$ 7 paga
 *    com R$ 100) e o desconto do fechamento abatido do consumo (Ragnar);
 *  - E3: o período do garçom (o "10/10" que consultava 09/10; "Hoje" à
 *    meia-noite do navegador);
 *  - E5: a linha Mesa contando rodadas no lugar de mesas;
 *  - E7: o "Hoje" do Relatório de Mesas às 2h da manhã.
 * E confere contra o Vendas por período (lib/relatorios/vendas.ts): a régua
 * única dá o mesmo valor e as mesmas vendas, tipo a tipo.
 */
import { contaDaMesa, mesasFechadasDoRelatorio, periodoDaConsulta, totaisDoGarcom, vendasPorOrigem, type MesaDoGarcom, type PedidoDoRelatorio, type SessaoFechada } from "../src/lib/relatorios/relatorio-de-mesas";
import { hojeNaLoja } from "../src/lib/relatorios/base";
import { janelaDoPeriodo } from "../src/lib/relatorios/servidor";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";
import { servicoDasMesas } from "../src/lib/relatorios/regua-da-venda";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const SP = "America/Sao_Paulo";
const BELEM = "America/Belem"; // Ragnar Burger
const iso = (d: Date) => d.toISOString();
const venda = (totalAmount: number, status = "ENTREGUE", discountTotal: number | null = null) => ({ status, totalAmount, discountTotal });

// ── 1) E2: o troco não é consumo ────────────────────────────────────────────
console.log("\n1) A conta da mesa: o troco não é consumo (E2)");
// Delicias da Maria, Mesa 2, 08/10/2026: consumo R$ 7, pago com nota de R$ 100, sem taxa.
const mesaDe7 = { id: "s7", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-10-09T00:37:00Z", pago: 100, pedidos: [venda(7)] };
const c7 = contaDaMesa(mesaDe7);
confere("mesa de R$ 7 paga com R$ 100: consumo 7", c7.consumo, 7);
confere("…total da conta 7 (era 100 no relatório do garçom)", c7.totalDaConta, 7);
confere("…sem desconto", c7.desconto, 0);
// Delícias de Casa, Mesa 9, 03/10/2026: consumo 74,80 + 10% (7,48) = 82,28, pago 103 em dinheiro.
const c9 = contaDaMesa({ id: "s9", serviceFee: 7.48, waiterTip: 0, fechadaEm: "2026-10-03T20:01:00Z", pago: 103, pedidos: [venda(74.8)] });
confere("conta com taxa paga com sobra: total = consumo + taxa (82,28), não 103", [c9.consumo, c9.taxa, c9.totalDaConta], [74.8, 7.48, 82.28]);
// Cancelado não é consumo; a taxa crua (6,359) vira centavo na linha.
const cCanc = contaDaMesa({ id: "sc", serviceFee: 6.359, waiterTip: 2, fechadaEm: "2026-10-03T20:01:00Z", pago: 71.95, pedidos: [venda(63.59), venda(20, "CANCELADO")] });
confere("pedido cancelado fora do consumo; taxa 6,359 → 6,36; gorjeta à parte", [cCanc.consumo, cCanc.taxa, cCanc.gorjeta, cCanc.totalDaConta], [63.59, 6.36, 2, 71.95]);
// Mesa liberada sem consumo.
confere("mesa liberada sem pedido: tudo zero", contaDaMesa({ id: "sl", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-10-03T20:01:00Z", pago: 0, pedidos: [] }), { consumo: 0, taxa: 0, gorjeta: 0, desconto: 0, totalDaConta: 0 });

// ── 2) E2: o desconto do fechamento fica à parte ────────────────────────────
console.log("\n2) Desconto dado ao fechar a conta: à parte, não sai do consumo (E2)");
// Ragnar, 26/09/2026: consumo 118,60, conta fechada por 78,70 no Pix (desconto 39,90), sem taxa.
const cRag = contaDaMesa({ id: "sr", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-09-27T02:16:00Z", pago: 78.7, pedidos: [venda(80), venda(38.6)] });
confere("consumo continua 118,60 (era 78,70 no Relatório de Mesas)", cRag.consumo, 118.6);
confere("desconto 39,90 à parte", cRag.desconto, 39.9);
confere("total da conta = 78,70, o que se cobrou", cRag.totalDaConta, 78.7);
// Desconto de 10 numa conta de 100 com 10% de taxa sobre o cobrado (9): conta 99, paga exata.
const cDesc = contaDaMesa({ id: "sd", serviceFee: 9, waiterTip: 0, fechadaEm: "2026-10-05T23:00:00Z", pago: 99, pedidos: [venda(100)] });
confere("conta 100 − 10 + 9 de taxa: desconto 10, total 99", [cDesc.consumo, cDesc.desconto, cDesc.totalDaConta], [100, 10, 99]);
// A mesma conta paga com nota de 100: o troco de 1 esconde 1 do desconto (é um piso, regra 4 da régua).
const cPiso = contaDaMesa({ id: "sp", serviceFee: 9, waiterTip: 0, fechadaEm: "2026-10-05T23:00:00Z", pago: 100, pedidos: [venda(100)] });
confere("…paga com nota de 100: desconto 9 (piso), total 100 — limite conhecido", [cPiso.desconto, cPiso.totalDaConta], [9, 100]);
// Antes de 13/09/2026 a mesa fechava com qualquer valor: diferença não é desconto.
const cVelha = contaDaMesa({ id: "sv", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-09-05T23:00:00Z", pago: 50, pedidos: [venda(80)] });
confere("conta mal fechada antes de 13/09: desconto 0, total = consumo", [cVelha.desconto, cVelha.totalDaConta], [0, 80]);
// Conta antiga com taxa NEGATIVA (era o desconto): vai para o desconto, a taxa fica 0.
const cNeg = contaDaMesa({ id: "sn", serviceFee: -48.91, waiterTip: 0, fechadaEm: "2026-09-05T23:00:00Z", pago: 440.19, pedidos: [venda(489.1)] });
confere("taxa negativa (Pastel da Paulista, 05/09): desconto 48,91, taxa 0, total 440,19", [cNeg.taxa, cNeg.desconto, cNeg.totalDaConta], [0, 48.91, 440.19]);
// Pedido com desconto próprio: o fechamento não deduz de novo (não conta duas vezes).
const cPed = contaDaMesa({ id: "sq", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-10-05T23:00:00Z", pago: 90, pedidos: [venda(90, "ENTREGUE", 10)] });
confere("desconto no pedido (já fora do totalAmount): nada a deduzir no fechamento", [cPed.consumo, cPed.desconto, cPed.totalDaConta], [90, 0, 90]);

// ── 3) As mesas fechadas do período: topo e tabela por garçom ───────────────
console.log("\n3) Mesas fechadas: topo e por garçom, pela régua (E2)");
const sessoes: SessaoFechada[] = [
  { ...mesaDe7, waiterId: "w1", garcom: "Ana" },
  { id: "a2", waiterId: "w1", garcom: "Ana", serviceFee: 6.359, waiterTip: 0, fechadaEm: "2026-10-09T01:00:00Z", pago: 69.95, pedidos: [venda(63.59)] },
  { id: "b1", waiterId: "w2", garcom: "Bruno", serviceFee: 0, waiterTip: 5, fechadaEm: "2026-10-09T02:00:00Z", pago: 83.7, pedidos: [venda(80), venda(38.6)] },
  { id: "x1", waiterId: null, garcom: null, serviceFee: 3, waiterTip: 0, fechadaEm: "2026-10-09T03:00:00Z", pago: 50, pedidos: [venda(30)] },
  { id: "x2", waiterId: null, garcom: null, serviceFee: 0, waiterTip: 0, fechadaEm: "2026-10-09T03:30:00Z", pago: 0, pedidos: [] },
];
const antesConsumo = Math.round(sessoes.reduce((s, m) => s + (m.pago || 0) - (m.serviceFee || 0) - (m.waiterTip || 0), 0) * 100) / 100;
const mf = mesasFechadasDoRelatorio(sessoes);
confere("(antes) pago − taxa − gorjeta somava o troco e tirava o desconto", antesConsumo, 289.29);
confere("consumo = soma dos pedidos das contas: 7 + 63,59 + 118,60 + 30", mf.consumo, 219.19);
confere("taxa crua somada (6,359 + 3) e gorjeta", [mf.taxaServico, mf.gorjetas], [9.36, 5]);
confere("desconto no fechamento à parte: 39,90 em 1 conta", [mf.descontoNoFechamento, mf.mesasComDesconto], [39.9, 1]);
confere("as mesmas somas de servicoDasMesas (a régua do Vendas por período)", [mf.taxaServico, mf.gorjetas, mf.descontoNoFechamento, mf.fechadas],
  (({ taxa, gorjeta, descontoNaMesa, mesas }) => [taxa, gorjeta, descontoNaMesa, mesas])(servicoDasMesas(sessoes)));
confere("por garçom: nome, mesas, consumo, taxa, gorjeta, desconto", mf.porGarcom.map((g) => [g.nome, g.mesas, g.consumo, g.taxaServico, g.gorjetas, g.desconto]), [
  ["Ana", 2, 70.59, 6.36, 0, 0],
  ["Sem garçom", 2, 30, 3, 0, 0],
  ["Bruno", 1, 118.6, 0, 5, 39.9],
]);
confere("Σ consumo por garçom = consumo do topo", Math.round(mf.porGarcom.reduce((s, g) => s + g.consumo, 0) * 100) / 100, mf.consumo);

// ── 4) E5: vendas por origem — mesas, não rodadas; o mesmo do Vendas por período ─
console.log("\n4) Vendas por origem: a mesa conta uma vez (E5) e bate com o Vendas por período");
let seq = 0;
const ped = (x: Partial<PedidoDoRelatorio & PedidoParaVendas>): PedidoDoRelatorio & PedidoParaVendas => ({
  id: `p${String(++seq).padStart(2, "0")}`, franchiseeId: "loja", createdAt: "2026-10-10T22:00:00.000Z", status: "ENTREGUE", totalAmount: 0, items: [], ...x,
});
const pedidos = [
  // Mesa 1: três rodadas na mesma conta. Mesa 2: duas. Mesa 3: uma, ainda aberta.
  ped({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m1", totalAmount: 40 }),
  ped({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m1", totalAmount: 25, createdAt: "2026-10-10T23:00:00.000Z" }),
  ped({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m1", totalAmount: 12.5, createdAt: "2026-10-11T00:10:00.000Z" }),
  ped({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m2", totalAmount: 60 }),
  ped({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m2", totalAmount: 18 }),
  ped({ source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m3", totalAmount: 33.3 }),
  // Lançamento antigo de mesa pelo PDV, sem sessão: uma venda cada.
  ped({ source: "PDV", deliveryType: "MESA", totalAmount: 20 }),
  // Balcão, totem (é balcão aqui; o Vendas por período separa), delivery iFood com acréscimo, retirada do site.
  ped({ source: "PRESENCIAL", deliveryType: "RETIRADA", totalAmount: 35 }),
  ped({ source: "TOTEM", deliveryType: "RETIRADA", totemLicenseId: "t1", totalAmount: 22 }),
  ped({ id: "ifood-pai", source: "IFOOD", ifoodOrderId: "if-1", deliveryType: "DELIVERY", totalAmount: 51.91 }),
  ped({ source: "IFOOD", ifoodOrderId: "if-1b", deliveryType: "DELIVERY", parentOrderId: "ifood-pai", totalAmount: 7 }),
  ped({ source: "SITE", deliveryType: "DELIVERY", totalAmount: 55 }),
  ped({ source: "SITE", deliveryType: "RETIRADA", totalAmount: 30 }),
  // Fora da venda: cancelado, rascunho do robô, valor impossível.
  ped({ status: "CANCELADO", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m1", totalAmount: 99 }),
  ped({ status: "CRIANDO_IA", source: "WHATSAPP_IA", deliveryType: "DELIVERY", totalAmount: 60 }),
  ped({ source: "SITE", deliveryType: "RETIRADA", totalAmount: 10, items: [{ quantity: 1, price: 1e17 }] }),
];
const vo = vendasPorOrigem(pedidos);
const rodadasAntes = pedidos.filter((p) => p.status !== "CANCELADO" && p.status !== "CRIANDO_IA" && (p.tableSessionId || p.deliveryType === "MESA")).length;
confere("(antes) a linha Mesa contava 7 \"pedidos\" (rodadas)", rodadasAntes, 7);
confere("Mesa: 4 vendas (3 contas + 1 lançamento sem sessão), 7 rodadas, R$ 208,80", [vo.porOrigem.MESA.vendas, vo.porOrigem.MESA.lancamentos, vo.porOrigem.MESA.valor], [4, 7, 208.8]);
confere("Delivery: o acréscimo do iFood não abre venda nova (2 vendas, 3 lançamentos)", [vo.porOrigem.DELIVERY.vendas, vo.porOrigem.DELIVERY.lancamentos, vo.porOrigem.DELIVERY.valor], [2, 3, 113.91]);
confere("Balcão com o totem dentro; retirada sem o valor impossível", [vo.porOrigem.BALCAO.valor, vo.porOrigem.BALCAO.vendas, vo.porOrigem.RETIRADA.valor, vo.porOrigem.RETIRADA.vendas], [57, 2, 30, 1]);
confere("delivery por canal", vo.deliveryPorCanal.map((c) => [c.canal, c.vendas, c.lancamentos, c.valor]), [["iFood", 1, 2, 58.91], ["Online", 1, 1, 55]]);
confere("o campo antigo `pedidos` (tela aberta antes do F5) = lançamentos", vo.porOrigem.MESA.pedidos, 7);
// O mesmo recorte no Vendas por período.
const rv = resumoDeVendas(pedidos);
const tipo = (t: string) => rv.porTipo.find((x) => x.tipo === t) || { vendas: 0, pedidos: 0, valor: 0 };
confere("total vendido = valor vendido do Vendas por período", vo.total, rv.totalPedidos);
confere("vendas = vendas (atendimentos) do Vendas por período", [vo.vendas, vo.lancamentos], [rv.atendimentos, rv.pedidos]);
confere("Mesa = Mesa do Vendas por período (vendas, lançamentos, valor)", [vo.porOrigem.MESA.vendas, vo.porOrigem.MESA.lancamentos, vo.porOrigem.MESA.valor], [tipo("MESA").vendas, tipo("MESA").pedidos, tipo("MESA").valor]);
confere("Delivery e Retirada iguais", [vo.porOrigem.DELIVERY.valor, vo.porOrigem.DELIVERY.vendas, vo.porOrigem.RETIRADA.valor, vo.porOrigem.RETIRADA.vendas], [tipo("DELIVERY").valor, tipo("DELIVERY").vendas, tipo("RETIRADA").valor, tipo("RETIRADA").vendas]);
confere("Balcão daqui = Balcão + Totem de lá", [vo.porOrigem.BALCAO.valor, vo.porOrigem.BALCAO.vendas], [Math.round((tipo("BALCAO").valor + tipo("TOTEM").valor) * 100) / 100, tipo("BALCAO").vendas + tipo("TOTEM").vendas]);

// ── 5) E3/E7: o período, no dia operacional da loja ─────────────────────────
console.log("\n5) O período: dia operacional da loja, resolvido no servidor (E3, E7)");
const q = (s: string) => new URLSearchParams(s);
// 11/10/2026 às 02:00 em Brasília = 05:00Z: o turno aberto ainda é o de 10/10.
const as2h = new Date("2026-10-11T05:00:00Z");
const hojeAs2h = hojeNaLoja(SP, as2h);
confere("às 2h de 11/10, 'hoje' na loja é 10/10 (o dia vira às 5h)", hojeAs2h, "2026-10-10");
confere("…na Ragnar (Belém) também", hojeNaLoja(BELEM, as2h), "2026-10-10");
// O diaLocal() de antes (Relatório de Mesas) pegava o calendário: 11/10, um dia que ainda não começou.
const calendarioAs2h = new Intl.DateTimeFormat("en-CA", { timeZone: SP, year: "numeric", month: "2-digit", day: "2-digit" }).format(as2h);
confere("(antes) o dia do calendário às 2h já era 11/10", calendarioAs2h, "2026-10-11");
confere("atalho=hoje às 2h → 10/10", periodoDaConsulta(q("atalho=hoje"), hojeAs2h), { de: "2026-10-10", ate: "2026-10-10" });
confere("atalho=ontem às 2h → 09/10", periodoDaConsulta(q("atalho=ontem"), hojeAs2h), { de: "2026-10-09", ate: "2026-10-09" });
confere("de/ate explícitos", periodoDaConsulta(q("de=2026-09-11&ate=2026-10-10"), hojeAs2h), { de: "2026-09-11", ate: "2026-10-10" });
confere("de/ate invertidos são trocados", periodoDaConsulta(q("de=2026-10-10&ate=2026-10-01"), hojeAs2h), { de: "2026-10-01", ate: "2026-10-10" });
confere("sem nada (ou lixo) = hoje", [periodoDaConsulta(q(""), hojeAs2h), periodoDaConsulta(q("de=10/10/2026&atalho=amanha"), hojeAs2h)], [{ de: "2026-10-10", ate: "2026-10-10" }, { de: "2026-10-10", ate: "2026-10-10" }]);
const j = janelaDoPeriodo("2026-10-10", "2026-10-10", SP);
confere("o dia 10/10 vai de 10/10 05:00 a 11/10 05:00 (Brasília)", [iso(j.inicio), iso(j.fim)], ["2026-10-10T08:00:00.000Z", "2026-10-11T08:00:00.000Z"]);
const jr = janelaDoPeriodo("2026-10-10", "2026-10-10", BELEM);
confere("…na Ragnar (Belém, −03:00) igual", [iso(jr.inicio), iso(jr.fim)], ["2026-10-10T08:00:00.000Z", "2026-10-11T08:00:00.000Z"]);
// (antes) A janela do garçom era montada no navegador: new Date("2026-10-10") é meia-noite UTC
// (09/10 21:00 em Brasília) e o setHours local a levava para o calendário de 09/10.
const OFF = -3 * 3600_000; // o navegador em Brasília
const local = (d: Date) => new Date(d.getTime() + OFF); // relógio do navegador, lido em UTC
const sd = local(new Date("2026-10-10")); // 09/10 21:00
const antesInicio = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate()) - OFF); // setHours(0,0,0,0)
const antesFim = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate(), 23, 59, 59, 999) - OFF); // setHours(23,59,59,999)
confere("(antes) o 'Período' de 10/10 consultava 09/10 00:00 a 09/10 23:59 (Brasília)", [iso(antesInicio), iso(antesFim)], ["2026-10-09T03:00:00.000Z", "2026-10-10T02:59:59.999Z"]);
// A mesa fechada à 1h de 11/10 é do turno de 10/10.
const fechadaA1h = new Date("2026-10-11T04:00:00Z");
confere("a mesa fechada à 1h de 11/10 entra em 10/10 (antes: em 11/10)", [fechadaA1h >= j.inicio && fechadaA1h < j.fim, fechadaA1h >= antesInicio && fechadaA1h <= antesFim], [true, false]);

// ── 6) Relatório do garçom: os cartões são a soma das linhas ─────────────────
console.log("\n6) Relatório do garçom: total da conta sem troco, cartões = soma das linhas (E2)");
const linha = (m: Parameters<typeof contaDaMesa>[0], comissao: number): MesaDoGarcom => ({
  ...contaDaMesa(m), serviceFee: Number(m.serviceFee) || 0, waiterTip: Number(m.waiterTip) || 0, waiterCommission: comissao,
});
const linhas = [
  linha(mesaDe7, 0),
  linha({ id: "g2", serviceFee: 6.359, waiterTip: 2, fechadaEm: "2026-10-10T23:00:00Z", pago: 100, pedidos: [venda(63.59)] }, 8.359),
  linha({ id: "g3", serviceFee: 9, waiterTip: 0, fechadaEm: "2026-10-10T23:30:00Z", pago: 99, pedidos: [venda(100)] }, 9),
];
const tg = totaisDoGarcom(linhas);
confere("(antes) 'Total gasto nas mesas' = Σ pago = 299", 100 + 100 + 99, 299);
confere("total gasto = Σ total da conta: 7 + 71,95 + 99", tg.totalDasContas, 177.95);
confere("…= consumo − desconto + taxa (por linha) + gorjeta", Math.round((tg.consumo - tg.desconto + linhas.reduce((s, l) => s + l.taxa, 0) + tg.gorjetas) * 100) / 100, tg.totalDasContas);
confere("desconto do período: 10 em 1 mesa", [tg.desconto, tg.mesasComDesconto], [10, 1]);
confere("taxa crua somada (6,359 + 9 = 15,36), gorjeta 2, comissão 17,36", [tg.taxaServico, tg.gorjetas, tg.comissao], [15.36, 2, 17.36]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
