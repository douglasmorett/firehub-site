/**
 * O "desfaz" do Bill (lib/assessor/ferramentas.ts → desfazerRegistroDoBill), com
 * o banco trocado por um falso em memória: só o mais novo se desfaz; com o id
 * da tela, outro mais novo trava; o registro é marcado antes de mexer e a marca
 * sai se o desfazer não acontece; dois "desfaz" ao mesmo tempo não estornam duas vezes.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-desfazer-do-bill.ts
 */
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { desfazerRegistroDoBill, type ContextoDoAssessor } from "../src/lib/assessor/ferramentas";

type Reg = { id: string; franchiseeId: string; tipo: string; resumo: string; refs: any; desfeitoEm: Date | null; criadoEm: Date };
let regs: Reg[] = [];
let despesas = new Set<string>();
let contas = new Map<string, { status: string }>();
const log: string[] = [];

const casa = (r: Reg, w: any) =>
  (!w.id || r.id === w.id) && (!w.franchiseeId || r.franchiseeId === w.franchiseeId) && (!("desfeitoEm" in w) || (w.desfeitoEm === null ? r.desfeitoEm === null : true));

const falso: any = {
  assessorRegistro: {
    findFirst: async ({ where }: any) => [...regs].filter((r) => casa(r, where)).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime() || b.id.localeCompare(a.id))[0] ?? null,
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of regs) if (casa(r, where)) { r.desfeitoEm = data.desfeitoEm; count++; }
      log.push(`marca ${where.id} ${data.desfeitoEm ? "desfeito" : "volta"}`);
      return { count };
    },
  },
  despesaLancada: {
    deleteMany: async ({ where }: any) => { log.push(`apaga despesa ${where.id}`); return { count: despesas.delete(where.id) ? 1 : 0 }; },
  },
  payable: {
    deleteMany: async ({ where }: any) => {
      const c = contas.get(where.id);
      if (!c || c.status === "PAID") return { count: 0 };
      contas.delete(where.id);
      log.push(`apaga conta ${where.id}`);
      return { count: 1 };
    },
  },
};
for (const k of Object.keys(falso)) Object.defineProperty(prisma, k, { value: falso[k], configurable: true });

const ctx: ContextoDoAssessor = { franchiseeId: "loja", usuarioId: "dono", canal: "PAINEL", autor: "Douglas" };
const t = (m: number) => new Date(Date.UTC(2026, 9, 17, 12, m));

async function main() {
  // 1. Pelo painel, com o id de uma linha que não é a mais nova: nada muda.
  regs = [
    { id: "r1", franchiseeId: "loja", tipo: "DESPESA", resumo: "Despesa Gás: R$ 130,00", refs: { despesaId: "d1" }, desfeitoEm: null, criadoEm: t(1) },
    { id: "r2", franchiseeId: "loja", tipo: "DESPESA", resumo: "Despesa Pessoal: R$ 80,00", refs: { despesaId: "d2" }, desfeitoEm: null, criadoEm: t(2) },
    { id: "x9", franchiseeId: "outra", tipo: "DESPESA", resumo: "de outra loja", refs: { despesaId: "d9" }, desfeitoEm: null, criadoEm: t(9) },
  ];
  despesas = new Set(["d1", "d2", "d9"]);
  let r = await desfazerRegistroDoBill(ctx, "r1");
  assert.equal(r.ok, false);
  assert.match(String(r.erro), /último/);
  assert.equal(regs[0].desfeitoEm, null);
  assert.equal(despesas.size, 3);

  // 2. Com o id da mais nova da loja (a da outra loja não conta): desfaz.
  r = await desfazerRegistroDoBill(ctx, "r2");
  assert.equal(r.ok, true);
  assert.ok(regs[1].desfeitoEm);
  assert.ok(!despesas.has("d2") && despesas.has("d9"));

  // 3. O "desfaz" do WhatsApp (sem id) pega a próxima.
  r = await desfazerRegistroDoBill({ ...ctx, canal: "WHATSAPP" }, null);
  assert.equal(r.ok, true);
  assert.ok(regs[0].desfeitoEm);
  r = await desfazerRegistroDoBill(ctx, null);
  assert.equal(r.ok, false); // não sobrou nada desta loja

  // 4. Conta a pagar já paga: não desfaz, e a marca de desfeito sai.
  regs = [{ id: "c1", franchiseeId: "loja", tipo: "CONTA", resumo: "Conta Enel", refs: { payableId: "p1" }, desfeitoEm: null, criadoEm: t(5) }];
  contas = new Map([["p1", { status: "PAID" }]]);
  log.length = 0;
  r = await desfazerRegistroDoBill(ctx, "c1");
  assert.equal(r.ok, false);
  assert.equal(regs[0].desfeitoEm, null);
  assert.deepEqual(log, ["marca c1 desfeito", "marca c1 volta"]);

  // 5. Dois "desfaz" ao mesmo tempo para a mesma linha: um desfaz, o outro não mexe.
  regs = [{ id: "d", franchiseeId: "loja", tipo: "CONTA", resumo: "Conta Águas", refs: { payableId: "p2" }, desfeitoEm: null, criadoEm: t(6) }];
  contas = new Map([["p2", { status: "PENDING" }]]);
  log.length = 0;
  const [a, b] = await Promise.all([desfazerRegistroDoBill(ctx, "d"), desfazerRegistroDoBill(ctx, "d")]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.equal(log.filter((l) => l.startsWith("apaga conta")).length, 1);

  // 6. Tipo desconhecido: recusa e solta a marca.
  regs = [{ id: "z", franchiseeId: "loja", tipo: "OUTRO", resumo: "?", refs: {}, desfeitoEm: null, criadoEm: t(7) }];
  r = await desfazerRegistroDoBill(ctx, "z");
  assert.equal(r.ok, false);
  assert.equal(regs[0].desfeitoEm, null);

  console.log("teste-desfazer-do-bill: ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
