/**
 * GET /api/store/waiters/acesso
 *
 * O que a aba Garçons precisa para montar o "Link de acesso do garçom":
 * o slug da loja. O endereço completo é montado no navegador com
 * window.location.origin — é o domínio que o gerente está usando de fato,
 * sem depender de variável de ambiente que dentro do container aponta para
 * o host interno.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loja = await prisma.user.findUnique({
    where: { id: dbUser.ownerId || dbUser.id },
    select: { slug: true, storeName: true, name: true },
  });

  return NextResponse.json({
    slug: loja?.slug || null,
    caminho: loja?.slug ? `/garcom/${encodeURIComponent(loja.slug)}` : null,
    nomeDaLoja: loja?.storeName || loja?.name || "",
  });
}
