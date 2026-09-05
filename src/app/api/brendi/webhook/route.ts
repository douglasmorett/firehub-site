import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrarBrendi } from "@/lib/webhook-brendi-log";
import { parseJson99Food } from "@/lib/json-ids-longos";
import { processBrendiEvent } from "@/lib/processBrendiEvent";
import {
  verificarAssinaturaHmac,
  avisarWebhookSemSegredo,
  diagnosticarAssinatura,
} from "@/lib/webhook-assinatura";

/**
 * POST /api/brendi/webhook
 * Recebe eventos push da Brendi (Open Delivery / Abrasel).
 *
 * ── O webhook é ACELERADOR, nunca dependência ───────────────────────────────
 * O transporte primário desta integração é o polling (`GET /v1/events:polling`
 * no cron e no poll do dashboard). Este endpoint existe para o pedido chegar
 * em segundos em vez de em até um minuto — se ele falhar, o polling entrega o
 * mesmo evento depois. Por isso NADA aqui pode ser a única via de um pedido.
 *
 * ── O evento só diz QUAL pedido; o conteúdo vem da API ──────────────────────
 * Lição paga no 99Food: quem confia no corpo do webhook aceita pedido forjado
 * por qualquer um que conheça a URL — itens, valor e endereço que o remetente
 * quiser. Aqui o payload serve apenas para extrair `orderId` + `eventType`;
 * o pedido de verdade é SEMPRE baixado de `GET /v1/orders/{id}` pelo
 * `processBrendiEvent`, autenticado com a credencial da loja. Um POST forjado
 * no máximo faz a gente perguntar à Brendi por um pedido que não existe.
 *
 * ── A resposta é parte do protocolo ─────────────────────────────────────────
 * O corpo e o prazo exatos que a Brendi espera ainda não são públicos
 * (pergunta aberta no ticket com eles). Até a resposta, vale o desenho mais
 * conservador aprendido no 99Food, que exige ACK em 6s:
 *
 *   terminou a tempo  → 200, tudo gravado
 *   falhou a tempo    → 500 DE PROPÓSITO, para a Brendi reenviar — o reenvio
 *                       (dela ou do polling) é a rede entre um pedido e a
 *                       cozinha nunca saber dele
 *   payload ilegível  → 200 com registro: reenviar o mesmo texto quebrado dez
 *                       vezes não o conserta
 *   passou do limite  → 200 agora e o trabalho segue no container; a gravação
 *                       é idempotente por openDeliveryOrderId, então reenvio
 *                       que cruze com ela não duplica
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 200 com corpo neutro. A Brendi ainda não documentou o corpo que considera
 * sucesso; quando responder ao ticket, é AQUI que se ajusta.
 */
const ACK = { ok: true };

/** Campos do evento que interessam — o resto do payload NÃO é confiável. */
function extrairEvento(event: any): { eventoId: string; orderId: string; eventType: string } {
  // TEXTO, sempre: openDeliveryOrderId é String no banco, e a Brendi usa UUID
  // (string). Se algum dia vier número, String() evita erro de tipo do Prisma.
  const orderIdBruto =
    event?.orderId ?? event?.orderID ?? event?.order_id ?? event?.data?.orderId ?? event?.order?.id ?? "";
  const orderId = orderIdBruto === null || orderIdBruto === undefined ? "" : String(orderIdBruto).trim();
  const eventoIdBruto = event?.eventId ?? event?.id ?? "";
  const eventoId = eventoIdBruto === null || eventoIdBruto === undefined ? "" : String(eventoIdBruto).trim();
  const eventType = String(event?.eventType ?? event?.fullCode ?? event?.code ?? event?.type ?? "").trim();
  return { eventoId, orderId, eventType };
}

export async function POST(req: NextRequest) {
  try {
    // Teto de vazão por origem: alto para não atrapalhar rajada legítima em
    // hora de pico, suficiente para barrar flood e varredura da URL.
    const { checkRateLimit, getClientIp } = await import("@/lib/rateLimit");
    const ipOrigem = getClientIp(req);
    const vazao = checkRateLimit(`brendi-webhook:${ipOrigem}`, { windowMs: 60_000, maxRequests: 600 });
    if (!vazao.allowed) {
      console.warn(`[Brendi Webhook] 🚦 Vazão excedida de ${ipOrigem} — requisição descartada.`);
      return NextResponse.json({ ok: false, error: "too many requests" }, { status: 429 });
    }

    // Corpo cru lido UMA vez: a verificação de assinatura precisa dos bytes
    // exatos — reserializar o JSON muda ordem de chaves e espaços e o hash
    // deixa de bater.
    const bodyText = await req.text();
    if (!bodyText) {
      // Corpo vazio ainda recebe 200: reenviar não vai fazê-lo aparecer.
      return NextResponse.json(ACK);
    }

    // ── De onde veio esta requisição ────────────────────────────────────────
    //
    // A fórmula de assinatura da Brendi não é publicada. Enquanto
    // BRENDI_WEBHOOK_SECRET não existir no ambiente, o evento entra e o log
    // registra o aviso; assim que existir, requisição sem assinatura válida é
    // recusada.
    //
    // ⚠️ NÃO defina BRENDI_WEBHOOK_SECRET antes de o modo observação abaixo
    // confirmar a fórmula no tráfego real. No 99Food, ligar o segredo teria
    // recusado 100% do tráfego verdadeiro (o cabeçalho deles era MD5 de 32
    // hex, não o HMAC-SHA256 que a verificação calcula) — trocando "não chega"
    // por "não chega, e agora é culpa nossa".
    const assinaturaBrendi = verificarAssinaturaHmac(
      "BRENDI_WEBHOOK_SECRET",
      bodyText,
      req.headers.get("x-brendi-signature") ||
        req.headers.get("x-signature") ||
        req.headers.get("x-hub-signature-256")
    );
    if (assinaturaBrendi.estado === "invalida") {
      console.error(`[Brendi Webhook] Origem não confirmada (${assinaturaBrendi.motivo}) — requisição recusada`);
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (assinaturaBrendi.estado === "sem-segredo") {
      avisarWebhookSemSegredo("Brendi", "BRENDI_WEBHOOK_SECRET");

      // Modo observação: confronta a assinatura que veio com a matriz de
      // fórmulas conhecidas usando os segredos que já temos, e loga só o NOME
      // da que bater. Nada é recusado por causa deste bloco — ele existe para
      // um dia dar para EXIGIR assinatura com certeza, em vez de com esperança.
      try {
        // Os candidatos naturais são os client secrets das lojas conectadas
        // (é o único segredo compartilhado entre nós e a Brendi hoje). SQL cru
        // porque as colunas brendi* são garantidas no boot e ainda não estão
        // no schema.prisma — o Prisma Client não as conhece.
        let candidatos: { rotulo: string; valor: string | undefined }[] = [
          { rotulo: "BRENDI_WEBHOOK_SECRET", valor: process.env.BRENDI_WEBHOOK_SECRET },
        ];
        try {
          const lojas = await prisma.$queryRaw<{ id: string; brendiClientSecret: string | null }[]>`
            SELECT "id", "brendiClientSecret" FROM "User"
            WHERE "brendiConnected" = true AND "brendiClientSecret" IS NOT NULL
            LIMIT 5
          `;
          candidatos = candidatos.concat(
            lojas.map((l) => ({
              rotulo: `clientSecret da loja ${l.id.slice(0, 8)}…`,
              valor: l.brendiClientSecret ?? undefined,
            }))
          );
        } catch {
          /* colunas ainda não criadas — segue só com o env */
        }

        diagnosticarAssinatura({
          parceiro: "Brendi",
          corpoCru: bodyText,
          assinaturaRecebida:
            req.headers.get("x-brendi-signature") ||
            req.headers.get("x-signature") ||
            req.headers.get("x-hub-signature-256"),
          candidatos,
          // Para os esquemas que assinam campos do evento em vez do corpo.
          extras: (() => {
            try {
              const e = JSON.parse(bodyText);
              const alvo = Array.isArray(e) ? e[0] : e;
              const campos: Record<string, string> = {};
              for (const k of ["id", "eventId", "eventType", "orderId", "createdAt", "timestamp", "merchantId"]) {
                if (alvo?.[k] !== undefined && typeof alvo[k] !== "object") campos[k] = String(alvo[k]);
              }
              return campos;
            } catch { return {}; }
          })(),
        });
      } catch { /* diagnóstico nunca pode derrubar o webhook */ }
    }

    // Payload ilegível é o único erro que merece 200: reenviar o mesmo texto
    // quebrado dez vezes não o conserta. Erro NOSSO, mais abaixo, é o oposto —
    // ali o reenvio é justamente o que salva o pedido.
    let payload: any;
    try {
      // Open Delivery usa UUID string, então o risco de inteiro de 19 dígitos
      // do 99Food não deveria existir — mas o parser defensivo não custa nada
      // e, se a Brendi mandar um id numérico longo, ele chega inteiro.
      payload = parseJson99Food(bodyText);
    } catch {
      console.error("[Brendi Webhook] Corpo não é JSON válido:", bodyText.slice(0, 300));
      registrarBrendi({
        tipo: "json-invalido",
        reconhecido: false,
        pedidoCriado: false,
        motivo: "corpo recebido não é JSON válido",
        payload: bodyText.slice(0, 1000),
      });
      return NextResponse.json(ACK);
    }

    // Evento único OU array — a Brendi não documenta qual dos dois manda, e o
    // Open Delivery permite ambos. Aceitar os dois custa uma linha.
    const events: any[] = Array.isArray(payload) ? payload : [payload];

    console.log(`[Brendi Webhook] Recebidos ${events.length} evento(s)`);

    let created = 0;
    let updated = 0;

    // ACK do feed de polling, agrupado POR LOJA: a credencial é por loja,
    // então o acknowledgment também é. Ackar aqui evita que o cron reprocesse
    // o mesmo evento no próximo ciclo (a idempotência absorveria, mas o feed
    // fica limpo). Só entra na lista evento cujo pedido está CONFIRMADO no
    // banco — o acknowledgment presume-se irreversível e sem listagem de
    // recuperação, igual ao JotaJá.
    const acksPorLoja = new Map<string, { id: string; orderId: string; eventType: string }[]>();

    const enviarAcks = async () => {
      if (acksPorLoja.size === 0) return;
      try {
        const { brendiMutate } = await import("@/lib/brendi-api");
        for (const [lojaId, lista] of acksPorLoja) {
          try {
            await brendiMutate("POST", "/v1/events/acknowledgment", lista, lojaId);
          } catch (e: any) {
            // Não crítico: sem ACK o evento volta no polling e a idempotência
            // o descarta — pior caso é uma consulta a mais, nunca duplicata.
            console.warn(`[Brendi Webhook] ACK falhou para a loja ${lojaId}: ${e?.message}`);
          }
        }
      } catch (e: any) {
        console.warn(`[Brendi Webhook] Módulo de ACK indisponível: ${e?.message}`);
      }
      acksPorLoja.clear();
    };

    // ── O trabalho corre solto; a resposta espera só até o limite ───────────
    // O prazo de ACK da Brendi não é público. Assume-se o mais apertado
    // conhecido entre os parceiros (6s do 99Food) até o ticket responder —
    // estourar prazo de webhook é como integração morre em silêncio.
    const trabalho = (async () => {
      for (const event of events) {
        const { eventoId, orderId, eventType } = extrairEvento(event);

        // Evento sem orderId não vira pedido nem atualização, mas PRECISA
        // ficar registrado: é o que separa "a Brendi nunca chamou" de "chamou
        // e a gente não entendeu" no /api/brendi/diagnostico.
        if (!orderId) {
          registrarBrendi({
            tipo: eventType || "(sem tipo)",
            reconhecido: false,
            pedidoCriado: false,
            motivo: "evento sem orderId — nada a criar nem a atualizar",
            payload: event,
          });
          continue;
        }

        // Evento MÍNIMO e sintético: só identidade. Itens, valores e endereço
        // vêm do GET /v1/orders dentro do processBrendiEvent — nunca daqui.
        // `metadata` passa porque alimenta apenas a disputa de cancelamento
        // (texto informativo), não a criação de pedido.
        const eventoMinimo = {
          id: eventoId || undefined,
          eventId: eventoId || undefined,
          eventType: eventType || undefined,
          orderId,
          metadata: event?.metadata && typeof event.metadata === "object" ? event.metadata : undefined,
        } as any;

        const result = await processBrendiEvent(eventoMinimo);

        if (result.action === "error") {
          // ── REENVIAR RESOLVE, OU NÃO? ────────────────────────────────────
          //
          // Só faz sentido devolver 500 (que é o que faz a Brendi mandar de
          // novo) quando a próxima tentativa tem chance de dar certo: banco
          // fora, rede, GET que falhou.
          //
          // "Não existe loja com este merchant" é estável — e era justamente
          // o estado do sistema inteiro enquanto nenhuma loja estivesse
          // conectada: TODO evento virava 500, inclusive a validação da URL no
          // cadastro da integração no painel da Brendi. Endpoint que responde
          // 500 na validação é endpoint reprovado.
          //
          // Nestes casos respondemos 200 e NÃO ackamos: o evento continua na
          // fila do polling e entra sozinho quando a loja for conectada.
          if (result.reenviarAdianta === false) {
            console.warn(`[Brendi Webhook] ${orderId}: ${result.message} — 200 (reenviar não resolve; evento segue na fila do polling)`);
            registrarBrendi({
              tipo: eventType || "(sem tipo)",
              reconhecido: true,
              pedidoCriado: false,
              motivo: `NÃO PROCESSADO: ${result.message || "sem detalhe"} — evento NÃO ackado, volta pelo polling quando a loja estiver conectada`,
              payload: event,
            });
            continue;
          }

          // Falha NOSSA e transitória (banco, rede até a Brendi). O 500 lá
          // embaixo faz a Brendi reenviar — e o polling também vai ver o
          // evento, porque ele NÃO foi ackado. Antes de derrubar o lote, os
          // eventos que JÁ deram certo são ackados para não voltarem.
          registrarBrendi({
            tipo: eventType || "(sem tipo)",
            reconhecido: true,
            pedidoCriado: false,
            motivo: `ERRO ao processar: ${result.message || "sem detalhe"} — evento NÃO ackado, reenvio vai tentar de novo`,
            payload: event,
          });
          await enviarAcks();
          throw new Error(`processBrendiEvent ${orderId}: ${result.message || result.action}`);
        }

        if (result.action === "created") created++;
        if (result.action === "updated" || result.action === "cancelled" || result.action === "dispute") updated++;

        registrarBrendi({
          tipo: eventType || "(sem tipo)",
          reconhecido: true,
          pedidoCriado: result.action === "created",
          motivo: `${result.action}${result.message ? `: ${result.message}` : ""}`,
          payload: event,
        });

        // ── ACK só com o pedido confirmado no banco ─────────────────────────
        // "processado" não basta: um "skipped" que não gravou nada e fosse
        // ackado apagaria o evento do feed para sempre. A consulta abaixo é a
        // prova de vida — e é dela que sai o franchiseeId dono da credencial
        // que assina o acknowledgment.
        if (eventoId) {
          const gravado = await prisma.customerOrder.findFirst({
            where: {
              OR: [
                { openDeliveryOrderId: orderId },
                { openDeliveryOrderId: { startsWith: `${orderId}_` } },
              ],
            } as any,
            select: { id: true, franchiseeId: true },
          });
          if (gravado?.franchiseeId) {
            const lista = acksPorLoja.get(gravado.franchiseeId) ?? [];
            lista.push({ id: eventoId, orderId, eventType });
            acksPorLoja.set(gravado.franchiseeId, lista);
          } else {
            console.warn(`[Brendi Webhook] ⛔ SEM ACK ${orderId}: ${result.action} não deixou pedido no banco`);
          }
        }
      }

      await enviarAcks();
    })();

    // Margem para a resposta caber num prazo estilo 99Food (6s) contando a
    // viagem de rede.
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
      // O trabalho continua; sem este catch, uma falha depois da resposta
      // viraria unhandled rejection e poderia derrubar o processo — levando
      // junto os outros pedidos em gravação. O evento não ackado volta pelo
      // polling, então nada se perde.
      trabalho.catch((err) => {
        console.error("[Brendi Webhook] Erro DEPOIS da resposta (o polling recupera o evento):", err);
        registrarBrendi({
          tipo: "erro-pos-resposta",
          reconhecido: false,
          pedidoCriado: false,
          motivo: `falhou depois do 200; o evento segue no feed de polling: ${err?.message}`,
          payload: null,
        });
      });
      console.warn(
        `[Brendi Webhook] ⏱️ ${events.length} evento(s) passaram de ${LIMITE_ACK_MS}ms — 200 mandado agora, gravação segue em segundo plano`
      );
      return NextResponse.json(ACK);
    }

    console.log(`[Brendi Webhook] ${events.length} evento(s): ${created} pedido(s) criado(s), ${updated} atualizado(s)`);
    return NextResponse.json(ACK);
  } catch (err: any) {
    // Falha NOSSA (banco fora, bug no parser, Brendi não devolveu o pedido).
    // Aqui NÃO se manda 200 de propósito: o reenvio da Brendi + o polling são
    // a rede entre um pedido e a cozinha nunca saber dele. Receber o mesmo
    // evento duas vezes é inofensivo — a criação é idempotente por
    // openDeliveryOrderId.
    console.error("[Brendi Webhook] Erro ao processar:", err);
    registrarBrendi({ tipo: "erro", reconhecido: false, pedidoCriado: false, motivo: err?.message, payload: null });
    // Mensagem genérica: este endpoint não tem autenticação, e o detalhe
    // interno (id de loja, nome de coluna, caminho de arquivo) não pode sair
    // para quem chamar. O motivo completo fica no log e no /api/brendi/diagnostico.
    return NextResponse.json({ ok: false, error: "erro ao processar o evento" }, { status: 500 });
  }
}

/**
 * GET /api/brendi/webhook
 *
 * Existe para o painel da Brendi conseguir SALVAR esta URL no campo
 * `webhookUrl`. Muitas plataformas validam o endereço com um GET (ou HEAD)
 * antes de aceitar o cadastro, e um 405 nessa hora é indistinguível de "URL
 * inválida" — o campo simplesmente não salva, e do lado de cá o sintoma é
 * webhook nunca chamado com tudo aparentemente configurado (foi exatamente o
 * caso da Brasa Burguer no 99Food). Nenhum pedido é criado por aqui — GET não
 * carrega evento.
 */
export async function GET() {
  return NextResponse.json(ACK);
}

/** Mesmo motivo do GET: validação por HEAD não pode esbarrar em 405. */
export async function HEAD() {
  return new Response(null, { status: 200 });
}
