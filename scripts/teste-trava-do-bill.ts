/**
 * A trava do assessor contra "disse que gravou sem gravar" (lib/assessor/assessor.ts):
 * a ação afirmada conta; a negada não.
 *
 *   npx tsx scripts/teste-trava-do-bill.ts
 */
import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "postgresql://teste@127.0.0.1:1/teste";

(async () => {
  const { dizQueGravou } = await import("../src/lib/assessor/assessor");
  const afirmadas = ["✅ *Lançado*", "Lancei a compra de 10 coca", "Pausei a esfirra de calabresa", "registrei a despesa do gás"];
  const negadas = [
    "Essa nota já foi lançada às 12:12. Para não duplicar, não lancei de novo. Quer que eu lance mesmo assim?",
    "Não registrei nada ainda: falta o valor.",
    "Nao pausei porque não achei o item.",
  ];
  for (const t of afirmadas) assert.equal(dizQueGravou(t), true, t);
  for (const t of negadas) assert.equal(dizQueGravou(t), false, t);
  assert.equal(dizQueGravou("Não lancei a coca, mas registrei a despesa do gás"), true, "a afirmada continua contando ao lado da negada");
  console.log("ok: trava do Bill — afirmada conta, negada não");
})().catch((e) => { console.error(e); process.exitCode = 1; });
