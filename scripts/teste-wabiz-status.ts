/**
 * Status do FireHub → status da Wabiz (lib/wabiz-status.ts).
 * NIK Esfihas, 20/11/2026: o "pronto" da retirada é gravado como SAIU_ENTREGA e
 * ia para a Wabiz como 5 (saiu para entrega); o cliente da retirada não recebia
 * o "pronto para retirar".
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-wabiz-status.ts
 */
import assert from "node:assert/strict";
import { statusWabizDoFireHub } from "../src/lib/wabiz-status";
import { WABIZ_STATUS } from "../src/lib/wabiz-api";

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log("ok -", nome); };

caso("retirada pronta no balcão (SAIU_ENTREGA) vai como pronto para retirar", () => {
  assert.equal(statusWabizDoFireHub("SAIU_ENTREGA", "RETIRADA"), WABIZ_STATUS.PRONTO_PARA_RETIRAR);
  assert.equal(statusWabizDoFireHub("SAIU_ENTREGA", "TAKEOUT"), WABIZ_STATUS.PRONTO_PARA_RETIRAR);
});
caso("entrega na rua continua saiu para entrega", () => {
  assert.equal(statusWabizDoFireHub("SAIU_ENTREGA", "DELIVERY"), WABIZ_STATUS.SAIU_PARA_ENTREGA);
  assert.equal(statusWabizDoFireHub("SAIU_ENTREGA", null), WABIZ_STATUS.SAIU_PARA_ENTREGA);
});
caso("PRONTO: retirada avisa, entrega não", () => {
  assert.equal(statusWabizDoFireHub("PRONTO", "RETIRADA"), WABIZ_STATUS.PRONTO_PARA_RETIRAR);
  assert.equal(statusWabizDoFireHub("PRONTO", "DELIVERY"), null);
});
caso("o resto não mudou", () => {
  assert.equal(statusWabizDoFireHub("ACEITO", "RETIRADA"), WABIZ_STATUS.CONFIRMADO);
  assert.equal(statusWabizDoFireHub("PREPARANDO", "DELIVERY"), WABIZ_STATUS.EM_PRODUCAO);
  assert.equal(statusWabizDoFireHub("ENTREGUE", "RETIRADA"), WABIZ_STATUS.FINALIZADO);
  assert.equal(statusWabizDoFireHub("CANCELADO", "DELIVERY"), WABIZ_STATUS.CANCELADO);
});

console.log(`\n${ok} ok`);
