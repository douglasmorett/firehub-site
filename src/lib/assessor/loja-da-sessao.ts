/**
 * A loja de quem está no painel, para as rotas do Bill.
 *
 * Ligar o serviço cobra no boleto e lançar mexe no financeiro: só o titular
 * (ou o ADMIN na loja que ele abriu) — funcionário não liga nem conversa.
 *
 * O ADMIN opera a loja ATIVA dele (cookie da loja ativa, como o Financeiro em
 * lib/financeiro/contexto.ts). Sem isso o admin que abriu a Hakim ligava o
 * Bill na conta do próprio admin (achado no teste em produção, 15/10/2026).
 */
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";

/** A loja que o ADMIN está vendo (null = nenhuma escolhida). */
export async function lojaAtivaDoAdmin(): Promise<string | null> {
  try {
    const v = (await cookies()).get(COOKIE_DA_LOJA_ATIVA)?.value;
    return v && v !== "all" ? v : null;
  } catch {
    return null;
  }
}

export async function lojaDoAssessorDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, name: true },
  });
  if (!u || u.role === "STAFF") return null;
  let franchiseeId = u.ownerId || u.id;
  if (u.role === "ADMIN") {
    const ativa = await lojaAtivaDoAdmin();
    if (!ativa) return null;
    franchiseeId = ativa;
  }
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { id: true, notificationPhone: true, chatbotConfig: true, storeTimezone: true, storeName: true, name: true },
  });
  if (!loja) return null;
  // `lojaDoLogin`: a loja em que /api/chatbot/config grava para este login
  // (ownerId || id). No ADMIN pelo seletor ela é a conta do admin, não a loja aberta.
  return { franchiseeId, usuarioId: u.id, lojaDoLogin: u.ownerId || u.id, nome: u.role === "ADMIN" ? "Suporte FireHub" : (u.name || "").split(" ")[0] || null, loja };
}
