/**
 * POST /api/admin/users/reset-password  { userId, confirmacao: "redefinir" }
 *
 * Redefine a senha de uma conta de loja para uma senha SORTEADA na hora, que
 * volta na resposta para o admin passar ao lojista — só ADMIN. Era "123456"
 * fixo para todo mundo: quem soubesse o e-mail de uma loja redefinida entrava.
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
import { gerarSenhaLegivel } from "@/lib/senha-gerada";
import { gravarSenhaNova } from "@/lib/senha-do-grupo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });

  // A tela pede para digitar "redefinir". Conferir aqui também impede que um
  // POST solto (script, clique duplo, aba antiga) derrube a senha de uma loja.
  if (String(body?.confirmacao || "").trim().toLowerCase() !== "redefinir") {
    return NextResponse.json({ error: 'Digite "redefinir" para confirmar.' }, { status: 400 });
  }

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
  const senha = gerarSenhaLegivel();
  const hashed = await bcrypt.hash(senha, 12);
  // Token de recuperação pendente cai junto: a senha nova é esta. Na
  // principal, vale também nas filiais que usavam a mesma (lib/senha-do-grupo.ts).
  await gravarSenhaNova(alvo.id, hashed, { resetToken: null, resetTokenExp: null });

  console.log(`[admin/reset-password] ${session.user.email} redefiniu a senha de ${alvo.email} (${alvo.storeName || alvo.id})`);
  // A senha só sai aqui, para a tela do admin — nunca no log.
  return NextResponse.json({ ok: true, email: alvo.email, storeName: alvo.storeName, senha });
}
