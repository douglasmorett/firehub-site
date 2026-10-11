/**
 * Trava o CMV real (lib/cmv/*): custo do insumo pela última compra até o dia,
 * custo do preparo pela receita ÷ rendimento (com preparo dentro de preparo e
 * ciclo), o fechamento da contagem (contado, carregado, sistema; ajuste só no
 * contado), a janela do período (abertura na véspera, parcial, faltando
 * contagem), o CMV entre contagens e os trechos dia a dia, a zona do ponteiro e
 * o CMO proporcional aos dias.
 *
 *   npx tsx scripts/teste-cmv-real.ts
 *
 * Números do Hakim (fichas revisadas pelo Douglas em 11/10/2026): recheio de
 * carne = 1 kg de carne + 200 g de tomate + 200 g de cebola + 200 ml de limão +
 * 32 g de Sazón + 12 g de sal, com 20% de perda de líquido → rende 1.315,2 g.
 */
import { custosNoDia, explodirPreparo, ultimaCompraAte, type InsumoParaCusto } from "../src/lib/cmv/custo-do-insumo";
import { entraNoCarregado, fecharContagem } from "../src/lib/cmv/contagem";
import { cmvEntre, janelaCompletaDoPeriodo, janelaDoPeriodo, lerMeta, trechosDaJanela, zonaDoCmv, type ContagemFechada, type DiaDoCmv } from "../src/lib/cmv/cmv-real";
import { cmoDoPeriodo, custoDoVt, custoMensal, ehMaoDeObra } from "../src/lib/cmv/cmo";
import { lerNumeroBr } from "../src/lib/cmv/numero";
import { diaQueAContagemFecha, inicioDaSemanaDoCmv, lerSemanaDoCmv, semanaDoCmv } from "../src/lib/cmv/semana-do-cmv";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const perto = (oQue: string, obtido: number | null | undefined, esperado: number, tol = 0.0001) => {
  const ok = obtido != null && Math.abs(obtido - esperado) <= tol;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${obtido}, esperava ${esperado}`}`);
};

// ── Custo ────────────────────────────────────────────────────────────────
const ins = (id: string, x: Partial<InsumoParaCusto> = {}): InsumoParaCusto => ({
  id, nome: id, unidade: "g", tipo: null, rendimento: null, unitCost: null, componentes: [], ...x,
});
const INSUMOS: InsumoParaCusto[] = [
  ins("carne", { unitCost: 0.03 }),          // cadastro R$ 30/kg
  ins("tomate", { unitCost: 0.008 }),
  ins("cebola", { unitCost: 0.005 }),
  ins("limao", { unidade: "ml", unitCost: 0.02 }),
  ins("sazon", { unitCost: 0.1 }),
  ins("sal", { unitCost: 0.002 }),
  ins("mussarela", { unitCost: 0.032 }),
  ins("parmesao"),                            // sem custo nenhum
  ins("recheioCarne", {
    tipo: "PREPARO", rendimento: 1315.2,
    componentes: [
      { insumoId: "carne", quantidade: 1000 }, { insumoId: "tomate", quantidade: 200 }, { insumoId: "cebola", quantidade: 200 },
      { insumoId: "limao", quantidade: 200 }, { insumoId: "sazon", quantidade: 32 }, { insumoId: "sal", quantidade: 12 },
    ],
  }),
  ins("tresQueijos", { tipo: "PREPARO", rendimento: 1000, componentes: [{ insumoId: "mussarela", quantidade: 700 }, { insumoId: "parmesao", quantidade: 150 }] }),
  ins("cicloA", { tipo: "PREPARO", rendimento: 100, componentes: [{ insumoId: "cicloB", quantidade: 50 }, { insumoId: "sal", quantidade: 100 }] }),
  ins("cicloB", { tipo: "PREPARO", rendimento: 100, componentes: [{ insumoId: "cicloA", quantidade: 50 }] }),
  ins("semReceita", { tipo: "PREPARO" }),
];
const ENTRADAS = [
  { stockItemId: "carne", dia: "2026-10-05", em: 1, unitCost: 0.028 },
  { stockItemId: "carne", dia: "2026-10-08", em: 2, unitCost: 0.034 },
  { stockItemId: "carne", dia: "2026-10-08", em: 3, unitCost: 0.035 },  // mesma data, lançada depois: vale esta
  { stockItemId: "carne", dia: "2026-10-12", em: 4, unitCost: 0.05 },   // depois do dia pedido: não conta
];

confere("última compra até o dia, desempate pela hora", [...ultimaCompraAte(ENTRADAS, "2026-10-10")], [["carne", 0.035]]);
confere("antes de qualquer compra não há custo de compra", ultimaCompraAte(ENTRADAS, "2026-10-01").size, 0);

const c10 = custosNoDia(INSUMOS, ENTRADAS, "2026-10-10");
confere("carne no dia 10 vem da compra", c10.get("carne"), { custo: 0.035, fonte: "COMPRA", incompleto: false });
confere("tomate sem compra vem do cadastro", c10.get("tomate")?.fonte, "CADASTRO");
confere("parmesão sem custo nenhum", c10.get("parmesao"), { custo: null, fonte: "SEM_CUSTO", incompleto: false });
// (1000×0,035 + 200×0,008 + 200×0,005 + 200×0,02 + 32×0,1 + 12×0,002) ÷ 1315,2
perto("recheio de carne = componentes ÷ rendimento", c10.get("recheioCarne")?.custo, (35 + 1.6 + 1 + 4 + 3.2 + 0.024) / 1315.2);
confere("recheio de carne é PREPARO completo", [c10.get("recheioCarne")?.fonte, c10.get("recheioCarne")?.incompleto], ["PREPARO", false]);
perto("3 queijos com parmesão sem custo: só a mussarela", c10.get("tresQueijos")?.custo, (700 * 0.032) / 1000);
confere("…e sai marcado incompleto", c10.get("tresQueijos")?.incompleto, true);
perto("ciclo não trava: entra só o sal", c10.get("cicloA")?.custo, (100 * 0.002) / 100);
confere("ciclo marca incompleto", c10.get("cicloA")?.incompleto, true);
confere("preparo sem receita fica sem custo", c10.get("semReceita"), { custo: null, fonte: "SEM_CUSTO", incompleto: true });

// Contagem de um dia fechada DEPOIS de uma compra nova: vale o custo do dia.
const depois = [
  { stockItemId: "tomate", dia: "2026-10-12", em: 9, unitCost: 0.01, custoAnterior: 0.008 },
  { stockItemId: "sal", dia: "2026-10-12", em: 10, unitCost: 0.003, custoAnterior: null },
  { stockItemId: "cebola", dia: "2026-10-12", em: 11, unitCost: 0.009 },  // sem o registro: não se sabe
];
const insumosHoje = INSUMOS.map((i) => (i.id === "tomate" ? { ...i, unitCost: 0.01 } : i.id === "sal" ? { ...i, unitCost: 0.003 } : i.id === "cebola" ? { ...i, unitCost: 0.009 } : i));
const c11 = custosNoDia(insumosHoje, depois, "2026-10-11");
confere("compra depois do dia: vale o custo que o cadastro tinha antes dela", c11.get("tomate"), { custo: 0.008, fonte: "CADASTRO", incompleto: false });
confere("sem custo antes da primeira compra: sem custo no dia", c11.get("sal"), { custo: null, fonte: "SEM_CUSTO", incompleto: false });
confere("compra sem o registro do custo anterior: fica o cadastro de hoje", c11.get("cebola")?.custo, 0.009);
confere("no dia da compra em diante vale a compra", custosNoDia(insumosHoje, depois, "2026-10-12").get("tomate")?.custo, 0.01);

const exp = explodirPreparo(INSUMOS, "recheioCarne", 1315.2);
perto("1.315,2 g de recheio contém 1 kg de carne", exp.get("carne"), 1000);
perto("…e 200 ml de limão", exp.get("limao"), 200);

// ── Contagem ─────────────────────────────────────────────────────────────
const custos = new Map([
  ["queijo", { custo: 0.03, fonte: "COMPRA" as const, incompleto: false }],
  ["farinha", { custo: 0.004, fonte: "COMPRA" as const, incompleto: false }],
  ["sal", { custo: 0.002, fonte: "CADASTRO" as const, incompleto: false }],
  ["caixa", { custo: null, fonte: "SEM_CUSTO" as const, incompleto: false }],
]);
const f = fecharContagem({
  itens: [
    { stockItemId: "queijo", nome: "Mussarela", unidade: "g", contado: 8000, saldoSistema: 9500 },
    { stockItemId: "farinha", nome: "Farinha", unidade: "g", contado: null, saldoSistema: 12000 },
    { stockItemId: "sal", nome: "Sal", unidade: "g", contado: null, saldoSistema: -300 },
    { stockItemId: "caixa", nome: "Caixa G", unidade: "un", contado: 40, saldoSistema: 40 },
  ],
  anterior: new Map([["farinha", 25000]]),
  movimentoDesde: new Map([["farinha", 5000 - 1000]]), // comprou 5 kg, perdeu 1 kg
  custos,
});
confere("origens", f.linhas.map((l) => l.origem), ["CONTADO", "CARREGADO", "SISTEMA", "CONTADO"]);
confere("carregado = anterior + movimento", f.linhas[1].quantidade, 29000);
confere("sistema negativo vira zero", f.linhas[2].quantidade, 0);
confere("ajuste só no contado (8000 − 9500)", f.linhas.map((l) => l.ajuste), [-1500, 0, 0, 0]);
confere("valor = Σ quantidade × custo (240 + 116)", f.valorTotal, 356);
confere("item contado sem custo é avisado", f.semCusto, ["Caixa G"]);
confere("contagem: 2 contados, 1 carregado, 1 pelo sistema", [f.contados, f.carregados, f.peloSistema], [2, 1, 1]);
const vazia = fecharContagem({ itens: [{ stockItemId: "queijo", nome: "Mussarela", unidade: "g", contado: null, saldoSistema: 700 }], anterior: null, movimentoDesde: new Map(), custos });
const semLimpeza = fecharContagem({
  itens: [
    { stockItemId: "queijo", nome: "Mussarela", unidade: "g", contado: 1000, saldoSistema: 0 },
    { stockItemId: "farinha", nome: "Detergente", unidade: "g", contado: 1000, saldoSistema: 0 },
  ],
  anterior: null, movimentoDesde: new Map(), custos, foraDoCmv: new Set(["farinha"]),
});
confere("item fora do CMV é contado mas não soma no valor", [semLimpeza.linhas[1].valor, semLimpeza.valorTotal], [4, 30]);
confere("primeira contagem sem contar: vale o sistema", [vazia.linhas[0].origem, vazia.linhas[0].quantidade], ["SISTEMA", 700]);
confere("venda e ajuste não entram no carregado", [
  entraNoCarregado({ type: "SALE" }), entraNoCarregado({ type: "AJUSTE" }),
  entraNoCarregado({ type: "INPUT", notes: "Devolução por cancelamento - Pedido #a (cancel id: x)" }),
  entraNoCarregado({ type: "INPUT", notes: "Compra" }), entraNoCarregado({ type: "WASTE" }),
], [false, false, false, true, true]);

// ── Janela e CMV ─────────────────────────────────────────────────────────
// Semana de segunda 12/10 a domingo 18/10/2026.
const C = (dia: string, valorTotal: number, tipo = "RAPIDA"): ContagemFechada => ({ id: dia, dia, tipo, valorTotal });
const CONTAGENS = [C("2026-10-04", 9000, "COMPLETA"), C("2026-10-11", 10000, "COMPLETA"), C("2026-10-12", 9200), C("2026-10-13", 8500), C("2026-10-15", 9800)];
const DIAS: DiaDoCmv[] = [
  { dia: "2026-10-11", compras: 999, vendas: 999 },   // é da semana passada: fica fora
  { dia: "2026-10-12", compras: 0, vendas: 2500 },
  { dia: "2026-10-13", compras: 300, vendas: 3000 },
  { dia: "2026-10-14", compras: 2000, vendas: 2800 },
  { dia: "2026-10-15", compras: 500, vendas: 3100 },
  { dia: "2026-10-16", compras: 800, vendas: 4000 },  // depois da última contagem: ainda não entra
];
const j = janelaDoPeriodo(CONTAGENS, "2026-10-12", "2026-10-18");
confere("semana abre no domingo anterior e fecha na última contagem", [j.abertura?.dia, j.fechamento?.dia, j.parcial, j.falta], ["2026-10-11", "2026-10-15", true, null]);
const sem = cmvEntre(j.abertura!, j.fechamento!, DIAS);
// 10000 + (0 + 300 + 2000 + 500) − 9800 = 3000; vendas 2500+3000+2800+3100 = 11400
confere("CMV da semana até quinta", [sem.de, sem.ate, sem.compras, sem.cmv, sem.vendas, sem.pct], ["2026-10-12", "2026-10-15", 2800, 3000, 11400, 26.3]);
const tr = trechosDaJanela(CONTAGENS, j, DIAS);
confere("um trecho por par de contagens", tr.map((t) => [t.de, t.ate, t.cmv]), [["2026-10-12", "2026-10-12", 800], ["2026-10-13", "2026-10-13", 1000], ["2026-10-14", "2026-10-15", 1200]]);
confere("a soma dos trechos é o CMV da semana", tr.reduce((s, t) => s + t.cmv, 0), sem.cmv);
const j2 = janelaDoPeriodo([C("2026-10-14", 5000)], "2026-10-12", "2026-10-18");
confere("só uma contagem: falta outra", [j2.abertura?.dia, j2.falta], ["2026-10-14", "SO_UMA_CONTAGEM"]);
confere("nenhuma contagem", janelaDoPeriodo([], "2026-10-12", "2026-10-18").falta, "NENHUMA_CONTAGEM");
const j3 = janelaDoPeriodo([C("2026-10-13", 5000), C("2026-10-14", 4000)], "2026-10-12", "2026-10-18");
confere("primeira contagem dentro do período abre a janela (parcial)", [j3.abertura?.dia, j3.fechamento?.dia, j3.parcial], ["2026-10-13", "2026-10-14", true]);
const jMes = janelaDoPeriodo(CONTAGENS, "2026-10-01", "2026-10-31");
confere("mês sem contagem em 30/09 abre na primeira de outubro", [jMes.abertura?.dia, jMes.fechamento?.dia, jMes.parcial], ["2026-10-04", "2026-10-15", true]);
confere("CMV sem venda não tem %", cmvEntre(C("2026-10-01", 100), C("2026-10-02", 50), []).pct, null);

confere("zona do ponteiro com meta 33", [zonaDoCmv(30), zonaDoCmv(33), zonaDoCmv(35.9), zonaDoCmv(36.1), zonaDoCmv(null)], ["verde", "verde", "amarelo", "vermelho", "sem"]);
confere("meta lida com vírgula, padrão sem meta", [lerMeta({ cmvPct: "31,5" }, "cmvPct", 33), lerMeta({}, "cmvPct", 33), lerMeta({ cmvPct: 150 }, "cmvPct", 33)], [31.5, 33, 33]);

// ── CMO ──────────────────────────────────────────────────────────────────
confere("custo mensal = salário × (1 + encargos) + benefícios", custoMensal({ salario: 2000, encargosPct: 20, beneficios: 300 }), 2700);
// VT à parte: a loja paga o VT menos o desconto no salário (6% por padrão, nunca mais que o VT)
confere("VT de R$ 220 com 6% de R$ 1.850 = 220 − 111", custoDoVt({ salario: 1850, valeTransporte: 220, descontoVtPct: null }), 109);
confere("VT menor que 6% do salário não custa nada", custoDoVt({ salario: 3000, valeTransporte: 150, descontoVtPct: 6 }), 0);
confere("sem desconto, a loja paga o VT inteiro", custoDoVt({ salario: 1850, valeTransporte: 220, descontoVtPct: 0 }), 220);
confere("cesta de R$ 200 + VT entram juntos no custo", custoMensal({ salario: 1850, encargosPct: 40, beneficios: 200, valeTransporte: 220, descontoVtPct: 6 }), 1850 * 1.4 + 200 + 109);
const cmo = cmoDoPeriodo(
  [
    { id: "a", nome: "Ana", salario: 3100, encargosPct: 0, beneficios: 0, desde: "2026-01-01", ate: null },
    { id: "b", nome: "Bia", salario: 3100, encargosPct: 0, beneficios: 0, desde: "2026-10-15", ate: null }, // entrou na quinta
    { id: "c", nome: "Caio", salario: 3100, encargosPct: 0, beneficios: 0, desde: "2026-01-01", ate: "2026-10-09" }, // saiu antes
  ],
  [
    { dia: "2026-10-13", valor: 120, categoria: "Diária / ajudante" },
    { dia: "2026-10-14", valor: 80, categoria: "Gás" },             // não é mão de obra
    { dia: "2026-10-20", valor: 120, categoria: "Diária / ajudante" }, // fora da semana
  ],
  "2026-10-12", "2026-10-18",
);
// outubro tem 31 dias: R$ 100/dia. Ana 7 dias, Bia 4 dias (15 a 18).
confere("CMO: folha proporcional + diária", [cmo.folha, cmo.diarias, cmo.total], [1100, 120, 1220]);
confere("CMO por pessoa (quem saiu antes não aparece)", cmo.porPessoa.map((p) => [p.nome, p.dias, p.valor]), [["Ana", 7, 700], ["Bia", 4, 400]]);
confere("diária é mão de obra, gás não", [ehMaoDeObra("Diária / ajudante"), ehMaoDeObra("Gás")], [true, false]);

// ── Semana do CMV pelo dia da contagem completa ─────────────────────────
// Hakim: terça antes de abrir → vale o fim de segunda → semana de terça a segunda.
const hakim = semanaDoCmv(2, "ANTES_DE_ABRIR");
confere("terça antes de abrir fecha segunda; semana começa na terça", [hakim.fecha, hakim.comecaEm], [1, 2]);
confere("terça depois de fechar: semana de quarta a terça", semanaDoCmv(2, "DEPOIS_DE_FECHAR").comecaEm, 3);
confere("sem nada gravado: domingo depois de fechar (segunda a domingo)", [lerSemanaDoCmv({}).fecha, lerSemanaDoCmv(null).comecaEm], [0, 1]);
confere("lê o gravado", lerSemanaDoCmv({ semanaDoCmv: { diaDaContagem: 2, momento: "ANTES_DE_ABRIR" } }).comecaEm, 2);
// domingo 11/10/2026: a semana do Hakim começou na terça 06; na terça 13 começa outra.
confere("início da semana do CMV", [inicioDaSemanaDoCmv("2026-10-11", 2), inicioDaSemanaDoCmv("2026-10-13", 2), inicioDaSemanaDoCmv("2026-10-12", 1)], ["2026-10-06", "2026-10-13", "2026-10-12"]);
// Hakim abre 17h30 na terça. Horários em UTC (−03).
const HORAS = [
  { day: "Terça", open: "17:30", close: "23:30", active: true, shifts: [{ open: "17:30", close: "23:30" }] },
  { day: "Quarta", open: "10:30", close: "23:30", active: true, shifts: [{ open: "10:30", close: "23:30" }] },
];
confere("terça 15h, antes de abrir: a contagem fecha segunda", diaQueAContagemFecha(new Date("2026-10-13T18:00:00Z"), "America/Sao_Paulo", HORAS), "2026-10-12");
confere("terça 23h50, depois de abrir: fecha terça", diaQueAContagemFecha(new Date("2026-10-14T02:50:00Z"), "America/Sao_Paulo", HORAS), "2026-10-13");
confere("quarta 1h da manhã: ainda fecha terça", diaQueAContagemFecha(new Date("2026-10-14T04:00:00Z"), "America/Sao_Paulo", HORAS), "2026-10-13");

// ── A janela do DRE: só entre contagens COMPLETAS, dentro do período ───────
const CF = (dia: string, tipo: string, valorTotal = 1000): ContagemFechada => ({ id: dia, dia, tipo, valorTotal });
const CONTAGENS_DO_HAKIM = [CF("2026-10-05", "COMPLETA"), CF("2026-10-10", "RAPIDA"), CF("2026-10-12", "COMPLETA"), CF("2026-10-15", "RAPIDA"), CF("2026-10-19", "COMPLETA")];
const jc = (de: string, ate: string) => {
  const j = janelaCompletaDoPeriodo(CONTAGENS_DO_HAKIM, de, ate);
  return [j.abertura?.dia ?? null, j.fechamento?.dia ?? null, j.falta];
};
confere("semana do CMV (terça 13 a segunda 19): abre na completa da véspera e fecha na do dia 19", jc("2026-10-13", "2026-10-19"), ["2026-10-12", "2026-10-19", null]);
confere("período que termina numa rápida: a rápida não fecha o R$ do DRE", jc("2026-10-13", "2026-10-18"), ["2026-10-12", null, "SO_UMA_CONTAGEM"]);
confere("sem completa na véspera: abre na primeira completa dentro do período", jc("2026-10-10", "2026-10-19"), ["2026-10-12", "2026-10-19", null]);
confere("a completa de dias antes da véspera não abre o período (o R$ levaria dias de fora)", jc("2026-10-14", "2026-10-19"), ["2026-10-19", null, "SO_UMA_CONTAGEM"]);
confere("duas semanas: da completa da véspera à última", jc("2026-10-06", "2026-10-19"), ["2026-10-05", "2026-10-19", null]);
confere("a completa do dia 19 abre a semana seguinte; falta a próxima", jc("2026-10-20", "2026-10-26"), ["2026-10-19", null, "SO_UMA_CONTAGEM"]);
confere("nenhuma completa no período", jc("2026-10-01", "2026-10-03"), [null, null, "NENHUMA_CONTAGEM"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
