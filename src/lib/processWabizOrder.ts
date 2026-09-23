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
import { generateDailyOrderNumberTx } from "@/lib/order-number";
import type { WabizPedido } from "@/lib/wabiz-api";
import { texto, traduzirPedidoWabiz } from "@/lib/wabiz-traducao";
import { distanciaDaEntregaKm } from "@/lib/distancia-da-entrega";

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

  // ── O FORMATO DAS OPÇÕES, NO LOG, ENQUANTO ELE NÃO FOR CERTEZA ───────────
  //
  // O Combo 4 da NIK (#3683, 22/09/2026) tem 12 esfihas obrigatórias e chegou
  // com 8 opções de quantidade 1. Ou a Wabiz passou a mandar a quantidade num
  // campo — é o que `quantidadeDaOpcao` agora lê —, ou ela deduplica do lado
  // dela e a informação não vem. A doc não declara quantidade em opção, e
  // pedido pendente só existe até o cron confirmar: quando alguém vai
  // investigar, o payload já não está em lugar nenhum.
  //
  // Então ele fica aqui, uma linha por pedido com combo. É barato (a Wabiz faz
  // poucas dezenas de pedidos por dia numa loja) e responde a pergunta na
  // primeira ocorrência seguinte, em vez de mais uma noite de adivinhação.
  try {
    // `items` é a lista de GRUPOS do cardápio da Wabiz, e os produtos moram
    // dentro de cada grupo — é assim que o tradutor também os percorre.
    const produtos = (pedido?.items || []).flatMap((grupo: any) => grupo?.products || []);
    const comCustomizacao = produtos.some((prod: any) =>
      (prod?.parts || []).some((parte: any) => parte?.customization),
    );
    if (comCustomizacao) {
      const cru = produtos.map((prod: any) => ({
        qty: prod?.qty,
        partes: (prod?.parts || []).map((parte: any) => ({ nome: parte?.name, customization: parte?.customization })),
      }));
      const lido = items.map((it: any) => ({
        nome: it.productName,
        opcoes: JSON.parse(String(it.comboSelections || "[]")).map((s: any) => `${s.quantity}x ${s.name}`),
      }));
      console.log(
        `[Wabiz] 🔎 Opções do pedido ${orderNumber} — CRU: ${JSON.stringify(cru).slice(0, 1500)} | LIDO: ${JSON.stringify(lido).slice(0, 700)}`,
      );
    }
  } catch {
    // Diagnóstico nunca derruba a gravação do pedido.
  }

  if (opts.apenasPrever) {
    return { action: existente ? "exists" : "created", traduzido: { ...dados, items } };
  }

  if (items.length === 0) {
    return { action: "error", message: `pedido ${orderNumber} veio sem itens` };
  }

  // O número do dia sai DENTRO da transação que grava (abaixo). Gerado aqui
  // fora, ele era consumido mesmo quando o create falhava — e o cron roda a
  // cada 30 s com prazo de 55 s, então dois ciclos podem pegar o mesmo pedido
  // pendente: o segundo cai no P2002 e devolve "já existe", mas o número que
  // ele puxou não volta. É o buraco de numeração que o poll do iFood já teve
  // (lib/order-number.ts): "#24 sumiu" e o lojista procurando o pedido.

  // Quantos km — só quando a Wabiz mandou o ponto do cliente. É o que a escada
  // de km do entregador compara no fechamento (lib/distancia-da-entrega.ts).
  const distanciaDaEntrega = await distanciaDaEntregaKm(loja.id, dados.customerLatLng);
  if (distanciaDaEntrega != null) dados.deliveryDistance = distanciaDaEntrega;

  let criado: { id: string } | null = null;
  let ultimoErro: any = null;
  for (let tentativa = 1; tentativa <= 3 && !criado; tentativa++) {
    try {
      criado = await prisma.$transaction(async (tx) => {
        dados.dailyOrderNumber = await generateDailyOrderNumberTx(tx, loja.id);
        return (tx.customerOrder as any).create({ data: dados, select: { id: true } });
      }, { timeout: 20000 });
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

  // ── `status` NÃO É VARIÁVEL DESTE ARQUIVO ────────────────────────────────
  //
  // Era, literalmente, `${status}` — e o TypeScript não reclamou porque o
  // tsconfig carrega a lib "dom", que declara um `status` global (o
  // `window.status`). No Node ele não existe: estas duas linhas estouravam com
  // `ReferenceError: status is not defined` DEPOIS de o pedido já estar
  // gravado, com o estoque baixado e a comanda enfileirada.
  //
  // O que o lojista via: a comanda saía da impressora e, junto, o alerta
  // "🚨 FireHub — pedido não entrou · Motivo: #3683: status is not defined".
  // O evento não era confirmado à Wabiz, ela reenviava no minuto seguinte e só
  // então a idempotência lá de cima respondia "exists" e fechava o ciclo. Um
  // minuto de atraso na confirmação e um susto por pedido.
  //
  // O status de verdade é o que foi GRAVADO, e ele está em `dados` (o
  // tradutor decide ACEITO ou NOVO pelo aceite automático da loja).
  const statusGravado = String(dados.status ?? "");
  console.log(`[Wabiz] ✅ Pedido #${orderNumber} gravado para ${loja.storeName || loja.id} (${statusGravado})`);
  return { action: "created", pedidoId: criado.id, status: statusGravado };
}
