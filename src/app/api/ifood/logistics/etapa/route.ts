/**
 * /api/ifood/logistics/etapa
 *
 * Cenário 3 da homologação: a viagem do entregador, uma etapa por vez.
 *
 * A ordem é conferida ANTES da chamada. Isso não é preciosismo: os critérios
 * dizem que "a sequência correta é crítica", e o avaliador tenta despachar sem
 * ter chegado à origem só para ver o que acontece. Recusar aqui é mais honesto
 * — e mais rápido — do que deixar o iFood recusar depois.
 *
 * O estado só é gravado quando o iFood aceita (202). Gravar antes deixaria a
 * tela contando uma etapa que não aconteceu do outro lado.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import {
  alocarEntregador, marcarEtapa, conferirSequencia,
  ETAPAS, proximaEtapa, type ChaveEtapa, type Veiculo,
} from "@/lib/ifood-logistics";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const orderId: string = corpo?.orderId ?? "";
    const etapa: ChaveEtapa = corpo?.etapa;
    if (!orderId || !etapa) {
      return NextResponse.json({ error: "Informe o pedido e a etapa." }, { status: 400 });
    }

    const pedido = await prisma.customerOrder.findUnique({
      where: { ifoodOrderId: orderId },
      select: { id: true, ifoodDriverStatus: true },
    });

    // Sem registro local ainda, a viagem começa do zero.
    const estadoAtual = pedido?.ifoodDriverStatus ?? null;
    conferirSequencia(estadoAtual, etapa);   // lança ErroSequencia → 400 com texto pronto

    const r = etapa === "assignDriver"
      ? await alocarEntregador(ctx, orderId, {
          nome: corpo?.entregador?.nome,
          telefone: corpo?.entregador?.telefone,
          veiculo: corpo?.entregador?.veiculo as Veiculo,
        })
      : await marcarEtapa(ctx, orderId, etapa);

    if (!r.ok) {
      // 409 aqui quer dizer "já tem entregador" — o avaliador provoca esse caso
      // de propósito, alocando duas vezes.
      return responder(r, { etapa, sequencia: estadoAtual });
    }

    const novoEstado = ETAPAS.find((e) => e.chave === etapa)!.estado;
    if (pedido) {
      await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: {
          ifoodDriverStatus: novoEstado,
          ...(etapa === "assignDriver"
            ? {
                ifoodDriverName: corpo?.entregador?.nome ?? null,
                ifoodDriverPhone: corpo?.entregador?.telefone ?? null,
                ifoodDriverVehicle: corpo?.entregador?.veiculo ?? null,
                ifoodDriverRequestedAt: new Date(),
              }
            : {}),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      ifood: { status: r.status, ok: true, origem: r.origem },
      etapa,
      estado: novoEstado,
      proxima: proximaEtapa(novoEstado),
      endpoint: `POST /logistics/v1.0/orders/{id}/${etapa}`,
    });
  });
}
