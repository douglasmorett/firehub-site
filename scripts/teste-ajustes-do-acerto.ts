/**
 * Teste dos ajustes à mão no acerto do motoboy (lib/ajustes-do-acerto-regras.ts):
 * a diária mudada num dia, a pendência descontada e a opção "cartão e voucher
 * num quadrado só" — e o relatório Acerto de entregadores somando os dois
 * primeiros. Rodar:
 * npx tsx scripts/teste-ajustes-do-acerto.ts
 */
import {
  diariasDoPeriodo, somaDasDiarias, totalDasPendencias, totaisDoAcertoDoMotoboy, validarPendencia, validarDiariaDoDia,
  lerValorEmReais, lerOpcoesDoAcerto, quadradoDaCaixa, diaNoPeriodo,
} from "../src/lib/ajustes-do-acerto-regras";
import { diaDoExpediente, resumoDasEntregas } from "../src/lib/resumo-do-entregador";
import { acertoDaEquipe, type MotoboyDoAcerto } from "../src/lib/relatorios/acerto-de-entregadores";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const tz = "America/Sao_Paulo";

// ── O valor que o lojista digita ────────────────────────────────────────────
confere("50,00", lerValorEmReais("50,00"), 50);
confere("R$ 1.250,90", lerValorEmReais("R$ 1.250,90"), 1250.9);
confere("50.5 (ponto decimal)", lerValorEmReais("50.5"), 50.5);
confere("número", lerValorEmReais(32.456), 32.46);
confere("zero vale (dia sem diária)", lerValorEmReais("0"), 0);
confere("negativo não", lerValorEmReais("-5"), null);
confere("texto não", lerValorEmReais("cinquenta"), null);
confere("vazio não", lerValorEmReais(""), null);

// ── O dia do expediente (vira às 5h, fuso da loja) ──────────────────────────
// 16/10 01:30 em Brasília = 04:30 UTC → ainda é o expediente do dia 15.
confere("1h30 da madrugada é do dia anterior", diaDoExpediente("2026-10-16T04:30:00Z", tz), "2026-10-15");
confere("5h já é o dia novo", diaDoExpediente("2026-10-16T08:00:00Z", tz), "2026-10-16");

// ── Diária por dia ──────────────────────────────────────────────────────────
// Jobson, diária de R$ 40: trabalhou 13, 14 e 15/10; a loja pagou R$ 20 no dia
// 14 (meio turno). O ajuste do dia 20 (sem entrega no período) não entra.
const ajustes = new Map([["2026-10-14", { valor: 20, criadoPor: "Fellipe" }], ["2026-10-20", { valor: 60 }]]);
const diarias = diariasDoPeriodo(["2026-10-15", "2026-10-13", "2026-10-14", "2026-10-13"], 40, ajustes);
confere("um por dia, em ordem", diarias.map((d) => d.dia), ["2026-10-13", "2026-10-14", "2026-10-15"]);
confere("dia ajustado vale o ajuste", diarias[1], { dia: "2026-10-14", valor: 20, padrao: 40, ajustada: true, ajustadaPor: "Fellipe" });
confere("dia sem ajuste vale o cadastro", diarias[0], { dia: "2026-10-13", valor: 40, padrao: 40, ajustada: false });
confere("soma das diárias: 40 + 20 + 40", somaDasDiarias(diarias), 100);
confere("sem ajuste nenhum: diária × dias", somaDasDiarias(diariasDoPeriodo(["2026-10-13", "2026-10-14"], 40, null)), 80);
// Tipo sem diária (por entrega): o cadastro dá 0, mas o dia ajustado conta.
confere("tipo sem diária com um dia ajustado", somaDasDiarias(diariasDoPeriodo(["2026-10-14"], 0, ajustes)), 20);

// resumoDasEntregas devolve os dias que pagam diária (só corridas).
const resumo = resumoDasEntregas([
  { createdAt: "2026-10-13T23:00:00Z", status: "ENTREGUE", totalAmount: 50, ganho: 5 },
  { createdAt: "2026-10-14T04:00:00Z", status: "ENTREGUE", totalAmount: 30, ganho: 5 }, // 01h do dia 14 = expediente do 13
  { createdAt: "2026-10-14T22:00:00Z", status: "CANCELADO", totalAmount: 30, ganho: 0 }, // cancelado sem sair: sem dia
], tz);
confere("dias trabalhados do resumo", resumo.diasTrabalhados, ["2026-10-13"]);

// ── Pendência ───────────────────────────────────────────────────────────────
confere("pendência sem motivo é recusada", validarPendencia({ valor: "50,00", motivo: " ", dia: "2026-10-15" }).ok, false);
confere("pendência de zero é recusada", validarPendencia({ valor: "0", motivo: "faltou", dia: "2026-10-15" }).ok, false);
confere("pendência sem data é recusada", validarPendencia({ valor: "50", motivo: "faltou", dia: "15/10" }).ok, false);
confere("pendência certa", validarPendencia({ valor: "50,00", motivo: "  Faltou   no dinheiro ", dia: "2026-10-15" }),
  { ok: true, valor: 50, motivo: "Faltou no dinheiro", dia: "2026-10-15" });
confere("diária do dia aceita zero", validarDiariaDoDia({ valor: "0,00", dia: "2026-10-15" }), { ok: true, valor: 0, dia: "2026-10-15" });
confere("total das pendências", totalDasPendencias([{ valor: 50 }, { valor: 12.35 }]), 62.35);
confere("pendência do dia 15 entra no mês", diaNoPeriodo("2026-10-15", "2026-10-01", "2026-10-31"), true);
confere("pendência do dia 15 fica fora da semana seguinte", diaNoPeriodo("2026-10-15", "2026-10-18", "2026-10-24"), false);

// A conta do A PAGAR: diárias 100 + entregas 75 − lanche 3 − pendência 50.
confere("a pagar com pendência", totaisDoAcertoDoMotoboy({ diarias: 100, entregas: 75, lanche: 3, pendencias: 50 }), { totalWithDaily: 122, totalFeeOnly: 22 });
confere("só taxa também desconta (pode ficar negativo)", totaisDoAcertoDoMotoboy({ diarias: 40, entregas: 10, lanche: 0, pendencias: 30 }).totalFeeOnly, -20);

// ── Cartão e voucher num quadrado só ────────────────────────────────────────
confere("opção desligada por padrão", lerOpcoesDoAcerto({ freeShippingActive: true }), { juntarCartaoEVale: false });
confere("opção ligada", lerOpcoesDoAcerto({ acertoDoMotoboy: { juntarCartaoEVale: true } }), { juntarCartaoEVale: true });
confere("config estranha = desligada", lerOpcoesDoAcerto({ acertoDoMotoboy: { juntarCartaoEVale: "sim" } }), { juntarCartaoEVale: false });
confere("ligada: débito, crédito e vale viram CARTAO", (["DEBITO", "CREDITO", "VALE"] as const).map((c) => quadradoDaCaixa(c, true)), ["CARTAO", "CARTAO", "CARTAO"]);
confere("ligada: dinheiro e pix continuam", [quadradoDaCaixa("DINHEIRO", true), quadradoDaCaixa("PIX", true)], ["DINHEIRO", "PIX"]);
confere("desligada: cada um no seu", quadradoDaCaixa("CREDITO", false), "CREDITO");

// ── O Acerto de entregadores soma o que vem pronto ──────────────────────────
const stats = (s: Partial<MotoboyDoAcerto["stats"]>): MotoboyDoAcerto["stats"] => ({
  totalDeliveries: 0, entreguesCount: 0, emAndamentoCount: 0, canceladasComCorridaCount: 0, canceladasSemCorridaCount: 0,
  valorDosPedidos: 0, totalDistance: 0, uniqueDays: 0, cashCollectedSum: 0, changeGivenSum: 0, cardPosTotal: 0, pixTotal: 0,
  onlineTotal: 0, fiadoTotal: 0, naoIdentificadoTotal: 0, naoIdentificadoCount: 0, dailyTotal: 0, feeTotal: 0, totalWithDaily: 0,
  lancheDescontado: 0, ...s,
});
const jobson: MotoboyDoAcerto = {
  motoboy: { id: "j", name: "Jobson", paymentType: "BOTH", dailyRate: 40, active: true },
  stats: stats({
    totalDeliveries: 2, entreguesCount: 2, uniqueDays: 2, dailyTotal: 60, feeTotal: 10, totalWithDaily: 20, pendenciasDescontadas: 50,
    cashCollectedSum: 0, valorDosPedidos: 80,
    diarias: [{ dia: "2026-10-13", valor: 40, padrao: 40, ajustada: false }, { dia: "2026-10-14", valor: 20, padrao: 40, ajustada: true }],
  }),
  pendencias: [{ id: "p1", dia: "2026-10-14", valor: 50, motivo: "Faltou R$ 50 no dinheiro", criadoPor: "Fellipe" }],
  orders: [
    { id: "1", createdAt: "2026-10-13T23:00:00Z", ganhoDoMotoboy: 5, corrida: true },
    { id: "2", createdAt: "2026-10-14T23:00:00Z", ganhoDoMotoboy: 5, corrida: true },
  ],
};
const r = acertoDaEquipe([{ loja: "Delícia de Casa", report: [jobson] }], tz);
confere("a pagar é o da tela Motoboys (já com a pendência)", r.linhas[0].aPagar, 20);
confere("pendência na linha", r.linhas[0].pendencias, 50);
confere("pendência com o motivo (recibo)", r.linhas[0].listaDePendencias, [{ dia: "2026-10-14", valor: 50, motivo: "Faltou R$ 50 no dinheiro", criadoPor: "Fellipe" }]);
confere("dias ajustados (recibo)", r.linhas[0].diariasAjustadas, [{ dia: "2026-10-14", valor: 20, padrao: 40 }]);
confere("total da equipe: pendências", r.total.pendencias, 50);
// O custo do dia usa a diária DAQUELE dia: 13/10 = 5 + 40; 14/10 = 5 + 20.
confere("custo de cada dia com a diária do dia", r.dias.map((d) => [d.dia, d.custo]), [["2026-10-13", 45], ["2026-10-14", 25]]);
confere("aviso da pendência", r.avisos.some((a) => a.texto.includes("pendência")), true);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
