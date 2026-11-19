/**
 * O Bill lê os relatórios do menu de QUALQUER período (lib/assessor/relatorios.ts):
 * cliente reclamou em 18/11/2026 que ele não liberava dia anterior.
 *
 * 1) Sem banco: a resposta da tela encolhe (lista longa → primeiras linhas + total).
 * 2) Com banco (só leitura): a loja real de ontem e da semana sai com os números
 *    da rota da tela, só da loja da conversa; sem a sessão do Bill a rota segue
 *    fechada (401); relatório inventado e período no futuro são recusados.
 *
 *   npx tsx scripts/teste-bill-relatorio-de-qualquer-dia.ts            (só a parte 1)
 *   LOJA=<id> npx tsx scripts/teste-bill-relatorio-de-qualquer-dia.ts  (as duas)
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { enxugar, consultarRelatorio, RELATORIOS_DO_BILL } from "../src/lib/assessor/relatorios";
import { hojeNaLoja } from "../src/lib/relatorios/base";

// ── 1. Encolher ──
const grande = { total: 10, linhas: Array.from({ length: 60 }, (_, i) => ({ nome: `item ${i}`, valor: i, vazio: null })) };
const e: any = enxugar(grande);
assert.equal(e.total, 10);
assert.equal(e.linhas.length, 26, "25 linhas + o aviso");
assert.match(e.linhas[25], /mais 35 linha\(s\) \(total 60\)/);
assert.equal("vazio" in e.linhas[0], false, "campo vazio sai");
assert.equal((enxugar("x".repeat(500)) as string).length, 241);
console.log("✓ encolhe a resposta da tela");

const LOJA = process.env.LOJA;
if (!LOJA) {
  console.log("(sem LOJA=<id>: pulei a parte com banco)");
  process.exit(0);
}

(async () => {
  const ctx = { franchiseeId: LOJA, usuarioId: LOJA, canal: "WHATSAPP" as const }; // como no WhatsApp: sem fuso
  const hoje: string = (await consultarRelatorio({ relatorio: "vendas" }, ctx) as any).periodo.de;
  const menos = (n: number) => new Date(new Date(`${hoje}T12:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);
  const ontem = menos(1);

  // ── 2a. Ontem, vendas por período ──
  const v: any = await consultarRelatorio({ relatorio: "vendas", de: ontem }, ctx);
  assert.equal(v.ok, true, JSON.stringify(v).slice(0, 300));
  assert.equal(v.periodo.de, ontem);
  assert.equal(v.periodo.ate, ontem);
  const nome = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][new Date(`${ontem}T12:00:00Z`).getUTCDay()];
  assert.equal(v.periodo.deComDia, `${nome} ${ontem.slice(8, 10)}/${ontem.slice(5, 7)}`);
  const texto = JSON.stringify(v.dados);
  assert.ok(texto.length > 50 && texto.length <= 14500, `tamanho ${texto.length}`);
  console.log(`✓ vendas de ontem (${ontem}):`, texto.slice(0, 260));

  // ── 2b. A semana, em vários relatórios ──
  for (const slug of ["faturamento-por-dia", "itens-vendidos", "formas-de-pagamento", "cancelamentos", "acerto-de-entregadores"]) {
    const r: any = await consultarRelatorio({ relatorio: slug, de: menos(7), ate: ontem }, ctx);
    assert.equal(r.ok, true, `${slug}: ${JSON.stringify(r).slice(0, 300)}`);
    console.log(`✓ ${slug} ${menos(7)}→${ontem}: ${JSON.stringify(r.dados).length} caracteres`);
  }

  // ── 2c. Recusas ──
  const inventado: any = await consultarRelatorio({ relatorio: "faturamento-do-planeta" }, ctx);
  assert.equal(inventado.ok, false);
  const futuro: any = await consultarRelatorio({ relatorio: "vendas", de: menos(-3) }, ctx);
  assert.equal(futuro.ok, false);
  console.log("✓ recusa relatório inventado e período no futuro");

  // ── 2d. Sem a sessão do Bill a rota segue fechada ──
  const rota = await RELATORIOS_DO_BILL["vendas"][1]();
  const semSessao = await rota.GET(new NextRequest(`http://x/api/store/relatorios/vendas?de=${ontem}&lojas=${LOJA}`));
  assert.equal(semSessao.status, 401);
  console.log("✓ sem a sessão do Bill: 401");

  console.log("\nTUDO OK");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
