/**
 * A conta do Meu Assessor no boleto (lib/assessor/assinatura.ts → valorDoAssessorNoMes).
 * Roda sem banco: npx tsx scripts/teste-assessor-cobranca.ts
 */
import assert from "node:assert/strict";
import { valorDoAssessorNoMes } from "../src/lib/assessor/assinatura";

const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
const fim = new Date("2026-12-01T03:00:00Z"); // novembro: 30 dias
const agora = new Date("2026-12-05T12:00:00Z");
const d = (s: string) => new Date(s).toISOString();

// Ligado o mês inteiro, teste já acabou: R$ 29,90.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-01T12:00:00Z"), ate: null }], "2026-10-08T12:00:00Z", ini, fim, agora), 29.9);
// Ligou em 14/10, teste até 21/10: outubro cobra só depois do dia 21 (10 dias de 31 → 9,65).
const out = valorDoAssessorNoMes([{ de: d("2026-10-14T15:00:00Z"), ate: null }], "2026-10-21T15:00:00Z",
  new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"), agora);
assert.equal(out, Math.round((29.9 * 11 / 31) * 100) / 100, `outubro deu ${out}`);
// Teste cobre o mês inteiro: zero.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-11-01T12:00:00Z"), ate: null }], "2026-12-10T00:00:00Z", ini, fim, agora), 0);
// Desligado no dia 10 (9 dias ligado): 9/30.
assert.equal(valorDoAssessorNoMes([{ de: d("2026-10-01T12:00:00Z"), ate: d("2026-11-10T03:00:00Z") }], "2026-10-08T00:00:00Z", ini, fim, agora), 8.97);
// Liga-desliga duas vezes no mesmo mês: soma os trechos, nunca passa do preço.
assert.equal(valorDoAssessorNoMes([
  { de: d("2026-10-01T12:00:00Z"), ate: d("2026-11-20T03:00:00Z") },
  { de: d("2026-11-20T04:00:00Z"), ate: null },
], "2026-10-08T00:00:00Z", ini, fim, agora), 29.9);
// Nunca ligado: zero.
assert.equal(valorDoAssessorNoMes([], null, ini, fim, agora), 0);
console.log("✅ cobrança do Meu Assessor: 6 casos ok");
