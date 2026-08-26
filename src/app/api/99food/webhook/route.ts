import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { registrar99Food } from "@/lib/webhook-99food-log";
import { parseJson99Food } from "@/lib/json-ids-longos";
import { traduzirPedido99Food, itens99ParaPrisma } from "@/lib/food99-pedido";
import { aplicarPedidoAlterado99 } from "@/lib/food99-status";
import { verificarAssinaturaHmac, avisarWebhookSemSegredo } from "@/lib/webhook-assinatura";

/**
 * POST /api/99food/webhook
 * Recebe pedidos e eventos de webhook do 99Food.
 *
 * ── A resposta é parte do protocolo ─────────────────────────────────────────
 * O 99Food só considera a entrega bem-sucedida se receber EXATAMENTE
 * `{"errno": 0, "errmsg": "ok"}` dentro de 6 segundos. Qualquer outra coisa —
 * inclusive um 200 com outro corpo — conta como falha, e ele reenvia o mesmo
 * evento várias vezes.
 *
 * Esta rota respondia `{"ok": true, "created": ...}`. Ou seja: mesmo que os
 * pedidos estivessem chegando, o 99Food os trataria como não entregues e
 * entraria em reenvio.
 *
 * ── Os nomes dos eventos também estavam errados ─────────────────────────────
 * O código procurava PLACED / PLC / ORDER_PLACED / CONCLUDED / DSP — que são
 * convenções do iFood e do OpenDelivery. O 99Food manda orderNew, orderCancel,
 * orderFinish, deliveryStatus, orderCancelApply, orderRefundApply e
 * orderPartialCancel. Os nomes antigos ficam aceitos junto, porque não custa
 * nada e cobre payload de teste montado no padrão antigo.
 *
 * Fonte: developer-food.99app.com/pt-BR/openapi (Integration Guide).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A única resposta que o 99Food aceita como "recebido". */
const ACK = { errno: 0, errmsg: "ok" };

/** Nome de evento normalizado, sem caixa nem separador, para comparar. */
function normalizarEvento(bruto: string): string {
  return (bruto || "").toString().toLowerCase().replace(/[^a-z]/g, "");
}

const EVENTOS_PEDIDO_NOVO = new Set([
  "ordernew",                                    // 99Food
  "placed", "plc", "orderplaced", "new",         // iFood / OpenDelivery
]);

/**
 * Eventos em que o CLIENTE pede algo e a loja teria que responder.
 *
 * `orderCancelApply` (pedido de cancelamento) e `orderRefundApply` (reembolso
 * por item faltando) só chegam se o app tiver optado por recebê-los em
 * `POST /v1/shop/apply/set`. Por padrão — e é o estado de hoje — quem responde
 * é o time de atendimento da própria DiDi.
 *
 * NÃO ligar esse opt-in enquanto não existir tela para a loja aceitar ou
 * recusar: passar a receber a pergunta sem ter como responder é pior do que
 * não recebê-la, porque tira da DiDi um caso que ela resolveria e o deixa sem
 * dono. Enquanto isso, se algum chegar, fica registrado em vez de virar
 * "evento não reconhecido" no meio dos outros.
 */
const EVENTOS_PEDIDO_DO_CLIENTE = new Set(["ordercancelapply", "orderrefundapply"]);

/** Evento de mudança de status → status interno do FireHub. */
function statusDoEvento(evento: string): string | null {
  switch (normalizarEvento(evento)) {
    // ATENÇÃO: `orderPartialCancel` NÃO entra aqui. Ver o tratamento próprio
    // mais abaixo — cancelamento PARCIAL é o cliente tirando um item, e cancelar
    // o pedido inteiro por causa disso joga fora uma venda que continua de pé.
    case "ordercancel":
    case "cancelled":
    case "can":
      return "CANCELADO";
    case "orderfinish":
    case "concluded":
    case "con":
      return "ENTREGUE";
    case "deliverystatus":
    case "dispatched":
    case "dsp":
      return "SAIU_ENTREGA";
    case "confirmed":
    case "cfm":
      return "ACEITO";
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
    if (!bodyText) {
      // Corpo vazio ainda recebe ACK: reenviar nao vai fazer aparecer.
      return NextResponse.json(ACK);
    }

    // ── De onde veio esta requisição ────────────────────────────────────────
    //
    // Esta rota não conferia nada: qualquer POST criava pedido na cozinha de
    // uma loja, com os itens e o valor que o remetente quisesse. A verificação
    // usa o corpo CRU — reserializar o JSON muda bytes e o hash deixa de bater.
    //
    // Enquanto FOOD99_WEBHOOK_SECRET não existir no ambiente, o pedido continua
    // entrando e o log registra o aviso; assim que existir, requisição sem
    // assinatura válida é recusada.
    const assinatura99 = verificarAssinaturaHmac(
      "FOOD99_WEBHOOK_SECRET",
      bodyText,
      req.headers.get("x-99food-signature") || req.headers.get("x-signature") || req.headers.get("x-hub-signature-256")
    );
    if (assinatura99.estado === "invalida") {
      console.error(`[99Food Webhook] Origem não confirmada (${assinatura99.motivo}) — requisição recusada`);
      return NextResponse.json({ errno: 401, errmsg: "unauthorized" }, { status: 401 });
    }
    if (assinatura99.estado === "sem-segredo") {
      avisarWebhookSemSegredo("99Food", "FOOD99_WEBHOOK_SECRET");
    }

    // Payload ilegível é o único erro que merece ACK: reenviar o mesmo texto
    // quebrado dez vezes não o conserta. Erro NOSSO, mais abaixo, é o oposto —
    // ali o reenvio é justamente o que salva o pedido.
    let payload: any;
    try {
      // NÃO trocar por JSON.parse: os ids do 99Food têm 19 dígitos e o parse
      // nativo os arredonda em silêncio. Ver lib/json-ids-longos.ts.
      payload = parseJson99Food(bodyText);
    } catch {
      console.error("[99Food Webhook] Corpo não é JSON válido:", bodyText.slice(0, 300));
      registrar99Food({
        tipo: "json-invalido",
        reconhecido: false,
        pedidoCriado: false,
        motivo: "corpo recebido não é JSON válido",
        payload: bodyText.slice(0, 1000),
      });
      return NextResponse.json(ACK);
    }

    const events = Array.isArray(payload) ? payload : [payload];

    console.log(`[99Food Webhook] Recebidos ${events.length} evento(s)`);

    let created = 0;
    let updated = 0;

    // ── O ACK do 99Food tem 6 segundos, e o trabalho nem sempre cabe ────────
    //
    // Medido contra a produção: um POST VAZIO nesta rota — que não toca o banco
    // uma vez — voltou em 0,87s, 1,17s e 5,29s em três tentativas seguidas. O
    // pedido de verdade acrescenta a isso a busca da loja, o número do dia, a
    // conferência de duplicado e a gravação com os itens, tudo contra o Neon.
    // Ou seja: estourar os 6s não é hipótese remota, é o caso ruim de uma
    // rota que hoje já chega perto dele sem fazer nada.
    //
    // Estourando, o 99Food trata como não entregue e reenvia — e o reenvio cai
    // numa rota que continua lenta, o que produz mais reenvio. A fila cresce
    // sozinha e a cozinha vê o mesmo pedido várias vezes.
    //
    // Então o trabalho corre solto e a resposta espera por ele só até o limite:
    //
    //   terminou a tempo  → ACK, tudo gravado
    //   falhou a tempo    → 500 de propósito, para o 99Food reenviar (é a única
    //                       rede que existe entre um pedido e a cozinha nunca
    //                       saber dele — não há endpoint de listagem para
    //                       recuperar depois)
    //   passou do limite  → ACK agora e o trabalho segue no container. A
    //                       gravação é idempotente por openDeliveryOrderId,
    //                       então um reenvio que cruze com ela não duplica.
    const trabalho = (async () => {
    for (const event of events) {
      // O OrderModel do 99Food pode vir embrulhado (`event.order`) ou solto no
      // próprio evento. Reconhece-se pelo `order_id`, que é o único campo
      // presente nas duas formas.
      const pedidoBruto =
        event.order && typeof event.order === "object" ? event.order : event.order_id ? event : null;

      const traduzido = pedidoBruto ? traduzirPedido99Food(pedidoBruto) : null;

      // O id da loja no 99Food. `shop.shop_id` é o lugar dele no OrderModel;
      // os outros nomes cobrem evento de status, que não carrega o pedido.
      const merchantId =
        traduzido?.shopId || event.shop_id || event.merchantId || event.storeId || event.merchant?.id;

      // O app_shop_id é o identificador da loja DENTRO do vínculo — o mesmo que
      // aparece em listarLojasVinculadas(). Quando ele vem, a amarração é exata
      // e não sobra espaço para palpite; é o oposto do fallback lá embaixo, que
      // só existe porque o formulário antigo pedia um merchantId digitado à mão.
      const appShopId = traduzido?.appShopId || event.app_shop_id || event.appShopId;

      const orderId = traduzido?.orderId || event.order_id || event.orderId || event.id;
      const displayId =
        traduzido?.numeroNoParceiro || event.order_index || event.displayId || event.reference || orderId;
      const eventType = event.event || event.eventType || event.fullCode || event.code || event.status || "";

      // Evento sem order_id não vira pedido nem atualização, mas PRECISA ficar
      // registrado: é o que separa "o 99Food nunca chamou" de "chamou e a gente
      // não entendeu". Ver o bloco de `franchisee` abaixo para o porquê.
      if (!orderId) {
        registrar99Food({
          tipo: eventType || "(sem tipo)",
          reconhecido: false,
          pedidoCriado: false,
          motivo: "evento sem order_id — nada a criar nem a atualizar",
          payload: event,
        });
        continue;
      }

      // 1ª tentativa — app_shop_id gravado no vínculo (campo food99AppId).
      // É a amarração que a tela de conexão escreve quando o lojista escolhe a
      // loja dele na lista de vinculadas.
      let franchisee = appShopId
        ? await prisma.user.findFirst({ where: { food99AppId: String(appShopId) } })
        : null;

      // 2ª — o app_shop_id pode SER o nosso id, quando o 99Food aceita o valor
      // que mandamos. Custa uma consulta e cobre esse caso sem depender de o
      // vínculo ter sido gravado aqui antes.
      if (!franchisee && appShopId) {
        franchisee = await prisma.user.findUnique({ where: { id: String(appShopId) } }).catch(() => null);
      }

      // 3ª — shop_id do 99Food, para quem conectou pelo formulário antigo.
      if (!franchisee && merchantId) {
        franchisee = await prisma.user.findFirst({
          where: { food99MerchantId: String(merchantId), role: "FRANCHISEE" },
        });
      }

      // Loja achada pelo app_shop_id mas ainda sem o merchantId gravado: grava
      // agora. É a única hora em que o id da loja no 99Food aparece de graça, e
      // sem ele as chamadas de volta (confirmar, pronto, entregue) não têm a
      // quem se dirigir.
      if (franchisee && merchantId && !franchisee.food99MerchantId) {
        await prisma.user
          .update({ where: { id: franchisee.id }, data: { food99MerchantId: String(merchantId) } })
          .catch(() => {});
      }

      // Fallback: SO quando existe exatamente 1 franqueado com 99Food ativo.
      // Antes pegava o mais antigo com findFirst, entao um merchantId
      // desconhecido despejava o pedido na cozinha de outra loja. Com duas ou
      // mais lojas conectadas nao ha como adivinhar o dono — recusa.
      if (!franchisee) {
        const conectados = await prisma.user.findMany({
          where: { food99Connected: true, role: "FRANCHISEE" },
          select: { id: true },
          take: 2,
        });
        if (conectados.length === 1) {
          franchisee = await prisma.user.findUnique({ where: { id: conectados[0].id } });
        } else if (conectados.length > 1) {
          console.warn(
            `[99Food Webhook] merchantId "${merchantId}" nao mapeado e ha ${conectados.length}+ lojas conectadas — pedido ${orderId} recusado para nao cair na loja errada`
          );
          registrar99Food({
            tipo: eventType || "orderNew",
            reconhecido: true,
            pedidoCriado: false,
            motivo:
              `RECUSADO: shop_id "${merchantId}" / app_shop_id "${appShopId}" não batem com nenhuma loja, ` +
              `e há ${conectados.length}+ lojas com 99Food ativo — não dá para adivinhar a dona sem arriscar ` +
              `entregar na cozinha errada. Conserto: ligar a loja pelo app_shop_id em Integrações → 99Food.`,
            payload: event,
          });
          continue;
        }
      }

      // ── Por que este descarte é registrado ────────────────────────────────
      //
      // Estes `continue` eram silenciosos: saíam só num console.warn que some
      // no restart do container. Como o diagnóstico decide "parou_em" pelo
      // tamanho desta lista, um pedido recusado aqui deixava a lista vazia — e
      // o diagnóstico respondia "o 99Food nunca chamou o nosso webhook",
      // mandando conferir o Callback address no portal deles. Ou seja: o
      // sintoma de "chamou e a gente jogou fora" era idêntico ao de "nunca
      // chamou", e os dois pedem conserto em lugares opostos.
      if (!franchisee) {
        console.warn(`[99Food Webhook] Nenhum franqueado encontrado para o pedido: ${orderId}`);
        registrar99Food({
          tipo: eventType || "orderNew",
          reconhecido: true,
          pedidoCriado: false,
          motivo:
            `RECUSADO: nenhuma loja do FireHub corresponde a shop_id "${merchantId}" / ` +
            `app_shop_id "${appShopId}", e nenhuma loja está com o 99Food ativo. ` +
            `O 99Food ENTREGOU o pedido — a amarração da loja é que falta.`,
          payload: event,
        });
        continue;
      }

      // Pedido novo: orderNew (99Food) ou os nomes do iFood/OpenDelivery.
      // Vale também quando o OrderModel veio junto, porque só o evento de
      // pedido novo carrega o pedido inteiro.
      const isNewOrder = EVENTOS_PEDIDO_NOVO.has(normalizarEvento(eventType)) || !!traduzido;

      // Evento de pedido novo SEM o pedido junto: registra o payload cru em vez
      // de descartar em silêncio. É o que permite ajustar o parser ao que o
      // 99Food realmente mandou, caso o formato mude.
      if (isNewOrder && !traduzido) {
        registrar99Food({
          tipo: eventType || "(pedido novo)",
          reconhecido: false,
          pedidoCriado: false,
          motivo: "pedido novo, mas sem OrderModel reconhecível (faltou order_id) — payload cru abaixo",
          payload: event,
        });
        console.warn(`[99Food Webhook] Pedido ${orderId} chegou em formato nao mapeado. Payload registrado em /api/99food/diagnostico`);
      }

      if (isNewOrder && traduzido) {
        const existing = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId },
        });

        if (!existing) {
          const p = traduzido;

          const items = itens99ParaPrisma(p.itens, franchisee!.id);

          try {
            await (prisma.customerOrder as any).create({
              data: {
                franchiseeId: franchisee.id,
                dailyOrderNumber: await generateDailyOrderNumber(franchisee.id),
                customerName: p.cliente.nome,
                customerPhone: p.cliente.telefone,
                customerAddress: p.cliente.endereco,
                status: "NOVO",
                paymentMethod: p.pagamento.texto,
                totalAmount: p.total,
                deliveryFee: p.taxaEntrega,
                notes: p.observacoes,
                source: "99FOOD",
                openDeliveryOrderId: orderId,
                openDeliveryReference: displayId || "",
                openDeliveryChannel: "99FOOD",
                deliveryBy: p.entreguePor,
                items: { create: items },
              },
            });
            created++;
            registrar99Food({ tipo: eventType || "orderNew", reconhecido: true, pedidoCriado: true, payload: event });
            console.log(
              `[99Food Webhook] ✅ Pedido #${displayId} criado — ${p.itens.length} item(ns), R$ ${p.total.toFixed(2)}, ${p.entreguePor}`
            );
          } catch (errCriacao: any) {
            // P2002 = violação de índice único (openDeliveryOrderId).
            //
            // O `findFirst` logo acima não fecha a corrida: o 99Food reenvia o
            // mesmo evento quando não recebe o ACK em 6s, e duas entregas
            // simultâneas passam as duas pela conferência antes de qualquer uma
            // gravar. Sem este catch, a perdedora derruba o lote inteiro para o
            // 500 lá embaixo — o que pede MAIS reenvio do mesmo evento, e os
            // outros pedidos do mesmo lote pagam junto.
            //
            // Chegar aqui significa que o pedido ESTÁ gravado. É sucesso.
            if (errCriacao?.code === "P2002") {
              registrar99Food({
                tipo: eventType || "orderNew",
                reconhecido: true,
                pedidoCriado: false,
                motivo: `reenvio simultâneo: ${orderId} já havia sido gravado por outra entrega do mesmo evento`,
                payload: event,
              });
              console.log(`[99Food Webhook] Pedido ${orderId} já existia (corrida de reenvio) — nada a fazer`);
            } else {
              throw errCriacao;
            }
          }
        } else {
          // Reenvio do 99Food de um pedido que já entrou. Não duplicar é o
          // certo; sumir do registro, não — uma fila de reenvios é sinal de
          // que o ACK não chegou lá, e sem esta linha isso fica invisível.
          registrar99Food({
            tipo: eventType || "orderNew",
            reconhecido: true,
            pedidoCriado: false,
            motivo: `reenvio: pedido ${orderId} já estava no banco (#${existing.dailyOrderNumber})`,
            payload: event,
          });
        }
      } else if (normalizarEvento(eventType) === "orderpartialcancel") {
        // Cancelamento PARCIAL: o cliente tirou item, o pedido continua de pé.
        // Antes isto caía no mesmo case do orderCancel e matava o pedido
        // inteiro — a comanda saía da cozinha e a venda sumia do caixa porque
        // o cliente desistiu de uma batata.
        const r = await aplicarPedidoAlterado99(orderId);
        if (r.ok) updated++;
        registrar99Food({
          tipo: eventType,
          reconhecido: true,
          pedidoCriado: false,
          motivo: r.ok ? `cancelamento parcial aplicado — ${r.motivo}` : `cancelamento parcial NÃO aplicado: ${r.motivo}`,
          payload: event,
        });
      } else if (EVENTOS_PEDIDO_DO_CLIENTE.has(normalizarEvento(eventType))) {
        // Só chega se alguém tiver ligado o opt-in em /v1/shop/apply/set. Não
        // está ligado, e não deve ser antes de existir tela para responder.
        console.warn(`[99Food Webhook] ${eventType} recebido para ${orderId} — não há tela para a loja responder`);
        registrar99Food({
          tipo: eventType,
          reconhecido: true,
          pedidoCriado: false,
          motivo:
            "o CLIENTE está pedindo cancelamento/reembolso e o FireHub não tem tela para aceitar ou recusar. " +
            "Enquanto o opt-in de /v1/shop/apply/set estiver desligado, quem responde é o atendimento da DiDi.",
          payload: event,
        });
      } else if (orderId) {
        // Atualizações de status
        const newStatus = statusDoEvento(eventType);

        let aplicado = 0;
        if (newStatus) {
          // ── Não ressuscitar pedido encerrado ────────────────────────────
          //
          // O 99Food reenvia evento quando não recebe o ACK em 6s, e reenvio
          // não chega na ordem original. Sem guarda, um `deliveryStatus`
          // atrasado rebaixa para SAIU_ENTREGA um pedido que já foi ENTREGUE,
          // e a comanda volta para a tela da cozinha depois de fechada. Pior:
          // um `orderFinish` atrasado marcaria como entregue um pedido que a
          // loja cancelou.
          //
          // CANCELADO é a exceção e passa por cima de tudo: cancelamento
          // depois da entrega é estorno, e a loja precisa ficar sabendo.
          const r = await (prisma.customerOrder as any).updateMany({
            where: {
              openDeliveryOrderId: orderId,
              ...(newStatus === "CANCELADO" ? {} : { status: { notIn: ["ENTREGUE", "CANCELADO"] } }),
            },
            data: { status: newStatus },
          });
          aplicado = r?.count ?? 0;
          if (aplicado > 0) updated++;
        }

        registrar99Food({
          tipo: eventType || "(sem tipo)",
          reconhecido: !!newStatus,
          pedidoCriado: false,
          motivo: !newStatus
            ? "evento não reconhecido"
            : aplicado > 0
            ? `status → ${newStatus}`
            : `status ${newStatus} ignorado: pedido ${orderId} já encerrado ou inexistente aqui`,
          payload: event,
        });
      }
    }

    })();

    // Margem para o ACK caber nos 6s do 99Food contando a viagem de rede.
    const LIMITE_ACK_MS = 4500;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const desfecho = await Promise.race([
      trabalho.then(() => "pronto" as const).catch((err) => { throw err; }),
      new Promise<"demorou">((resolve) => {
        timer = setTimeout(() => resolve("demorou"), LIMITE_ACK_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (desfecho === "demorou") {
      // O trabalho continua; sem este catch, uma falha depois do ACK viraria
      // unhandled rejection e poderia derrubar o processo — levando junto os
      // outros pedidos que estivessem sendo gravados.
      trabalho.catch((err) => {
        console.error("[99Food Webhook] Erro DEPOIS do ACK (pedido pode não ter sido gravado):", err);
        registrar99Food({
          tipo: "erro-pos-ack",
          reconhecido: false,
          pedidoCriado: false,
          motivo: `falhou depois do ACK, então o 99Food não vai reenviar: ${err?.message}`,
          payload: null,
        });
      });
      console.warn(
        `[99Food Webhook] ⏱️ ${events.length} evento(s) passaram de ${LIMITE_ACK_MS}ms — ACK mandado agora, gravação segue em segundo plano`
      );
      return NextResponse.json(ACK);
    }

    console.log(`[99Food Webhook] ${events.length} evento(s): ${created} pedido(s) criado(s), ${updated} atualizado(s)`);
    return NextResponse.json(ACK);
  } catch (err: any) {
    // Falha NOSSA (banco fora, bug no parser). Aqui NÃO se manda ACK de
    // propósito: o reenvio do 99Food é a única coisa entre um pedido e a
    // cozinha nunca saber dele. Perder o pedido em silêncio é pior do que
    // receber o mesmo evento duas vezes — a criação já é idempotente por
    // openDeliveryOrderId.
    console.error("[99Food Webhook] Erro ao processar:", err);
    registrar99Food({ tipo: "erro", reconhecido: false, pedidoCriado: false, motivo: err?.message, payload: null });
    return NextResponse.json({ errno: 1, errmsg: err?.message || "erro interno" }, { status: 500 });
  }
}

/**
 * GET /api/99food/webhook
 *
 * Existe para o portal do 99Food conseguir SALVAR esta URL como Callback
 * address.
 *
 * A rota só exportava POST, então qualquer GET aqui respondia 405. Muitas
 * plataformas validam o endereço com um GET (ou HEAD) antes de aceitar o
 * cadastro, e um 405 nessa hora é indistinguível de "URL inválida" — o campo
 * simplesmente não salva, e do lado de cá o sintoma é exatamente o que a Brasa
 * Burguer vive: loja autorizada, vínculo de pé, e o webhook nunca chamado.
 *
 * Não custa nada e pode ser o que destrava: responde o mesmo `{"errno":0,
 * "errmsg":"ok"}` que o POST responde, que é o único corpo que o 99Food
 * reconhece como sucesso. Nenhum pedido é criado por aqui — GET não carrega
 * evento.
 */
export async function GET() {
  return NextResponse.json(ACK);
}

/** Mesmo motivo do GET: validação por HEAD não pode esbarrar em 405. */
export async function HEAD() {
  return new Response(null, { status: 200 });
}
