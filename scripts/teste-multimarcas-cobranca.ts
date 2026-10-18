/**
 * A conta do Multimarcas no boleto (lib/multimarcas/assinatura.ts → valorDoMultimarcasNoMes).
 * Regra do termo (lib/multimarcas/termo.ts): R$ 97 à parte da mensalidade; 7 dias grátis só na 1ª ativação;
 * depois, ativo em algum momento do mês = o mês inteiro, uma vez só; desativou, o mês seguinte não é cobrado.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-multimarcas-cobranca.ts
 */
import assert from "node:assert/strict";
import { valorDoMultimarcasNoMes as valor, PRECO_DO_MULTIMARCAS, DIAS_DE_TESTE_DO_MULTIMARCAS, type TrechoDoMultimarcas } from "../src/lib/multimarcas/assinatura";
import { CLAUSULAS_DO_TERMO_DO_MULTIMARCAS } from "../src/lib/multimarcas/termo";

const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
const fim = new Date("2026-12-01T03:00:00Z");
const agora = new Date("2026-12-05T12:00:00Z");
const d = (s: string) => new Date(s).toISOString();
const t = (de: string, ate: string | null, v = PRECO_DO_MULTIMARCAS): TrechoDoMultimarcas => ({ de: d(de), ate: ate ? d(ate) : null, valor: v });

assert.equal(PRECO_DO_MULTIMARCAS, 97);
assert.equal(DIAS_DE_TESTE_DO_MULTIMARCAS, 7);

// Ativo o mês inteiro: R$ 97.
assert.equal(valor([t("2026-10-01T12:00:00Z", null)], null, ini, fim, agora), 97);
// Ativou no dia 29: mês inteiro, sem proporção.
assert.equal(valor([t("2026-11-29T15:00:00Z", null)], null, ini, fim, agora), 97);
// Ativou e desativou duas vezes no mesmo dia: uma vez só.
assert.equal(valor([t("2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z"), t("2026-11-10T15:00:00Z", "2026-11-10T15:30:00Z")], null, ini, fim, agora), 97);
// Desativou em outubro: novembro não é cobrado.
assert.equal(valor([t("2026-10-01T12:00:00Z", "2026-10-20T12:00:00Z")], null, ini, fim, agora), 0);
// Desativou no último instante de outubro (1º/11 02h59 UTC = 31/10 23h59 em Brasília): novembro zero.
assert.equal(valor([t("2026-10-01T12:00:00Z", "2026-11-01T02:59:00Z")], null, ini, fim, agora), 0);
// Ativou em dezembro: novembro zero.
assert.equal(valor([t("2026-12-02T12:00:00Z", null)], null, ini, fim, agora), 0);

// Dias grátis: ativou 25/11, grátis até 02/12 — novembro não é cobrado.
assert.equal(valor([t("2026-11-25T12:00:00Z", null)], "2026-12-02T12:00:00Z", ini, fim, agora), 0);
// Grátis até 05/11 e continuou ativo: novembro cobrado.
assert.equal(valor([t("2026-10-29T12:00:00Z", null)], "2026-11-05T12:00:00Z", ini, fim, agora), 97);
// Desativou ainda no período grátis: nada.
assert.equal(valor([t("2026-11-01T12:00:00Z", "2026-11-04T12:00:00Z")], "2026-11-08T12:00:00Z", ini, fim, agora), 0);

// Reajuste futuro: quem ativou a R$ 97 segue a R$ 97; dois valores no mesmo mês, vale o maior.
assert.equal(valor([t("2026-10-01T12:00:00Z", null, 97)], null, ini, fim, agora), 97);
assert.equal(valor([t("2026-11-02T12:00:00Z", "2026-11-03T12:00:00Z", 97), t("2026-11-10T12:00:00Z", null, 127)], null, ini, fim, agora), 127);

// O termo diz com todas as letras que é à parte da mensalidade.
assert.ok(CLAUSULAS_DO_TERMO_DO_MULTIMARCAS.some((c) => /À PARTE/.test(c) && /mensalidade/.test(c)));

console.log("✅ teste-multimarcas-cobranca: tudo certo");
