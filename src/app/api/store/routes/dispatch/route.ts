import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { despacharRota } from "@/lib/despacho-da-rota";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // ── A ROTA, O MOTOBOY E OS PEDIDOS TÊM DE SER DESTA LOJA ────────────────
    //
    // Esta rota nem carregava o usuário: qualquer sessão mandava o `routeId`
    // de OUTRA loja e a despachava — pedidos dela em "Saiu para entrega",
    // WhatsApp para os clientes dela, despacho no iFood/99 dela e a NFC-e
    // dela emitida. Agora, antes de qualquer escrita: a rota é da loja de quem
    // pede, o motoboy também, e só os pedidos da loja andam.
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    const lojaId = user.ownerId || user.id;

    const body = await req.json();
    const { routeId, motoboyId } = body;

    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    // A gravação (rota DISPATCHED + pedidos SAIU_ENTREGA numa transação, a
    // trava do segundo clique, o filtro de status) mora em
    // lib/despacho-da-rota.ts desde 22/10/2026: o motoboy que puxa a rota
    // automática pelo QR despacha pelo mesmo caminho. Os efeitos (cliente,
    // NFC-e, app, parceiros, WhatsApp) vão para o `after()` e rodam depois
    // desta resposta.
    //
    // A chamada da rota automática é lida ANTES: despachada pela loja quando
    // estava chamada para TODOS, os outros livres que receberam o "quem
    // chegar primeiro sai com ela" ficam sabendo que ela já saiu
    // (ROTA_JA_SAIU). Coluna da Fase 0, daí o `as any`; ilegível = sem aviso.
    const chamada = (await prisma.routeSchedule
      .findFirst({
        where: { id: String(routeId), OR: [{ franchiseeId: lojaId }, { franchisee: { ownerId: lojaId } }] },
        select: { origem: true, chamadaEm: true, chamadaMotoboyId: true } as any,
      })
      .catch(() => null)) as unknown as { origem: string | null; chamadaEm: Date | null; chamadaMotoboyId: string | null } | null;
    const r = await despacharRota({ lojaId, rotaId: String(routeId), motoboyId, agendar: after });

    if (!r.ok) {
      // Rota de outra loja responde como rota inexistente: a resposta não
      // conta que o id existe.
      if (r.erro === "ROTA_NAO_ENCONTRADA") return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
      if (r.erro === "SEM_MOTOBOY") return NextResponse.json({ error: "Selecione um motoboy para poder despachar a rota!" }, { status: 400 });
      return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });
    }

    if (!r.mudou) {
      return NextResponse.json({
        success: true,
        jaDespachada: true,
        message: `A rota ${r.rota.routeNumber} já tinha saído com o motoboy ${r.motoboy.name}.`,
      });
    }

    if (chamada?.origem === "AUTO" && chamada.chamadaEm && !chamada.chamadaMotoboyId) {
      const quemLevou = { id: r.motoboy.id, nome: r.motoboy.name };
      after(() => import("@/lib/roteirizacao-automatica/executar").then((m) => m.avisarQueARotaJaSaiu({ rotaId: r.rota.id, quemLevou })).catch(() => {}));
    }

    return NextResponse.json({
      success: true,
      message: `🚀 Rota ${r.rota.routeNumber} despachada com sucesso com o motoboy ${r.motoboy.name}!`,
    });
  } catch (err: any) {
    console.error("[POST /api/store/routes/dispatch Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
