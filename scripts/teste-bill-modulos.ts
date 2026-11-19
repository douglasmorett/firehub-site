/**
 * Os módulos do Bill juntos (lib/assessor/modulos): nenhum nome de ferramenta
 * repetido, todo "grava" existe, tipo de registro não se repete entre módulos,
 * todo módulo que grava sabe desfazer os seus tipos, e o tamanho das
 * declarações (vai em toda mensagem do dono).
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-bill-modulos.ts
 */
import assert from "node:assert/strict";
import { DECLARACOES_DO_ASSESSOR, FERRAMENTAS_QUE_GRAVAM } from "../src/lib/assessor/ferramentas";
import { MODULOS_DO_BILL } from "../src/lib/assessor/modulos";

const nomes = DECLARACOES_DO_ASSESSOR.map((d: any) => d.name);
const repetidos = nomes.filter((n, i) => nomes.indexOf(n) !== i);
assert.deepEqual(repetidos, [], `ferramenta repetida: ${repetidos}`);
for (const n of nomes) assert.match(n, /^[a-z][a-z0-9_]*$/, `nome fora do padrão: ${n}`);

for (const m of MODULOS_DO_BILL) {
  const deste = m.declaracoes.map((d: any) => d.name);
  for (const g of m.gravam) assert.ok(deste.includes(g), `${m.nome}: "${g}" está em gravam mas não é ferramenta dele`);
  for (const g of m.gravam) assert.ok(FERRAMENTAS_QUE_GRAVAM.has(g));
  if (m.gravam.length && m.tipos?.length) assert.ok(m.desfazer, `${m.nome}: grava tipos e não tem desfazer`);
  assert.ok(m.regras.trim().length > 20, `${m.nome}: sem regras`);
}
const tipos = MODULOS_DO_BILL.flatMap((m) => m.tipos || []);
assert.deepEqual(tipos.filter((t, i) => tipos.indexOf(t) !== i), [], "tipo de registro repetido entre módulos");
const ANTIGOS = ["COMPRA", "DESPESA", "CONTA", "CONTA_PAGA", "SAIDA", "PAUSADO", "REATIVADO", "SITE", "ENTREGA"];
assert.deepEqual(tipos.filter((t) => ANTIGOS.includes(t)), [], "módulo usando tipo antigo");

// Ferramenta de um módulo não responde pelo outro (o executor percorre a lista).
(async () => {
  const ctx = { franchiseeId: "x", usuarioId: "x", canal: "PAINEL" as const };
  for (const m of MODULOS_DO_BILL) assert.equal(await m.executar("ferramenta_que_nao_existe", {}, ctx as any), null, `${m.nome} respondeu por ferramenta alheia`);

  const tamanho = JSON.stringify(DECLARACOES_DO_ASSESSOR).length;
  const regras = MODULOS_DO_BILL.map((m) => m.regras).join("\n").length;
  console.log(`✓ ${nomes.length} ferramentas (${MODULOS_DO_BILL.length} módulos), ${FERRAMENTAS_QUE_GRAVAM.size} gravam, ${tipos.length} tipos de registro`);
  console.log(`  declarações ${tamanho} caracteres · regras dos módulos ${regras} caracteres`);
  for (const m of MODULOS_DO_BILL) console.log(`  ${m.nome}: ${m.declaracoes.map((d: any) => d.name).join(", ")}`);
  console.log("TUDO OK");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
