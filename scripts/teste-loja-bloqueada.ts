/**
 * Prova da regra "esta loja está bloqueada por mensalidade agora?"
 * (lib/loja-bloqueada.ts) — a mesma da tela de bloqueio do painel, agora usada
 * pelo iFood, robô, cardápio, totem, mesa e demais canais. Pura, sem banco.
 *
 *   npx tsx scripts/teste-loja-bloqueada.ts
 *
 * O caso real é a NATAL LANCHES (16/10/2026): setembro/2026 CLOSED com
 * R$ 100 em aberto, travada desde o fim do dia 10/10 — e recebendo iFood.
 */
import { cicloBloqueia, decidirBloqueio, ehLojaEspecial } from "../src/lib/loja-bloqueada";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// Fim do dia 10/10 em Brasília = 11/10 às 03:00 UTC.
const antesDoBloqueio = new Date("2026-10-11T02:59:00Z");
const depoisDoBloqueio = new Date("2026-10-11T03:00:00Z");
const hoje = new Date("2026-10-16T15:00:00Z");

const setembroEmAberto = { yearMonth: "2026-09", closedAt: new Date("2026-10-01T00:28:00Z"), amountPending: 100, status: "CLOSED" };
const natal = { role: "FRANCHISEE", email: "natal@exemplo.com", isFranqueadoHakim: false };

// ── O caso da Natal ──────────────────────────────────────────────────────────
confere("Natal hoje (16/10) está bloqueada", decidirBloqueio({ conta: natal, ciclo: setembroEmAberto, agora: hoje }), true);
confere("até o fim do dia 10/10 ainda não trava", decidirBloqueio({ conta: natal, ciclo: setembroEmAberto, agora: antesDoBloqueio }), false);
confere("a partir de 11/10 03:00 UTC trava", decidirBloqueio({ conta: natal, ciclo: setembroEmAberto, agora: depoisDoBloqueio }), true);

// ── Pagou: volta sozinha ─────────────────────────────────────────────────────
confere("ciclo PAID não trava", decidirBloqueio({ conta: natal, ciclo: { ...setembroEmAberto, status: "PAID", amountPending: 0 }, agora: hoje }), false);
confere("CLOSED com amountPending 0 não trava", decidirBloqueio({ conta: natal, ciclo: { ...setembroEmAberto, amountPending: 0 }, agora: hoje }), false);
confere("mensalidade perdoada (FORGIVEN) não trava", decidirBloqueio({ conta: natal, ciclo: { ...setembroEmAberto, status: "FORGIVEN" }, agora: hoje }), false);
confere("sem ciclo em aberto não trava", decidirBloqueio({ conta: natal, ciclo: null, agora: hoje }), false);

// ── Exceções do layout ───────────────────────────────────────────────────────
confere("franqueado Hakim nunca trava", decidirBloqueio({ conta: { ...natal, isFranqueadoHakim: true }, ciclo: setembroEmAberto, agora: hoje }), false);
confere("contatohakim@ nunca trava", decidirBloqueio({ conta: { ...natal, email: "contatohakim@gmail.com" }, ciclo: setembroEmAberto, agora: hoje }), false);
confere("e-mail com maiúscula e espaço também", decidirBloqueio({ conta: { ...natal, email: " ContatoHakim@Gmail.com " }, ciclo: setembroEmAberto, agora: hoje }), false);
confere("viniciusmenezes.ofc@ nunca trava", decidirBloqueio({ conta: { ...natal, email: "viniciusmenezes.ofc@gmail.com" }, ciclo: setembroEmAberto, agora: hoje }), false);
confere("ADMIN nunca trava", decidirBloqueio({ conta: { ...natal, role: "ADMIN" }, ciclo: setembroEmAberto, agora: hoje }), false);
confere("contingência (FIREHUB_LOCAL) nunca trava", decidirBloqueio({ conta: natal, ciclo: setembroEmAberto, agora: hoje, modoLocal: true }), false);
confere("conta inexistente não trava", decidirBloqueio({ conta: null, ciclo: setembroEmAberto, agora: hoje }), false);

// ── Funcionário/filial: vale o dono ──────────────────────────────────────────
confere("STAFF de loja devedora trava", decidirBloqueio({ conta: { role: "STAFF", email: "caixa@x.com" }, dono: natal, ciclo: setembroEmAberto, agora: hoje }), true);
confere("STAFF de loja Hakim não trava", decidirBloqueio({ conta: { role: "STAFF", email: "caixa@x.com" }, dono: { ...natal, isFranqueadoHakim: true }, ciclo: setembroEmAberto, agora: hoje }), false);
confere("ehLojaEspecial olha o e-mail do dono primeiro", ehLojaEspecial({ email: "contatohakim@gmail.com" }, { email: "outro@x.com" }), true);

// ── Prazo dado à mão (Brazza, setembro/2026: até 14/10) ──────────────────────
const brazza = "jmingordo@gmail.com";
confere("Brazza em 12/10 ainda não trava (prazo até 14/10)", cicloBloqueia(setembroEmAberto, brazza, new Date("2026-10-12T15:00:00Z")), false);
confere("Brazza em 15/10 trava", cicloBloqueia(setembroEmAberto, brazza, new Date("2026-10-15T15:00:00Z")), true);

// ── Fechamento atrasado ganha 5 dias ─────────────────────────────────────────
const fechadoTarde = { ...setembroEmAberto, closedAt: new Date("2026-10-09T12:00:00Z") };
confere("fechado em 09/10: em 12/10 ainda não trava", cicloBloqueia(fechadoTarde, natal.email, new Date("2026-10-12T15:00:00Z")), false);
confere("fechado em 09/10: em 14/10 15h trava", cicloBloqueia(fechadoTarde, natal.email, new Date("2026-10-14T15:00:00Z")), true);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
