/**
 * /api/ifood/shipping
 *
 * A aba Shipping da homologação: entregador do iFood para pedido do canal
 * próprio da loja. Uma rota só, com `acao`, porque cada ação é uma chamada ao
 * iFood e a tela mostra o status de cada uma no painel "Chamadas ao iFood" —
 * é por esse status que o analista confere o vídeo.
 *
 *   GET  ?acao=pedidos                     pedidos de Shipping desta loja (com eventos)
 *   GET  ?acao=cotacao&latitude=&longitude= deliveryAvailabilities
 *   GET  ?acao=detalhe&orderId=            Order API (orderType, salesChannel, pickupCode)
 *   GET  ?acao=motivos&orderId=            cancellationReasons
 *   GET  ?acao=rastreio&orderId=           tracking
 *   GET  ?acao=confianca&orderId=          safeDelivery
 *   POST {acao:"registrar", pedido}        POST /merchants/{id}/orders
 *   POST {acao:"confirmar"|"confirmarEndereco"|"aceitarTroca"|"recusarTroca", orderId}
 *   POST {acao:"pedirTroca", orderId, endereco}
 *   POST {acao:"cancelar", orderId, codigo, motivo}
 *   POST {acao:"validarColeta", orderId, codigo}
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { prisma } from "@/lib/prisma";
import {
  consultarDisponibilidade, registrarPedido, detalhesDoPedido, confirmarPedido,
  confirmarEnderecoDoCliente, pedirTrocaDeEndereco, aceitarTrocaDeEndereco,
  recusarTrocaDeEndereco, motivosDeCancelamento, cancelarPedido, rastreioDoPedido,
  confiancaDaEntrega, validarCodigoDeColeta, gravarPedidoShipping, gravarDisplayId,
  listarPedidosShipping, distanciaEmMetros, LIMITE_TROCA_ENDERECO_M,
} from "@/lib/ifood-shipping";

async function franquiaDe(email: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  return u ? u.ownerId || u.id : null;
}

const orderIdValido = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, email, params }) => {
    const acao = params.get("acao");
    const orderId = params.get("orderId") ?? "";

    if (acao === "pedidos") {
      const franchiseeId = await franquiaDe(email);
      if (!franchiseeId) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
      return NextResponse.json({ pedidos: await listarPedidosShipping(prisma, franchiseeId) });
    }

    if (acao === "cotacao") {
      const r = await consultarDisponibilidade(ctx, Number(params.get("latitude")), Number(params.get("longitude")));
      return responder(r, { endpoint: "GET /shipping/v1.0/merchants/{merchantId}/deliveryAvailabilities" });
    }

    if (!orderIdValido(orderId)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

    if (acao === "detalhe") {
      const r = await detalhesDoPedido(ctx, orderId);
      if (r.ok && (r.data as any)?.displayId) await gravarDisplayId(prisma, orderId, (r.data as any).displayId);
      return responder(r, { endpoint: "GET /order/v1.0/orders/{id}" });
    }
    if (acao === "motivos") {
      const r = await motivosDeCancelamento(ctx, orderId);
      return responder(r, { endpoint: "GET /shipping/v1.0/orders/{id}/cancellationReasons" });
    }
    if (acao === "rastreio") {
      const r = await rastreioDoPedido(ctx, orderId);
      return responder(r, { endpoint: "GET /shipping/v1.0/orders/{id}/tracking" });
    }
    if (acao === "confianca") {
      const r = await confiancaDaEntrega(ctx, orderId);
      return responder(r, { endpoint: "GET /shipping/v1.0/orders/{id}/safeDelivery" });
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  });
}

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, email, corpo }) => {
    const acao = corpo?.acao;

    if (acao === "registrar") {
      const franchiseeId = await franquiaDe(email);
      if (!franchiseeId) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
      const r = await registrarPedido(ctx, corpo?.pedido);
      if (r.ok && r.data?.id) {
        await gravarPedidoShipping(prisma, {
          ifoodOrderId: r.data.id,
          franchiseeId,
          merchantId: ctx.merchantId,
          trackingUrl: r.data.trackingUrl ?? null,
          clienteNome: corpo.pedido.cliente.nome,
          total: r.total,
          enderecoOriginal: corpo.pedido.endereco,
          pedidoEnviado: r.corpo,
        });
      }
      return responder(r, { endpoint: "POST /shipping/v1.0/merchants/{merchantId}/orders", total: r.total });
    }

    const orderId = corpo?.orderId;
    if (!orderIdValido(orderId)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

    switch (acao) {
      case "confirmar":
        return responder(await confirmarPedido(ctx, orderId), { endpoint: "POST /order/v1.0/orders/{id}/confirm" });
      case "confirmarEndereco":
        return responder(await confirmarEnderecoDoCliente(ctx, orderId), {
          endpoint: "POST /shipping/v1.0/orders/{id}/userConfirmAddress",
        });
      case "pedirTroca": {
        // O limite de 500 m é do iFood; conferir antes evita mandar uma
        // solicitação que só pode voltar MaxDistanceHigherThanAllowed.
        const original = corpo?.original;
        if (original && Number.isFinite(Number(original.latitude))) {
          const d = distanciaEmMetros(original, corpo.endereco);
          if (d > LIMITE_TROCA_ENDERECO_M) {
            return NextResponse.json(
              { error: `O novo endereço fica a ${d} m do original. O iFood só aceita troca até ${LIMITE_TROCA_ENDERECO_M} m.` },
              { status: 400 },
            );
          }
        }
        return responder(await pedirTrocaDeEndereco(ctx, orderId, corpo?.endereco), {
          endpoint: "POST /shipping/v1.0/orders/{id}/deliveryAddressChangeRequest",
        });
      }
      case "aceitarTroca":
        return responder(await aceitarTrocaDeEndereco(ctx, orderId), {
          endpoint: "POST /shipping/v1.0/orders/{id}/acceptDeliveryAddressChange",
        });
      case "recusarTroca":
        return responder(await recusarTrocaDeEndereco(ctx, orderId), {
          endpoint: "POST /shipping/v1.0/orders/{id}/denyDeliveryAddressChange",
        });
      case "cancelar":
        return responder(await cancelarPedido(ctx, orderId, corpo?.codigo, corpo?.motivo), {
          endpoint: "POST /shipping/v1.0/orders/{id}/cancel",
        });
      case "validarColeta": {
        const r = await validarCodigoDeColeta(ctx, orderId, corpo?.codigo);
        // 412 é o iFood dizendo que nenhum entregador aceitou a corrida ainda —
        // não é erro do sistema, é a segunda etapa do critério ("validar
        // confirmação do entregador antes de marcar como retirado").
        if (r.status === 412) {
          return NextResponse.json({
            ok: true,
            aguardandoEntregador: true,
            mensagem: "O iFood só valida o código depois que um entregador aceita a corrida. Aguarde o entregador chegar.",
            ifood: { status: r.status, ok: r.ok, origem: r.origem },
            endpoint: "POST /order/v1.0/orders/{id}/validatePickupCode",
          });
        }
        return responder(r, { endpoint: "POST /order/v1.0/orders/{id}/validatePickupCode" });
      }
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  });
}
