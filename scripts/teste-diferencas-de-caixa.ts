/**
 * Trava as DIFERENÇAS DE CAIXA DO PERÍODO (lib/relatorios/diferencas-de-caixa.ts):
 * a soma por operador, por dia e por forma, com a régua de
 * lib/conferencia-do-caixa.ts — forma em branco fora da diferença, caixa sem
 * conferência à parte (nunca como falta), o caixa antigo de cinco zeros —, o
 * operador (quem abriu; no caixa antigo, quem fechou; nunca o "sistema") e o
 * dia operacional da abertura.
 *
 *   npx tsx scripts/teste-diferencas-de-caixa.ts
 */
import { diferencasDeCaixa, operadorDoCaixa, type CaixaParaDiferencas } from "../src/lib/relatorios/diferencas-de-caixa";
import { FECHADO_PELO_SISTEMA } from "../src/lib/conferencia-do-caixa";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
const caixa = (x: Partial<CaixaParaDiferencas> & { id: string; openedAt: string }): CaixaParaDiferencas => ({
  closedAt: null, closedBy: null, abertoPorNome: null,
  expectedCash: 0, expectedDebit: 0, expectedCredit: 0, expectedPix: 0, expectedVoucher: 0, expectedTotal: 0,
  closingCash: null, closingDebit: null, closingCredit: null, closingPix: null, closingVoucher: null, difference: null,
  ...x,
});

const CAIXAS: CaixaParaDiferencas[] = [
  // Ana, 02/11: esperava 500 dinheiro + 300 crédito; contou 480 e 300 → faltou 20.
  caixa({ id: "a1", openedAt: "2026-11-02T21:00:00Z", closedAt: "2026-11-03T03:00:00Z", abertoPorNome: "Ana", closedBy: "Ana",
    expectedCash: 500, expectedCredit: 300, expectedTotal: 900, closingCash: 480, closingCredit: 300, difference: -20 }),
  // Ana, 03/11 aberto às 02h (madrugada de 04/11 em UTC−3 = 23h do dia 03): sobrou 5; o Pix ficou em BRANCO (fora).
  caixa({ id: "a2", openedAt: "2026-11-04T02:00:00Z", closedAt: "2026-11-04T06:00:00Z", abertoPorNome: "ana ",
    expectedCash: 200, expectedPix: 150, expectedTotal: 350, closingCash: 205, closingPix: null, difference: 5 }),
  // Bruno (caixa antigo: sem quem abriu, fechou o Bruno): as cinco linhas em zero — SEM conferência, não é falta.
  caixa({ id: "b1", openedAt: "2026-11-02T13:00:00Z", closedAt: "2026-11-02T20:00:00Z", closedBy: "Bruno",
    expectedCash: 100, expectedDebit: 50, expectedTotal: 150, closingCash: 0, closingDebit: 0, closingCredit: 0, closingPix: 0, closingVoucher: 0, difference: -150 }),
  // Fechado sozinho ao abrir outro: sem quem abriu → "Não identificado", sem conferência.
  caixa({ id: "s1", openedAt: "2026-11-01T13:00:00Z", closedAt: "2026-11-01T22:00:00Z", closedBy: FECHADO_PELO_SISTEMA,
    expectedCash: 70, expectedTotal: 70 }),
];

confere("operador: quem abriu; senão quem fechou; nunca o sistema", [
  operadorDoCaixa({ abertoPorNome: "Ana", closedBy: "Bruno" }), operadorDoCaixa({ abertoPorNome: null, closedBy: "Bruno" }), operadorDoCaixa({ abertoPorNome: "", closedBy: FECHADO_PELO_SISTEMA }),
], ["Ana", "Bruno", "Não identificado"]);

const r = diferencasDeCaixa(CAIXAS, TZ);
const ana = r.porOperador.find((o) => o.operador === "Ana")!;
confere("Ana e 'ana ' são a mesma pessoa: 2 caixas", ana.caixas, 2);
confere("Ana: esperado das formas contadas (800 + 200), contado (780 + 205), diferença −15", [ana.esperado, ana.contado, ana.diferenca], [1000, 985, -15]);
confere("Ana: faltas −20 e sobras +5, à parte", [ana.faltas, ana.sobras], [-20, 5]);
const pixDaAna = ana.formas.find((f) => f.chave === "pix")!;
confere("Pix em branco: esperado 150, nada conferido, diferença 0", [pixDaAna.esperado, pixDaAna.esperadoConferido, pixDaAna.contado, pixDaAna.diferenca], [150, 0, 0, 0]);
const dinheiroDaAna = ana.formas.find((f) => f.chave === "cash")!;
confere("Dinheiro da Ana: 700 esperado, 685 contado, −15", [dinheiroDaAna.esperadoConferido, dinheiroDaAna.contado, dinheiroDaAna.diferenca], [700, 685, -15]);
confere("Online do turno da Ana (900 − 800): fora da conferência", ana.online, 100);

const bruno = r.porOperador.find((o) => o.operador === "Bruno")!;
confere("Bruno: caixa antigo de cinco zeros é SEM conferência — a falta de −150 gravada não conta", [bruno.caixas, bruno.semConferencia, bruno.diferenca, bruno.faltas], [1, 1, 0, 0]);
confere("mas o esperado dele aparece por forma (é o que passou no turno)", bruno.formas.filter((f) => f.esperado).map((f) => [f.nome, f.esperado]), [["Dinheiro", 100], ["Débito", 50]]);

confere("total: 4 caixas, 2 conferidos, 2 sem conferência, diferença −15", [r.total.caixas, r.total.conferidos, r.total.semConferencia, r.total.diferenca], [4, 2, 2, -15]);
confere("quem mais deixou faltar vem primeiro", r.porOperador[0].operador, "Ana");
confere("dia da abertura: 23h de 03/11 é dia 03", r.caixas.find((c) => c.id === "a2")!.dia, "2026-11-03");
confere("por dia, do mais recente", r.porDia.map((x) => [x.dia, x.caixas]), [["2026-11-03", 1], ["2026-11-02", 2], ["2026-11-01", 1]]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
