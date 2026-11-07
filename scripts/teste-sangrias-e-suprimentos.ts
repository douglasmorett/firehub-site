/**
 * Trava SANGRIAS, RETIRADAS E SUPRIMENTOS DO PERÍODO
 * (lib/relatorios/sangrias-e-suprimentos.ts): o tipo (o que não é ENTRADA é
 * retirada, como no esperado do fechamento), o total por tipo, por quem lançou,
 * por motivo (sem diferença de maiúscula e espaço; vazio = "(sem motivo)") e
 * por dia operacional (vira às 5h).
 *
 *   npx tsx scripts/teste-sangrias-e-suprimentos.ts
 */
import { sangriasESuprimentos, type MovimentoParaRelatorio } from "../src/lib/relatorios/sangrias-e-suprimentos";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

let seq = 0;
const m = (x: Partial<MovimentoParaRelatorio> & { tipo: string; valor: number; em: string }): MovimentoParaRelatorio => ({
  id: `m${++seq}`, descricao: null, quem: "Ana", caixaId: "c1", operadorDoCaixa: "Ana", depoisDoFechamento: false, ...x,
});

const r = sangriasESuprimentos([
  m({ tipo: "ENTRADA", valor: 100, em: "2026-11-02T21:00:00Z", descricao: "Troco" }),
  m({ tipo: "SAIDA", valor: 200, em: "2026-11-02T23:00:00Z", descricao: "Cofre" }),
  m({ tipo: "SAIDA", valor: 50, em: "2026-11-03T04:30:00Z", descricao: "  cofre ", quem: "Bruno" }), // 01h30 de 03/11 = expediente de 02/11
  m({ tipo: "SANGRIA", valor: 30, em: "2026-11-03T20:00:00Z", quem: null }), // tipo desconhecido = retirada; sem quem; sem motivo
], "America/Sao_Paulo");

confere("total: 1 suprimento de 100; 3 retiradas, 280; saldo −180", r.total, { suprimentos: { quantidade: 1, valor: 100 }, retiradas: { quantidade: 3, valor: 280 }, saldo: -180 });
confere("por motivo: 'Cofre' e '  cofre ' juntos; vazio vira (sem motivo)", r.porMotivo.map((x) => [x.motivo, x.tipo, x.quantidade, x.valor]), [
  ["Cofre", "SAIDA", 2, 250], ["Troco", "ENTRADA", 1, 100], ["(sem motivo)", "SAIDA", 1, 30],
]);
confere("por quem: maior retirada primeiro; sem quem = Não identificado", r.porQuem.map((x) => [x.quem, x.retiradas.valor, x.suprimentos.valor]), [
  ["Ana", 200, 100], ["Bruno", 50, 0], ["Não identificado", 30, 0],
]);
confere("por dia: a de 01h30 é do dia 02", r.porDia.map((x) => [x.dia, x.suprimentos.valor, x.retiradas.valor]), [["2026-11-03", 0, 30], ["2026-11-02", 100, 250]]);
confere("lista do mais recente, com a hora da loja", r.lista.map((x) => [x.dia, x.hora, x.tipo]), [
  ["2026-11-03", "17:00", "SAIDA"], ["2026-11-02", "01:30", "SAIDA"], ["2026-11-02", "20:00", "SAIDA"], ["2026-11-02", "18:00", "ENTRADA"],
]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
