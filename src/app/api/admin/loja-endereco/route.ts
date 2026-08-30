import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/loja-endereco — troca o endereço público do cardápio.
 *
 * O `slug` nasce automático no cadastro, montado a partir do que o lojista
 * digitou: a Point Mix ficou com `/loja/57-893-286-eduarda-campos-pereira`,
 * que é a razão social com o CNPJ na frente. Esse é o endereço que vai no
 * cartão, no Instagram e no QR da mesa — e não existia NENHUMA tela para
 * arrumar. Nem o lojista (a tela Minha Loja só exibe a URL), nem o admin.
 *
 * Fica em /api/admin de propósito. Trocar o endereço quebra todo link já
 * distribuído — QR impresso, print no grupo do WhatsApp, anúncio no ar —, e
 * essa não é uma decisão para um clique perdido do lojista no meio do
 * expediente. Passa pelo suporte, que sabe perguntar "esse endereço já está
 * impresso em algum lugar?".
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const quemPediu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });
  if (quemPediu?.role !== "ADMIN") {
    return NextResponse.json({ error: "Só o suporte pode trocar o endereço do cardápio" }, { status: 403 });
  }

  const { storeId, slug } = await req.json().catch(() => ({}) as any);
  if (!storeId || typeof slug !== "string") {
    return NextResponse.json({ error: "Informe storeId e slug" }, { status: 400 });
  }

  // Formato: o slug entra numa URL e vira chave de busca da loja. Só minúsculas,
  // números e hífen — acento e espaço viram %C3%A7 no link que o cliente copia.
  const limpo = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(limpo) || limpo.length < 3 || limpo.length > 60) {
    return NextResponse.json(
      { error: "Use de 3 a 60 caracteres: letras minúsculas, números e hífen entre palavras." },
      { status: 400 }
    );
  }

  // Palavras que já são rotas do site: um slug assim criaria uma loja
  // inalcançável e, pior, uma rota ambígua.
  const reservados = ["login", "cadastro", "admin", "store", "api", "loja", "totem", "uploads", "downloads"];
  if (reservados.includes(limpo)) {
    return NextResponse.json({ error: `"${limpo}" é uma palavra reservada do sistema.` }, { status: 400 });
  }

  const loja = await prisma.user.findUnique({
    where: { id: storeId },
    select: { id: true, slug: true, storeName: true, name: true },
  });
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const ocupado = await prisma.user.findFirst({
    where: { slug: limpo, NOT: { id: storeId } },
    select: { storeName: true, name: true },
  });
  if (ocupado) {
    return NextResponse.json(
      { error: `Esse endereço já é de ${ocupado.storeName || ocupado.name}.` },
      { status: 409 }
    );
  }

  const atualizada = await prisma.user.update({
    where: { id: storeId },
    data: { slug: limpo },
    select: { id: true, slug: true, storeName: true },
  });

  // O endereço antigo passa a responder 404 — quem for trocar precisa saber
  // disso para avisar a loja, então volta na resposta em vez de sumir.
  return NextResponse.json({
    ok: true,
    loja: atualizada.storeName || loja.name,
    enderecoAnterior: loja.slug ? `/loja/${loja.slug}` : null,
    enderecoNovo: `/loja/${atualizada.slug}`,
    aviso: "O endereço anterior deixa de funcionar. Avise a loja se ele já estiver em QR, cartão ou anúncio.",
  });
}
