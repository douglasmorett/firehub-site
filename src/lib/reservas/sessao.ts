/**
 * Quem GERE as reservas e quem CONTRATA o módulo.
 *
 * Ver, criar, marcar chegada e mudar a configuração é do dono e do funcionário
 * com acesso à tela (/store/reservas em lib/permissao-da-tela.ts: quem cuida
 * do salão). Ligar e desligar põe R$ 49,90 no boleto — só o dono (ou o ADMIN na
 * loja), pela mesma porta do Bill e da Balança (lib/assessor/loja-da-sessao.ts).
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export async function lojaDasReservasDaSessao(): Promise<{ franchiseeId: string; podeContratar: boolean; quem: string | null } | null> {
  const session = await getServerSession(authOptions);
  const quem = (session?.user as any)?.name || session?.user?.email || null;
  const dono = await lojaDoAssessorDaSessao();
  if (dono) return { franchiseeId: dono.franchiseeId, podeContratar: true, quem: dono.nome || quem };

  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { ownerId: true, role: true, permissions: true, name: true },
  });
  if (!u || u.role !== "STAFF" || !u.ownerId) return null;
  if (!funcionarioAbre("/store/reservas", u.permissions)) return null;
  return { franchiseeId: u.ownerId, podeContratar: false, quem: u.name || quem };
}
