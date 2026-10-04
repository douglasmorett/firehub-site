/**
 * GET /api/motoboys/relatorio?motoboyId=…&storeId=…&from=2026-10-01T18:00&to=2026-10-02T02:00
 *
 * O relatório do PRÓPRIO entregador, no app dele, com o mesmo filtro de data e
 * hora do relatório da loja (Motoboys → Relatório) — e a mesma conta
 * (lib/relatorio-do-entregador.ts). Foi o pedido do dono depois do "pra mim
 * bate nove, pra ele bate dez" da Frangoso (02/10/2026): os dois lados
 * escolhem o mesmo período e veem o mesmo número.
 *
 * A guarda é a da lista de pedidos do app (api/motoboys/orders): o app não tem
 * sessão de lojista, então vale o par motoboy + loja com o motoboy ATIVO —
 * demitido não consulta nada. Só o próprio entregador, nunca os colegas, e sem
 * itens nem observações: o que ele precisa para conferir o acerto.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { montarRelatorioDosEntregadores, periodoDoRelatorio } from "@/lib/relatorio-do-entregador";

/** Teto do período: o app é para conferir turno e semana, não o ano. */
const TETO_DO_PERIODO_MS = 45 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    // App nativo: o entregador sai da sessão assinada (ver api/motoboys/orders).
    const { temSessaoAssinada, exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const daSessao = temSessaoAssinada(req) ? await exigirMotoboy(req) : null;
    if (temSessaoAssinada(req) && !daSessao) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });
    }
    const motoboyId = daSessao?.id ?? sp.get("motoboyId");
    const storeId = daSessao?.franchiseeId ?? sp.get("storeId");
    if (!motoboyId || !storeId) {
      return NextResponse.json({ error: "motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    const motoboy = await prisma.motoboy.findFirst({
      where: { id: motoboyId, franchiseeId: storeId, active: true },
      select: { id: true },
    });
    if (!motoboy) {
      return NextResponse.json({ error: "Acesso encerrado. Fale com a loja.", precisaRelogar: true }, { status: 401 });
    }

    const loja = await prisma.user.findUnique({ where: { id: storeId }, select: { storeTimezone: true, appMotoboyConfig: true } });
    const tz = loja?.storeTimezone || "America/Sao_Paulo";

    // A loja decide se o entregador vê o relatório e até quantos dias para
    // trás (App Motoboys → configurações; lib/app-motoboy-config.ts).
    const { lerAppMotoboyConfig } = await import("@/lib/app-motoboy-config");
    const cfg = lerAppMotoboyConfig(loja?.appMotoboyConfig);
    if (!cfg.relatorioLiberado) {
      return NextResponse.json({ error: "A loja não liberou o relatório no app. Peça o acerto para ela.", relatorioFechado: true }, { status: 403 });
    }

    const periodo = periodoDoRelatorio(sp.get("from"), sp.get("to"), tz);
    let fromDate = periodo.fromDate;
    const toDate = periodo.toDate;
    if (toDate.getTime() - fromDate.getTime() > TETO_DO_PERIODO_MS) {
      return NextResponse.json({ error: "Escolha um período de até 45 dias." }, { status: 400 });
    }
    // Mais para trás do que a loja libera: o começo é puxado para o limite, e
    // a resposta diz o período que valeu (o app mostra as datas de `period`).
    const limiteDeTras = Date.now() - cfg.relatorioDias * 24 * 3600_000;
    if (fromDate.getTime() < limiteDeTras) fromDate = new Date(limiteDeTras);
    if (toDate.getTime() <= fromDate.getTime()) {
      return NextResponse.json({ error: `A loja libera só os últimos ${cfg.relatorioDias} dia(s).` }, { status: 400 });
    }

    const { period, report } = await montarRelatorioDosEntregadores({ lojaId: storeId, motoboyId, fromDate, toDate, tz });
    const meu = report[0];
    if (!meu) return NextResponse.json({ period, stats: null, orders: [], cancelados: { qtd: 0, lista: [] } });

    return NextResponse.json({
      period,
      motoboy: {
        paymentType: meu.motoboy.paymentType,
        dailyRate: meu.motoboy.dailyRate,
        entregasSemDistancia: meu.motoboy.entregasSemDistancia,
      },
      stats: meu.stats,
      cancelados: meu.cancelados,
      orders: meu.orders.map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        dailyOrderNumber: o.dailyOrderNumber,
        ifoodReference: o.ifoodReference,
        openDeliveryReference: o.openDeliveryReference,
        customerName: o.customerName,
        customerAddress: o.customerAddress,
        paymentMethod: o.paymentMethod,
        totalAmount: o.totalAmount,
        cashToDeliver: o.cashToDeliver,
        changeGiven: o.changeGiven,
        ganhoDoMotoboy: o.ganhoDoMotoboy,
        origemDoGanho: o.origemDoGanho,
        status: o.status,
        cancelado: o.cancelado,
      })),
    });
  } catch (e: any) {
    console.error("[Motoboy Relatório]", e?.message);
    return NextResponse.json({ error: "Não consegui montar o relatório agora." }, { status: 500 });
  }
}
