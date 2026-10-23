/**
 * Redefinir senha (api/auth/forgot-password): objeto no lugar do token, do
 * e-mail ou da senha é recusado ANTES de qualquer consulta — no Prisma ele
 * vira filtro (`{ not: "" }`) e trocava a senha de outra conta.
 *
 *   npx tsx scripts/teste-reset-de-senha.ts
 */
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/auth/forgot-password/route";
import { prisma } from "../src/lib/prisma";

(prisma.user as any).findFirst = async () => { throw new Error("CONSULTOU O BANCO"); };

let ip = 0;
async function chama(body: any): Promise<[number, string]> {
  const req = new NextRequest("http://x/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
  });
  const r = await POST(req);
  return [r.status, (await r.json()).error];
}

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

(async () => {
  const recusados: [string, any][] = [
    ["token objeto", { token: { not: "" }, newPassword: "abcdef123" }],
    ["token objeto (gt)", { token: { gt: "" }, newPassword: "abcdef123" }],
    ["e-mail objeto", { email: { contains: "@" } }],
    ["senha objeto", { token: "a".repeat(64), newPassword: { length: 99 } }],
    ["token fora do formato", { token: "abc", newPassword: "abcdef123" }],
    ["senha curta é recusada antes da consulta", { token: "a".repeat(64), newPassword: "123" }],
  ];
  for (const [nome, body] of recusados) {
    try {
      const r = await chama(body);
      confere(nome, r[0] === 400, r);
    } catch (e: any) {
      confere(nome, false, e.message);
    }
  }
  (prisma.user as any).findFirst = async () => null;
  const r = await chama({ token: "a".repeat(64), newPassword: "abcdef123" });
  confere("token no formato certo consulta o banco", r[0] === 400 && r[1] === "Token inválido ou expirado.", r);
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
