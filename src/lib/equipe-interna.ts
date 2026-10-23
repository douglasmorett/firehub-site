import { prisma } from "@/lib/prisma";

/**
 * Quem pode usar o /admin e as actions dele (pedidos de insumo, catálogo,
 * emergências): ADMIN, ou STAFF da equipe interna do FireHub.
 *
 * O papel "STAFF" é o mesmo que o dono da loja dá aos funcionários dele
 * (/api/store/team grava role STAFF com ownerId = a loja). Olhar só o papel
 * deixava o caixa de qualquer loja abrir o /admin, ver CPF/CNPJ e Pix de todas
 * as lojas e mudar pedido de insumo. O que separa os dois é o `ownerId`:
 * funcionário de loja tem dono, a equipe interna não.
 *
 * Lido do banco, e não do cookie: o papel no cookie é o do dia do login.
 */
export async function ehEquipeInterna(session: any): Promise<boolean> {
  const id = session?.user?.id;
  if (!id) return false;
  const usuario = await prisma.user.findUnique({
    where: { id: String(id) },
    select: { role: true, ownerId: true },
  });
  if (!usuario) return false;
  if (usuario.role === "ADMIN") return true;
  return usuario.role === "STAFF" && !usuario.ownerId;
}
