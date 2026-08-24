/**
 * POST /api/webhooks/mercadopago-point
 *
 * Recebe os eventos das cobranças da maquininha (Mercado Pago Point, Orders API).
 * Cadastre esta URL em Suas integrações > Webhooks, marcando o evento
 * "Order (Mercado Pago)".
 *
 * Eventos: order.processed, order.canceled, order.refunded, order.action_required,
 * order.failed, order.expired. O corpo chega como
 * { action, type: "order", data: { id: "ORD01J..." }, ... }.
 *
 * Duas regras mandam neste arquivo:
 *
 * 1. FALHA FECHADA. Sem assinatura válida, ou sem segredo configurado no
 *    servidor, a resposta é 401 e nada é gravado. Um webhook de pagamento sem
 *    verificação é um endpoint público que libera pedido de graça para quem
 *    descobrir a URL.
 *
 * 2. O WEBHOOK É GATILHO, NUNCA PROVA. Depois de validar a assinatura, a ordem é
 *    reconsultada na API do MP com o token do lojista. Só o que a consulta
 *    devolver vale — o corpo da notificação nunca é usado para dizer que pagou.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { centavosParaAmount, consultarOrdem } from "@/lib/mp-point";

export const dynamic = "force-dynamic";

/** Status que tiram o totem da tela de espera sem pagamento. */
const MORREU_SEM_PAGAR = new Set(["canceled", "expired", "failed"]);

/**
 * Compara os dois HMAC em tempo constante.
 *
 * O teste de tamanho vem antes porque `timingSafeEqual` LANÇA quando os buffers
 * têm comprimentos diferentes — e uma assinatura curta forjada derrubaria a rota
 * com 500 em vez de ser recusada com 401.
 */
function assinaturaBate(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(recebido, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const corpoCru = await req.text();

    // O segredo é o da aplicação que recebe a notificação. A variável dedicada
    // existe para o caso de o Point ser configurado em outra aplicação do MP;
    // não existindo, vale a mesma do webhook de pagamento online.
    const segredo = process.env.MP_POINT_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET;
    if (!segredo) {
      console.error(
        "[MP Point Webhook] MP_POINT_WEBHOOK_SECRET (ou MP_WEBHOOK_SECRET) não está configurada — notificação recusada.",
      );
      return NextResponse.json(
        { error: "Webhook não configurado neste servidor.", code: "SEM_SEGREDO" },
        { status: 401 },
      );
    }

    const assinatura = req.headers.get("x-signature") || "";
    const requestId = req.headers.get("x-request-id") || "";

    // Formato do header: "ts=1704908010,v1=618c8534..."
    const partes: Record<string, string> = {};
    for (const pedaco of assinatura.split(",")) {
      const i = pedaco.indexOf("=");
      if (i > 0) partes[pedaco.slice(0, i).trim()] = pedaco.slice(i + 1).trim();
    }
    const ts = partes["ts"] || "";
    const v1 = partes["v1"] || "";
    if (!ts || !v1) {
      console.warn("[MP Point Webhook] Requisição sem x-signature válido — recusada.");
      return NextResponse.json({ error: "Assinatura ausente" }, { status: 401 });
    }

    let corpo: any = null;
    try {
      corpo = corpoCru ? JSON.parse(corpoCru) : null;
    } catch {
      corpo = null;
    }

    // O MP repete o data.id na query string, e é esse valor que ele usa para
    // montar a assinatura. O corpo entra só como reserva.
    const dataId = req.nextUrl.searchParams.get("data.id") || (corpo?.data?.id ? String(corpo.data.id) : "");
    if (!dataId) {
      console.warn("[MP Point Webhook] Notificação sem data.id — recusada.");
      return NextResponse.json({ error: "Notificação sem data.id" }, { status: 401 });
    }

    // A documentação manda usar o data.id em minúsculas no template. A variante
    // com o texto original também é aceita porque o id do Point vem em caixa
    // alta ("ORD01J...") e recusar uma notificação legítima aqui deixaria o
    // cliente parado no totem com o cartão já debitado. As duas exigem o mesmo
    // segredo — não há perda de segurança, só tolerância à forma do id.
    const candidatos = new Set([dataId.toLowerCase(), dataId]);
    const manifestos: string[] = [];
    for (const id of candidatos) {
      manifestos.push(`id:${id};request-id:${requestId};ts:${ts};`);
      // Sem o header x-request-id, o pedaço "request-id:" some do template (é o
      // que a doc manda fazer com valor ausente). Sem esta variante, uma
      // notificação legítima que chegasse sem o header seria recusada com 401 e
      // o pagamento já feito no cartão nunca daria baixa. Continua exigindo o
      // mesmo segredo — não é uma porta a mais.
      if (!requestId) manifestos.push(`id:${id};ts:${ts};`);
    }
    const valida = manifestos.some((manifesto) => {
      const esperado = crypto.createHmac("sha256", segredo).update(manifesto).digest("hex");
      return assinaturaBate(esperado, v1);
    });

    if (!valida) {
      console.warn(`[MP Point Webhook] Assinatura inválida para data.id=${dataId} — recusada.`);
      return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }

    // Daqui para baixo a origem está confirmada.
    const tipo = corpo?.type ? String(corpo.type) : "";
    const acao = corpo?.action ? String(corpo.action) : "";
    if (tipo && tipo !== "order") {
      return NextResponse.json({ received: true, ignorado: `tipo ${tipo}` });
    }

    const pedido = await prisma.customerOrder.findFirst({
      where: { posOrderId: dataId },
      select: { id: true, franchiseeId: true, totalAmount: true, paymentPaidAt: true },
    });

    if (!pedido) {
      // Pode ser a corrida com /api/totem/payment/start, que grava o posOrderId
      // logo depois de criar a ordem. Responder erro faz o MP reenviar, e na
      // segunda tentativa o pedido já está gravado. Responder 200 aqui perderia
      // o pagamento para sempre.
      console.warn(`[MP Point Webhook] Nenhum pedido com posOrderId=${dataId} (ação ${acao}).`);
      return NextResponse.json({ error: "Pedido ainda não encontrado" }, { status: 404 });
    }

    const loja = await prisma.user.findUnique({
      where: { id: pedido.franchiseeId },
      select: { mpAccessToken: true },
    });
    if (!loja?.mpAccessToken) {
      // Sem o token do lojista não dá para conferir nada no MP, e o webhook
      // sozinho não é prova. Erro deixa o MP reenviar depois da reconexão.
      console.error(
        `[MP Point Webhook] Loja ${pedido.franchiseeId} sem mpAccessToken — impossível conferir a ordem ${dataId}.`,
      );
      return NextResponse.json(
        { error: "Loja não conectada ao Mercado Pago", code: "MP_NAO_CONECTADO" },
        { status: 409 },
      );
    }

    const consulta = await consultarOrdem(loja.mpAccessToken, dataId);
    if (!consulta.ok) {
      console.error(`[MP Point Webhook] Falha ao reconsultar a ordem ${dataId}: ${consulta.erro}`);
      return NextResponse.json({ error: consulta.erro }, { status: 502 });
    }
    const ordem = consulta.dados;

    // A ordem consultada tem que ser a deste pedido. Divergência aqui significa
    // posOrderId apontando para a cobrança errada — confirmar seria dar baixa
    // num pedido com o pagamento de outro.
    if (ordem.externalReference && ordem.externalReference !== pedido.id) {
      console.error(
        `[MP Point Webhook] Ordem ${dataId} referencia o pedido ${ordem.externalReference}, mas o posOrderId está no pedido ${pedido.id}. Nada foi confirmado.`,
      );
      return NextResponse.json({ error: "Ordem não confere com o pedido" }, { status: 409 });
    }

    // gatewayProvider e gatewayPaymentId só entram quando o MP disse
    // "processed". Fora deste arquivo esses campos sozinhos já contam como
    // pedido recebido — o fechamento de caixa (/api/cash-session) soma o valor
    // no esperado e a tela de pedidos pinta o selo verde "Pago Online". Uma
    // cobrança que expirou sem ninguém passar o cartão viraria dinheiro que a
    // loja acha que tem.
    const pagou = ordem.status === "processed";
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: {
        posStatus: ordem.status,
        ...(pagou
          ? {
              gatewayProvider: "MERCADOPAGO_POINT",
              ...(ordem.paymentId ? { gatewayPaymentId: ordem.paymentId } : {}),
            }
          : {}),
      },
    });

    if (pagou) {
      // Conferência de valor com o mesmo formatador que montou a cobrança, para
      // não acusar diferença que só existe em arredondamento.
      //
      // É aviso, não bloqueio: o valor cobrado é o que NÓS mandamos, então uma
      // divergência denuncia erro de formatação (a armadilha do decimal em
      // string virar centavos e cobrar 100x) e precisa aparecer no log. Barrar
      // seria pior — `amount` é o do primeiro pagamento, e uma conta dividida em
      // dois cartões legitimamente traz menos que o total.
      const esperado = centavosParaAmount(Math.round((pedido.totalAmount || 0) * 100));
      if (ordem.amount && ordem.amount !== esperado) {
        console.warn(
          `[MP Point Webhook] Pedido ${pedido.id}: esperado R$ ${esperado}, primeiro pagamento da ordem ${dataId} veio R$ ${ordem.amount}.`,
        );
      }

      const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
      await confirmOrderPayment(pedido.id);
      console.log(`[MP Point Webhook] Pedido ${pedido.id} pago na maquininha e despachado.`);
    } else if (MORREU_SEM_PAGAR.has(ordem.status)) {
      // Só o posStatus muda. O pedido continua aguardando pagamento: o cliente
      // ainda pode tentar outro cartão ou pagar no caixa, e é o totem que sai da
      // tela de espera ao ler este status.
      console.log(`[MP Point Webhook] Pedido ${pedido.id}: cobrança ${ordem.status} (${ordem.statusDetail}).`);
    }

    return NextResponse.json({ received: true, status: ordem.status });
  } catch (err) {
    console.error("[MP Point Webhook] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
