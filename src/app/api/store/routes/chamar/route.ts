/**
 * POST /api/store/routes/chamar — a loja chama (de novo) o motoboy de uma
 * rota AUTOMÁTICA, ou troca quem é chamado. Os botões "Chamar de novo" e
 * "Trocar entregador" do card da rota na Roteirização (Rota 100%
 * automatizada, Fase 2; plano no vault "FireHub - Plano despacho
 * automático", D11).
 *
 *   corpo:    { routeId, motoboyId: string | null }   (null = todos os livres)
 *   resposta: { success, rota: { id, routeNumber, chamadaEm, chamadaMotoboyId } }
 *
 * Grava `chamadaEm = agora` e `chamadaMotoboyId`, manda o push ROTA_PRONTA
 * ao novo (ou a todos os livres) e ROTA_FOI_COM_OUTRO a quem era o chamado
 * (lib/roteirizacao-automatica/executar.ts, `chamarARota` — o mesmo do cron).
 *
 * NÃO usa o PATCH de /api/store/routes: aquele grava `motoboyId` nos pedidos
 * (é a troca de entregador da rota que já saiu), e na rota automática isso
 * quebraria o claim do QR — o chamado ainda não é dono (D7).
 *
 * Só rota AUTO desta loja, ainda aguardando (PENDING). 404 de outra loja.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chamarARota } from "@/lib/roteirizacao-automatica/executar";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    // A loja de quem pede, como o /dispatch: a rota AUTO nasce no cron com o
    // id da loja (`RouteSchedule.franchiseeId`).
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    const corpo = await req.json().catch(() => ({} as any));
    const routeId = corpo?.routeId ? String(corpo.routeId) : "";
    if (!routeId) return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    if (corpo?.motoboyId !== null && typeof corpo?.motoboyId !== "string") {
      return NextResponse.json({ error: "Diga quem chamar (o entregador, ou todos)." }, { status: 400 });
    }
    const motoboyId: string | null = corpo.motoboyId || null;

    // Rota de outra loja responde como rota inexistente.
    const rota = (await prisma.routeSchedule.findFirst({
      where: { id: routeId, franchiseeId: lojaId },
      select: { id: true, routeNumber: true, status: true, dispatchedAt: true, origem: true } as any,
    })) as unknown as { id: string; routeNumber: string; status: string; dispatchedAt: Date | null; origem: string | null } | null;
    if (!rota) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    if (rota.origem !== "AUTO") {
      return NextResponse.json({ error: "Só a rota automática chama o entregador. Esta é montada à mão: despache pelo card." }, { status: 409 });
    }
    if (rota.status !== "PENDING" || rota.dispatchedAt) {
      return NextResponse.json({ error: `A ${rota.routeNumber} já saiu.` }, { status: 409 });
    }

    if (motoboyId) {
      const motoboy = await prisma.motoboy.findFirst({
        where: { id: motoboyId, active: true, OR: [{ franchiseeId: lojaId }, { franchisee: { ownerId: lojaId } }] },
        select: { id: true },
      });
      if (!motoboy) return NextResponse.json({ error: "Entregador não encontrado (ou inativo)." }, { status: 404 });
    }

    const r = await chamarARota({ lojaId, rotaId: rota.id, motoboyId });
    if (!r.ok) {
      // Entre a leitura e a gravação a rota saiu (puxada pelo QR) ou outro
      // ciclo a chamou: nada foi gravado.
      return NextResponse.json({ error: `A ${rota.routeNumber} mudou agora. Confira o card e tente de novo.` }, { status: 409 });
    }
    return NextResponse.json({ success: true, rota: r.rota });
  } catch (err: any) {
    console.error("[POST /api/store/routes/chamar Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
