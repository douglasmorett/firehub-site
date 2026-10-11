/**
 * POST /api/meta-ads/pixel
 *
 * "Criar o pixel agora" do passo de configurar o anúncio. Usa o pixel que a
 * conta de anúncios já tem ou cria um ("FireHub — <loja>") e grava em
 * `metaPixelId` — a partir daí o cardápio da loja instala o pixel sozinho e os
 * pedidos vindos do anúncio passam a ser contados.
 *
 * A conexão do Facebook já tenta isto sozinha (api/meta-ads/callback); esta
 * rota é a saída quando aquela tentativa falhou ou a loja conectou antes.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { garantirPixelDaConta } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { metaFbAccessToken: true, metaAdAccountId: true, storeName: true, name: true },
  });
  if (!loja?.metaFbAccessToken || !loja.metaAdAccountId) {
    return NextResponse.json(
      { error: "Conecte o Facebook antes de criar o pixel." },
      { status: 400 }
    );
  }

  const pixel = await garantirPixelDaConta(
    loja.metaAdAccountId,
    loja.metaFbAccessToken,
    loja.storeName || loja.name || ""
  );
  if (!pixel) {
    return NextResponse.json(
      {
        error:
          "O Facebook não deixou criar o pixel agora. Tente de novo em alguns minutos — " +
          "ou crie no Gerenciador de Eventos do Facebook e conecte de novo aqui.",
      },
      { status: 502 }
    );
  }

  await prisma.user.update({ where: { id: lojaId }, data: { metaPixelId: pixel.id } });
  return NextResponse.json({ pixelId: pixel.id, nome: pixel.nome, criado: pixel.criado });
}
