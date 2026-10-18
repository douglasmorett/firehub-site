/**
 * Quem não paga mensalidade (lib/billing.ts → lojaIsenta). Desde 17/10/2026 ser
 * embaixador ou vendedor não isenta sozinho: isenta é a loja da casa (lista de
 * e-mails, Hakim) e a que o dono isentou (`planPercent` 0, botão do admin).
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-isencao-escolhida.ts
 */
import assert from "node:assert/strict";
import { lojaIsenta } from "../src/lib/billing";

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log("ok -", nome); };

caso("loja comum paga", () => {
  assert.equal(lojaIsenta({ email: "loja@x.com", planPercent: 2, isFranqueadoHakim: false }), false);
});
caso("loja do embaixador NÃO é isenta só por ser dele (Showrrascão, 17/10)", () => {
  // O campo da conta de parceiro pode até vir junto de um select antigo: não muda nada.
  const doEmbaixador = { email: "loja@x.com", planPercent: 2, isFranqueadoHakim: false, ambassadorAccount: { active: true } };
  assert.equal(lojaIsenta(doEmbaixador), false);
});
caso("embaixador que o dono isentou continua isento (DUGABURGUER, Delícias de Casa)", () => {
  assert.equal(lojaIsenta({ email: "loja@x.com", planPercent: 0, isFranqueadoHakim: false }), true);
});
caso("percentual ausente não é isenção", () => {
  assert.equal(lojaIsenta({ email: "loja@x.com", planPercent: null, isFranqueadoHakim: false }), false);
});
caso("Hakim é isenta", () => {
  assert.equal(lojaIsenta({ email: "loja@x.com", planPercent: 2, isFranqueadoHakim: true }), true);
});
caso("conta da casa pela lista de e-mails é isenta", () => {
  assert.equal(lojaIsenta({ email: "ContatoHakim@gmail.com ", planPercent: 2, isFranqueadoHakim: false }), true);
});
caso("sem loja não é isenta", () => {
  assert.equal(lojaIsenta(null), false);
});

console.log(`\n${ok} ok`);
