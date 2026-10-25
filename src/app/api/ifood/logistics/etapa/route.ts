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
  return comContextoIfood(req, async ({ ctx, email, corpo }) => {
    const orderId: string = corpo?.orderId ?? "";
    const etapa: ChaveEtapa = corpo?.etapa;
    if (!orderId || !etapa) {
      return NextResponse.json({ error: "Informe o pedido e a etapa." }, { status: 400 });
    }

    // Só pedido DESTA loja: o orderId vem do corpo e a cascata de tokens cai no
    // central, então sem esta conferência a etapa valia para pedido de outra
    // loja (auditoria 23/10/2026, F79). A tela só lista os pedidos da loja.
    const quem = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
    const pedido = quem
      ? await prisma.customerOrder.findFirst({
          where: { ifoodOrderId: orderId, franchiseeId: quem.ownerId || quem.id },
          select: { id: true, ifoodDriverStatus: true },
        })
      : null;
    if (!pedido) {
      return NextResponse.json({ error: "Pedido não encontrado nesta loja." }, { status: 404 });
    }

    const estadoAtual = pedido.ifoodDriverStatus ?? null;
    conferirSequencia(estadoAtual, etapa);   // lança ErroSequencia → 400 com texto pronto

    const r = etapa === "assignDriver"
      ? await alocarEntregador(ctx, orderId, {
          nome: corpo?.entregador?.nome,
          telefone: corpo?.entregador?.telefone,
          veiculo: corpo?.entregador?.veiculo as Veiculo,
        })
      : await marcarEtapa(ctx, orderId, etapa);

    if (!r.ok) {
      // 409 quer dizer que o iFood já tem esta etapa registrada. Se pararmos
      // aqui sem gravar, o estado local nunca alcança o dele: nenhuma etapa
      // seguinte passa na conferência de sequência, e repetir esta devolve 409
      // de novo — o pedido trava sem saída pela tela.
      //
      // A exceção é "REQUESTED", que marca motoboy solicitado ao próprio iFood
      // (por /api/ifood/request-driver). Ali o 409 significa "já existe OUTRO
      // entregador", e assumir a alocação como nossa seria sequestrar a entrega.
      const jaRegistrada = r.status === 409 && estadoAtual !== "REQUESTED";
      if (!jaRegistrada) {
        return responder(r, { etapa, sequencia: estadoAtual });
      }
      console.warn(`[iFood logistics] ${etapa} devolveu 409 — o iFood já tinha a etapa; sincronizando o estado local.`);
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
      // 409 sincronizado conta como sucesso para a tela: o estado dos dois lados
      // passou a ser o mesmo, que é o que importa para seguir a viagem.
      sincronizado: !r.ok,
      ifood: { status: r.status, ok: r.ok, origem: r.origem },
      etapa,
      estado: novoEstado,
      proxima: proximaEtapa(novoEstado),
      endpoint: `POST /logistics/v1.0/orders/{id}/${etapa}`,
    });
  });
}
