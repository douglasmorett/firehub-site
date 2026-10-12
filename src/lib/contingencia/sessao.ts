/**
 * Quem está pedindo, nas rotas da contingência que o PAINEL chama (ativar,
 * estado, bilhete). As rotas do computador da loja usam a chave
 * (lib/contingencia/servidor.ts → lojaDaChave), não a sessão.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type QuemPede = {
  lojaId: string;
  userId: string;
  email: string;
  /** Dono da conta (não funcionário). Só ele ativa e desativa. */
  dono: boolean;
  /** Suporte do FireHub dentro da loja ("Acessar" do admin): pode ativar pela loja. */
  suporte: boolean;
};

export async function quemPede(): Promise<QuemPede | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return null;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, role: true } });
  if (!u) return null;
  return {
    lojaId: u.ownerId || u.id,
    userId: u.id,
    email,
    dono: !u.ownerId && u.role === "FRANCHISEE",
    suporte: Boolean((session?.user as any)?.impersonatedBy),
  };
}
