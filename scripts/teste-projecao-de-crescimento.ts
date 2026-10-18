/**
 * scripts/teste-projecao-de-crescimento.ts — o bloco "Mês que vem com
 * crescimento" da aba Projeção (lib/projecao-de-crescimento-regras.ts), sem banco.
 *
 * Pedido do dono (18/10/2026): "se continuar crescendo igual, mês que vem bate quanto?".
 *
 *   npx tsx scripts/teste-projecao-de-crescimento.ts
 */
import {
  entraNoFunil, etapasDaLoja, fracaoQueSaiDoTesteNoMes, funilPorMes, mensalidadeDaNova, montarCrescimento,
  partesDoMesSeguinte, perdaMensal, projetarComCrescimento, somarMeses, taxa, diasDeTesteTipico, mesmoPadrao, crescimentoDoMes, vendeConstanteNoTeste, mensalidadeNoMesSeguinte,
  type LojaNoCrescimento,
} from "../src/lib/projecao-de-crescimento-regras";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const brt = (s: string) => new Date(`${s}-03:00`);
const agora = brt("2026-10-18T12:00:00");

const loja = (o: Partial<Omit<LojaNoCrescimento, "cadastro">> & { cadastro: string }): LojaNoCrescimento => ({
  id: o.id || Math.random().toString(36).slice(2), doFunil: o.doFunil ?? true,
  cadastro: brt(o.cadastro), fimDoTeste: o.fimDoTeste === undefined ? new Date(brt(o.cadastro).getTime() + 15 * 86_400_000) : o.fimDoTeste,
  primeiroPedido: o.primeiroPedido ?? null, ultimoPedido: o.ultimoPedido ?? null,
  boletos: o.boletos || [], previstoNoMes: o.previstoNoMes ?? null, noMes: o.noMes ?? null, porDia: o.porDia || 0, pedidos30d: o.pedidos30d || 0,
});

// Quem entra no funil.
confere("conta nova entra", entraNoFunil({ id: "a", isenta: false, accountGroupId: null }), true);
confere("loja principal do grupo entra", entraNoFunil({ id: "a", isenta: false, accountGroupId: "a" }), true);
confere("loja extra de outra conta fica fora", entraNoFunil({ id: "b", isenta: false, accountGroupId: "a" }), false);
confere("isenta (Hakim, casa) fica fora", entraNoFunil({ id: "a", isenta: true, accountGroupId: null }), false);

// Etapas.
const emTeste = loja({ cadastro: "2026-10-10T10:00:00", primeiroPedido: brt("2026-10-12T20:00:00"), ultimoPedido: brt("2026-10-17T20:00:00"), porDia: 300 });
const e1 = etapasDaLoja(emTeste, agora);
confere("em teste: ativou, ainda em teste, vendeu no teste, não é pagante", [e1.ativou, e1.emTeste, e1.vendeuNoTeste, e1.pagante], [true, true, true, false]);
const pagaVende = loja({ cadastro: "2026-08-20T10:00:00", primeiroPedido: brt("2026-08-22T20:00:00"), ultimoPedido: brt("2026-10-17T20:00:00"),
  boletos: [{ mes: "2026-09", pago: true, base: 12000, valor: 120 }], previstoNoMes: 15000, porDia: 500 });
const e2 = etapasDaLoja(pagaVende, agora);
confere("pagou setembro e vende: pagante que continua", [e2.pagante, e2.pagou, e2.continua, e2.parou], [true, true, true, false]);
const parou = loja({ cadastro: "2026-08-05T10:00:00", primeiroPedido: brt("2026-08-06T20:00:00"), ultimoPedido: brt("2026-10-09T20:00:00"),
  boletos: [{ mes: "2026-09", pago: true, base: 8000, valor: 100 }], previstoNoMes: 3000 });
confere("pagante sem pedido há 8 dias: parou", etapasDaLoja(parou, agora).parou, true);
const soPrevisto = loja({ cadastro: "2026-09-25T10:00:00", primeiroPedido: brt("2026-10-12T20:00:00"), ultimoPedido: brt("2026-10-18T10:00:00"), previstoNoMes: 4000, porDia: 200 });
const e3 = etapasDaLoja(soPrevisto, agora);
confere("saiu do teste, boleto previsto, vendeu só depois do teste", [e3.pagante, e3.pagou, e3.vendeuNoTeste], [true, false, false]);
const boletoEmAberto = loja({ cadastro: "2026-08-01T10:00:00", primeiroPedido: brt("2026-08-02T20:00:00"), ultimoPedido: brt("2026-09-20T20:00:00"),
  boletos: [{ mes: "2026-09", pago: false, base: 2000, valor: 100 }] });
confere("boleto de setembro em aberto e nada em outubro: não é pagante", etapasDaLoja(boletoEmAberto, agora).pagante, false);
confere("sem data de teste: saiu do teste", etapasDaLoja(loja({ cadastro: "2026-10-01T10:00:00", fimDoTeste: null }), agora).saiuDoTeste, true);

// Funil por mês: só contas do funil, no mês de cadastro em Brasília.
const extra = loja({ cadastro: "2026-10-02T10:00:00", doFunil: false, primeiroPedido: brt("2026-10-03T10:00:00") });
const virada = loja({ cadastro: "2026-09-30T23:30:00" }); // 23h30 de Brasília = 02h30 UTC de 01/10
const funil = funilPorMes([emTeste, pagaVende, parou, soPrevisto, boletoEmAberto, extra, virada], ["2026-08", "2026-09", "2026-10"], agora);
confere("agosto: 3 cadastros, 2 pagantes (1 parou), conversão 2/3", [funil[0].cadastros, funil[0].pagantes, funil[0].pararam, r2(funil[0].conversao!)], [3, 2, 1, 0.67]);
confere("setembro: o das 23h30 do dia 30 é de setembro", funil[1].cadastros, 2);
confere("outubro: a loja extra não entra; a em teste fica 'ainda em teste'", [funil[2].cadastros, funil[2].emTeste, funil[2].conversao], [1, 1, null]);

// Taxa com faixa.
const t = taxa(1, 8);
confere("taxa 1 de 8 = 12,5%", t.taxa, 0.125);
confere("faixa de 1 de 8 é larga (≈3% a 41%)", [r2(t.min), r2(t.max)], [0.03, 0.41]);
const t2 = taxa(100, 800);
confere("com 800 a faixa aperta (±2 pontos)", [r2(t2.min), r2(t2.max)], [0.11, 0.15]);
confere("sem ninguém: taxa nula", taxa(0, 0).taxa, null);
confere("somar meses vira o ano", [somarMeses("2026-12", 1), somarMeses("2026-01", -1)], ["2027-01", "2025-12"]);

// Perda: de setembro para outubro, ficou quem tem boleto previsto vendendo.
const perda = perdaMensal([pagaVende, parou, boletoEmAberto], "2026-10", agora);
confere("perda set→out: 2 de 3 (parou há 8 dias; boleto em aberto sem venda)", [perda.s, perda.n, perda.meses], [2, 3, 1]);
const agoSet = loja({ cadastro: "2026-07-01T10:00:00", boletos: [{ mes: "2026-08", pago: true, base: 0, valor: 100 }, { mes: "2026-09", pago: true, base: 0, valor: 100 }], previstoNoMes: 5000, ultimoPedido: brt("2026-10-18T09:00:00") });
const soAgo = loja({ cadastro: "2026-07-01T10:00:00", boletos: [{ mes: "2026-08", pago: true, base: 0, valor: 100 }] });
const p2 = perdaMensal([agoSet, soAgo], "2026-10", agora);
confere("perda ago→set pelos boletos + set→out pelo previsto: 1 de 3", [p2.s, p2.n, p2.meses], [1, 3, 2]);

// Mensalidade da conta nova no 1º mês pago, a 2% de novembro.
const nova = mensalidadeDaNova([pagaVende, soPrevisto, parou, emTeste], "2026-11", agora);
// pagaVende: 1º boleto base 12.000 → 240; soPrevisto: base prevista 4.000 → 100 (mínimo); parou: base 8.000 → 160.
confere("média do 1º mês: (240 + 100 + 160) / 3", [r2(nova.valor), nova.n, nova.reserva], [166.67, 3, false]);
confere("sem pagante novo: mínimo, marcado como reserva", mensalidadeDaNova([emTeste], "2026-11", agora), { valor: 100, n: 0, reserva: true });

// Teste típico e defasagem.
confere("teste típico = mediana (15)", diasDeTesteTipico([emTeste, soPrevisto, loja({ cadastro: "2026-10-01T10:00:00", fimDoTeste: brt("2026-10-31T10:00:00") })]), 15);
confere("novembro (30 dias) com teste de 15: metade sai no mês", fracaoQueSaiDoTesteNoMes(30, 15), 0.5);
confere("teste de 30 num mês de 30: ninguém", fracaoQueSaiDoTesteNoMes(30, 30), 0);

// Partes do mês que vem.
const iniNov = brt("2026-11-01T00:00:00"), fimNov = brt("2026-12-01T00:00:00");
const testeAteDia10 = loja({ cadastro: "2026-10-11T00:00:00", fimDoTeste: brt("2026-11-11T00:00:00"), porDia: 500 }); // 20 dias × 500 = 10 mil → 200
const testeSemVenda = loja({ cadastro: "2026-10-15T00:00:00" });
const testeLongo = loja({ cadastro: "2026-10-15T00:00:00", fimDoTeste: brt("2026-12-15T00:00:00"), porDia: 900 });
const partes = partesDoMesSeguinte([pagaVende, emTeste, testeAteDia10, testeSemVenda, testeLongo, extra], agora, "2026-11", iniNov, fimNov);
// pagaVende 500/dia × 30 = 15 mil → 300. emTeste (acaba 25/10) 300/dia: mês cheio 9 mil → 180.
confere("fora do teste vendendo: mês cheio", partes.pagantesNoRitmo, { valor: 300, lojas: 1 });
confere("em teste vendendo: dias depois do teste (180 + 200), teste até dezembro fica fora",
  [r2(partes.emTesteVendendo.valor), partes.emTesteVendendo.lojas, r2(partes.emTesteVendendo.valorMesCheio)], [380, 2, 480]);
confere("em teste sem venda que sai do teste em novembro", partes.emTesteSemVenda, 1);

// A fórmula, com números redondos.
const c = projetarComCrescimento(
  { pagantesNoRitmo: { valor: 10000, lojas: 40 }, emTesteVendendo: { valor: 2000, valorMesCheio: 3000, lojas: 10 }, emTesteSemVenda: 50 },
  180, 0.5, { perda: 0.1, convVendeu: 0.6, convNaoVendeu: 0.1, convCadastro: 0.2, mensalidadeNova: 120 },
);
// base 10.000 × 0,9 = 9.000; teste vendendo 2.000 × 0,6 = 1.200; sem venda 50 × 0,1 × 120 = 600;
// novas 180 × 0,5 × 0,2 = 18 lojas × 120 = 2.160 → total 12.960; pagantes 36 + 6 + 5 + 18 = 65.
confere("fórmula: total", c.total, 12960);
confere("fórmula: partes", [c.base, c.perdido, c.testeVendendo, c.testeSemVenda, c.novasLojas, c.novas, c.pagantes], [9000, 1000, 1200, 600, 18, 2160, 65]);

// Montagem inteira: cenários e aviso de histórico curto.
const m = montarCrescimento({
  lojas: [emTeste, pagaVende, parou, soPrevisto, boletoEmAberto, extra, testeSemVenda],
  agora, mes: "2026-10", mesSeguinte: "2026-11", meses: ["2026-07", "2026-08", "2026-09", "2026-10"],
  inicioDoMes: brt("2026-10-01T00:00:00"), fimDoMes: iniNov, inicioDoSeguinte: iniNov, fimDoSeguinte: fimNov,
  previstoDoMes: { boletos: 3, aposta: 400, seTodas: 500 },
  mesAnterior: "2026-09", mesPassado: { recebido: 1600, emAberto: 640, boletosEmAberto: 3, lojasPagas: 8 },
});
confere("ritmo de cadastro: 2 em 17,5 dias → 30 dias de novembro", r2(m.ritmoDeCadastro.igual), r2((2 / 17.5) * 30));
confere("média: julho vazio fica fora (agosto e setembro)", [m.ritmoDeCadastro.mesesDaMedia, m.ritmoDeCadastro.media], [["2026-08", "2026-09"], 2]);
confere("pessimista ≤ cenários ≤ otimista", m.cenarios.pessimista.total <= Math.min(m.cenarios.igual.total, m.cenarios.media!.total)
  && m.cenarios.otimista.total >= Math.max(m.cenarios.igual.total, m.cenarios.media!.total), true);
confere("histórico curto avisa", !!m.historicoCurto && m.historicoCurto.length >= 2, true);
confere("série começa no 1º mês com boleto e termina no previsto", m.serie.map((s) => [s.mes, s.tipo, s.boletos]), [["2026-09", "real", 3], ["2026-10", "previsto", 3]]);

// O número principal: o mesmo padrão do último mês, aditivo em R$.
{
  const ficou = loja({ cadastro: "2026-06-01T10:00:00", ultimoPedido: brt("2026-10-18T09:00:00"),
    boletos: [{ mes: "2026-09", pago: true, base: 20000, valor: 400 }], noMes: { total: 400, chance: 1 } });
  const saiu = loja({ cadastro: "2026-06-01T10:00:00", ultimoPedido: brt("2026-09-28T20:00:00"),
    boletos: [{ mes: "2026-09", pago: false, base: 5000, valor: 100 }] });
  const paradoAgora = loja({ cadastro: "2026-06-01T10:00:00", ultimoPedido: brt("2026-10-05T20:00:00"),
    boletos: [{ mes: "2026-09", pago: true, base: 5000, valor: 100 }], noMes: { total: 100, chance: 0.5 } });
  // Nova do mês: 1º boleto é outubro. Uma saiu do teste em 25/09 (já teve boleto de setembro? não: entrou no fim do mês, boleto só agora).
  const novaQueSaiuEmSetembro = loja({ cadastro: "2026-09-10T10:00:00", fimDoTeste: brt("2026-09-25T10:00:00"), ultimoPedido: brt("2026-10-18T09:00:00"), noMes: { total: 300, chance: 1 } });
  const novaDeOutubro = loja({ cadastro: "2026-10-01T10:00:00", fimDoTeste: brt("2026-10-16T10:00:00"), ultimoPedido: brt("2026-10-18T09:00:00"), noMes: { total: 200, chance: 1 } });
  const testeAcabaDia25 = loja({ cadastro: "2026-10-10T10:00:00", fimDoTeste: brt("2026-10-25T10:00:00"), ultimoPedido: brt("2026-10-18T09:00:00"), noMes: { total: 100, chance: 0.25 } });
  // Saiu do teste em 10/09 e teve boleto de setembro: não é nova no mês, mas é nova nos 30 dias? Não — começou há mais de 30 dias.
  const antigaDeSetembro = loja({ cadastro: "2026-08-26T10:00:00", fimDoTeste: brt("2026-09-10T10:00:00"), ultimoPedido: brt("2026-10-18T09:00:00"),
    boletos: [{ mes: "2026-09", pago: true, base: 4000, valor: 100 }], noMes: { total: 150, chance: 1 } });
  // Saiu do teste em 22/09 com boleto de setembro: nos 30 dias ela é nova.
  const setembroTardia = loja({ cadastro: "2026-09-07T10:00:00", fimDoTeste: brt("2026-09-22T10:00:00"), ultimoPedido: brt("2026-10-18T09:00:00"),
    boletos: [{ mes: "2026-09", pago: false, base: 2000, valor: 100 }], noMes: { total: 250, chance: 1 } });
  const ls = [ficou, saiu, paradoAgora, novaQueSaiuEmSetembro, novaDeOutubro, testeAcabaDia25, antigaDeSetembro, setembroTardia];
  const mesAtual = { seTodas: 1600, aposta: 1350 };
  const ctx = { mesAnterior: "2026-09", mesSeguinte: "2026-11", agora, fimDoMes: iniNov, inicioDoSeguinte: iniNov, fimDoSeguinte: fimNov };
  const m1 = mesmoPadrao(ls, ctx, mesAtual, "mes");
  // Setembro: 400 + 100 + 100 + 100 + 100 = 800; perdeu 100 (sem boleto em outubro) = 12,5%.
  confere("último mês: perda em R$ = 100 de 800", [m1.anterior, m1.perdido, m1.lojasPerdidas, m1.perda], [800, 100, 1, 0.125]);
  // Novas (1º boleto em outubro): 300 + 200 + 100 = 600; na aposta 300 + 200 + 25 = 525.
  confere("último mês: receita nova inclui quem sai do teste até o fim do mês", [m1.nova, m1.novaAposta, m1.lojasNovas], [600, 525, 3]);
  // 1.600 × 0,875 + 600 = 2.000; aposta 1.350 × 0,875 + 525 = 1.706,25.
  confere("último mês: próximo = atual × (1 − perda) + nova", [m1.total, m1.totalAposta], [2000, 1706.25]);
  const m30 = mesmoPadrao(ls, ctx, mesAtual, "30dias");
  // Perda de 30 dias conta também o parado agora: 200 de 800.
  confere("30 dias: perda conta quem está parado agora", [m30.perdido, m30.lojasPerdidas, m30.perda], [200, 2, 0.25]);
  // Novas nos 30 dias (cobrança começou de 18/09 a hoje): 300 (25/09) + 200 (16/10) + 250 (22/09) = 750; teste que acaba dia 25 ainda não.
  confere("30 dias: receita nova = quem começou a pagar nos últimos 30 dias", [m30.nova, m30.lojasNovas], [750, 3]);
  confere("30 dias: próximo", m30.total, r2(1600 * 0.75 + 750));
  confere("sem boleto no mês anterior: perda zero", mesmoPadrao([novaDeOutubro], ctx, mesAtual, "mes").perda, 0);
}

// Loja em teste vendendo constante: fica (dono, 18/10/2026).
{
  const ctx = { mesAnterior: "2026-09", mesSeguinte: "2026-11", agora, fimDoMes: iniNov, inicioDoSeguinte: iniNov, fimDoSeguinte: fimNov };
  const ontem = brt("2026-10-17T20:00:00");
  // Teste acaba 25/10, 500/dia, 20 pedidos em 30 dias: já tem boleto (pedaço) de outubro com chance de teste 25%.
  const constanteOut = loja({ cadastro: "2026-10-10T10:00:00", fimDoTeste: brt("2026-10-25T10:00:00"), ultimoPedido: ontem, porDia: 500, pedidos30d: 20, noMes: { total: 100, chance: 0.25 } });
  // Teste acaba 11/11, 500/dia: sem boleto em outubro — ficava de fora dos dois lados.
  const constanteNov = loja({ cadastro: "2026-10-12T10:00:00", fimDoTeste: brt("2026-11-11T00:00:00"), ultimoPedido: ontem, porDia: 500, pedidos30d: 15 });
  const fraca = loja({ cadastro: "2026-10-12T10:00:00", fimDoTeste: brt("2026-10-27T10:00:00"), ultimoPedido: ontem, porDia: 100, pedidos30d: 4, noMes: { total: 100, chance: 0.25 } });
  const parada = loja({ cadastro: "2026-10-01T10:00:00", fimDoTeste: brt("2026-10-30T10:00:00"), ultimoPedido: brt("2026-10-09T20:00:00"), porDia: 0, pedidos30d: 12 });
  const pagava = loja({ cadastro: "2026-06-01T10:00:00", ultimoPedido: ontem, boletos: [{ mes: "2026-09", pago: true, base: 10000, valor: 200 }], noMes: { total: 200, chance: 1 }, porDia: 300, pedidos30d: 40 });
  confere("constante: em teste, pedido < 7 dias, ritmo e 10+ pedidos em 30 dias",
    [constanteOut, constanteNov, fraca, parada, pagava].map((l) => vendeConstanteNoTeste(l, agora)), [true, true, false, false, false]);
  confere("mensalidade do mês que vem: 20 dias depois do teste × 500 = 10 mil → 200", mensalidadeNoMesSeguinte(constanteNov, "2026-11", iniNov, fimNov), 200);
  confere("mensalidade do mês que vem: teste acaba em outubro = mês cheio (15 mil → 300)", mensalidadeNoMesSeguinte(constanteOut, "2026-11", iniNov, fimNov), 300);
  const ls = [constanteOut, constanteNov, fraca, parada, pagava];
  const atual = { seTodas: 400, aposta: 250 };
  const m = mesmoPadrao(ls, ctx, atual, "mes");
  // Último mês: novas = constanteOut (100, na aposta 100%) + fraca (100, aposta 25%); ficam = constanteNov 200.
  confere("último mês: a do teste em novembro entra como 'fica'; a constante de outubro vai a 100% na aposta",
    [m.nova, m.novaAposta, m.lojasNovas, m.ficam, m.lojasFicam], [200, 125, 2, 200, 1]);
  confere("último mês: total = 400 + 200 + 200; aposta = 250 + 125 + 200", [m.total, m.totalAposta], [800, 575]);
  const m30 = mesmoPadrao(ls, ctx, atual, "30dias");
  // 30 dias: ficam as duas constantes pela mensalidade do mês que vem (300 + 200); a fraca e a parada ficam fora; ninguém começou a pagar.
  confere("30 dias: as em teste constantes ficam pelo ritmo; fraca e parada fora", [m30.ficam, m30.lojasFicam, m30.nova, m30.lojasNovas], [500, 2, 0, 0]);
  confere("30 dias: loja em teste nunca entra na perda (só quem já pagava)", [m30.lojasAnteriores, m30.lojasPerdidas, m30.perda], [1, 0, 0]);
  confere("30 dias: total = 400 + 500", [m30.total, m30.totalAposta], [900, 750]);
}

// Crescimento do mês sobre o recebido (os em aberto à parte).
const cr = crescimentoDoMes({ recebido: 1600, emAberto: 640, boletosEmAberto: 3, lojasPagas: 8, seTodas: 10088, aposta: 7900 });
confere("1.600 recebidos → 10.088 = 6,3x; aposta 4,9x; cobrado 2.240", [cr.vezesSeTodas, cr.vezesAposta, cr.cobrado], [6.3, 4.9, 2240]);
confere("sem recebido: sem 'x'", crescimentoDoMes({ recebido: 0, emAberto: 0, boletosEmAberto: 0, lojasPagas: 0, seTodas: 500, aposta: 400 }).vezesSeTodas, null);
// Na montagem acima nenhuma loja tem boleto previsto em outubro: as 3 de setembro somem (perda 100%).
confere("montagem: perda 100% quando nenhuma de setembro tem boleto agora", [m.mesmoPadrao.doMes.perda, m.mesmoPadrao.doMes.total], [1, 0]);
confere("montagem: crescimento sobre o recebido", m.mesmoPadrao.crescimento.vezesSeTodas, 0.3);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
