import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { registrar99Food } from "@/lib/webhook-99food-log";
import { parseJson99Food } from "@/lib/json-ids-longos";
import { traduzirPedido99Food, itens99ParaPrisma } from "@/lib/food99-pedido";
import { aplicarPedidoAlterado99, sincronizar99Food, tokenDaLoja } from "@/lib/food99-status";
import { donoDoAppShopId, donoDoShopId } from "@/lib/food99-lojas";
import { detalheDoPedido } from "@/lib/food99-api";
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
 * ── O formato real, e por que nenhum pedido entrava ─────────────────────────
 *
 * Em 26/08/2026 o log do portal de desenvolvedor deles mostrou o que ninguém
 * tinha visto: **o 99Food sempre chamou este webhook**, com HTTP 200 e resposta
 * `{"errno":0,"errmsg":"ok"}`, em ~55ms. O pedido morria aqui dentro.
 *
 * O evento de pedido novo é isto, e só isto:
 *
 *     {"app_id":5764607734538831960,
 *      "app_shop_id":"cmt1hle8y0001ia04z3ss479k",
 *      "type":"orderConfirm",
 *      "timestamp":1787766276,
 *      "data":{"order_id":5764684089013634116}}
 *
 * Quatro suposições erradas, e cada uma sozinha já bastava para descartar tudo:
 *
 *   1. o tipo vem em `type` — liam-se event/eventType/fullCode/code/status
 *   2. o conteúdo vem em `data` — procurava-se `order` ou `order_id` na raiz
 *   3. pedido novo é `orderConfirm` — esperava-se `orderNew`
 *   4. o pedido NÃO vem junto: só o id. O resto é `GET order/order/detail`
 *
 * O item 4 é o que mais custou: havia um parser inteiro de OrderModel aqui
 * dentro, escrito contra o swagger, para um payload que o webhook nunca manda.
 *
 * Fonte: log real em Gerenciamento de aplicativo → Monitoramento da API →
 * Monitoramento de log da API, no developer-food.99app.com.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A única resposta que o 99Food aceita como "recebido". */
const ACK = { errno: 0, errmsg: "ok" };

/** Nome de evento normalizado, sem caixa nem separador, para comparar. */
function normalizarEvento(bruto: string): string {
  return (bruto || "").toString().toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Evento de pedido novo.
 *
 * `orderConfirm` é o que o 99Food manda de verdade — confirmado no log do
 * portal deles. `orderNew` está na documentação pública e nunca chegou; fica na
 * lista porque não custa nada. Os outros são iFood/OpenDelivery, para payload
 * de teste montado no padrão antigo.
 */
const EVENTOS_PEDIDO_NOVO = new Set([
  "orderconfirm",                                // 99Food — o real
  "ordernew",                                    // 99Food — documentado
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
    // `deliveryStatus` NÃO entra aqui de propósito. Ele é logística do
    // entregador, não status do pedido: o payload real é
    // `{order_id, delivery_status:120, rider_name, rider_phone, rider_to_B_ETA}`
    // e o 120 é o entregador indo BUSCAR na loja — a comida ainda está no
    // balcão. Mapeá-lo para SAIU_ENTREGA tirava a comanda da cozinha antes da
    // hora. Chegaram 8 desses para um pedido só, em 8 minutos.
    //
    // Os outros códigos de delivery_status ainda não são conhecidos; o evento
    // fica registrado com o payload cru até dar para mapear com segurança.
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

/** Nome do entregador do 99, quando o evento de logística o traz. */
function entregadorDoEvento(dados: any): string | null {
  const nome = String(dados?.rider_name ?? "").trim();
  if (!nome) return null;
  const fone = String(dados?.rider_phone ?? "").trim();
  return fone ? `${nome} (${fone})` : nome;
}

export async function POST(req: NextRequest) {
  try {
    // Teto de vazão por origem: alto para não atrapalhar rajada legítima em
    // hora de pico, suficiente para barrar flood e varredura de app_shop_id.
    // Devolve o ACK deles no formato certo — um 429 cru faria o 99Food tratar
    // como falha nossa e reenviar em loop.
    const { checkRateLimit, getClientIp } = await import("@/lib/rateLimit");
    const ipOrigem = getClientIp(req);
    const vazao = checkRateLimit(`99food-webhook:${ipOrigem}`, { windowMs: 60_000, maxRequests: 600 });
    if (!vazao.allowed) {
      console.warn(`[99Food Webhook] 🚦 Vazão excedida de ${ipOrigem} — requisição descartada.`);
      return NextResponse.json({ errno: 429, errmsg: "too many requests" }, { status: 429 });
    }

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
    // ⚠️ NÃO defina FOOD99_WEBHOOK_SECRET sem antes acertar o algoritmo.
    //
    // O cabeçalho real deles é `didi-header-sign`, e o valor tem 32 hex
    // (`ac8f6deb93955d388befd635b0adc304`) — tamanho de MD5, não de
    // HMAC-SHA256, que é o que `verificarAssinaturaHmac` calcula. Lido do log
    // do portal em 26/08/2026.
    //
    // Ou seja: com o segredo definido, TODA requisição do 99Food seria recusada
    // com 401 e a integração pararia — trocando "não chega" por "não chega, e
    // agora é culpa nossa". O cabeçalho certo já entra na lista para o dia em
    // que a fórmula for confirmada com eles.
    const assinatura99 = verificarAssinaturaHmac(
      "FOOD99_WEBHOOK_SECRET",
      bodyText,
      req.headers.get("didi-header-sign") ||
        req.headers.get("x-99food-signature") ||
        req.headers.get("x-signature") ||
        req.headers.get("x-hub-signature-256")
    );
    if (assinatura99.estado === "invalida") {
      console.error(`[99Food Webhook] Origem não confirmada (${assinatura99.motivo}) — requisição recusada`);
      return NextResponse.json({ errno: 401, errmsg: "unauthorized" }, { status: 401 });
    }
    if (assinatura99.estado === "sem-segredo") {
      avisarWebhookSemSegredo("99Food", "FOOD99_WEBHOOK_SECRET");

      // Modo observação: o `didi-header-sign` tem 32 hex (cara de MD5), e não
      // os 64 do HMAC-SHA256 que a verificação acima calcula — por isso ligar
      // o segredo hoje recusaria TODO pedido verdadeiro. Aqui a assinatura
      // real é confrontada com uma matriz de fórmulas usando os segredos que
      // já temos; quando o log apontar a que bate, a exigência pode ser ligada
      // com certeza. Nada é recusado por causa deste bloco.
      try {
        const { diagnosticarAssinatura } = await import("@/lib/webhook-assinatura");
        diagnosticarAssinatura({
          parceiro: "99Food",
          corpoCru: bodyText,
          assinaturaRecebida:
            req.headers.get("didi-header-sign") ||
            req.headers.get("x-99food-signature") ||
            req.headers.get("x-signature"),
          candidatos: [
            { rotulo: "FOOD99_APP_SECRET", valor: process.env.FOOD99_APP_SECRET },
            { rotulo: "FOOD99_WEBHOOK_SECRET", valor: process.env.FOOD99_WEBHOOK_SECRET },
          ],
          // O esquema da DiDi costuma assinar os campos do evento, não o corpo.
          extras: (() => {
            try {
              const e = JSON.parse(bodyText);
              const campos: Record<string, string> = {};
              for (const k of ["app_id", "app_shop_id", "type", "timestamp"]) {
                if (e?.[k] !== undefined) campos[k] = String(e[k]);
              }
              return campos;
            } catch { return {}; }
          })(),
        });
      } catch { /* diagnóstico nunca pode derrubar o webhook */ }
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
      // ── O formato REAL, lido do log do portal deles em 26/08/2026 ─────────
      //
      //   {"app_id":5764607734538831960,
      //    "app_shop_id":"cmt1hle8y0001ia04z3ss479k",
      //    "type":"orderConfirm",
      //    "timestamp":1787766276,
      //    "data":{"order_id":5764684089013634116}}
      //
      // Três coisas aqui derrubavam TODO evento, e o 99Food chamava desde o
      // primeiro dia (HTTP 200, resposta "ok", ~55ms — está no log deles):
      //
      //   • o tipo vem em `type`, e a lista lida era
      //     event/eventType/fullCode/code/status. `eventType` saía vazio.
      //   • o conteúdo vem em `data`, não em `order`. Como `event.order_id`
      //     também não existe na raiz, `orderId` ficava undefined e o
      //     `continue` logo abaixo jogava o evento fora sem registrar nada.
      //   • pedido novo é `orderConfirm`, não `orderNew`.
      //
      // Os nomes antigos seguem aceitos: não custam nada e cobrem payload de
      // teste montado no padrão anterior.
      const dados = event.data && typeof event.data === "object" ? event.data : event;

      // O OrderModel completo só aparece se algum dia eles passarem a mandá-lo
      // junto. Hoje NÃO vem — ver o bloco de busca em order/detail abaixo.
      const pedidoBruto =
        event.order && typeof event.order === "object"
          ? event.order
          : dados.order_items || dados.receive_address
          ? dados
          : null;

      const traduzido = pedidoBruto ? traduzirPedido99Food(pedidoBruto) : null;

      // O id da loja no 99Food. `shop.shop_id` é o lugar dele no OrderModel;
      // os outros nomes cobrem evento de status, que não carrega o pedido.
      const merchantId =
        traduzido?.shopId || dados.shop_id || event.shop_id || event.merchantId || event.storeId || event.merchant?.id;

      // O app_shop_id é o identificador da loja DENTRO do vínculo. No payload
      // real ele vem na RAIZ do evento, fora do `data` — e é ele que amarra o
      // pedido à loja, porque o evento fino não traz shop_id nenhum.
      const appShopId = traduzido?.appShopId || event.app_shop_id || event.appShopId;

      // TEXTO, sempre. `openDeliveryOrderId` é String no banco, e um order_id
      // que chegue como número derruba a consulta inteira com erro de tipo do
      // Prisma. Na prática o id real tem 19 dígitos e o parseJson99Food já o
      // entrega como string — mas depender disso é deixar a rota de pé por
      // sorte, e um evento de teste com id curto já basta para quebrar.
      const orderIdBruto = traduzido?.orderId || dados.order_id || event.order_id || event.orderId || event.id;
      const orderId = orderIdBruto === null || orderIdBruto === undefined || orderIdBruto === "" ? "" : String(orderIdBruto);
      const displayId =
        traduzido?.numeroNoParceiro || dados.order_index || event.order_index || event.displayId || event.reference || orderId;
      const eventType =
        event.type || event.event || event.eventType || event.fullCode || event.code || event.status || "";

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

      // ── De quem é este pedido ─────────────────────────────────────────────
      //
      // 1ª tentativa — a tabela de lojas (Food99Store), que é o que permite
      // mais de uma loja do 99Food na mesma conta. `donoDoAppShopId` já cai
      // sozinha nas colunas antigas do User quando a tabela não existe ou não
      // tem a linha, então esta chamada NÃO substitui o caminho antigo: ela o
      // embrulha. Com a tabela vazia, o comportamento é exatamente o de antes.
      let franchisee = null as any;
      if (appShopId) {
        const donoId = await donoDoAppShopId(String(appShopId));
        if (donoId) franchisee = await prisma.user.findUnique({ where: { id: donoId } }).catch(() => null);
      }

      // 2ª — o app_shop_id pode SER o nosso id, quando o 99Food aceita o valor
      // que mandamos. Custa uma consulta e cobre esse caso sem depender de o
      // vínculo ter sido gravado aqui antes. (É como a Brasa Burguer está.)
      if (!franchisee && appShopId) {
        franchisee = await prisma.user.findUnique({ where: { id: String(appShopId) } }).catch(() => null);
      }

      // 3ª — shop_id do 99Food, para quem conectou pelo formulário antigo.
      if (!franchisee && merchantId) {
        const donoId = await donoDoShopId(String(merchantId));
        if (donoId) franchisee = await prisma.user.findUnique({ where: { id: donoId } }).catch(() => null);
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

      // Pedido novo. `orderNew` e `orderConfirm` chegam OS DOIS, com ~3s de
      // diferença — visto no log deles no primeiro pedido que entrou:
      //
      //   17:08:21  orderNew      ← é este que cria
      //   17:08:25  orderConfirm  ← o mesmo pedido, já gravado
      //
      // Por isso os dois estão em EVENTOS_PEDIDO_NOVO, e a conferência de
      // duplicado logo abaixo é o que impede a comanda de sair duas vezes.
      const isNewOrder = EVENTOS_PEDIDO_NOVO.has(normalizarEvento(eventType)) || !!traduzido;

      // ── Conferir ANTES de buscar ──────────────────────────────────────────
      //
      // Esta conferência ficava depois do `order/detail`, e o log deles mostrou
      // a conta: no primeiro pedido real saíram DUAS chamadas ao detail em 3
      // segundos — a segunda só para descobrir que o pedido já estava gravado.
      // Como orderNew e orderConfirm sempre vêm em par, isso dobrava o consumo
      // da API deles em TODO pedido, e reenvio por ACK atrasado multiplicaria
      // mais ainda.
      if (isNewOrder) {
        const jaGravado = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId },
          select: { id: true, dailyOrderNumber: true },
        });
        if (jaGravado) {
          registrar99Food({
            tipo: eventType || "orderNew",
            reconhecido: true,
            pedidoCriado: false,
            motivo: `reenvio: pedido ${orderId} já estava no banco (#${jaGravado.dailyOrderNumber})`,
            payload: event,
          });
          continue;
        }
      }

      // ── O webhook do 99Food NÃO carrega o pedido ──────────────────────────
      //
      // O evento de pedido novo é literalmente isto:
      //
      //     {"app_id":…,"app_shop_id":"…","type":"orderConfirm",
      //      "timestamp":…,"data":{"order_id":5764684089013634116}}
      //
      // Só o id. Nome do cliente, endereço, itens e valor não vêm — quem tem o
      // pedido inteiro é `GET /v1/order/order/detail`. Todo o parser de
      // OrderModel que morava aqui esperava um payload que nunca chegou, e é
      // por isso que nenhum pedido do 99Food entrou até hoje.
      //
      // A busca custa uma ida à API deles dentro do webhook. Cabe: a resposta
      // ao 99Food já corre contra o limite de 4,5s e, estourando, o ACK sai na
      // frente e a gravação termina em segundo plano.
      let pedido = traduzido;
      if (isNewOrder && !pedido) {
        const token = await tokenDaLoja(franchisee.id);
        if (!token) {
          registrar99Food({
            tipo: eventType || "(pedido novo)",
            reconhecido: true,
            pedidoCriado: false,
            motivo: `sem auth_token para a loja ${franchisee.id} — não deu para buscar o pedido ${orderId} em order/detail`,
            payload: event,
          });
          console.error(`[99Food Webhook] Sem token da loja ${franchisee.id} — pedido ${orderId} não pôde ser buscado`);
          continue;
        }

        const detalhe = await detalheDoPedido(token, String(orderId));
        if (detalhe.errno !== 0 || !detalhe.data) {
          registrar99Food({
            tipo: eventType || "(pedido novo)",
            reconhecido: true,
            pedidoCriado: false,
            motivo: `order/detail recusou o pedido ${orderId}: ${detalhe.errno} ${detalhe.errmsg}`,
            payload: event,
          });
          // Erro NOSSO/deles ao buscar: deixa o lote falhar para o 99Food
          // reenviar. É a única chance de o pedido ainda entrar.
          throw new Error(`order/detail ${orderId}: ${detalhe.errno} ${detalhe.errmsg}`);
        }
        pedido = traduzirPedido99Food(detalhe.data);
      }

      if (isNewOrder && pedido) {
        // A conferência de duplicado já aconteceu lá em cima, antes de gastar
        // uma chamada no order/detail. O que sobra aqui é a corrida: duas
        // entregas do mesmo evento passando juntas pela conferência. Quem perde
        // cai no P2002 logo abaixo, que trata como sucesso.
        {
          const p = pedido;

          const items = itens99ParaPrisma(p.itens, franchisee!.id);

          try {
            await (prisma.customerOrder as any).create({
              data: {
                franchiseeId: franchisee.id,
                dailyOrderNumber: await generateDailyOrderNumber(franchisee.id),
                customerName: p.cliente.nome,
                customerPhone: p.cliente.telefone,
                customerAddress: p.cliente.endereco,
                // O aceite automatico da loja vale para o 99Food tambem. Com ele
                // ligado o pedido ja nasce ACEITO e e confirmado no 99Food logo
                // abaixo; desligado, nasce NOVO e fica tocando no painel para o
                // lojista aceitar, exatamente como sempre foi.
                status: franchisee.autoAcceptOrders ? "ACEITO" : "NOVO",
                paymentMethod: p.pagamento.texto,
                totalAmount: p.total,
                deliveryFee: p.taxaEntrega,
                notes: p.observacoes,
                source: "99FOOD",
                openDeliveryOrderId: orderId,
                // ── O NUMERO QUE O CLIENTE E O MOTOBOY DIZEM ──────────────
                //
                // `displayId` foi calculado la em cima, a partir do EVENTO — e
                // o evento do 99Food NAO traz `order_index`. Sobrava o
                // fallback: o `order_id` de 19 digitos. A comanda saia com
                // "N. do Pedido: 5764684242755849382" enquanto o cliente, o
                // app e o motoboy falavam de #403016. Ninguem conseguia casar
                // um com o outro no balcao.
                //
                // O numero curto ESTAVA aqui do lado o tempo todo: veio no
                // `order/detail` que este mesmo bloco acabou de buscar, e o
                // tradutor ja o entrega em `numeroNoParceiro` (order_index).
                // So nao estava sendo usado na hora de gravar.
                openDeliveryReference: p.numeroNoParceiro || displayId || "",
                openDeliveryChannel: "99FOOD",
                deliveryBy: p.entreguePor,
                items: { create: items },
              },
            });

            // ── Confirmar no 99Food, quando a loja aceita sozinha ─────────
            //
            // Gravar ACEITO aqui NAO avisa o 99Food: quem chama o `confirm`
            // deles e `sincronizar99Food`, e ela so roda nas trocas de status
            // (customer-order/status, kds, motoboys/*). Um pedido que nasce
            // aceito nunca passa por essas rotas, entao sem esta chamada ele
            // ficaria aceito aqui e nao-confirmado la — e pedido nao
            // confirmado a tempo o 99Food cancela.
            //
            // Sem `await`: a resposta ao webhook corre contra 6 segundos, e o
            // ACK nao pode esperar a ida ao 99Food.
            if (franchisee.autoAcceptOrders) {
              sincronizar99Food(
                {
                  openDeliveryOrderId: String(orderId),
                  franchiseeId: franchisee.id,
                  status: "NOVO",
                  deliveryBy: p.entreguePor,
                },
                "ACEITO"
              ).catch((e) =>
                console.error(`[99Food Webhook] falha ao confirmar ${orderId} no 99Food:`, e?.message)
              );
            }
            created++;
            registrar99Food({ tipo: eventType || "orderNew", reconhecido: true, pedidoCriado: true, payload: event });
            console.log(
              `[99Food Webhook] ✅ Pedido #${p.numeroNoParceiro || displayId} criado — ${p.itens.length} item(ns), R$ ${p.total.toFixed(2)}, ${p.entreguePor}`
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

        // Logística do 99: não mexe no status do pedido, mas dizer QUEM vem
        // buscar e em que código é o que permite mapear o resto dos
        // delivery_status sem precisar caçar no portal deles de novo.
        const ehLogistica = normalizarEvento(eventType) === "deliverystatus";
        const entregador = entregadorDoEvento(dados);

        registrar99Food({
          tipo: eventType || "(sem tipo)",
          reconhecido: !!newStatus || ehLogistica,
          pedidoCriado: false,
          motivo: ehLogistica
            ? `logística do 99: delivery_status=${dados?.delivery_status ?? "?"}` +
              (entregador ? `, entregador ${entregador}` : "") +
              " — status do pedido NÃO muda por isto"
            : !newStatus
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
