/**
 * QUEM está no Caixa de mercado.
 *
 * - Configurar, contratar, registrar computador, importar: o dono (ou o ADMIN
 *   na loja que ele abriu) — a porta do Bill (lib/assessor/loja-da-sessao.ts).
 *   Importar também abre para o funcionário com "Cardápio".
 * - Vender no caixa (/store/caixa-mercado/caixa): o dono e o funcionário com
 *   "Venda presencial" (lib/permissao-da-tela.ts), como o balcão.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export type QuemUsaOCaixa = { lojaId: string; usuarioId: string; nome: string; email: string | null; dono: boolean };

export async function quemUsaOCaixa(tela: string = "/store/caixa-mercado/caixa"): Promise<QuemUsaOCaixa | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return null;
  const dono = await lojaDoAssessorDaSessao();
  if (dono) return { lojaId: dono.franchiseeId, usuarioId: dono.usuarioId, nome: dono.nome || "Dono", email, dono: true };
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, role: true, permissions: true, name: true } });
  if (!u || u.role !== "STAFF" || !u.ownerId) return null;
  if (!funcionarioAbre(tela, u.permissions)) return null;
  return { lojaId: u.ownerId, usuarioId: u.id, nome: (u.name || email).trim(), email, dono: false };
}
