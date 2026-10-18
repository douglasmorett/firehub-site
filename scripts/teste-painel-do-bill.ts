/**
 * As regras do painel do Bill ligado (/store/bill → lib/assessor/painel.ts):
 * resumo do período, pausados pelo Bill, quem mandou, filtros e cursor do
 * histórico, quem pode ser desfeito.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-painel-do-bill.ts
 */
import assert from "node:assert/strict";
import {
  resumirRegistros, pausadosPeloBill, mascararTelefone, quemMandou, lerFiltrosDoHistorico, codificarCursor, lerCursor,
  podeDesfazer, diasDoResumo, lerPeriodoDoResumo, comAutor, ondeVer, rotuloDoRegistro,
} from "../src/lib/assessor/painel";
import { janelaDosDias } from "../src/lib/numeros-do-inicio";
import { naLoja } from "../src/lib/relatorios/base";

// ── Resumo: desfeito não entra em nada (só na contagem de desfeitos); valor vem do lançamento ──
const r = resumirRegistros([
  { tipo: "COMPRA", desfeitoEm: null, valor: 45 },
  { tipo: "COMPRA", desfeitoEm: null, valor: 210.1 },
  { tipo: "COMPRA", desfeitoEm: "2026-10-17T15:00:00Z", valor: 999 },
  { tipo: "COMPRA", desfeitoEm: null, valor: null }, // compra sem valor: conta 1, soma 0
  { tipo: "DESPESA", desfeitoEm: null, valor: 130 },
  { tipo: "DESPESA", desfeitoEm: new Date(), valor: null },
  { tipo: "CONTA", desfeitoEm: null, valor: 412.3 },
  { tipo: "CONTA_PAGA", desfeitoEm: null, valor: 412.3 },
  { tipo: "SAIDA", desfeitoEm: null, valor: null },
  { tipo: "PAUSADO", desfeitoEm: null, valor: null },
  { tipo: "PAUSADO", desfeitoEm: null, valor: null },
  { tipo: "REATIVADO", desfeitoEm: null, valor: null },
  { tipo: "SITE", desfeitoEm: null, valor: null },
]);
assert.equal(r.lancamentos, 11);
assert.equal(r.desfeitos, 2);
assert.deepEqual(r.compras, { qtd: 3, valor: 255.1 });
assert.deepEqual(r.despesas, { qtd: 1, valor: 130 });
assert.deepEqual(r.contasAnotadas, { qtd: 1, valor: 412.3 });
assert.deepEqual(r.contasPagas, { qtd: 1, valor: 412.3 });
assert.equal(r.saidas, 1);
assert.equal(r.pausados, 2);
assert.equal(r.reativados, 1);
assert.equal(r.porTipo.COMPRA, 3);
assert.equal(r.porTipo.SITE, 1);
// Centavos não acumulam erro de ponto flutuante.
assert.equal(resumirRegistros(Array.from({ length: 10 }, () => ({ tipo: "DESPESA", desfeitoEm: null, valor: 0.1 }))).despesas.valor, 1);
// Vazio.
assert.equal(resumirRegistros([]).lancamentos, 0);

// ── Pausados pelo Bill: vale o registro MAIS NOVO de cada produto que não foi desfeito ──
const p = pausadosPeloBill([
  // do mais novo para o mais antigo
  { tipo: "REATIVADO", refs: { ids: ["coca"], ativo: true }, criadoEm: "2026-10-17T20:00:00Z", desfeitoEm: null, canal: "WHATSAPP" },
  { tipo: "PAUSADO", refs: { ids: ["esfirra"], ativo: false }, criadoEm: "2026-10-17T19:00:00Z", desfeitoEm: "2026-10-17T19:05:00Z", canal: "WHATSAPP" }, // desfeito
  { tipo: "PAUSADO", refs: { ids: ["coca", "pastel"], ativo: false }, criadoEm: "2026-10-17T18:00:00Z", desfeitoEm: null, canal: "PAINEL" },
  { tipo: "PAUSADO", refs: { ids: ["esfirra"], ativo: false }, criadoEm: "2026-10-16T18:00:00Z", desfeitoEm: null, canal: "WHATSAPP" },
  { tipo: "COMPRA", refs: { invoiceId: "x" }, criadoEm: "2026-10-16T17:00:00Z", desfeitoEm: null, canal: "WHATSAPP" },
  { tipo: "PAUSADO", refs: null, criadoEm: "2026-10-15T17:00:00Z", desfeitoEm: null, canal: "WHATSAPP" },
]);
assert.deepEqual([...p.keys()].sort(), ["esfirra", "pastel"]); // a coca foi reativada depois
assert.equal(p.get("esfirra")!.pausadoEm, "2026-10-16T18:00:00.000Z"); // a pausa desfeita de 17/10 não conta
assert.equal(p.get("pastel")!.canal, "PAINEL");

// ── Quem mandou ──
assert.equal(mascararTelefone("5522998851680"), "(22) •••••-1680");
assert.equal(mascararTelefone("2233334444"), "(22) ••••-4444");
assert.equal(mascararTelefone("123"), null);
assert.equal(mascararTelefone(null), null);
assert.equal(quemMandou({ canal: "WHATSAPP", telefone: "5522998851680" }), "WhatsApp · (22) •••••-1680");
assert.equal(quemMandou({ canal: "WHATSAPP", telefone: null }), "WhatsApp");
assert.equal(quemMandou({ canal: "PAINEL", autor: "Douglas" }), "Painel · Douglas");
assert.equal(quemMandou({ canal: "PAINEL" }), "Painel");
// O autor só vai nas refs pelo painel, e não apaga as refs que o desfazer usa.
assert.deepEqual(comAutor({ invoiceId: "i1" }, { canal: "PAINEL", autor: "Douglas" }), { invoiceId: "i1", autor: "Douglas" });
assert.deepEqual(comAutor({ invoiceId: "i1" }, { canal: "WHATSAPP", autor: "Douglas" }), { invoiceId: "i1" });
assert.deepEqual(comAutor({ ids: ["a"], ativo: false }, { canal: "PAINEL", autor: null }), { ids: ["a"], ativo: false });

// ── Período do resumo: dia de operação da loja ──
assert.equal(lerPeriodoDoResumo("7d"), "7d");
assert.equal(lerPeriodoDoResumo("xpto"), "hoje");
assert.deepEqual(diasDoResumo("hoje", "2026-10-17"), { de: "2026-10-17", ate: "2026-10-17" });
assert.deepEqual(diasDoResumo("7d", "2026-10-17"), { de: "2026-10-11", ate: "2026-10-17" }); // 7 dias, contando hoje
assert.deepEqual(diasDoResumo("mes", "2026-10-17"), { de: "2026-10-01", ate: "2026-10-17" });
// O dia vira às 5h: 17/10 em São Paulo vai de 17/10 05:00 (08:00Z) a 18/10 05:00.
const j = janelaDosDias("2026-10-17", "2026-10-17", "America/Sao_Paulo");
assert.equal(j.inicio.toISOString(), "2026-10-17T08:00:00.000Z");
assert.equal(j.fim.toISOString(), "2026-10-18T08:00:00.000Z");
// Lançamento das 2h da manhã de 18/10 é do dia 17 (a linha do histórico agrupa por aqui).
assert.equal(naLoja(new Date("2026-10-18T05:00:00Z"), "America/Sao_Paulo").dia, "2026-10-17");

// ── Filtros do histórico ──
const sp = (q: string) => new URLSearchParams(q);
const f1 = lerFiltrosDoHistorico(sp("tipo=compra,DESPESA,xpto,COMPRA&canal=whatsapp&q=%20coca%20&limite=500"), "2026-10-17");
assert.deepEqual(f1.tipos, ["COMPRA", "DESPESA"]);
assert.equal(f1.canal, "WHATSAPP");
assert.equal(f1.busca, "coca");
assert.equal(f1.limite, 100);
assert.equal(f1.comDesfeitos, true);
assert.equal(f1.de, null);
const f2 = lerFiltrosDoHistorico(sp("periodo=7d&desfeitos=nao&canal=sms"), "2026-10-17");
assert.deepEqual([f2.de, f2.ate], ["2026-10-11", "2026-10-17"]);
assert.equal(f2.comDesfeitos, false);
assert.equal(f2.canal, null);
// Datas escolhidas ganham do atalho, e invertidas se desinvertem.
const f3 = lerFiltrosDoHistorico(sp("periodo=hoje&de=2026-10-15&ate=2026-10-01"), "2026-10-17");
assert.deepEqual([f3.de, f3.ate], ["2026-10-01", "2026-10-15"]);
// Mês anterior.
const f4 = lerFiltrosDoHistorico(sp("periodo=mesAnterior"), "2026-10-17");
assert.deepEqual([f4.de, f4.ate], ["2026-09-01", "2026-09-30"]);
// Atalho desconhecido e data malformada: sem limite.
const f5 = lerFiltrosDoHistorico(sp("periodo=ano&de=17/10/2026"), "2026-10-17");
assert.deepEqual([f5.de, f5.ate], [null, null]);
assert.equal(lerFiltrosDoHistorico(sp("")).limite, 30);

// ── Cursor ──
const c = codificarCursor({ criadoEm: new Date("2026-10-17T18:31:02.123Z"), id: "cmabc123" });
assert.equal(c, "2026-10-17T18:31:02.123Z_cmabc123");
const lido = lerCursor(c)!;
assert.equal(lido.criadoEm.toISOString(), "2026-10-17T18:31:02.123Z");
assert.equal(lido.id, "cmabc123");
assert.equal(lerCursor("lixo"), null);
assert.equal(lerCursor("2026-10-17T18:31:02.123Z_'; drop"), null);
assert.equal(lerCursor(null), null);

// ── Desfazer: só o mais novo ainda não desfeito (regra do "desfaz" do WhatsApp) ──
assert.equal(podeDesfazer({ id: "a", desfeitoEm: null }, "a"), true);
assert.equal(podeDesfazer({ id: "b", desfeitoEm: null }, "a"), false);
assert.equal(podeDesfazer({ id: "a", desfeitoEm: "2026-10-17T10:00:00Z" }, "a"), false);
assert.equal(podeDesfazer({ id: "a", desfeitoEm: null }, null), false);

// ── Rótulos e links ──
assert.equal(rotuloDoRegistro("COMPRA").grupo, "Estoque");
assert.equal(rotuloDoRegistro("NOVO_TIPO").texto, "NOVO_TIPO");
assert.equal(ondeVer("CONTA")!.href, "/store/financeiro?tab=contasapagar");
assert.equal(ondeVer("SITE"), null);

console.log("teste-painel-do-bill: ok");
