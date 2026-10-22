/**
 * Sessão ASSINADA do app FireHub (apps/firehub), o app da loja no celular.
 *
 * O painel dentro do app é o site de sempre, com o cookie do NextAuth. O que
 * é do app nativo (o aviso de pedido novo e a impressora Bluetooth) roda sem
 * a página aberta, então precisa de um token próprio — mesmo desenho da
 * sessão do motoboy (lib/motoboy-sessao.ts):
 *
 *   `l1.<userId>.<expira>.<hmac>`, assinado com o NEXTAUTH_SECRET.
 *
 * O hash da SENHA entra na assinatura: trocar a senha derruba o app em todos
 * os celulares, sem coluna nova e sem lista de revogação. O token nasce do
 * login já feito no painel (POST /api/app-firehub/sessao), nunca de senha
 * digitada fora dele — a tela de login, a trava de tentativas e o 2º fator
 * continuam sendo os do site.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

const VALIDADE_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar a sessão do app.");
  return s;
}

function assinar(userId: string, exp: number, hashSenha: string | null): string {
  const marcaDaSenha = crypto.createHash("sha256").update(String(hashSenha || "")).digest("hex").slice(0, 12);
  return crypto.createHmac("sha256", chave())
    .update(`app-firehub:${userId}:${exp}:${marcaDaSenha}`)
    .digest("hex").slice(0, 32);
}

export function criarSessaoDoApp(userId: string, hashSenha: string | null): string {
  const exp = Date.now() + VALIDADE_MS;
  return `l1.${userId}.${exp}.${assinar(userId, exp, hashSenha)}`;
}

export type UsuarioDoApp = {
  /** Quem entrou (o dono ou um funcionário). */
  userId: string;
  /** A loja: o dono, ou o dono do funcionário. */
  lojaId: string;
};

/**
 * Confere assinatura, validade e a conta numa passada. null para QUALQUER
 * falha — quem chama responde 401 sem detalhar.
 */
export async function exigirUsuarioDoApp(req: NextRequest): Promise<UsuarioDoApp | null> {
  const bruto = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const partes = bruto.split(".");
  if (partes.length !== 4 || partes[0] !== "l1") return null;
  const [, userId, expStr, sig] = partes;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, password: true, ownerId: true },
  });
  // O dono ou o funcionário da loja (STAFF, com ownerId). Admin e parceiro, não.
  if (!u || (u.role !== "FRANCHISEE" && u.role !== "STAFF")) return null;

  const esperada = Buffer.from(assinar(userId, exp, u.password));
  const recebida = Buffer.from(sig);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;

  return { userId: u.id, lojaId: u.ownerId || u.id };
}
