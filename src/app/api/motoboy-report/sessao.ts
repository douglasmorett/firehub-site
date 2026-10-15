/**
 * Quem está mexendo no acerto do motoboy (diária do dia, pendência, opções).
 *
 * A loja é a do DONO (`ownerId || id`), como no relatório (api/motoboy-report).
 * Funcionário (STAFF) só se a conta dele abre a tela Motoboys — é a mesma régua
 * do menu (lib/permissao-da-tela.ts). O nome vai junto: a pendência mostra quem
 * lançou.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export type QuemMexeNoAcerto = { lojaId: string; quem: string; papel: string };

export async function quemMexeNoAcerto(): Promise<QuemMexeNoAcerto | { erro: string; status: number }> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return { erro: "Não autorizado", status: 401 };
  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true, name: true, email: true, role: true, permissions: true },
  });
  if (!u) return { erro: "Usuário não encontrado", status: 404 };
  const papel = String(u.role || "").toUpperCase();
  if (papel !== "FRANCHISEE" && papel !== "ADMIN" && papel !== "STAFF") return { erro: "Sem acesso ao acerto dos motoboys.", status: 403 };
  if (papel === "STAFF" && !funcionarioAbre("/store/motoboys", (u as any).permissions)) {
    return { erro: "Sua conta não tem acesso à tela Motoboys.", status: 403 };
  }
  return { lojaId: u.ownerId || u.id, quem: u.name || u.email, papel };
}

/** O motoboy é desta loja? (nunca mexer no acerto do entregador de outra conta) */
export async function motoboyDaLoja(motoboyId: unknown, lojaId: string) {
  if (typeof motoboyId !== "string" || !motoboyId) return null;
  return prisma.motoboy.findFirst({ where: { id: motoboyId, franchiseeId: lojaId }, select: { id: true, name: true, paymentType: true, dailyRate: true } });
}
