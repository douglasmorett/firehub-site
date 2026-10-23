/**
 * Quem entra no /admin (lib/equipe-interna.ts): ADMIN e STAFF da equipe
 * interna, nunca o funcionário que o dono da loja criou (STAFF com ownerId).
 * O papel vem do banco, não do cookie.
 *
 *   npx tsx scripts/teste-equipe-interna.ts
 */
import { prisma } from "../src/lib/prisma";
import { ehEquipeInterna } from "../src/lib/equipe-interna";

const NO_BANCO: Record<string, { role: string; ownerId: string | null }> = {
  admin: { role: "ADMIN", ownerId: null },
  interno: { role: "STAFF", ownerId: null },
  caixa: { role: "STAFF", ownerId: "loja-1" },
  dono: { role: "FRANCHISEE", ownerId: null },
  rebaixado: { role: "FRANCHISEE", ownerId: null },
};
(prisma.user as any).findUnique = async ({ where }: any) => NO_BANCO[where.id] ?? null;

let falhas = 0;
async function confere(nome: string, session: any, esperado: boolean) {
  const obtido = await ehEquipeInterna(session);
  if (obtido === esperado) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${obtido}`); }
}

(async () => {
  await confere("ADMIN entra", { user: { id: "admin", role: "ADMIN" } }, true);
  await confere("STAFF da equipe interna entra", { user: { id: "interno", role: "STAFF" } }, true);
  await confere("funcionário de loja (STAFF com dono) não entra", { user: { id: "caixa", role: "STAFF" } }, false);
  await confere("dono de loja não entra", { user: { id: "dono", role: "FRANCHISEE" } }, false);
  await confere("cookie diz ADMIN mas o banco não: não entra", { user: { id: "rebaixado", role: "ADMIN" } }, false);
  await confere("usuário que não existe não entra", { user: { id: "sumiu", role: "ADMIN" } }, false);
  await confere("sem sessão não entra", null, false);
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
