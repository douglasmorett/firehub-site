/**
 * A conta do aplicativo próprio da loja no boleto (lib/app-da-loja/plano.ts → valorDoAppNoMes).
 * Regra: ativado pelo admin; ligado em qualquer momento do mês = o mês inteiro, uma vez só;
 * trocou de plano no mês = o maior; desligou = o mês seguinte zera.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-app-da-loja-cobranca.ts
 */
import assert from "node:assert/strict";
import { valorDoAppNoMes, PRECOS_DO_APP, type TrechoDoApp } from "../src/lib/app-da-loja/plano";

const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
const fim = new Date("2026-12-01T03:00:00Z");
const agora = new Date("2026-12-05T12:00:00Z");
const d = (s: string) => new Date(s).toISOString();
const t = (de: string, ate: string | null, p: TrechoDoApp["plataformas"], valor: number = PRECOS_DO_APP[p]): TrechoDoApp => ({ de: d(de), ate: ate ? d(ate) : null, plataformas: p, valor });

assert.deepEqual(PRECOS_DO_APP, { android: 149, apple: 149, ambos: 197 });
// Ligado o mês inteiro, os dois: R$ 197.
assert.equal(valorDoAppNoMes([t("2026-10-10T12:00:00Z", null, "ambos")], ini, fim, agora), 197);
// Ativado no dia 28: o mês inteiro, sem proporção.
assert.equal(valorDoAppNoMes([t("2026-11-28T15:00:00Z", null, "android")], ini, fim, agora), 149);
// Desligado em outubro: novembro zero.
assert.equal(valorDoAppNoMes([t("2026-10-01T12:00:00Z", "2026-10-20T12:00:00Z", "apple")], ini, fim, agora), 0);
// Desligado no último instante de outubro (1º/11 02h59 UTC = ainda outubro em Brasília): novembro zero.
assert.equal(valorDoAppNoMes([t("2026-10-01T12:00:00Z", "2026-11-01T02:59:00Z", "apple")], ini, fim, agora), 0);
// Desligado em 1º/11 às 10h: novembro cobrado.
assert.equal(valorDoAppNoMes([t("2026-10-01T12:00:00Z", "2026-11-01T13:00:00Z", "apple")], ini, fim, agora), 149);
// Trocou de Android para os dois no meio do mês: vale o maior, uma vez.
assert.equal(valorDoAppNoMes([
  t("2026-10-01T12:00:00Z", "2026-11-15T12:00:00Z", "android"),
  t("2026-11-15T12:00:00Z", null, "ambos"),
], ini, fim, agora), 197);
// Valor gravado no trecho vale (reajuste futuro não muda o combinado).
assert.equal(valorDoAppNoMes([t("2026-10-01T12:00:00Z", null, "ambos", 180)], ini, fim, agora), 180);
// Ativado só em dezembro: novembro zero.
assert.equal(valorDoAppNoMes([t("2026-12-02T12:00:00Z", null, "ambos")], ini, fim, agora), 0);
// Fechamento no dia 1º, ainda ligado: cobra.
assert.equal(valorDoAppNoMes([t("2026-11-15T12:00:00Z", null, "ambos")], ini, fim, new Date("2026-12-01T06:00:00Z")), 197);
// Nunca ativado: zero.
assert.equal(valorDoAppNoMes([], ini, fim, agora), 0);
console.log("✅ cobrança do aplicativo da loja: 11 casos ok");
