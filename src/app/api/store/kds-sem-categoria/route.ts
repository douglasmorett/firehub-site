import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PREFIXOS_DE_ESPELHO } from "@/lib/cardapio-interno";
import { categoriaResolvida, ehCategoriaDeIntegracao, montarMapa } from "@/lib/categoria-do-item";

/**
 * Itens das integrações (iFood, 99, Wabiz, Brendi…) que o KDS não sabe em que
 * tela pôr — e a escolha da categoria deles pelo lojista.
 *
 * O item de plataforma aponta para um produto ESPELHO (`ifood-…`, inativo).
 * `categoriaResolvida` acha a categoria pelo nome, pelo tamanho da pizza e
 * pelas palavras do cardápio; quando nada disso acha, o item fica sem
 * categoria e aparece em TODA tela filtrada, para não sumir da cozinha
 * (lib/kds-telas.ts, `pedidoNaTela`). Esta rota lista esses e grava a
 * categoria escolhida no próprio espelho — a categoria do espelho vale quando
 * é da loja ("A CATEGORIA DO ESPELHO VALE…", lib/categoria-do-item.ts), então
 * dali em diante o item cai só na tela daquela categoria.
 */

async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  return user ? user.ownerId || user.id : null;
}

function ehEspelho(p: { id: string; active: boolean }) {
  return !p.active && PREFIXOS_DE_ESPELHO.some((pre) => p.id.startsWith(pre));
}

export async function GET() {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: lojaId },
    select: { id: true, name: true, category: true, active: true },
  });
  const mapa = montarMapa(produtos);

  const semCategoria = produtos
    .filter((p) => ehEspelho(p) && ehCategoriaDeIntegracao(p.category))
    .filter((p) => !categoriaResolvida({ productName: p.name, menuProduct: p }, mapa))
    .map((p) => ({
      id: p.id,
      nome: p.name,
      plataforma: String(p.category || ""),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const categorias = Array.from(
    new Set(
      produtos
        .filter((p) => p.active && p.category && !ehCategoriaDeIntegracao(p.category))
        .map((p) => String(p.category).trim())
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  return NextResponse.json({ itens: semCategoria, categorias });
}

export async function PATCH(req: NextRequest) {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const corpo = await req.json().catch(() => null);
  const id = String(corpo?.id || "");
  const categoria = String(corpo?.categoria || "").trim();
  if (!id || !categoria) return NextResponse.json({ error: "Informe o item e a categoria" }, { status: 400 });

  const produto = await prisma.menuProduct.findFirst({
    where: { id, franchiseeId: lojaId },
    select: { id: true, active: true },
  });
  if (!produto || !ehEspelho(produto)) {
    return NextResponse.json({ error: "Item de integração não encontrado nesta loja" }, { status: 404 });
  }

  // Só categoria que a loja já usa no cardápio: é ela que a tela do KDS filtra.
  const existe = await prisma.menuProduct.findFirst({
    where: { franchiseeId: lojaId, active: true, category: { equals: categoria, mode: "insensitive" } },
    select: { category: true },
  });
  if (!existe || ehCategoriaDeIntegracao(existe.category)) {
    return NextResponse.json({ error: "Escolha uma categoria do seu cardápio" }, { status: 400 });
  }

  await prisma.menuProduct.update({ where: { id }, data: { category: existe.category } });
  return NextResponse.json({ ok: true, categoria: existe.category });
}
