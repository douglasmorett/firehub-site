import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";

/**
 * /api/store/trilha-produtos
 *
 * A lista enxuta do cardápio para ESCOLHER O PRÊMIO da Trilha Premiada — foto,
 * nome, preço e categoria, nada mais.
 *
 * Existe separada de /api/admin/menu-products de propósito: aquela devolve o
 * cardápio inteiro com os combos aninhados (já medido em 14 MB numa loja), e a
 * tela de prêmio só precisa de uma grade de fotos. Puxar megabytes para montar
 * um seletor seria pagar o preço do balcão numa tela de configuração.
 *
 * Fora da lista: produto inativo (a loja escolheria um prêmio que não sai),
 * espelho de integração (é item do iFood/99, não do cardápio próprio) e opção
 * que só existe dentro de combo — "6 Nuggets" do combo não é prêmio.
 *
 * COMBO também fica de fora, e este é o único corte que merece explicação: o
 * combo só existe depois de alguém escolher as partes dele (sabor, tamanho,
 * acompanhamento). Dar um combo de prêmio exigiria abrir essa escolha no
 * checkout; enquanto isso não existe, o prêmio entraria no pedido pela metade
 * e a cozinha receberia um item sem saber o que montar.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const produtos = await prisma.menuProduct.findMany({
    where: {
      franchiseeId: user.ownerId || user.id,
      active: true,
      isCombo: false,
      // Os dois filtros têm `NOT`: juntos num objeto só, um sobrescreveria o
      // outro em silêncio e o espelho do iFood voltaria para a lista.
      AND: [{ NOT: { apenasEmCombo: true } }, SEM_PRODUTO_DE_INTEGRACAO],
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, price: true, imageUrl: true, category: true },
    take: 400,
  });

  return NextResponse.json({ produtos });
}
