import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { garantirColunasBrendi } from "@/lib/garantir-colunas";

/**
 * POST /api/customer-order/brendi-import
 * Resgate MANUAL de pedido da Brendi (clone do jotaja/import-order).
 *
 * Existe para o dia em que o pedido está no painel da Brendi e não apareceu no
 * FireHub (feed atrasado, evento perdido antes do ACK condicionado existir,
 * loja recém-conectada). O lojista digita o número (displayId) ou o UUID e o
 * pedido entra AGORA — sem esperar diagnóstico.
 *
 * Corpo: { referencia, apenasPrever? } + campos opcionais de fallback
 * (customerName, customerPhone, customerAddress, totalAmount, paymentMethod,
 * itemsSummary) para quando a API não devolver o pedido.
 *
 * Modo { apenasPrever: true } — lição do 99Food: devolve { traduzido, cru }
 * SEM gravar nada. Foi esse modo que pegou o parser lendo campo errado com
 * total zero ANTES de entrar em produção. Com apenasPrever NUNCA se cria
 * pedido, nem pelo fallback.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, email: true, storeName: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    // Credencial e pedido moram no DONO da conta (filial aponta via ownerId).
    const targetFranchiseeId = user.ownerId || user.id;

    // Defensivo (custo zero após o 1º sucesso): a resolução de credencial e o
    // processador leem colunas brendi* que só existem se o boot ensure rodou.
    await garantirColunasBrendi();

    const body = await req.json();
    const {
      referencia,       // ex: 2366 (displayId) ou UUID completo da Brendi
      apenasPrever,
      customerName,
      customerPhone,
      customerAddress,
      totalAmount,
      paymentMethod,
      itemsSummary,
    } = body as {
      referencia?: string | number;
      apenasPrever?: boolean;
      customerName?: string;
      customerPhone?: string;
      customerAddress?: string;
      totalAmount?: number | string;
      paymentMethod?: string;
      itemsSummary?: string;
    };

    const prever = apenasPrever === true;
    const cleanRef = String(referencia ?? "").replace(/#/g, "").trim();

    if (!cleanRef && !customerName) {
      return NextResponse.json({ error: "Informe o número do pedido Brendi ou dados do cliente" }, { status: 400 });
    }

    // ── Via oficial: resolver na API da Brendi e injetar no processador ─────
    // UM processador para todos os caminhos (webhook, cron, poll e este
    // import) — três cópias é onde uma diverge em silêncio.
    let motivoFalhaApi = "";
    if (cleanRef) {
      try {
        const { brendiFetch } = await import("@/lib/brendi-api");
        const { processBrendiEvent } = await import("@/lib/processBrendiEvent");

        let targetId = cleanRef;

        // O feed e o GET /v1/orders falam UUID; o lojista enxerga o displayId.
        // Se o que veio não é UUID, procuramos no feed o evento cujo pedido
        // tem esse displayId. IMPORTANTE: este passo NUNCA manda acknowledgment
        // — o import não pode consumir o feed; quem acka (após gravação
        // confirmada) é o cron/webhook.
        const pareceUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanRef);
        if (!pareceUuid) {
          try {
            const evRes = await brendiFetch("/v1/events:polling", targetFranchiseeId);
            if (evRes.ok) {
              const evsText = await evRes.text();
              const parsed = evsText ? JSON.parse(evsText) : [];
              const evs: any[] = Array.isArray(parsed) ? parsed : [parsed];
              for (const ev of evs) {
                if (!ev?.orderId) continue;
                const checkRes = await brendiFetch(`/v1/orders/${ev.orderId}`, targetFranchiseeId);
                if (!checkRes.ok) continue;
                const checkData = await checkRes.json();
                if (
                  String(checkData.displayId || "").includes(cleanRef) ||
                  String(checkData.orderSeqNumber || "").includes(cleanRef)
                ) {
                  targetId = String(ev.orderId);
                  break;
                }
              }
            }
          } catch (resErr: any) {
            console.warn("[Import Brendi] Falha ao resolver UUID por displayId:", resErr?.message);
          }
        }

        // Evento sintético MÍNIMO: só identidade. Itens, valores e endereço
        // vêm do GET /v1/orders dentro do processBrendiEvent — nunca daqui.
        // O displayId vai junto para a barreira de idempotência por reference
        // reconhecer um pedido que já tenha entrado por outro caminho.
        const eventoSintetico = {
          orderId: targetId,
          eventType: "CREATED",
          displayId: cleanRef || undefined,
        };
        const result = await processBrendiEvent(eventoSintetico, {
          targetFranchiseeId,
          apenasPrever: prever,
        });

        if (prever) {
          // Previsão: traduzido + cru, nada gravado. Se nem prever deu (GET
          // falhou, loja sem amarração), devolve o motivo cru — é exatamente
          // o que o operador precisa ler.
          if (result.traduzido) {
            return NextResponse.json({
              ok: true,
              apenasPrever: true,
              message: result.message || "Tradução gerada — nada foi gravado.",
              traduzido: result.traduzido,
              cru: result.cru,
            });
          }
          return NextResponse.json({
            ok: false,
            apenasPrever: true,
            error: `Não foi possível prever o pedido #${cleanRef}: ${result.message || result.action}`,
          }, { status: 502 });
        }

        if (result.action === "created" || result.action === "updated") {
          return NextResponse.json({
            ok: true,
            message: `✅ Pedido #${cleanRef} importado com sucesso via API Brendi!`,
            orderId: result.orderId,
          });
        }
        // "skipped" aqui = duplicata detectada pelo processador (o pedido já
        // está no banco). Devolver sucesso sem cair no fallback: o fallback
        // criaria um segundo registro para a mesma venda.
        if (result.action === "skipped") {
          return NextResponse.json({
            ok: true,
            message: `ℹ️ Pedido #${cleanRef} já existe no sistema — não foi duplicado. (${result.message || ""})`,
            orderId: result.orderId,
          });
        }
        motivoFalhaApi = result.message || result.action;
      } catch (err: any) {
        motivoFalhaApi = err?.message || "erro desconhecido";
        console.warn("[Import Brendi] Tentativa via API Open Delivery falhou:", motivoFalhaApi);
      }
    }

    // apenasPrever jamais grava — se a via oficial não respondeu, não existe
    // "previsão de fallback": o fallback é criação às cegas.
    if (prever) {
      return NextResponse.json({
        ok: false,
        apenasPrever: true,
        error: `API da Brendi não devolveu o pedido${motivoFalhaApi ? ` (${motivoFalhaApi})` : ""} — nada foi gravado.`,
      }, { status: 502 });
    }

    // ── Fallback: criação direta resiliente com os dados informados ─────────
    // Última barreira "nunca perder venda": entra um pedido mínimo (item único
    // com o total) para a cozinha produzir; o lojista confere os itens no
    // painel da Brendi.
    const refTag = cleanRef || "MANUAL";

    // ANTI-DUPLICATA: se o cron/webhook importar o mesmo pedido depois (ou já
    // tiver importado), não pode haver dois registros. A condição por
    // reference exige loja + canal juntos — reference NÃO é único no schema e
    // é compartilhado com JotaJá/99Food (casar só por ele acharia pedido de
    // OUTRO canal).
    const alreadyExists = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          cleanRef ? { openDeliveryOrderId: cleanRef } : undefined,
          cleanRef ? { openDeliveryOrderId: { startsWith: `${cleanRef}_` } } : undefined,
          cleanRef
            ? { openDeliveryReference: cleanRef, franchiseeId: targetFranchiseeId, openDeliveryChannel: "BRENDI" }
            : undefined,
        ].filter(Boolean) as any[],
      } as any,
    });
    if (alreadyExists) {
      return NextResponse.json({
        ok: true,
        message: `ℹ️ Pedido #${refTag} já existe no sistema (id=${alreadyExists.id}) — não foi duplicado.`,
        order: alreadyExists,
      });
    }

    const dailyOrderNumber = await generateDailyOrderNumber(targetFranchiseeId);
    const ord = await prisma.customerOrder.create({
      data: {
        franchiseeId: targetFranchiseeId,
        dailyOrderNumber,
        source: "BRENDI",
        openDeliveryChannel: "BRENDI",
        // Com cleanRef, o UUID/displayId vira a chave — é o que permite à
        // 2ª barreira do processBrendiEvent amarrar o evento real a ESTE
        // registro depois, em vez de duplicar.
        openDeliveryOrderId: cleanRef || `manual_brendi_${Date.now()}`,
        openDeliveryReference: refTag,
        customerName: customerName || `Cliente Brendi #${refTag}`,
        customerPhone: customerPhone || "",
        customerAddress: customerAddress || "",
        totalAmount: Number(totalAmount) || 0,
        deliveryFee: 0,
        paymentMethod: paymentMethod || "Brendi Online",
        deliveryType: (customerAddress && customerAddress.trim().length > 3) ? "DELIVERY" : "RETIRADA",
        status: "NOVO",
        kdsStage: "PRODUCTION",
        kdsProductionAt: new Date(),
        notes: `Pedido Brendi #${refTag}${itemsSummary ? ` | ${itemsSummary}` : ""}`,
        items: {
          create: [
            {
              quantity: 1,
              price: Number(totalAmount) || 0,
              menuProduct: {
                connectOrCreate: {
                  where: { id: `brendi-manual-${refTag}_${targetFranchiseeId}` },
                  create: {
                    id: `brendi-manual-${refTag}_${targetFranchiseeId}`,
                    franchiseeId: targetFranchiseeId,
                    name: itemsSummary || `Pedido Brendi #${refTag}`,
                    description: `Pedido Brendi #${refTag}`,
                    price: Number(totalAmount) || 0,
                    category: "Brendi",
                    // Produto fantasma: existe só para a comanda/relatório
                    // referenciar; nunca aparece no cardápio da loja.
                    active: false,
                  },
                },
              },
            },
          ],
        },
      },
    });

    // Disparar impressão na nuvem — o Assistente puxa via print-queue
    try {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(targetFranchiseeId, ord, user.storeName || "HAKIM RIO DAS OSTRAS");
    } catch {}

    return NextResponse.json({
      ok: true,
      message: `✅ Pedido Brendi #${refTag} de ${ord.customerName} adicionado e enviado para impressão!`,
      order: ord,
    });
  } catch (err: any) {
    console.error("[Import Brendi] Erro:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
