/**
 * A loja de quem está no painel, para as rotas do Meu Assessor.
 *
 * Ligar o serviço cobra no boleto e lançar mexe no financeiro: só o titular
 * (ou o ADMIN na loja que ele abriu) — funcionário não liga nem conversa.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function lojaDoAssessorDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!u || u.role === "STAFF") return null;
  const franchiseeId = u.ownerId || u.id;
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { id: true, notificationPhone: true, chatbotConfig: true, storeTimezone: true, storeName: true, name: true },
  });
  if (!loja) return null;
  return { franchiseeId, usuarioId: u.id, loja };
}
