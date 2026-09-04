/**
 * GET /api/store/print-queue/status
 *
 * Quando foi a última vez que o Assistente de Impressão desta loja consultou
 * a fila da nuvem. É o que o painel usa para avisar "a impressão parou" —
 * antes disso a loja só descobria pela comanda que não saiu, e o suporte só
 * conseguia saber indo ao PC do caixa.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const eu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!eu) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const loja = await prisma.user.findUnique({
    where: { id: eu.ownerId || eu.id },
    select: { printerConfig: true, printQueuePolledAt: true },
  });

  const pc: any = loja?.printerConfig || null;
  const impressoras: any[] = Array.isArray(pc?.printers) ? pc.printers.filter((p: any) => p?.name) : [];
  const ultimo = loja?.printQueuePolledAt ?? null;

  return NextResponse.json({
    temImpressora: impressoras.length > 0,
    ultimoPoll: ultimo ? ultimo.toISOString() : null,
    paradoHaSegundos: ultimo ? Math.max(0, Math.round((Date.now() - ultimo.getTime()) / 1000)) : null,
  });
}
