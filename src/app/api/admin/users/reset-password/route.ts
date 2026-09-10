/**
 * POST /api/admin/users/reset-password  { userId }
 *
 * Redefine a senha de uma conta de loja para a senha padrão de suporte
 * (SENHA_PADRAO) — só ADMIN. O lojista troca depois, se quiser.
 *
 * Existe porque "esqueci a senha" depende de e-mail chegar, e o e-mail nem
 * sempre chega (Hotmail joga em spam, o cadastro tem e-mail antigo): a NIK
 * Esfihas e Pizzas ficou sem entrar no sistema em 10/09/2026 com o dono no
 * telefone, e a única saída era mexer no banco na mão. Quem redefine é o
 * admin, na tela, com confirmação — e fica no log quem fez e para quem.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// Senha padrão de suporte. Não é exportada: arquivo de rota só pode exportar
// os handlers e as configs do Next.
const SENHA_PADRAO = "123456";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });

  const alvo = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, storeName: true, role: true },
  });
  if (!alvo) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  // Só conta de loja (ou funcionário de loja). Nunca outro admin por aqui.
  if (alvo.role === "ADMIN") {
    return NextResponse.json({ error: "Conta de administrador não é redefinida por esta tela." }, { status: 400 });
  }

  // Mesmo custo de hash do fluxo "esqueci a senha" (forgot-password).
  const hashed = await bcrypt.hash(SENHA_PADRAO, 12);
  await prisma.user.update({
    where: { id: alvo.id },
    // Token de recuperação pendente cai junto: a senha nova é esta.
    data: { password: hashed, resetToken: null, resetTokenExp: null },
  });

  console.log(`[admin/reset-password] ${session.user.email} redefiniu a senha de ${alvo.email} (${alvo.storeName || alvo.id}) para a padrão.`);
  return NextResponse.json({ ok: true, email: alvo.email, storeName: alvo.storeName, senha: SENHA_PADRAO });
}
