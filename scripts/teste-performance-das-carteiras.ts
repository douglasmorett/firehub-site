/**
 * As contas da performance por carteira (lib/performance-das-carteiras/regras.ts):
 * período, receita do mês, situação no mês, conversão do teste, perdas,
 * faturamento com corte, comissão, upsell, variação e CSV.
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-performance-das-carteiras.ts
 */
import {
  csvDoComparativo, evolucaoDaCarteira, numerosDaJanela, periodoDaAnalise, receitaDoMes, resumirCarteira, situacaoNoMes,
  SERVICOS_VAZIOS, type CarteiraDaAnalise, type CicloDaReceita, type LojaDaAnalise, type MesDaLoja,
} from "../src/lib/performance-das-carteiras/regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— Períodos —");
confere("mês atual: out contra set no mesmo ponto", (({ meses, anteriores, parcial, rotulo }) => ({ meses, anteriores, parcial, rotulo }))(periodoDaAnalise("mes", "2026-10")),
  { meses: ["2026-10"], anteriores: ["2026-09"], parcial: true, rotulo: "out/26 (até hoje)" });
confere("mês anterior: set contra ago", [periodoDaAnalise("mesAnterior", "2026-10").meses, periodoDaAnalise("mesAnterior", "2026-10").anteriores, periodoDaAnalise("mesAnterior", "2026-10").parcial], [["2026-09"], ["2026-08"], false]);
confere("3 meses: ago–out contra mai–jul", [periodoDaAnalise("3m", "2026-10").meses, periodoDaAnalise("3m", "2026-10").anteriores], [["2026-08", "2026-09", "2026-10"], ["2026-05", "2026-06", "2026-07"]]);
confere("12 meses vira o ano", [periodoDaAnalise("12m", "2026-10").meses[0], periodoDaAnalise("12m", "2026-10").anteriores[0], periodoDaAnalise("12m", "2026-10").anteriores[11]], ["2025-11", "2024-11", "2025-10"]);

console.log("\n— Receita do mês —");
const ciclo = (x: Partial<CicloDaReceita>): CicloDaReceita => ({
  yearMonth: "2026-09", status: "PAID", amountDue: 300, amountPending: 0, paidValue: 449.9, paidAt: "2026-10-04", asaasPaymentId: "pay_1", asaasStatus: "RECEIVED", metaAdsFee: 0, totemFee: 100, ...x,
});
const sv = { ...SERVICOS_VAZIOS, app: 149, bill: 49.9 };
const pago = receitaDoMes(ciclo({}), { ...sv, totem: 100 }, false);
confere("boleto pago: faturado = recebido = valor pago", [pago.previsto, pago.faturado, pago.recebido, pago.emAberto], [449.9, 449.9, 449.9, 0]);
confere("…mensalidade = amountDue e o resto distribuído (app, bill; totem só o que sobra)", [pago.mensalidade, pago.servicos.app, pago.servicos.bill, pago.servicos.totem, pago.servicos.outros], [300, 149, 0.9, 0, 0]);
const aberto = receitaDoMes(ciclo({ status: "CLOSED", amountPending: 549.9, paidValue: null, paidAt: null, asaasStatus: "PENDING" }), sv, false);
confere("boleto em aberto: faturado sim, recebido não", [aberto.faturado, aberto.recebido, aberto.emAberto], [549.9, 0, 549.9]);
confere("…serviços conhecidos e 'outros' (loja extra)", [aberto.servicos.app, aberto.servicos.bill, aberto.servicos.totem, aberto.servicos.outros], [149, 49.9, 51, 0]);
const cancelado = receitaDoMes(ciclo({ status: "CLOSED", amountPending: 300, asaasStatus: "DELETED" }), sv, false);
confere("boleto cancelado no Asaas não é receita", [cancelado.faturado, cancelado.emAberto], [0, 0]);
const corrente = receitaDoMes(ciclo({ yearMonth: "2026-10", status: "OPEN", amountDue: 220, amountPending: 320, paidValue: null, paidAt: null, asaasPaymentId: null, metaAdsFee: 0, totemFee: 100 }), { ...sv, disparo: 50 }, false);
confere("mês aberto: previsto = mensalidade + totem do ciclo + app + bill + disparo", [corrente.previsto, corrente.faturado, corrente.recebido], [568.9, 50, 50]);
confere("isenta: só o disparo", receitaDoMes(ciclo({}), { ...sv, disparo: 30 }, true).previsto, 30);
confere("fechado sem boleto (teste/isento pelo fechamento): zero", receitaDoMes(ciclo({ status: "PAID", asaasPaymentId: null, paidValue: null, amountDue: 0 }), sv, false).faturado, 0);

console.log("\n— Situação no mês —");
const out = { inicio: new Date("2026-10-01T03:00:00Z"), fim: new Date("2026-11-01T03:00:00Z") };
const sit = (x: Partial<Parameters<typeof situacaoNoMes>[0]>) => situacaoNoMes({
  criadaEm: "2026-01-10T12:00:00Z", testeAte: "2026-01-25T12:00:00Z", mes: "2026-10", inicioDoMes: out.inicio, fimDoMes: out.fim,
  vendas: 100, vendasDoMesAnterior: 100, fracaoDoMes: 1, ...x,
});
confere("cadastrada no mês = NOVA", sit({ criadaEm: "2026-10-05T12:00:00Z" }), "NOVA");
confere("em teste no fim do mês = NOVA", sit({ testeAte: "2026-11-10T12:00:00Z" }), "NOVA");
confere("sem venda = PARADA", sit({ vendas: 0 }), "PARADA");
confere("70 de 100 = ESFRIANDO", sit({ vendas: 70 }), "ESFRIANDO");
confere("71 de 100 = ATIVA", sit({ vendas: 71 }), "ATIVA");
confere("mês corrente na metade: 40 vendas projetam 80 = ATIVA", sit({ vendas: 40, fracaoDoMes: 0.5 }), "ATIVA");
confere("mês corrente na metade: 30 projetam 60 = ESFRIANDO", sit({ vendas: 30, fracaoDoMes: 0.5 }), "ESFRIANDO");
confere("base < 20 não esfria", sit({ vendas: 2, vendasDoMesAnterior: 19 }), "ATIVA");

console.log("\n— Uma carteira —");
const meses = ["2026-07", "2026-08", "2026-09", "2026-10"];
const intervalos: Record<string, { inicio: Date; fim: Date }> = {};
meses.forEach((ym, i) => {
  const [a, m] = ym.split("-").map(Number);
  intervalos[ym] = { inicio: new Date(Date.UTC(a, m - 1, 1, 3)), fim: new Date(Date.UTC(a, m, 1, 3)) };
  void i;
});
const AGORA = new Date("2026-10-16T15:00:00Z");
const r = (previsto: number, recebido = previsto) => ({ ...receitaDoMes(null, SERVICOS_VAZIOS, false), previsto, faturado: previsto, recebido, mensalidade: previsto });
const mes = (vendas: number, gmv: number, receita = 0, comissao = 0): MesDaLoja => ({ vendas, gmv, receita: r(receita), comissaoPrevista: comissao, comissaoRecebida: comissao });
const loja = (x: Partial<LojaDaAnalise> & { id: string }): LojaDaAnalise => ({
  nome: x.id, cidade: null, criadaEm: "2026-01-01T12:00:00Z", testeAte: "2026-01-16T12:00:00Z", desde: "2026-01-01T12:00:00Z", isenta: false,
  meses: {}, gmvAnteriorNoCorte: 0, vendasAnterioresNoCorte: 0, primeiroPagamentoEm: null, bloqueadaAgora: false, upsell: [], agora: null, ...x,
});
const lojas: LojaDaAnalise[] = [
  // vende sempre; setembro no corte (mesmo ponto) = 40% do mês
  loja({ id: "firme", meses: { "2026-08": mes(100, 5000, 150, 4.5), "2026-09": mes(100, 5000, 160, 4.8), "2026-10": mes(55, 2750, 170, 5.1) }, gmvAnteriorNoCorte: 2000, vendasAnterioresNoCorte: 40,
    upsell: [{ servico: "app", em: "2026-10-03T12:00:00Z", valorMensal: 149 }], agora: { status: "ATIVA", diasSemVenda: 0, valor30: 5500, valor30Anterior: 5000, oportunidadesDeVenda: 1, potencialMensal: 49.9, oportunidadesDeAdocao: 2, produtos: ["Bill"] } }),
  // parou em outubro (vendeu em setembro) e está há 35 dias sem vender
  loja({ id: "parou", gmvAnteriorNoCorte: 120, vendasAnterioresNoCorte: 4, meses: { "2026-08": mes(30, 900, 100), "2026-09": mes(10, 300, 100), "2026-10": mes(0, 0, 0) }, agora: { status: "PARADA", diasSemVenda: 35, valor30: 0, valor30Anterior: 300, oportunidadesDeVenda: 0, potencialMensal: 0, oportunidadesDeAdocao: 0, produtos: [] } }),
  // nova em setembro, teste acabou, pagou
  loja({ id: "nova-pagou", criadaEm: "2026-09-02T12:00:00Z", testeAte: "2026-09-17T12:00:00Z", desde: "2026-09-02T12:00:00Z", primeiroPagamentoEm: "2026-10-05T12:00:00Z", gmvAnteriorNoCorte: 300, vendasAnterioresNoCorte: 8, meses: { "2026-09": mes(20, 800), "2026-10": mes(25, 1000, 100) } }),
  // nova em outubro, ainda em teste
  loja({ id: "nova-teste", criadaEm: "2026-10-10T12:00:00Z", testeAte: "2026-10-25T12:00:00Z", desde: "2026-10-10T12:00:00Z", meses: { "2026-10": mes(3, 90) } }),
  // entrou na carteira (atribuída ao vendedor) só em outubro: setembro não conta para receita/comissão
  loja({ id: "atribuida", desde: "2026-10-01T12:00:00Z", meses: { "2026-09": mes(50, 2500, 120, 3.6), "2026-10": mes(20, 1000, 130, 3.9) }, gmvAnteriorNoCorte: 1000, vendasAnterioresNoCorte: 20 }),
];
const carteira: CarteiraDaAnalise = { id: "v1", nome: "Victor", papel: "VENDEDOR", ativo: true, lojas };
const fracao = (AGORA.getTime() - intervalos["2026-10"].inicio.getTime()) / (intervalos["2026-10"].fim.getTime() - intervalos["2026-10"].inicio.getTime());

const mesAtual = resumirCarteira(carteira, periodoDaAnalise("mes", "2026-10"), intervalos, AGORA, fracao, "2026-10", null);
confere("lojas no fim do período (todas) e no anterior (sem a de outubro nem a atribuída em outubro)", [mesAtual.atual.lojas, mesAtual.anterior.lojas], [5, 3]);
confere("novas: 1 em outubro; 1 em setembro", [mesAtual.atual.novas, mesAtual.anterior.novas], [1, 1]);
confere("conversão de setembro: 1 saiu do teste e pagou = 100%", [mesAtual.anterior.novasForaDoTeste, mesAtual.anterior.novasPagantes, mesAtual.anterior.conversaoPct], [1, 1, 100]);
confere("conversão de outubro: ninguém saiu do teste ainda = sem taxa", [mesAtual.atual.novasForaDoTeste, mesAtual.atual.conversaoPct], [0, null]);
confere("perdida em outubro: a que parou (35 dias, vendeu em setembro)", [mesAtual.atual.perdidas, mesAtual.atual.perdidasNomes], [1, ["parou"]]);
confere("GMV de outubro (até hoje) contra setembro NO CORTE", [mesAtual.atual.gmv, mesAtual.anterior.gmv], [4840, 2000 + 120 + 300]);
confere("receita de setembro só das lojas que já estavam na carteira", mesAtual.anterior.receita.previsto, 260);
confere("comissão de setembro idem (sem a atribuída em outubro)", mesAtual.anterior.comissaoPrevista, 4.8);
confere("upsell de outubro: o App da 'firme'", [mesAtual.atual.upsell, mesAtual.atual.upsellMensal], [1, 149]);
confere("receita no mês atual: anterior proporcional ao mesmo ponto do mês", mesAtual.variacao.receita, Math.round(((mesAtual.atual.receita.previsto - 260 * fracao) / (260 * fracao)) * 100));
confere("variação do GMV", mesAtual.variacao.gmv, Math.round(((4840 - 2420) / 2420) * 100));
confere("agora: 1 em risco (parada que já vendeu), R$ 300 em risco; oportunidades", [mesAtual.agora.emRisco, mesAtual.agora.gmvEmRisco, mesAtual.agora.oportunidades, mesAtual.agora.potencial], [1, 300, 1, 49.9]);

const tri = resumirCarteira(carteira, periodoDaAnalise("mesAnterior", "2026-10"), intervalos, AGORA, fracao, "2026-10", null);
confere("mês anterior: setembro inteiro (sem corte)", [tri.atual.gmv, tri.atual.lojas], [5000 + 300 + 800, 3]);
confere("situação de setembro: firme ativa, parou esfriando (10 de 30 não, base 30 ≥ 20 → esfria), nova", tri.atual.porSituacao, { ATIVA: 1, ESFRIANDO: 1, PARADA: 0, NOVA: 1 });

console.log("\n— Evolução —");
const ev = evolucaoDaCarteira(carteira, ["2026-08", "2026-09", "2026-10"], intervalos, "2026-10", fracao);
confere("lojas por mês (entraram antes do fim do mês)", ev.map((m) => m.lojas), [2, 3, 5]);
confere("GMV por mês (só lojas já na carteira: a atribuída em outubro não entra em setembro)", ev.map((m) => m.gmv), [5900, 6100, 4840]);

console.log("\n— CSV —");
const csv = csvDoComparativo([mesAtual], periodoDaAnalise("mes", "2026-10"));
confere("CSV com BOM, cabeçalho e uma linha", [csv.charCodeAt(0) === 0xfeff, csv.split("\r\n").length, csv.split("\r\n")[1].startsWith("Victor;VENDEDOR;out/26 (até hoje);5;3;")], [true, 2, true]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
