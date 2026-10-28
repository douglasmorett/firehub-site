/**
 * A conta do FireCheck no boleto (lib/firecheck-modulos/assinatura.ts → valorDoFirecheckNoMes).
 * Regra do termo (lib/firecheck-modulos/termo.ts): R$ 149 por módulo, os dois R$ 197; 7 dias grátis
 * na 1ª ativação de cada módulo; ligado em algum momento do mês fora do teste = o mês inteiro.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-firecheck-cobranca.ts
 */
import assert from "node:assert/strict";
import { valorDoFirecheckNoMes as conta, lerTrechos, lerTestes, type TrechoDoFirecheck, type ModuloDoFirecheck } from "../src/lib/firecheck-modulos/assinatura";
import { PRECO_DO_COMBO, PRECO_POR_MODULO, DIAS_DE_TESTE_DO_FIRECHECK } from "../src/lib/firecheck-modulos/preco";
import { CLAUSULAS_DO_TERMO_DO_FIRECHECK } from "../src/lib/firecheck-modulos/termo";

const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
const fim = new Date("2026-12-01T03:00:00Z");
const agora = new Date("2026-12-05T12:00:00Z");
const d = (s: string) => new Date(s).toISOString();
const t = (modulo: ModuloDoFirecheck, de: string, ate: string | null, v = 149): TrechoDoFirecheck => ({ modulo, de: d(de), ate: ate ? d(ate) : null, valor: v });
const valor = (trechos: TrechoDoFirecheck[], testes = {}) => conta(trechos, testes, ini, fim, agora).valor;

assert.deepEqual(PRECO_POR_MODULO, { checklists: 149, ponto: 149 });
assert.equal(PRECO_DO_COMBO, 197);
assert.equal(DIAS_DE_TESTE_DO_FIRECHECK, 7);

// Um módulo ligado o mês todo: R$ 149.
assert.equal(valor([t("checklists", "2026-10-01T12:00:00Z", null)]), 149);
assert.equal(valor([t("ponto", "2026-10-01T12:00:00Z", null)]), 149);
// Os dois ligados: o combo, não 298.
assert.equal(valor([t("checklists", "2026-10-01T12:00:00Z", null), t("ponto", "2026-10-01T12:00:00Z", null)]), 197);
// Os dois no mesmo mês, em dias diferentes (um desligou, o outro ligou depois): combo também.
assert.equal(valor([t("checklists", "2026-10-01T12:00:00Z", "2026-11-10T12:00:00Z"), t("ponto", "2026-11-20T12:00:00Z", null)]), 197);
// Ligou no dia 29: mês inteiro, sem proporcional.
assert.equal(valor([t("ponto", "2026-11-29T15:00:00Z", null)]), 149);
// Liga e desliga várias vezes no mês: uma vez só.
assert.equal(valor([t("checklists", "2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z"), t("checklists", "2026-11-12T15:00:00Z", null)]), 149);
// Desligou em outubro (virada): novembro zero.
assert.equal(valor([t("checklists", "2026-10-01T12:00:00Z", "2026-11-01T03:00:00Z")]), 0);
// Ligou em dezembro: novembro zero.
assert.equal(valor([t("checklists", "2026-12-02T12:00:00Z", null)]), 0);

// Teste grátis por módulo. Ligou 25/11, grátis até 02/12: novembro não é cobrado.
assert.equal(valor([t("ponto", "2026-11-25T12:00:00Z", null)], { ponto: "2026-12-02T12:00:00Z" }), 0);
// Desligou no teste: nada.
assert.equal(valor([t("ponto", "2026-11-01T12:00:00Z", "2026-11-04T12:00:00Z")], { ponto: "2026-11-08T12:00:00Z" }), 0);
// Teste acabou 05/11 e continuou ligado: novembro cobrado.
assert.equal(valor([t("ponto", "2026-10-29T12:00:00Z", null)], { ponto: "2026-11-05T12:00:00Z" }), 149);
// Checklist cobrado e ponto ainda no teste o mês todo: só o checklist (149, não combo).
assert.equal(valor(
  [t("checklists", "2026-10-01T12:00:00Z", null), t("ponto", "2026-11-28T12:00:00Z", null)],
  { checklists: "2026-10-08T12:00:00Z", ponto: "2026-12-05T12:00:00Z" },
), 149);
// O teste do checklist não vale para o ponto: ponto ligado depois do teste do checklist acabar é cobrado.
assert.equal(valor([t("ponto", "2026-11-20T12:00:00Z", null)], { checklists: "2026-12-30T12:00:00Z" }), 149);

// Detalhe por módulo.
assert.deepEqual(conta([t("checklists", "2026-10-01T12:00:00Z", null)], {}, ini, fim, agora), { checklists: 149, ponto: 0, valor: 149 });

// Leitura do banco: ignora módulo desconhecido e valor vazio vira o preço do módulo.
assert.deepEqual(lerTrechos(JSON.stringify([{ modulo: "ponto", de: d("2026-11-01T12:00:00Z") }, { modulo: "estoque", de: d("2026-11-01T12:00:00Z") }])),
  [{ modulo: "ponto", de: d("2026-11-01T12:00:00Z"), ate: null, valor: 149 }]);
assert.deepEqual(lerTestes({ ponto: "2026-11-08T12:00:00.000Z", x: "y" }), { ponto: "2026-11-08T12:00:00.000Z" });

// O termo diz as regras com todas as letras.
const termo = CLAUSULAS_DO_TERMO_DO_FIRECHECK.join(" ");
for (const trecho of ["R$ 149,00", "R$ 197,00", "7 dias grátis", "usando ou não", "proporcional", "bloqueado junto", "Cakto"]) {
  assert.ok(termo.includes(trecho), `o termo tem que dizer "${trecho}"`);
}

console.log("✅ cobrança do FireCheck: todos os casos passaram");
