/**
 * A conta do Bill, seu assessor, no boleto (lib/assessor/assinatura.ts → valorDoAssessorNoMes).
 * Regra do termo (lib/assessor/termo.ts): 7 dias grátis só na 1ª ativação; depois, ativo em algum momento do mês = R$ 49,90 do mês
 * inteiro (R$ 29,90 para o trecho ligado com o termo de 14/10), uma vez só; desligou, o mês seguinte não é cobrado.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-assessor-cobranca.ts
 */
import assert from "node:assert/strict";
import { valorDoAssessorNoMes as valorBruto, PRECO_DO_ASSESSOR, PRECO_ANTIGO_DO_ASSESSOR, type Periodo } from "../src/lib/assessor/assinatura";
import { VERSAO_DO_TERMO_DO_BILL } from "../src/lib/assessor/termo";

const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
const fim = new Date("2026-12-01T03:00:00Z");
const agora = new Date("2026-12-05T12:00:00Z");
const d = (s: string) => new Date(s).toISOString();
const aceite = (versao: string) => ({ versao, em: "", email: null, ip: null, userAgent: null });
// Os casos de sempre, com o termo em vigor: cada trecho ganha o aceite da versão atual.
const valorDoAssessorNoMes = (ps: Periodo[], ...resto: [any, Date, Date, Date?]) =>
  valorBruto(ps.map((p) => ({ ...p, aceite: aceite(VERSAO_DO_TERMO_DO_BILL) })), ...resto);

assert.equal(PRECO_DO_ASSESSOR, 49.9);

// Ligado o mês inteiro: R$ 49,90.
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
// ── Termo de 14/10 (R$ 29,90): segue 29,90 enquanto o trecho ficar ligado ──
assert.equal(valorBruto([{ de: d("2026-10-15T12:00:00Z"), ate: null, aceite: aceite("2026-10-14b") }], d("2026-10-22T12:00:00Z"), ini, fim, agora), PRECO_ANTIGO_DO_ASSESSOR);
// Trecho sem aceite gravado (anterior ao termo): 29,90.
assert.equal(valorBruto([{ de: d("2026-10-01T12:00:00Z"), ate: null }], null, ini, fim, agora), PRECO_ANTIGO_DO_ASSESSOR);
// Desligou o de 29,90 e religou no mesmo mês com o termo novo: o mês sai a 49,90, uma vez só.
assert.equal(valorBruto([
  { de: d("2026-10-15T12:00:00Z"), ate: d("2026-11-10T12:00:00Z"), aceite: aceite("2026-10-14b") },
  { de: d("2026-11-10T13:00:00Z"), ate: null, aceite: aceite("2026-10-17") },
], d("2026-10-22T12:00:00Z"), ini, fim, agora), PRECO_DO_ASSESSOR);
// ...e o mês em que só o de 29,90 esteve ligado continua 29,90.
assert.equal(valorBruto([
  { de: d("2026-10-15T12:00:00Z"), ate: d("2026-10-30T12:00:00Z"), aceite: aceite("2026-10-14b") },
  { de: d("2026-11-10T13:00:00Z"), ate: null, aceite: aceite("2026-10-17") },
], d("2026-10-22T12:00:00Z"), new Date("2026-10-01T03:00:00Z"), ini, agora), PRECO_ANTIGO_DO_ASSESSOR);
console.log("✅ cobrança do Bill: 17 casos ok");
