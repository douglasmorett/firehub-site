/**
 * A CONFERÊNCIA DO FECHAMENTO: forma em branco não é "contei zero".
 *
 *   npx tsx scripts/teste-conferencia-do-caixa.ts
 *
 * Auditoria de 11/10/2026 (C6, C7 e o aviso ao dono): 67 de 270 caixas em 30
 * dias fecharam com as cinco formas em zero (−R$ 108.653 de "falta" gravada e
 * avisada no WhatsApp do dono; Ragnar 10/10, −R$ 7.369,37); o Histórico
 * comparava o esperado COM o online e o troco contra o contado SEM eles (Hakim
 * 10/10: "R$ 2.505,21 | R$ 1.045,20 | +R$ 0,18"); e o aviso dizia só
 * "Diferença no caixa: R$ -274,32". Aqui, as funções puras de
 * lib/conferencia-do-caixa.ts e o papel (lib/cupom-do-caixa.ts) com os números
 * reais desses caixas.
 */
import { conferenciaGravada, conferirFechamento, lerContado, mensagemDoCaixaFechado } from "../src/lib/conferencia-do-caixa";
import { cupomDeFechamentoDeCaixa, type LinhaDoRelatorio } from "../src/lib/cupom-do-caixa";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok    " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const vale = (nome: string, cond: boolean, detalhe?: unknown) => confere(nome + (cond ? "" : ` ${JSON.stringify(detalhe ?? "")}`), cond, true);

console.log("\n— O contado que a tela manda —");
confere("em branco = não conferida", [lerContado(""), lerContado("  "), lerContado(null), lerContado(undefined)], [null, null, null, null]);
confere("zero digitado = zero contado", [lerContado("0"), lerContado(0), lerContado("12.5")], [0, 0, 12.5]);

console.log("\n— A diferença do fechamento (PUT) —");
const esperado = { cash: 947.7, debit: 2303.39, credit: 1611.69, pix: 2506.59, voucher: 0 };
const nada = { cash: null, debit: null, credit: null, pix: null, voucher: null };
const semNada = conferirFechamento(esperado, nada);
confere("nada contado (Ragnar 10/10): SEM CONFERÊNCIA, diferença nula — não −R$ 7.369,37", [semNada.semConferencia, semNada.diferenca], [true, null]);
const soDinheiro = conferirFechamento(esperado, { ...nada, cash: 940 });
confere("só o dinheiro contado: a diferença é só dele (−7,70)", [soDinheiro.semConferencia, soDinheiro.diferenca], [false, -7.7]);
confere("…e os cartões e o Pix ficam como não conferidos", soDinheiro.naoConferidas.map((l) => l.nome), ["Débito", "Crédito", "Pix"]);
const tudo = conferirFechamento(esperado, { cash: 947.7, debit: 2303.39, credit: 1611.69, pix: 2500, voucher: 0 });
confere("tudo contado: falta de 6,59 no Pix", [tudo.semConferencia, tudo.diferenca, tudo.naoConferidas.length], [false, -6.59, 0]);
const zeroNoVale = conferirFechamento(esperado, { ...nada, voucher: 0 });
confere("só um 0 digitado onde nada era esperado: continua sem conferência", zeroNoVale.semConferencia, true);
const nadaEsperado = conferirFechamento({ cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0 }, nada);
confere("nada esperado e nada contado (loja só de online): fecha com diferença zero", [nadaEsperado.semConferencia, nadaEsperado.diferenca], [false, 0]);

console.log("\n— O caixa gravado, lido pelo Histórico e pela 2ª via —");
const sessao = (s: Record<string, unknown>) => ({ expectedCash: 0, expectedDebit: 0, expectedCredit: 0, expectedPix: 0, expectedVoucher: 0, expectedTotal: 0, ...s });
// Hakim 10/10: esperado 2.505,21 (com R$ 1.460,19 pago online), contado 1.045,20, diferença +0,18.
const hakim = conferenciaGravada(sessao({
  expectedCash: 287.55, expectedDebit: 171.02, expectedCredit: 446.59, expectedPix: 139.86, expectedTotal: 2505.21,
  closingCash: 287.55, closingDebit: 171.2, closingCredit: 446.59, closingPix: 139.86, closingVoucher: 0, difference: 0.18, closedBy: "Hakim Contato",
}));
confere("Hakim: igual com igual — esperado 1.045,02 × contado 1.045,20, +0,18", [hakim.situacao, hakim.esperadoConferido, hakim.contado, hakim.diferenca], ["CONFERIDO", 1045.02, 1045.2, 0.18]);
confere("Hakim: o online fica à parte (1.460,19)", hakim.online, 1460.19);
// Ragnar 10/10: cinco formas em zero, diferença gravada −7.369,37 (= −esperado).
const ragnar = conferenciaGravada(sessao({
  expectedCash: 947.7, expectedDebit: 2303.39, expectedCredit: 1611.69, expectedPix: 2506.59, expectedTotal: 15548.49,
  closingCash: 0, closingDebit: 0, closingCredit: 0, closingPix: 0, closingVoucher: 0, difference: -7369.37, closedBy: "Fabiano",
}));
confere("Ragnar: caixa antigo com tudo em zero é SEM CONFERÊNCIA (TUDO_ZERO)", [ragnar.situacao, ragnar.motivo, ragnar.diferenca], ["SEM_CONFERENCIA", "TUDO_ZERO", null]);
confere("…e a 'falta' gravada fica à vista como o que não vale", ragnar.diferencaGravadaQueNaoVale, -7369.37);
// NIK 05/10: encerrado sozinho ao abrir outro (difference nulo) — o Histórico mostrava ✅.
const nik = conferenciaGravada(sessao({ expectedCash: 455.8, expectedTotal: 9995.98, difference: null, closedBy: "sistema — encerrado ao abrir outro caixa" }));
confere("NIK: encerrado ao abrir outro caixa = sem conferência, não ✅", [nik.situacao, nik.motivo], ["SEM_CONFERENCIA", "ABRIU_OUTRO"]);
const novo = conferenciaGravada(sessao({ expectedCash: 100, expectedTotal: 100, difference: null, closedBy: "Maria", closingCash: null }));
confere("fechado agora sem ninguém contar = SEM_CONTAGEM", [novo.situacao, novo.motivo], ["SEM_CONFERENCIA", "SEM_CONTAGEM"]);
const parcial = conferenciaGravada(sessao({
  expectedCash: 855.73, expectedDebit: 688.12, expectedCredit: 1070.89, expectedTotal: 2614.74,
  closingCash: 850, closingDebit: null, closingCredit: null, difference: -5.73, closedBy: "Allan",
}));
confere("Delícia de Casa: só o dinheiro contado = PARCIAL, cartões não conferidos", [parcial.situacao, parcial.naoConferidas.map((l) => l.nome), parcial.esperadoConferido, parcial.diferenca], ["PARCIAL", ["Débito", "Crédito"], 855.73, -5.73]);
const antigoParcial = conferenciaGravada(sessao({ expectedCash: 500, expectedDebit: 300, expectedTotal: 800, closingCash: 500, closingDebit: 0, difference: -300, closedBy: "X" }));
confere("caixa antigo com o débito em 0: conferido, mas avisa que pode ter ficado em branco", [antigoParcial.situacao, antigoParcial.linhas.find((l) => l.chave === "debit")?.talvezEmBranco], ["CONFERIDO", true]);

console.log("\n— O aviso no WhatsApp do dono —");
const msgFalta = mensagemDoCaixaFechado({ loja: "Ragnar", fechadoAs: "04:04", abertoAs: "20:48", esperado, contado: { cash: 940, debit: 2303.39, credit: 1611.69, pix: 2506.59, voucher: null },
  trocoInicial: 728, online: 7949.47, vendas: { qtd: 243, valor: 14642.88 } });
vale("diz FALTOU, com o valor", /\*Faltou R\$ 7,70\* na conferência/.test(msgFalta), msgFalta);
vale("diz o esperado (com o troco inicial) e o contado", /Esperado nas formas contadas: R\$ 7\.369,37 \(com R\$ 728,00 de troco inicial\)/.test(msgFalta) && /Contado: R\$ 7\.361,67/.test(msgFalta), msgFalta);
vale("diz as vendas do turno e o online", /Vendas do turno: R\$ 14\.642,88 \(243 vendas\)/.test(msgFalta) && /R\$ 7\.949,47/.test(msgFalta), msgFalta);
vale("não diz mais 'Diferença no caixa: R$ -'", !/Diferença no caixa/.test(msgFalta));
const msgSem = mensagemDoCaixaFechado({ loja: "Ragnar", fechadoAs: "04:04", esperado, contado: nada, trocoInicial: 728, online: 0, vendas: null });
vale("sem contagem: 'Fechado SEM conferir', sem falta", /Fechado SEM conferir a gaveta/.test(msgSem) && !/Faltou/.test(msgSem), msgSem);
const msgSobra = mensagemDoCaixaFechado({ loja: "P17", fechadoAs: "03:16", esperado: { cash: 100, debit: 0, credit: 0, pix: 0, voucher: 0 }, contado: { cash: 112, debit: null, credit: null, pix: null, voucher: null }, trocoInicial: 0, online: 0 });
vale("sobra: 'Sobrou R$ 12,00'", /\*Sobrou R\$ 12,00\*/.test(msgSobra), msgSobra);

console.log("\n— O papel —");
const texto = (r: LinhaDoRelatorio[] | undefined) => (r || []).map((l: any) => `${l.texto || ""} ${l.valor || ""} ${l.nota || ""}`).join("\n");
const papel = (valores: any) => texto(cupomDeFechamentoDeCaixa({
  sessionId: "c1", loja: "Teste", fuso: "America/Sao_Paulo", operador: "Op", abertoEm: new Date("2026-10-10T20:00:00-03:00"),
  fechadoEm: new Date("2026-10-11T02:00:00-03:00"), trocoInicial: 100, valores,
}).relatorio);
const papelParcial = papel({ esperado: { cash: 500, debit: 300, credit: 0, pix: 0, voucher: 0, total: 900 }, contado: { cash: 495, debit: null, credit: null, pix: null, voucher: null },
  diferenca: -5, online: { ifood: 100 }, onlineEsperado: 100 });
vale("papel: a forma em branco sai 'nao conferido', fora da diferença", /Debito nao conferido esperado R\$ 300,00 \| ficou em branco/.test(papelParcial), papelParcial);
vale("papel: esperado e contado só das formas contadas", /Esperado nas formas contadas R\$ 500,00/.test(papelParcial) && /Contado R\$ 495,00/.test(papelParcial), papelParcial);
vale("papel: DIFERENCA (FALTA) de 5", /DIFERENCA \(FALTA\) -R\$ 5,00/.test(papelParcial), papelParcial);
const papelSem = papel({ esperado: { cash: 500, debit: 300, credit: 0, pix: 0, voucher: 0, total: 900 }, contado: { cash: null, debit: null, credit: null, pix: null, voucher: null },
  diferenca: 0, semConferencia: true, motivoSemConferencia: "SEM_CONTAGEM", online: { ifood: 100 }, onlineEsperado: 100 });
vale("papel sem contagem: o motivo certo (não 'encerrado ao abrir outro')", /Fechado sem conferir: ninguem digitou a contagem/.test(papelSem) && !/encerrado sozinho/.test(papelSem), papelSem);
vale("papel sem contagem: sem DIFERENCA", !/DIFERENCA/.test(papelSem), papelSem);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
