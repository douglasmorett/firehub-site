/**
 * A conta do Bill, seu assessor, no boleto (lib/assessor/assinatura.ts → valorDoAssessorNoMes).
 * Regra do termo (lib/assessor/termo.ts): 7 dias grátis só na 1ª ativação; depois, ativo em algum momento do mês = R$ 29,90 do mês
 * inteiro, uma vez só; desligou, o mês seguinte não é cobrado.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-assessor-cobranca.ts
 */
import assert from "node:assert/strict";
import { valorDoAssessorNoMes, PRECO_DO_ASSESSOR } from "../src/lib/assessor/assinatura";

const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
const fim = new Date("2026-12-01T03:00:00Z");
const agora = new Date("2026-12-05T12:00:00Z");
const d = (s: string) => new Date(s).toISOString();

// Ligado o mês inteiro: R$ 29,90.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-01T12:00:00Z"), ate: null }], null, ini, fim, agora), PRECO_DO_ASSESSOR);
// Ligou no dia 29: mês inteiro, sem proporção.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-11-29T15:00:00Z"), ate: null }], null, ini, fim, agora), PRECO_DO_ASSESSOR);
// Ligou e desligou no mesmo dia, duas vezes: cobra uma vez só, o mês inteiro.
assert.equal(valorDoAssessorNoMes([
  { de: d("2026-11-10T13:00:00Z"), ate: d("2026-11-10T14:00:00Z") },
  { de: d("2026-11-10T15:00:00Z"), ate: d("2026-11-10T15:30:00Z") },
], null, ini, fim, agora), PRECO_DO_ASSESSOR);
// Desligou em outubro: novembro não é cobrado.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-01T12:00:00Z"), ate: d("2026-10-20T12:00:00Z") }], null, ini, fim, agora), 0);
// Ligado até o último instante de outubro (desligou 1º/11 02h59 Brasília = ainda outubro): novembro zero.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-01T12:00:00Z"), ate: d("2026-11-01T02:59:00Z") }], null, ini, fim, agora), 0);
// Desligou em 1º/11 às 10h: novembro cobrado (ficou ativo em novembro).
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-01T12:00:00Z"), ate: d("2026-11-01T13:00:00Z") }], null, ini, fim, agora), PRECO_DO_ASSESSOR);
// Ligou em dezembro: novembro zero.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-12-02T12:00:00Z"), ate: null }], null, ini, fim, agora), 0);
// Fechamento do mês corrido (cron do dia 1º, ainda ligado): cobra.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-11-15T12:00:00Z"), ate: null }], null, ini, fim, new Date("2026-12-01T06:00:00Z")), PRECO_DO_ASSESSOR);
// Nunca ligado: zero.
assert.equal(valorDoAssessorNoMes([], null, ini, fim, agora), 0);
// ── 7 dias grátis só na primeira ativação ──
// Ligou 28/10, teste até 04/11: outubro inteiro dentro do teste = zero.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-28T15:00:00Z"), ate: null }], d("2026-11-04T15:00:00Z"),
  new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"), agora), 0);
// ...e novembro (ativo depois do dia 4) é cobrado inteiro.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-28T15:00:00Z"), ate: null }], d("2026-11-04T15:00:00Z"), ini, fim, agora), PRECO_DO_ASSESSOR);
// Testou 3 dias e desligou dentro do teste: nada.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-11-02T12:00:00Z"), ate: d("2026-11-05T12:00:00Z") }], d("2026-11-09T12:00:00Z"), ini, fim, agora), 0);
// Saiu no teste e voltou depois que ele venceu (não ganha outro): cobra o mês.
assert.equal(valorDoAssessorNoMes([
  { de: d("2026-11-02T12:00:00Z"), ate: d("2026-11-05T12:00:00Z") },
  { de: d("2026-11-20T12:00:00Z"), ate: null },
], d("2026-11-09T12:00:00Z"), ini, fim, agora), PRECO_DO_ASSESSOR);
console.log("✅ cobrança do Bill: 13 casos ok");
