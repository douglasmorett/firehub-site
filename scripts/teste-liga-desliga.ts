/**
 * Liga e desliga dos módulos pagos (lib/modulo-pago.ts) e a cobrança junto (Multimarcas e Bill).
 * Regra (Douglas, 18/10/2026): no teste grátis, desligar para na hora e não cobra; depois do teste, o mês
 * já está pago — fica liberado até o fim do mês e desliga sozinho na virada; sem proporcional.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-liga-desliga.ts
 */
import assert from "node:assert/strict";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "../src/lib/modulo-pago";
import { valorDoMultimarcasNoMes, type TrechoDoMultimarcas } from "../src/lib/multimarcas/assinatura";
import { valorDoAssessorNoMes } from "../src/lib/assessor/assinatura";
import { VERSAO_DO_TERMO_DO_BILL, CLAUSULAS_DO_TERMO_DO_BILL } from "../src/lib/assessor/termo";
import { CLAUSULAS_DO_TERMO_DO_MULTIMARCAS } from "../src/lib/multimarcas/termo";

let casos = 0;
const ok = (f: () => void) => { f(); casos++; };
const d = (s: string) => new Date(s);
// Outubro de 2026 em Brasília: [01/10 03:00Z, 01/11 03:00Z).
const out = { ini: d("2026-10-01T03:00:00Z"), fim: d("2026-11-01T03:00:00Z") };
const nov = { ini: d("2026-11-01T03:00:00Z"), fim: d("2026-12-01T03:00:00Z") };
const agora = d("2026-10-18T15:00:00Z");

// ─── ligado agora ───
ok(() => assert.equal(ligadoAgora([{ de: "2026-10-01T12:00:00Z", ate: null }], agora), true));
ok(() => assert.equal(ligadoAgora([{ de: "2026-10-01T12:00:00Z", ate: "2026-10-10T12:00:00Z" }], agora), false));
// Desligamento marcado para a virada: ainda ligado hoje, desligado depois da virada.
const marcado = [{ de: "2026-10-01T12:00:00Z", ate: "2026-11-01T03:00:00Z" }];
ok(() => assert.equal(ligadoAgora(marcado, agora), true));
ok(() => assert.equal(ligadoAgora(marcado, d("2026-10-31T23:00:00Z")), true));
ok(() => assert.equal(ligadoAgora(marcado, d("2026-11-01T03:00:00Z")), false));
ok(() => assert.equal(desligamentoMarcado(marcado, agora), "2026-11-01T03:00:00Z"));
ok(() => assert.equal(desligamentoMarcado([{ de: "2026-10-01T12:00:00Z", ate: null }], agora), null));
ok(() => assert.equal(desligamentoMarcado(marcado, d("2026-11-02T00:00:00Z")), null));
ok(() => assert.equal(ligadoAgora([], agora), false));

// ─── quando desliga ───
// No teste (até 22/10): na hora.
ok(() => assert.deepEqual(quandoDesliga("2026-10-22T12:00:00Z", out.fim, agora), { naHora: true, ate: agora }));
// Teste acabou (ou nunca teve teste nesta ativação): na virada do mês.
ok(() => assert.deepEqual(quandoDesliga("2026-10-08T12:00:00Z", out.fim, agora), { naHora: false, ate: out.fim }));
ok(() => assert.deepEqual(quandoDesliga(null, out.fim, agora), { naHora: false, ate: out.fim }));

// ─── cobrança junto ───
const t = (de: string, ate: string | null): TrechoDoMultimarcas => ({ de, ate, valor: 97 });
// Depois do teste, desligou com a virada marcada: outubro cobra inteiro, novembro nada.
ok(() => assert.equal(valorDoMultimarcasNoMes([t("2026-10-01T12:00:00Z", out.fim.toISOString())], "2026-10-08T12:00:00Z", out.ini, out.fim, agora), 97));
ok(() => assert.equal(valorDoMultimarcasNoMes([t("2026-10-01T12:00:00Z", out.fim.toISOString())], "2026-10-08T12:00:00Z", nov.ini, nov.fim, d("2026-11-05T12:00:00Z")), 0));
// No teste, desligou na hora: nada em outubro.
ok(() => assert.equal(valorDoMultimarcasNoMes([t("2026-10-15T12:00:00Z", agora.toISOString())], "2026-10-22T12:00:00Z", out.ini, out.fim, agora), 0));
// Já usou o teste e ligou de novo: o mês corrente entra inteiro.
ok(() => assert.equal(valorDoMultimarcasNoMes([t("2026-09-01T12:00:00Z", "2026-09-05T12:00:00Z"), t(agora.toISOString(), null)], "2026-09-08T12:00:00Z", out.ini, out.fim, agora), 97));
// O mesmo para o Bill.
const aceite = { versao: VERSAO_DO_TERMO_DO_BILL, em: "", email: null, ip: null, userAgent: null };
ok(() => assert.equal(valorDoAssessorNoMes([{ de: "2026-10-01T12:00:00Z", ate: out.fim.toISOString(), aceite }], "2026-10-08T12:00:00Z", out.ini, out.fim, agora), 49.9));
ok(() => assert.equal(valorDoAssessorNoMes([{ de: "2026-10-01T12:00:00Z", ate: out.fim.toISOString(), aceite }], "2026-10-08T12:00:00Z", nov.ini, nov.fim, d("2026-11-05T12:00:00Z")), 0));
// A versão nova do termo continua a R$ 49,90.
ok(() => assert.ok(VERSAO_DO_TERMO_DO_BILL >= "2026-10-17"));

// ─── os termos dizem a regra ───
for (const clausulas of [CLAUSULAS_DO_TERMO_DO_BILL, CLAUSULAS_DO_TERMO_DO_MULTIMARCAS]) {
  ok(() => assert.ok(clausulas.some((c) => /durante os 7 dias grátis/.test(c) && /na hora/.test(c) && /virada/.test(c) && /proporcional/.test(c))));
  ok(() => assert.ok(clausulas.some((c) => /já usou o teste/.test(c) && /cobrado inteiro/.test(c))));
}

console.log(`✅ teste-liga-desliga: ${casos} casos ok`);
