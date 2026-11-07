/**
 * src/lib/loja-do-cardapio.ts
 *
 * A loja cujo cardápio as telas "Código PDV" e "Itens das integrações" (e a
 * rota api/store/cardapio/integracoes) mostram. Funcionário vê a do dono
 * (`ownerId`), o dono vê a própria, e o ADMIN vê a loja escolhida no seletor
 * (cookie firehub_active_store, lib/loja-ativa.ts) — sem loja escolhida não há
 * "um cardápio", e a tela fica vazia em vez de misturar as lojas todas.
 * Mesmo jeito de autenticar de api/store/kds-sem-categoria.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookieDaVisao } from "@/lib/loja-ativa";

export async function lojaDoCardapioDaSessao(): Promise<string | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return null;
  const user = await prisma.user
    .findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true, role: true } })
    .catch(() => null);
  if (!user) return null;
  if (user.role === "ADMIN") {
    const escolhida = await cookieDaVisao();
    return escolhida && escolhida !== "all" ? escolhida : null;
  }
  return user.ownerId || user.id;
}
