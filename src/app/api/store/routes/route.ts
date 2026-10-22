import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { criarRotaDaLoja } from "@/lib/rotas-da-loja";

export const dynamic = "force-dynamic";

/**
 * O pedido como o card da rota o mostra (aba ROTAS da roteirização).
 *
 * `dailyOrderNumber` faltava: o card e o COPIAR caíam no fim do id
 * ("📦 3 Pedidos: X7KQ, 9B2M…") e o lojista não reconhecia os próprios
 * pedidos na rota. `routeSequence` não entra — vive fora do schema.prisma.
 */
const CAMPOS_DO_PEDIDO_NA_ROTA = {
  id: true,
  status: true,
  dailyOrderNumber: true,
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  ifoodReference: true,
  openDeliveryReference: true,
  isRoutePriority: true,
  // "aguardando cozinha · 2/3 prontos" no card da rota automática: o pronto
  // do KDS (READY/FINISHED) vem antes do status PRONTO (pedidoJaEstaPronto).
  kdsStage: true,
  totalAmount: true,
  createdAt: true,
} as const;

// Helper para obter IDs da franquia vinculados
async function getValidFranchiseeIds(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, ownerId: true, email: true },
  });

  const targetId = user?.ownerId || user?.id || "";

  const allStoreUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: targetId },
        { ownerId: targetId },
      ],
    },
    select: { id: true },
  });

  return Array.from(
    new Set([
      ...allStoreUsers.map((u) => u.id),
      targetId,
      user?.id,
      user?.ownerId,
    ].filter(Boolean))
  ) as string[];
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const validFranchiseeIds = await getValidFranchiseeIds(user.id);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Sem `select` na rota: vêm todas as colunas dela — `origem` ("AUTO" =
    // Rota 100% automatizada, o selo 🤖 do card), `chamadaEm` e
    // `chamadaMotoboyId` inclusive (colunas da Fase 0 no schema.prisma; o
    // client do build as conhece).
    const routes = await prisma.routeSchedule.findMany({
      where: {
        franchiseeId: { in: validFranchiseeIds },
        createdAt: { gte: twentyFourHoursAgo },
      },
      include: {
        motoboy: {
          select: { id: true, name: true, phone: true },
        },
        orders: { select: CAMPOS_DO_PEDIDO_NA_ROTA },
      },
      orderBy: { createdAt: "desc" },
    });

    // ── AS PARADAS NA ORDEM EM QUE A LOJA MONTOU ──────────────────────────
    //
    // O `include` devolve os pedidos da rota na ordem que o banco quiser: o
    // card, o COPIAR e a linha da rota no mapa saíam embaralhados, a linha
    // indo e voltando pela cidade. A ordem é a `routeSequence` gravada na
    // montagem — coluna fora do schema.prisma, daí o SQL cru (o mesmo de
    // api/motoboys/orders). Sem a coluna, fica a ordem de antes.
    const idsNasRotas = routes.flatMap((r) => r.orders.map((o) => o.id));
    if (idsNasRotas.length > 0) {
      try {
        const linhas = await prisma.$queryRaw<{ id: string; routeSequence: number | null }[]>`
          SELECT "id", "routeSequence" FROM "CustomerOrder"
          WHERE "id" = ANY(${idsNasRotas}) AND "routeSequence" IS NOT NULL
        `;
        const posicao = new Map(linhas.map((l) => [l.id, Number(l.routeSequence)]));
        const ordem = (id: string) => posicao.get(id) ?? Number.MAX_SAFE_INTEGER;
        for (const r of routes) r.orders.sort((a, b) => ordem(a.id) - ordem(b.id));
      } catch (e: any) {
        console.warn("[Rotas] routeSequence não lida (coluna ausente?):", e?.message?.slice(0, 120));
      }
    }

    // ── FORA DA AUTOMÁTICA ────────────────────────────────────────────────
    //
    // Os pedidos que a loja tirou de uma rota automática (Desfazer, ou tirados
    // da rota): a lista de pendentes mostra "✋ fora da automática · voltar".
    // Coluna da Fase 2 fora do client local, daí o SQL cru; o recorte por
    // loja e pelas últimas 24 h anda no índice (franchiseeId, createdAt).
    let foraDaAutomatica: string[] = [];
    try {
      const marcados = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CustomerOrder"
        WHERE "franchiseeId" = ANY(${validFranchiseeIds}) AND "createdAt" >= ${twentyFourHoursAgo}
          AND "semRotaAutomaticaEm" IS NOT NULL
      `;
      foraDaAutomatica = marcados.map((m) => m.id);
    } catch (e: any) {
      console.warn("[Rotas] semRotaAutomaticaEm não lida (coluna ausente?):", e?.message?.slice(0, 120));
    }

    return NextResponse.json({ routes, foraDaAutomatica });
  } catch (err: any) {
    console.error("[GET /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const { orderIds, motoboyId, color, routeNumber } = body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: "Informe ao menos 1 pedido para criar a rota" }, { status: 400 });
    }

    const validFranchiseeIds = await getValidFranchiseeIds(user.id);
    const primaryFranchiseeId = validFranchiseeIds[0] || user.id;

    // A gravação mora em lib/rotas-da-loja.ts — a mesma da Rota 100%
    // automatizada (o cron), para a rota da loja e a do servidor nascerem
    // iguais: número do expediente, prioridade no KDS e ordem das paradas.
    const { rota: newRoute } = await criarRotaDaLoja({
      lojaId: primaryFranchiseeId,
      idsDaLoja: validFranchiseeIds,
      orderIds,
      motoboyId,
      color,
      routeNumber,
      origem: "MANUAL",
    });

    // A rota volta com o que a roteirização mostra no card (o mesmo recorte
    // do GET). Voltava com `orders: true` — todas as colunas de cada pedido,
    // as de JSON inclusive — para a tela usar só o id.
    const fullRoute = await prisma.routeSchedule.findUnique({
      where: { id: newRoute.id },
      include: {
        motoboy: { select: { id: true, name: true, phone: true } },
        orders: { select: CAMPOS_DO_PEDIDO_NA_ROTA },
      },
    });
    // Na ordem em que a loja montou (a mesma do GET): `orderIds` é a sequência.
    if (fullRoute) {
      const posicao = new Map(orderIds.map((id: unknown, i: number) => [String(id), i] as const));
      fullRoute.orders.sort(
        (a, b) => (posicao.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (posicao.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    }

    return NextResponse.json({ success: true, route: fullRoute });
  } catch (err: any) {
    console.error("[POST /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const { routeId, motoboyId, color, orderIds } = body;

    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    const updatedRoute = await prisma.routeSchedule.update({
      where: { id: routeId },
      data: {
        motoboyId: motoboyId === null ? null : (motoboyId || undefined),
        color: color || undefined,
      },
    });

    // ── TROCAR O ENTREGADOR DA ROTA ───────────────────────────────────
    //
    // O pedido tem que SAIR do app de quem estava com ele e aparecer no do
    // novo — o app lista por `motoboyId` (api/motoboys/orders), e é essa única
    // escrita que move o pedido de um celular para o outro. Sem ela, a rota
    // trocava de nome no painel e o pedido continuava no aparelho do antigo.
    //
    // PEDIDO JÁ ENTREGUE OU CANCELADO NÃO É TOCADO. Ele é história: quem
    // entregou entregou, e reescrever o motoboy ali moveria o PAGAMENTO da
    // entrega para alguém que não a fez (o relatório soma por motoboyId).
    if (motoboyId !== undefined) {
      const { STATUS_CANCELADOS, STATUS_FINALIZADOS } = await import("@/lib/status-pedido");
      // Quem estava com cada pedido ANTES: é para eles que sai o "saiu da
      // sua lista", e é a comparação que decide se o novo precisa de aviso.
      const abertosAntes = await prisma.customerOrder.findMany({
        where: { routeId, status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] } },
        select: { id: true, motoboyId: true, dailyOrderNumber: true, customerAddress: true },
      });
      await prisma.customerOrder.updateMany({
        where: {
          routeId,
          status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] },
        },
        data: {
          motoboyId: motoboyId === null ? null : motoboyId,
          // O carimbo de "puxou pelo QR" é de quem puxou. Mantido ao lado do
          // nome novo, a tela juraria que o entregador novo puxou o pedido num
          // horário em que ele nem sabia que ele existia.
          motoboyPuxadoEm: null,
        },
      });

      // Aviso no app nativo (lib/app-motoboy/aparelhos.ts), em segundo plano.
      const novoDono = motoboyId === null ? null : String(motoboyId);
      const chegaram = abertosAntes.filter((o) => o.motoboyId !== novoDono);
      const perderam = [...new Set(chegaram.map((o) => o.motoboyId).filter((m): m is string => Boolean(m)))];
      if (chegaram.length > 0) {
        import("@/lib/app-motoboy/aparelhos")
          .then(async ({ avisarPedidosNovos, avisarMotoboy }) => {
            if (novoDono) await avisarPedidosNovos(novoDono, chegaram, updatedRoute.routeNumber);
            for (const antigo of perderam) {
              await avisarMotoboy(antigo, {
                titulo: `↩️ ${updatedRoute.routeNumber || "A rota"} saiu da sua lista`,
                corpo: "A loja passou estas entregas para outro entregador.",
                dados: { tipo: "PEDIDO_REMOVIDO" },
              });
            }
          })
          .catch(() => {});
      }
    }

    // Se orderIds foram atualizados na rota
    if (Array.isArray(orderIds)) {
      // Tirado de uma rota AUTOMÁTICA pela loja: o cron não o agrupa de novo
      // (`semRotaAutomaticaEm`, "tirado-pela-loja") até o "voltar" da lista —
      // senão, 20 s depois, ele voltava para uma rota. `origem` é coluna da
      // Fase 0: o client do build a conhece; o `as any` é do client local.
      if ((updatedRoute as any).origem === "AUTO") {
        await (prisma.customerOrder as any).updateMany({
          where: { routeId, id: { notIn: orderIds } },
          data: { semRotaAutomaticaEm: new Date() },
        });
      }

      // Remove pedidos antigos que saíram da rota
      await prisma.customerOrder.updateMany({
        where: { routeId, id: { notIn: orderIds } },
        data: { routeId: null, isRoutePriority: false },
      });

      // Adiciona novos pedidos à rota
      for (const id of orderIds) {
        const ord = await prisma.customerOrder.findUnique({ where: { id }, select: { status: true } });
        const isNotReady = ord && ord.status !== "PRONTO" && ord.status !== "SAIU_ENTREGA" && ord.status !== "ENTREGUE";
        await prisma.customerOrder.update({
          where: { id },
          data: {
            routeId,
            motoboyId: motoboyId || undefined,
            isRoutePriority: !!isNotReady,
          },
        });
      }
    }

    const route = await prisma.routeSchedule.findUnique({
      where: { id: routeId },
      include: { motoboy: true, orders: true },
    });

    return NextResponse.json({ success: true, route });
  } catch (err: any) {
    console.error("[PATCH /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const routeId = req.nextUrl.searchParams.get("routeId");
    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    // ── A rota é DESTA loja? ──────────────────────────────────────────────
    // Não havia conferência nenhuma: qualquer sessão autenticada apagava a
    // rota de qualquer loja pelo id, e junto desatribuía os pedidos dela.
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const validFranchiseeIds = await getValidFranchiseeIds(user.id);

    const rota = (await prisma.routeSchedule.findFirst({
      where: { id: routeId, franchiseeId: { in: validFranchiseeIds } },
      select: { id: true, motoboyId: true, status: true, dispatchedAt: true, routeNumber: true, origem: true } as any,
    })) as unknown as { id: string; motoboyId: string | null; status: string; dispatchedAt: Date | null; routeNumber: string; origem: string | null } | null;
    if (!rota) {
      return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    }

    // ── Rota que já saiu não se apaga ─────────────────────────────────────
    //
    // Depois de despachada ela virou HISTÓRICO: o relatório de entregas soma o
    // que cada motoboy levou por `motoboyId`, e apagar a rota desatribuiria os
    // pedidos — apagando o acerto de quem já fez a entrega. Trocar o ENTREGADOR
    // continua liberado pelo PATCH, que é a correção legítima de "despachei no
    // nome errado" e move o pedido de um celular para o outro.
    if (rota.status === "DISPATCHED" || rota.dispatchedAt) {
      return NextResponse.json(
        {
          error: `A rota ${rota.routeNumber} já foi despachada e não pode mais ser excluída — ela é o histórico do acerto do entregador. Se saiu no nome errado, troque o entregador da rota.`,
          podeTrocarEntregador: true,
        },
        { status: 409 },
      );
    }

    // ── Tirar os pedidos do APP do entregador ─────────────────────────────
    //
    // Limpar só o `routeId` não bastava: o app do motoboy lista por
    // `motoboyId` (api/motoboys/orders), então o pedido sumia do painel e
    // continuava no celular dele — foi a queixa do Emanuel, da Delicias de
    // Casa. Quem entrou no aparelho pela rota tem que sair com ela.
    //
    // Só desatribui de quem a ROTA pôs lá, e só pedido em aberto: entregue e
    // cancelado são história, e reescrever o motoboy neles moveria o pagamento
    // da entrega para quem não a fez.
    const { STATUS_CANCELADOS, STATUS_FINALIZADOS } = await import("@/lib/status-pedido");
    await prisma.customerOrder.updateMany({
      where: {
        routeId,
        status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] },
        ...(rota.motoboyId ? { motoboyId: rota.motoboyId } : {}),
      },
      data: { motoboyId: null, motoboyPuxadoEm: null },
    });

    // Desfazer uma rota AUTOMÁTICA é a loja dizendo "estes não": os pedidos
    // abertos dela ficam fora do cron (`semRotaAutomaticaEm`) até o "voltar"
    // da lista — sem isto, 20 s depois o cron montava a mesma rota de novo.
    if (rota.origem === "AUTO") {
      await (prisma.customerOrder as any).updateMany({
        where: { routeId, status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] } },
        data: { semRotaAutomaticaEm: new Date() },
      });
    }

    // O resto dos pedidos da rota (entregues, cancelados, ou de outro
    // entregador) perde só o vínculo com a rota.
    await prisma.customerOrder.updateMany({
      where: { routeId },
      data: { routeId: null, isRoutePriority: false },
    });

    await prisma.routeSchedule.delete({
      where: { id: routeId },
    });

    return NextResponse.json({ success: true, message: "Rota desfeita com sucesso" });
  } catch (err: any) {
    console.error("[DELETE /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
