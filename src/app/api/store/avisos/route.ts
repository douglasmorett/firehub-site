/**
 * GET  /api/store/avisos              → cancelamentos e disputas do dia em aberto
 * POST /api/store/avisos { ciente: [] } → "Ciente" nos cancelamentos listados
 *
 * Consultado em loop pelo AvisosDoDia (components/customer), montado no layout
 * da loja: o aviso aparece em qualquer tela do painel, não só na de pedidos.
 * A regra do que é aviso mora em lib/avisos-do-dia.ts.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { avisosDoDia, marcarCiente } from "@/lib/avisos-do-dia";

export const dynamic = "force-dynamic";

/** As lojas desta conta — o mesmo recorte do feed de pedidos (customer-order/poll). */
async function lojasDaSessao() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email || "";
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, name: true } });
  if (!user) return null;
  const lojaId = user.ownerId || user.id;
  const ids = [...new Set([lojaId, user.id, user.ownerId].filter(Boolean))] as string[];
  return { lojaId, ids, quem: session?.user?.name || user.name || email };
}

export async function GET() {
  const s = await lojasDaSessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const loja = await prisma.user.findUnique({ where: { id: s.lojaId }, select: { storeTimezone: true } });
  try {
    return NextResponse.json(await avisosDoDia(s.ids, loja?.storeTimezone || FUSO_PADRAO));
  } catch (e: any) {
    // Coluna ainda não criada (boot que falhou) ou banco fora: sem aviso, mas
    // sem 500 em loop no console da loja a cada poucos segundos.
    console.error("[Avisos] Não consegui listar os avisos do dia:", e?.message);
    return NextResponse.json({ cancelamentos: [], disputas: [], erro: true });
  }
}

export async function POST(req: Request) {
  const s = await lojasDaSessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const ids = Array.isArray(body?.ciente) ? body.ciente : [];
  const marcados = await marcarCiente(s.ids, ids, s.quem);
  return NextResponse.json({ ok: true, marcados });
}
