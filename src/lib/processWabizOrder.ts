/**
 * lib/processWabizOrder.ts — um pedido pendente da Wabiz vira CustomerOrder.
 *
 * Mesmo esqueleto de processBrendiEvent (idempotência, criação com retry,
 * estoque, impressão), com o formato da Wabiz, que é outro:
 *
 *   - Não há evento nem GET de detalhe: `orders/pending` já traz o pedido inteiro.
 *   - `internalKey` (GUID) é o id → `openDeliveryOrderId`; `orderNumber` (int) é
 *     o número que o atendente da Wabiz vê → `openDeliveryReference`. O status
 *     precisa dos DOIS, então os dois ficam gravados.
 *   - Valores em reais. `product.price` é o preço de UMA unidade já com borda,
 *     adicionais e massa (48,9 = 40 + 3 + 3,9 + 2 no exemplo da doc).
 *   - `total` já inclui a taxa de entrega (exemplo Delivery: 40 + 2×9 + 4 = 62).
 *   - Pizza meio-a-meio = produto com mais de uma `part`.
 *   - Datas vêm "yyyy-MM-dd HH:mm:ss" SEM fuso: é o relógio da loja.
 *
 * Quem confirma na Wabiz é o cron, depois de conferir o pedido no banco — este
 * módulo só grava. Assim um pedido que falhou nunca sai de `pending` e o
 * próximo ciclo tenta de novo.
 */
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { generateDailyOrderNumber } from "@/lib/order-number";
import type { WabizPedido } from "@/lib/wabiz-api";
import { texto, traduzirPedidoWabiz } from "@/lib/wabiz-traducao";

export interface ResultadoWabizPedido {
  action: "created" | "exists" | "error";
  /** Id do CustomerOrder quando existe no banco. */
  pedidoId?: string;
  status?: string;
  message?: string;
}

export async function processWabizOrder(
  pedido: WabizPedido,
  franchiseeId: string,
  opts: { apenasPrever?: boolean } = {}
): Promise<ResultadoWabizPedido & { traduzido?: unknown }> {
  const internalKey = texto(pedido?.internalKey);
  const orderNumber = texto(pedido?.orderNumber);
  if (!internalKey || !orderNumber) {
    return { action: "error", message: "pedido sem internalKey/orderNumber" };
  }

  // ── Idempotência ─────────────────────────────────────────────────────────
  // O mesmo pedido volta em `pending` até a confirmação dar certo; o segundo
  // encontro tem de ser "já existe", nunca um pedido duplicado na cozinha.
  const existente = await prisma.customerOrder.findFirst({
    where: {
      franchiseeId,
      OR: [
        { openDeliveryOrderId: internalKey },
        { openDeliveryOrderId: `${internalKey}_recovered` },
      ],
    } as any,
    select: { id: true, status: true },
  });
  if (existente && !opts.apenasPrever) {
    return { action: "exists", pedidoId: existente.id, status: existente.status };
  }

  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { id: true, storeName: true, autoAcceptOrders: true },
  });
  if (!loja) return { action: "error", message: `loja ${franchiseeId} não encontrada` };

  const fuso = await fusoDaLoja(franchiseeId);
  const { dados, items } = traduzirPedidoWabiz(pedido, { lojaId: loja.id, fuso, autoAcceptOrders: !!loja.autoAcceptOrders });

  if (opts.apenasPrever) {
    return { action: existente ? "exists" : "created", traduzido: { ...dados, items } };
  }

  if (items.length === 0) {
    return { action: "error", message: `pedido ${orderNumber} veio sem itens` };
  }

  dados.dailyOrderNumber = await generateDailyOrderNumber(loja.id);

  let criado: { id: string } | null = null;
  let ultimoErro: any = null;
  for (let tentativa = 1; tentativa <= 3 && !criado; tentativa++) {
    try {
      criado = await (prisma.customerOrder as any).create({ data: dados, select: { id: true } });
    } catch (e: any) {
      ultimoErro = e;
      if (e?.code === "P2002") {
        const ja = await prisma.customerOrder.findFirst({
          where: { franchiseeId: loja.id, openDeliveryOrderId: internalKey } as any,
          select: { id: true, status: true },
        });
        if (ja) return { action: "exists", pedidoId: ja.id, status: ja.status };
      }
      console.error(`[Wabiz] ❌ Tentativa ${tentativa}/3 de criar o pedido ${orderNumber}: ${e?.message}`);
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!criado) {
    return { action: "error", message: `não gravou o pedido ${orderNumber}: ${ultimoErro?.message || "erro desconhecido"}` };
  }

  import("@/lib/stock")
    .then((m) => m.deductStockForOrder(criado!.id))
    .catch((e) => console.error(`[Wabiz] Baixa de estoque falhou para ${orderNumber}:`, e?.message));

  try {
    const completo = await prisma.customerOrder.findUnique({
      where: { id: criado.id },
      include: { items: { include: { menuProduct: { select: { id: true, name: true, isBeverage: true } } } } },
    });
    if (completo) {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(loja.id, completo, loja.storeName || undefined);
    }
  } catch (e: any) {
    console.error("[Wabiz] Erro ao enfileirar a impressão:", e?.message);
  }

  console.log(`[Wabiz] ✅ Pedido #${orderNumber} gravado para ${loja.storeName || loja.id} (${status})`);
  return { action: "created", pedidoId: criado.id, status };
}
