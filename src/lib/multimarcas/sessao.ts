/**
 * Quem USA o Multimarcas e quem CONTRATA.
 *
 * Montar a página das marcas (separar categorias, logo, capa, banners) é
 * trabalho de cardápio: quem cuida do cardápio da loja também cuida dele. Já
 * ligar e desligar põe R$ 97 no boleto — isso continua só do dono (ou do ADMIN
 * na loja), pela mesma porta do Bill (lib/assessor/loja-da-sessao.ts).
 *
 * Douglas, 22/10/2026 (Frangoso, login de funcionário barrado com "Só o dono
 * da loja contrata o Multimarcas" com o módulo já ativo): "se tiver ativo, tem
 * que aparecer em qualquer acesso. Se não, ele só não pode ativar."
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export async function lojaDoMultimarcasDaSessao(): Promise<{ franchiseeId: string; podeContratar: boolean; nomeDaLoja: string | undefined } | null> {
  const dono = await lojaDoAssessorDaSessao();
  if (dono) return { franchiseeId: dono.franchiseeId, podeContratar: true, nomeDaLoja: dono.loja.storeName || dono.loja.name || undefined };

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { ownerId: true, role: true, permissions: true },
  });
  if (!u || u.role !== "STAFF" || !u.ownerId) return null;
  if (!funcionarioAbre("/store/multimarcas", u.permissions)) return null;
  const loja = await prisma.user.findUnique({ where: { id: u.ownerId }, select: { storeName: true, name: true } });
  if (!loja) return null;
  return { franchiseeId: u.ownerId, podeContratar: false, nomeDaLoja: loja.storeName || loja.name || undefined };
}
