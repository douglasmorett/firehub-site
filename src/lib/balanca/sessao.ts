/**
 * Quem CONFIGURA a balança e quem CONTRATA.
 *
 * Escolher os produtos por quilo e abrir a tela de pesagem é do dono e do
 * funcionário com acesso à tela (/store/balanca em lib/permissao-da-tela.ts).
 * Ligar e desligar põe R$ 197 no boleto — só o dono (ou o ADMIN na loja), pela
 * mesma porta do Bill e do Multimarcas (lib/assessor/loja-da-sessao.ts).
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export async function lojaDaBalancaDaSessao(): Promise<{ franchiseeId: string; podeContratar: boolean } | null> {
  const dono = await lojaDoAssessorDaSessao();
  if (dono) return { franchiseeId: dono.franchiseeId, podeContratar: true };

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { ownerId: true, role: true, permissions: true },
  });
  if (!u || u.role !== "STAFF" || !u.ownerId) return null;
  if (!funcionarioAbre("/store/balanca", u.permissions)) return null;
  return { franchiseeId: u.ownerId, podeContratar: false };
}
