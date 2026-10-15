/**
 * GET /api/store/foody/avisos — as chamadas à Foody/Voe que falharam nas
 * últimas horas, para o aviso no topo do painel de pedidos
 * (components/customer/AvisosDaFoody.tsx). Loja sem a integração: { ligada: false }
 * e a tela para de perguntar.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { configDaFoody, falhasRecentesDaFoody } from "@/lib/foody-no-banco";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = user.ownerId || user.id;
  const config = await configDaFoody(lojaId);
  if (!config.conectada) return NextResponse.json({ ligada: false, falhas: [] });
  return NextResponse.json({ ligada: true, falhas: await falhasRecentesDaFoody(lojaId) });
}
