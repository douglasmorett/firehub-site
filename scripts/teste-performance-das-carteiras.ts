/**
 * As contas da performance por carteira (lib/performance-das-carteiras/regras.ts):
 * períodos (atalhos, mês escolhido, intervalo livre, ano atual), rateio do mês,
 * receita (com a margem do disparo), dono da carteira e comissão por origem
 * (link 10% / atribuída 3% — o que o cadastro paga), conversão, perdas, CSV.
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-performance-das-carteiras.ts
 */
import {
  coberturaDoMes, csvDoComparativo, custoDaDescricao, donosDaLoja, evolucaoDaCarteira, exemploDeComissao, margemDaRecarga,
  numerosDaJanela, periodoDaAnalise, receitaDoMes, regraDeComissao, resumirCarteira, situacaoNoMes,
  SERVICOS_VAZIOS, type CarteiraDaAnalise, type CicloDaReceita, type Contexto, type LojaDaAnalise, type MesDaLoja,
} from "../src/lib/performance-das-carteiras/regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const faixa = (p: ReturnType<typeof periodoDaAnalise>) => [p.de, p.ate, p.deAnterior, p.ateAnterior];

console.log("\n— Períodos —");
const HOJE = "2026-10-18";
confere("mês atual: 01 a 18/10 × 01 a 18/09", faixa(periodoDaAnalise("mes", HOJE)), ["2026-10-01", "2026-10-18", "2026-09-01", "2026-09-18"]);
confere("mês atual no dia 31 × mês de 30 dias: corta no último dia", faixa(periodoDaAnalise("mes", "2026-10-31")).slice(2), ["2026-09-01", "2026-09-30"]);
confere("mês anterior: setembro inteiro × agosto", faixa(periodoDaAnalise("mesAnterior", HOJE)), ["2026-09-01", "2026-09-30", "2026-08-01", "2026-08-31"]);
confere("90 dias: 21/07 a 18/10 × os 90 antes", faixa(periodoDaAnalise("90d", HOJE)), ["2026-07-21", "2026-10-18", "2026-04-22", "2026-07-20"]);
confere("ano atual: 01/01 até hoje × o mesmo trecho de 2025", faixa(periodoDaAnalise("ano", HOJE)), ["2026-01-01", "2026-10-18", "2025-01-01", "2025-10-18"]);
confere("ano atual toca jan a out", periodoDaAnalise("ano", HOJE).meses.length, 10);
confere("ano em 29/02 compara com 28/02", periodoDaAnalise("ano", "2028-02-29").ateAnterior, "2027-02-28");
confere("mês escolhido (julho) × junho", faixa(periodoDaAnalise("mesEspecifico", HOJE, { mes: "2026-07" })), ["2026-07-01", "2026-07-31", "2026-06-01", "2026-06-30"]);
confere("mês escolhido = o corrente vira 'até hoje'", faixa(periodoDaAnalise("mesEspecifico", HOJE, { mes: "2026-10" })), ["2026-10-01", "2026-10-18", "2026-09-01", "2026-09-18"]);
confere("mês no futuro vira o corrente", periodoDaAnalise("mesEspecifico", HOJE, { mes: "2027-01" }).de, "2026-10-01");
confere("intervalo livre 10 dias × os 10 antes", faixa(periodoDaAnalise("intervalo", HOJE, { de: "2026-10-05", ate: "2026-10-14" })), ["2026-10-05", "2026-10-14", "2026-09-25", "2026-10-04"]);
confere("intervalo invertido é desvirado e o fim não passa de hoje", faixa(periodoDaAnalise("intervalo", HOJE, { de: "2026-12-01", ate: "2026-10-10" })).slice(0, 2), ["2026-10-10", "2026-10-18"]);
confere("intervalo cruzando meses toca os dois", periodoDaAnalise("intervalo", HOJE, { de: "2026-09-20", ate: "2026-10-05" }).meses, ["2026-09", "2026-10"]);

console.log("\n— Rateio do mês —");
const set = { inicio: new Date("2026-09-01T03:00:00Z"), fim: new Date("2026-10-01T03:00:00Z") };
const out = { inicio: new Date("2026-10-01T03:00:00Z"), fim: new Date("2026-11-01T03:00:00Z") };
const AGORA = new Date("2026-10-16T15:00:00Z");
confere("mês inteiro dentro = 1", coberturaDoMes(set, { inicio: new Date("2026-08-01"), fim: new Date("2026-12-01") }, AGORA, false), 1);
confere("metade de setembro = 0,5", coberturaDoMes(set, { inicio: new Date("2026-09-16T03:00:00Z"), fim: new Date("2026-10-01T03:00:00Z") }, AGORA, false), 0.5);
confere("mês corrente até agora, janela até agora = 1", coberturaDoMes(out, { inicio: out.inicio, fim: new Date("2026-10-19T08:00:00Z") }, AGORA, true), 1);
confere("fora da janela = 0", coberturaDoMes(set, { inicio: out.inicio, fim: out.fim }, AGORA, false), 0);

console.log("\n— Receita do mês e disparo —");
const ciclo = (x: Partial<CicloDaReceita>): CicloDaReceita => ({
  yearMonth: "2026-09", status: "PAID", amountDue: 300, amountPending: 0, paidValue: 449.9, paidAt: "2026-10-04", asaasPaymentId: "pay_1", asaasStatus: "RECEIVED", metaAdsFee: 0, totemFee: 100, ...x,
});
const sv = { ...SERVICOS_VAZIOS, app: 149, bill: 49.9 };
const pago = receitaDoMes(ciclo({}), { ...sv, totem: 100 }, false);
confere("boleto pago: previsto = faturado = recebido = boleto", [pago.previsto, pago.faturado, pago.recebido, pago.boleto, pago.emAberto], [449.9, 449.9, 449.9, 449.9, 0]);
confere("…mensalidade e serviços distribuídos no boleto", [pago.mensalidade, pago.servicos.app, pago.servicos.bill, pago.servicos.totem, pago.servicos.outros], [300, 149, 0.9, 0, 0]);
const aberto = receitaDoMes(ciclo({ status: "CLOSED", amountPending: 549.9, paidValue: null, paidAt: null, asaasStatus: "PENDING" }), sv, false);
confere("boleto em aberto", [aberto.faturado, aberto.recebido, aberto.emAberto], [549.9, 0, 549.9]);
confere("boleto cancelado no Asaas não conta", receitaDoMes(ciclo({ status: "CLOSED", amountPending: 300, asaasStatus: "DELETED" }), sv, false).faturado, 0);
const recarga = margemDaRecarga({ valor: 46, disparos: 100, custoPorDisparo: custoDaDescricao("Custo Meta na hora: R$ 0.3217") }, 0.4);
confere("margem da recarga com o custo GRAVADO: 46 − 100 × 0,3217", recarga, { bruto: 46, margem: 13.83, estimada: false });
confere("recarga sem custo gravado usa o custo atual e fica estimada", margemDaRecarga({ valor: 46, disparos: 100, custoPorDisparo: null }, 0.3217), { bruto: 46, margem: 13.83, estimada: true });
confere("custo da descrição com vírgula", custoDaDescricao("Custo Meta na hora: R$ 0,3500"), 0.35);
const corrente = receitaDoMes(ciclo({ yearMonth: "2026-10", status: "OPEN", amountDue: 220, amountPending: 320, paidValue: null, paidAt: null, asaasPaymentId: null }), { ...sv, disparo: 13.83, disparoBruto: 46 }, false);
confere("mês aberto: boleto 220 + App 149 + Bill 49,90 + totem 100; receita leva a MARGEM do disparo, não o bruto", [corrente.previsto, corrente.boleto, corrente.servicos.disparo, corrente.disparoBruto, corrente.recebido], [532.73, 518.9, 13.83, 46, 13.83]);
confere("isenta: só a margem do disparo", receitaDoMes(ciclo({}), { ...sv, disparo: 13.83, disparoBruto: 46 }, true).previsto, 13.83);

console.log("\n— Dono da carteira (quem atende) —");
const vendedores = new Set(["vic", "bia"]);
const eh = (id: string) => vendedores.has(id);
confere("veio pelo link do vendedor → só dele (LINK)", donosDaLoja({ ambassadorId: "vic", vendedorId: null }, eh), [{ carteira: "vic", origem: "LINK" }]);
confere("link do Victor e a Bia atende → é da Bia (quem atende), como atribuída", donosDaLoja({ ambassadorId: "vic", vendedorId: "bia" }, eh), [{ carteira: "bia", origem: "ATRIBUIDA" }]);
confere("link do Victor e ele mesmo atribuído → LINK", donosDaLoja({ ambassadorId: "vic", vendedorId: "vic" }, eh), [{ carteira: "vic", origem: "LINK" }]);
confere("atribuída pelo admin → do vendedor (ATRIBUIDA)", donosDaLoja({ ambassadorId: null, vendedorId: "bia" }, eh), [{ carteira: "bia", origem: "ATRIBUIDA" }]);
confere("embaixador que não vende + vendedor atribuído → as duas (regra antiga)", donosDaLoja({ ambassadorId: "ana", vendedorId: "bia" }, eh), [{ carteira: "bia", origem: "ATRIBUIDA" }, { carteira: "ana", origem: "INDICACAO" }]);
confere("ninguém → Sem vendedor", donosDaLoja({ ambassadorId: null, vendedorId: null }, eh), [{ carteira: "sem", origem: "SEM" }]);

console.log("\n— Comissão por origem: cadastro × combinado —");
confere("vendedor com 10% e 3% = sem aviso", regraDeComissao({ isVendedor: true, commissionPercent: 10, sellerPercent: 3 }).divergencias, []);
confere("vendedor criado no admin (0% no link) = aviso", regraDeComissao({ isVendedor: true, commissionPercent: 0, sellerPercent: 3 }).divergencias.length, 1);
confere("embaixador que não vende: sem aviso, vale o % dele", [regraDeComissao({ isVendedor: false, commissionPercent: 20, sellerPercent: 3 }).link, regraDeComissao({ isVendedor: false, commissionPercent: 20, sellerPercent: 3 }).divergencias], [20, []]);
const ex = exemploDeComissao({ link: 10, atribuida: 3 });
confere("exemplo: loja de R$ 10 mil → boleto R$ 349 (200 + App 149); 10% = 34,90; 3% = 10,47", [ex.boleto, ex.link, ex.atribuida], [349, 34.9, 10.47]);
confere("exemplo do disparo: margem 13,83; sempre 3% = 0,41", [ex.margem, ex.disparo], [13.83, 0.41]);

console.log("\n— Situação no mês —");
const sit = (x: Partial<Parameters<typeof situacaoNoMes>[0]>) => situacaoNoMes({
  criadaEm: "2026-01-10T12:00:00Z", testeAte: "2026-01-25T12:00:00Z", mes: "2026-10", inicioDoMes: out.inicio, fimDoMes: out.fim,
  vendas: 100, vendasDoMesAnterior: 100, fracaoDoMes: 1, ...x,
});
confere("cadastrada no mês = NOVA", sit({ criadaEm: "2026-10-05T12:00:00Z" }), "NOVA");
confere("sem venda = PARADA", sit({ vendas: 0 }), "PARADA");
confere("70 de 100 = ESFRIANDO; 71 = ATIVA", [sit({ vendas: 70 }), sit({ vendas: 71 })], ["ESFRIANDO", "ATIVA"]);
confere("mês na metade: 40 projetam 80 = ATIVA; 30 projetam 60 = ESFRIANDO", [sit({ vendas: 40, fracaoDoMes: 0.5 }), sit({ vendas: 30, fracaoDoMes: 0.5 })], ["ATIVA", "ESFRIANDO"]);

console.log("\n— Uma carteira —");
const meses = ["2026-07", "2026-08", "2026-09", "2026-10"];
const intervalos: Contexto["intervalos"] = {};
for (const ym of meses) { const [a, m] = ym.split("-").map(Number); intervalos[ym] = { inicio: new Date(Date.UTC(a, m - 1, 1, 3)), fim: new Date(Date.UTC(a, m, 1, 3)) }; }
const fracao = (AGORA.getTime() - intervalos["2026-10"].inicio.getTime()) / (intervalos["2026-10"].fim.getTime() - intervalos["2026-10"].inicio.getTime());
const ctx: Contexto = { intervalos, agora: AGORA, mesCorrente: "2026-10", fracaoDoMesCorrente: fracao };
const r = (previsto: number, disparo = 0) => ({ ...receitaDoMes(null, { ...SERVICOS_VAZIOS, disparo }, false), previsto: previsto + disparo, faturado: previsto + disparo, recebido: previsto + disparo, mensalidade: previsto, boleto: previsto });
const mes = (vendas: number, gmv: number, receita = 0, comissao = 0, disparo = 0, comissaoDoDisparo = 0): MesDaLoja => ({ vendas, gmv, receita: r(receita, disparo), comissaoPrevista: comissao, comissaoRecebida: comissao, comissaoDoDisparo });
const loja = (x: Partial<LojaDaAnalise> & { id: string }): LojaDaAnalise => ({
  nome: x.id, cidade: null, criadaEm: "2026-01-01T12:00:00Z", testeAte: "2026-01-16T12:00:00Z", desde: "2026-01-01T12:00:00Z", isenta: false,
  origem: "LINK", percentual: 10, meses: {}, faixa: { atual: { vendas: 0, gmv: 0 }, anterior: { vendas: 0, gmv: 0 } },
  primeiroPagamentoEm: null, bloqueadaAgora: false, upsell: [], agora: null, ...x,
});
const lojas: LojaDaAnalise[] = [
  // pelo link (10%): setembro 160 de boleto → 16 de comissão; outubro 170 → 17; disparo margem 13,83 → 1,38
  loja({ id: "link", meses: { "2026-08": mes(100, 5000, 150, 15), "2026-09": mes(100, 5000, 160, 16), "2026-10": mes(55, 2750, 170, 17, 13.83, 1.38) },
    faixa: { atual: { vendas: 55, gmv: 2750 }, anterior: { vendas: 40, gmv: 2000 } },
    upsell: [{ servico: "app", em: "2026-10-03T12:00:00Z", valorMensal: 149 }],
    agora: { status: "ATIVA", diasSemVenda: 0, valor30: 5500, valor30Anterior: 5000, oportunidadesDeVenda: 1, potencialMensal: 49.9, oportunidadesDeAdocao: 2, produtos: ["Bill"] } }),
  // atribuída (3%) em 01/10: setembro NÃO conta para receita/comissão desta carteira
  loja({ id: "atribuida", origem: "ATRIBUIDA", percentual: 3, desde: "2026-10-01T12:00:00Z", meses: { "2026-09": mes(50, 2500, 120, 3.6), "2026-10": mes(20, 1000, 130, 3.9) },
    faixa: { atual: { vendas: 20, gmv: 1000 }, anterior: { vendas: 20, gmv: 1000 } } }),
  // parou em outubro (vendeu em setembro) e está há 35 dias sem vender
  loja({ id: "parou", meses: { "2026-08": mes(30, 900, 100, 10), "2026-09": mes(10, 300, 100, 10), "2026-10": mes(0, 0, 0) },
    faixa: { atual: { vendas: 0, gmv: 0 }, anterior: { vendas: 4, gmv: 120 } },
    agora: { status: "PARADA", diasSemVenda: 35, valor30: 0, valor30Anterior: 300, oportunidadesDeVenda: 0, potencialMensal: 0, oportunidadesDeAdocao: 0, produtos: [] } }),
  // nova em setembro, teste acabou, pagou
  loja({ id: "nova-pagou", criadaEm: "2026-09-02T12:00:00Z", testeAte: "2026-09-17T12:00:00Z", desde: "2026-09-02T12:00:00Z", primeiroPagamentoEm: "2026-10-05T12:00:00Z",
    meses: { "2026-09": mes(20, 800), "2026-10": mes(25, 1000, 100, 10) }, faixa: { atual: { vendas: 25, gmv: 1000 }, anterior: { vendas: 8, gmv: 300 } } }),
  // nova em outubro, ainda em teste
  loja({ id: "nova-teste", criadaEm: "2026-10-10T12:00:00Z", testeAte: "2026-10-25T12:00:00Z", desde: "2026-10-10T12:00:00Z", meses: { "2026-10": mes(3, 90) }, faixa: { atual: { vendas: 3, gmv: 90 }, anterior: { vendas: 0, gmv: 0 } } }),
];
const carteira: CarteiraDaAnalise = { id: "vic", nome: "Victor", papel: "VENDEDOR", ativo: true, regra: regraDeComissao({ isVendedor: true, commissionPercent: 10, sellerPercent: 3 }), lojas };
const pMes = periodoDaAnalise("mes", "2026-10-16");
const janelas = {
  atual: { inicio: intervalos["2026-10"].inicio, fim: new Date("2026-10-17T08:00:00Z") },
  anterior: { inicio: intervalos["2026-09"].inicio, fim: new Date("2026-09-17T08:00:00Z") },
};
const rm = resumirCarteira(carteira, pMes, janelas, ctx, null);
confere("lojas: todas no fim de outubro; antes, sem a atribuída em outubro e a nova de outubro", [rm.atual.lojas, rm.anterior.lojas], [5, 3]);
confere("por origem no período: 4 pelo link, 1 atribuída", [rm.atual.porOrigem.LINK, rm.atual.porOrigem.ATRIBUIDA], [4, 1]);
confere("GMV pelos dias exatos (faixa)", [rm.atual.gmv, rm.anterior.gmv], [4840, 2420]);
confere("novas e conversão: setembro 1 de 1 pagou; outubro ainda em teste", [rm.anterior.conversaoPct, rm.atual.conversaoPct, rm.atual.novas], [100, null, 1]);
confere("perdida em outubro: a que parou", rm.atual.perdidasNomes, ["parou"]);
const fSet = coberturaDoMes(intervalos["2026-09"], janelas.anterior, AGORA, false);
confere("receita de set no mesmo ponto = boleto de set × fração (só quem já estava)", rm.anterior.receita.previsto, Math.round((160 + 100) * fSet * 100) / 100);
const fAtrib = coberturaDoMes(intervalos["2026-10"], { inicio: new Date("2026-10-01T12:00:00Z"), fim: janelas.atual.fim }, AGORA, true);
confere("comissão do mês: link 17 + nova 10 + atribuída 3,9 só desde que entrou (01/10 9h)", rm.atual.comissaoPrevista, Math.round((17 + 10 + 3.9 * fAtrib) * 100) / 100);
confere("comissão sobre a margem do disparo é separada (1,38)", rm.atual.comissaoDoDisparo, 1.38);
confere("receita de outubro leva a margem do disparo", rm.atual.receita.servicos.disparo, 13.83);
confere("upsell de outubro: o App", [rm.atual.upsell, rm.atual.upsellMensal], [1, 149]);
confere("agora: risco e oportunidades", [rm.agora.emRisco, rm.agora.gmvEmRisco, rm.agora.oportunidades, rm.agora.potencial], [1, 300, 1, 49.9]);

const pSet = periodoDaAnalise("mesAnterior", "2026-10-16");
const rs = resumirCarteira(carteira, pSet, { atual: intervalos["2026-09"], anterior: intervalos["2026-08"] }, ctx, null);
confere("mês anterior inteiro: receita de setembro só de quem estava (link + parou)", rs.atual.receita.previsto, 260);
confere("situação de setembro", rs.atual.porSituacao, { ATIVA: 1, ESFRIANDO: 1, PARADA: 0, NOVA: 1 });

console.log("\n— Evolução —");
const ev = evolucaoDaCarteira(carteira, ["2026-08", "2026-09", "2026-10"], ctx);
confere("lojas por mês (entraram antes do fim do mês)", ev.map((m) => m.lojas), [2, 3, 5]);
confere("GMV por mês (a atribuída em outubro não entra em setembro)", ev.map((m) => m.gmv), [5900, 6100, 4840]);

console.log("\n— CSV —");
const csv = csvDoComparativo([rm], pMes);
const [cab, linha] = csv.split("\r\n");
confere("CSV com BOM e as colunas novas", [csv.charCodeAt(0) === 0xfeff, cab.includes("Disparo margem"), cab.includes("% link (cadastro)")], [true, true, true]);
confere("linha começa com carteira, papel e período", linha.startsWith("Victor;VENDEDOR;out/26 (até hoje);set/26 no mesmo ponto;5;3;4;1;0;"), true);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
