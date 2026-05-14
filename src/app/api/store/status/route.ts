import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET - retorna status da loja (público, por slug)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");

  if (slug) {
    const user = await prisma.user.findUnique({
      where: { slug },
      select: { storeOpen: true, cashOpen: true, storeName: true },
    });
    if (!user) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(user);
  }

  // Autenticado: retorna status do próprio usuário
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { storeOpen: true, cashOpen: true },
  });
  return NextResponse.json(user);
}

// PATCH - toggle loja/caixa
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const data: any = {};
  if (body.storeOpen !== undefined) data.storeOpen = body.storeOpen;
  if (body.cashOpen !== undefined) data.cashOpen = body.cashOpen;

  const user = await prisma.user.update({
    where: { email: session.user?.email || "" },
    data,
    select: { storeOpen: true, cashOpen: true },
  });
  return NextResponse.json(user);
}
