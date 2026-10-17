/**
 * Prova dos canais do cashback (lib/cashback.ts, storeLoyalty.cashbackCanais):
 * a loja escolhe se o cashback vale no site, no robô do WhatsApp, nos dois ou
 * em nenhum — e a loja que nunca mexeu continua com os dois. Sem banco.
 *
 *   npx tsx scripts/teste-cashback-canais.ts
 */
import assert from "node:assert/strict";
import {
  cashbackDoPedido,
  lerCanaisDoCashback,
  lerCashback,
  ondeValeOCashback,
  regraNoCanal,
  resgateMaximo,
  saldoDoCashback,
} from "../src/lib/cashback";

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log("ok -", nome); };

const BASE = { cashbackActive: true, rate: 5, minOrderValue: 20, maxRedeemPercent: 50 };
const loja = (cashbackCanais?: unknown) => (cashbackCanais === undefined ? { ...BASE } : { ...BASE, cashbackCanais });

/** Num pedido de R$ 100 com R$ 30 de saldo: quanto gera e quanto usa, no canal. */
const noCanal = (storeLoyalty: unknown, canal: "site" | "whatsapp") => {
  const r = regraNoCanal(lerCashback(storeLoyalty), canal);
  return { ativo: r.ativo, gera: cashbackDoPedido(r, 100, 100, r.taxa), usa: resgateMaximo(r, 30, 100) };
};

caso("ausente = todos marcados (loja que nunca mexeu fica igual)", () => {
  assert.deepEqual(lerCanaisDoCashback(loja()), { site: true, whatsapp: true });
  assert.deepEqual(lerCanaisDoCashback(undefined), { site: true, whatsapp: true });
  assert.deepEqual(lerCanaisDoCashback({ cashbackCanais: "lixo" }), { site: true, whatsapp: true });
  assert.deepEqual(noCanal(loja(), "site"), { ativo: true, gera: 5, usa: 30 });
  assert.deepEqual(noCanal(loja(), "whatsapp"), { ativo: true, gera: 5, usa: 30 });
  assert.equal(ondeValeOCashback(lerCanaisDoCashback(loja())), "Vale nos pedidos pelo site e pelo WhatsApp.");
});

caso("canal que falta no objeto herda marcado", () => {
  assert.deepEqual(lerCanaisDoCashback(loja({ whatsapp: false })), { site: true, whatsapp: false });
  assert.deepEqual(lerCanaisDoCashback(loja({ site: "não" })), { site: true, whatsapp: true });
});

caso("só site (Bistrô Burguer): site gera e usa, robô não", () => {
  const l = loja({ site: true, whatsapp: false });
  assert.deepEqual(noCanal(l, "site"), { ativo: true, gera: 5, usa: 30 });
  assert.deepEqual(noCanal(l, "whatsapp"), { ativo: false, gera: 0, usa: 0 });
  assert.equal(ondeValeOCashback(lerCanaisDoCashback(l)), "Vale só nos pedidos pelo site.");
});

caso("só robô: WhatsApp gera e usa, site não", () => {
  const l = loja({ site: false, whatsapp: true });
  assert.deepEqual(noCanal(l, "site"), { ativo: false, gera: 0, usa: 0 });
  assert.deepEqual(noCanal(l, "whatsapp"), { ativo: true, gera: 5, usa: 30 });
  assert.equal(ondeValeOCashback(lerCanaisDoCashback(l)), "Vale só nos pedidos pelo WhatsApp.");
});

caso("nenhum: nenhum canal gera nem usa", () => {
  const l = loja({ site: false, whatsapp: false });
  assert.deepEqual(noCanal(l, "site"), { ativo: false, gera: 0, usa: 0 });
  assert.deepEqual(noCanal(l, "whatsapp"), { ativo: false, gera: 0, usa: 0 });
  assert.match(ondeValeOCashback(lerCanaisDoCashback(l)), /Nenhum canal/);
});

caso("cashback desligado continua desligado com os canais marcados", () => {
  const l = { ...loja({ site: true, whatsapp: true }), cashbackActive: false };
  assert.deepEqual(noCanal(l, "site"), { ativo: false, gera: 0, usa: 0 });
});

caso("desmarcar o WhatsApp não apaga o que o cliente já ganhou por lá", () => {
  const regra = lerCashback(loja({ site: true, whatsapp: false }));
  const agora = new Date("2026-10-17T20:00:00Z");
  const s = saldoDoCashback(regra, [
    { id: "r1", source: "WHATSAPP_IA", status: "ENTREGUE", createdAt: "2026-10-10T20:00:00Z", cashbackEarned: 4 } as any,
    { id: "s1", source: "ONLINE", status: "ENTREGUE", createdAt: "2026-10-12T20:00:00Z", cashbackEarned: 3 } as any,
  ], agora);
  assert.equal(s.saldo, 7);
});

console.log(`\n${ok} casos ok`);
