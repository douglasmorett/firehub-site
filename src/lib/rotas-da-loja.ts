/**
 * Criar uma rota da loja — a MESMA gravação para quem monta à mão
 * (POST /api/store/routes, a Roteirização) e para a Rota 100% automatizada
 * (lib/roteirizacao-automatica/executar.ts, o cron de 20 s).
 *
 * Fatorada do POST manual em 22/10/2026 (Fase 1 do plano, vault "FireHub -
 * Plano despacho automático", D7): a rota automática tinha de nascer igual à
 * manual — o número "Rota #N" do expediente, o `routeId` nos pedidos, o
 * "⚡ PRIORIDADE PARA ROTA" no KDS e a ordem das paradas — senão o KDS, o app
 * do motoboy e o card da Roteirização teriam de conhecer dois jeitos de rota.
 * A diferença é só a `origem` ("MANUAL" | "AUTO") e que a automática nasce
 * SEM motoboy (quem leva é decidido na chamada, Fase 2).
 */
import { prisma } from "@/lib/prisma";
import { chaveDoContador } from "@/lib/order-number";

/**
 * O pedido ainda na cozinha pede prioridade no KDS ("⚡ PRIORIDADE PARA
 * ROTA"); o que já está pronto, saiu ou foi entregue, não. A regra que o POST
 * manual sempre usou — a automática usa a mesma ao acrescentar pedido em rota.
 */
export function pedePrioridadeNaRota(status: string | null | undefined): boolean {
  return status !== "PRONTO" && status !== "SAIU_ENTREGA" && status !== "ENTREGUE";
}

export type OrigemDaRota = "MANUAL" | "AUTO";

export type NovaRota = {
  /** A loja dona da rota (`RouteSchedule.franchiseeId`). */
  lojaId: string;
  /** Na ordem das paradas: a posição vira a `routeSequence` (1, 2, 3…). */
  orderIds: string[];
  motoboyId?: string | null;
  color?: string | null;
  /** Sem ele, "Rota #N" pela contagem do expediente. */
  routeNumber?: string | null;
  origem: OrigemDaRota;
  /**
   * Os usuários da loja (dono + funcionários) para contar as rotas do
   * expediente. O POST manual já tem a lista; sem ela, é lida aqui.
   */
  idsDaLoja?: string[];
  /** Início do expediente para a numeração. Padrão: o de sempre do POST manual. */
  virada?: Date;
};

export async function criarRotaDaLoja(nova: NovaRota) {
  const { lojaId, orderIds, motoboyId, color, routeNumber, origem } = nova;

  const idsDaLoja =
    nova.idsDaLoja && nova.idsDaLoja.length > 0
      ? nova.idsDaLoja
      : (await prisma.user.findMany({ where: { OR: [{ id: lojaId }, { ownerId: lojaId }] }, select: { id: true } })).map((u) => u.id);

  // Gera número sequencial de rota se não enviado
  // Expediente da loja: o contador de rotas zerava as 21:00 de Brasilia (fuso
  // do container e UTC) e a rota da noite nascia como "Rota #1" de novo,
  // duplicando o numero com a rota da tarde.
  // Das 5h, não da meia-noite: a rota da noite seguia a contagem das rotas
  // da madrugada, que são do turno anterior.
  // O contador zera quando a loja fecha o caixa, igual à numeração dos pedidos.
  const todayStart = nova.virada ?? (await chaveDoContador(prisma, lojaId)).desde;

  const existingTodayCount = await prisma.routeSchedule.count({
    where: {
      franchiseeId: { in: idsDaLoja.length > 0 ? idsDaLoja : [lojaId] },
      createdAt: { gte: todayStart },
    },
  });

  const finalRouteNumber = routeNumber || `Rota #${existingTodayCount + 1}`;

  // Cria o registro da Rota. `origem` é coluna da Fase 0 (garantir-colunas +
  // schema.prisma): o client gerado no build a conhece; o `as any` é para o
  // client local de quem ainda não rodou o generate.
  const newRoute: { id: string; routeNumber: string } = await (prisma.routeSchedule as any).create({
    data: {
      franchiseeId: lojaId,
      routeNumber: finalRouteNumber,
      motoboyId: motoboyId || null, // Permite criar sem motoboy!
      color: color || "#3B82F6",
      status: "PENDING",
      origem,
    },
  });

  // Associa os pedidos à rota e ativa PRIORIDADE PARA ROTA no KDS se o pedido não estiver PRONTO
  const ordersToUpdate = await prisma.customerOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, status: true, motoboyId: true, dailyOrderNumber: true, customerAddress: true },
  });

  // Uma gravação por pedido, como sempre — mas todas de uma vez, não uma
  // esperando a outra. Em fila, cada pedido da rota somava uma ida e volta
  // ao banco antes de a tela ouvir "rota criada" (e esta chamada é a
  // primeira do botão "Despachar Rota agora").
  await Promise.all(
    ordersToUpdate.map((ord) =>
      prisma.customerOrder.update({
        where: { id: ord.id },
        data: {
          routeId: newRoute.id,
          motoboyId: motoboyId || undefined,
          isRoutePriority: pedePrioridadeNaRota(ord.status), // 🚨 Marca PRIORIDADE PARA ROTA no KDS se não estiver pronto!
        },
      }),
    ),
  );

  // Rota montada já com entregador: os pedidos aparecem no app dele agora,
  // então o aviso no celular sai agora (lib/app-motoboy/aparelhos.ts).
  if (motoboyId) {
    const novosParaEle = ordersToUpdate.filter((o) => o.motoboyId !== motoboyId && o.status !== "ENTREGUE");
    if (novosParaEle.length > 0) {
      import("@/lib/app-motoboy/aparelhos")
        .then((m) => m.avisarPedidosNovos(String(motoboyId), novosParaEle, finalRouteNumber))
        .catch(() => {});
    }
  }

  // ── A ORDEM das paradas, que morria aqui ────────────────────────────────
  //
  // `orderIds` chega na sequência que a loja montou no mapa (1º, 2º, 3º…) e
  // essa ordem não era gravada em lugar nenhum: o app do motoboy ordenava
  // por data de criação DESC e o entregador rodava a rota de trás pra
  // frente. A coluna `routeSequence` vive FORA do schema.prisma (ver
  // /api/admin/coluna-sequencia-rota), daí o SQL cru — e o try/catch:
  // enquanto a coluna não existir, a rota continua funcionando sem
  // sequência, exatamente como sempre funcionou.
  // A posição de cada parada é a do índice em `orderIds` — as gravações
  // podem ir juntas, cada uma leva o seu número.
  try {
    await Promise.all(
      orderIds.map(
        (id: unknown, i: number) => prisma.$executeRaw`
          UPDATE "CustomerOrder" SET "routeSequence" = ${i + 1} WHERE "id" = ${String(id)}
        `,
      ),
    );
  } catch (e: any) {
    console.warn("[Rotas] routeSequence não gravada (coluna ausente?):", e?.message?.slice(0, 120));
  }

  return { rota: newRoute, pedidos: ordersToUpdate };
}
