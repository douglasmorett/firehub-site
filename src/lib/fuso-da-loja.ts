/**
 * O fuso de uma loja pelo id — para rotas e processadores que só têm o id em
 * mãos (integrações, totem, mesa). Servidor apenas: usa o prisma.
 *
 * Quem já carregou a loja deve usar `storeTimezone` direto, sem esta consulta.
 */
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";

export async function fusoDaLoja(franchiseeId: string | null | undefined): Promise<string> {
  if (!franchiseeId) return FUSO_PADRAO;
  try {
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeTimezone: true } });
    return loja?.storeTimezone || FUSO_PADRAO;
  } catch {
    return FUSO_PADRAO;
  }
}
