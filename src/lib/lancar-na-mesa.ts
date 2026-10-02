/**
 * Lançar um pedido na conta de uma mesa aberta — a regra ÚNICA de quem lança:
 * o garçom pelo celular (api/store/table-sessions/[id]/add-order) e o cliente
 * pelo QR da mesa (api/loja/mesa/pedido).
 *
 * Mora aqui para os dois caminhos não divergirem: o pedido do QR tem que ser,
 * para a cozinha, para a impressora e para o fechamento da conta, idêntico ao
 * que o garçom lança — tipo MESA, origem PRESENCIAL, sem pagamento (a conta
 * fecha no fim), preço do salão.
 *
 * Quem chama confere a autorização e o caixa aberto ANTES.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { SEM_PRODUTO_DE_INTEGRACAO, disponivelAgora } from "@/lib/cardapio-interno";
import { aplicarPrecoDoCanalComCombo } from "@/lib/preco-por-canal";
import { precoUnitarioDoItem, pisoDoPreco } from "@/lib/preco-combo";
import { conferirEstoque } from "@/lib/estoque-restante";

export type ItemParaLancar = {
  menuProductId?: unknown;
  quantity?: unknown;
  comboSelections?: unknown;
  tableGuestId?: unknown;
  notes?: unknown;
};

export type ResultadoDoLancamento =
  | { ok: true; order: Awaited<ReturnType<typeof prisma.customerOrder.create>> }
  | { ok: false; status: number; error: string };

export async function lancarNaMesa(opcoes: {
  franchiseeId: string;
  tableSessionId: string;
  items: ItemParaLancar[];
  notes?: unknown;
  customerName?: unknown;
  /** Só para a fila de impressão antiga (hoje no-op); o painel manda "FIREHUB". */
  origemDaImpressao: string;
  /** Texto do "estes itens não estão no cardápio da mesa": o garçom atualiza a tela; o cliente, o cardápio. */
  comoTentarDeNovo?: string;
}): Promise<ResultadoDoLancamento> {
  const { franchiseeId: targetFranchiseeId, tableSessionId: id, items } = opcoes;
  const tenteDeNovo = opcoes.comoTentarDeNovo || "Atualize a tela e lance de novo.";

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Items are required" };
  }

  const fuso = await fusoDaLoja(targetFranchiseeId);

  const tableSession = await prisma.tableSession.findUnique({
    where: { id },
    include: { table: true },
  });

  if (!tableSession || tableSession.table.franchiseeId !== targetFranchiseeId) {
    return { ok: false, status: 404, error: "Session not found" };
  }
  if (tableSession.status !== "OPEN") {
    return { ok: false, status: 400, error: "Session is not open" };
  }

  // ── PREÇO E PRODUTO SÃO DO SERVIDOR, NÃO DO CORPO ─────────────────────
  // A rota gravava o `price` que a tela mandava e aceitava qualquer
  // menuProductId. Com o módulo aberto ao garçom pelo link — e agora ao
  // cliente pelo QR, o papel de menor confiança do sistema — bastaria uma
  // requisição montada na mão para lançar o combo por R$ 0,01 ou um produto
  // de outra loja. Mesma regra do totem (api/totem/order): produto da loja,
  // ativo e liberado para o salão; preço recalculado pelo canal a partir das
  // escolhas do combo, com o mínimo do produto como piso; quantidade inteira
  // de 1 a 99.
  const idsPedidos = [...new Set(items.map((i) => String(i?.menuProductId ?? "")).filter(Boolean))];
  const produtosDaLoja = await prisma.menuProduct.findMany({
    where: {
      id: { in: idsPedidos },
      franchiseeId: targetFranchiseeId,
      active: true,
      activeGarcom: true,
      ...SEM_PRODUTO_DE_INTEGRACAO,
    },
    include: { comboGroups: { include: { items: { include: { menuProduct: true } } } } },
  });
  const porId = new Map(produtosDaLoja.map((p) => [p.id, p]));

  const recusados: string[] = [];
  const itensValidados: {
    menuProductId: string;
    quantity: number;
    price: number;
    comboSelections: any;
    tableGuestId: string | null;
    notes: string | null;
  }[] = [];

  for (const item of items) {
    const produto = porId.get(String(item?.menuProductId ?? ""));
    if (!produto) {
      recusados.push(String(item?.menuProductId ?? "?"));
      continue;
    }
    // Produto de dia ou horário específico não sai fora dele; a tela pode
    // estar aberta desde ontem.
    if (!disponivelAgora(produto, fuso)) {
      recusados.push(produto.name);
      continue;
    }
    // Mesma conta do cardápio, do modal e do totem (src/lib/preco-combo.ts).
    const noCanal = aplicarPrecoDoCanalComCombo(produto as any, "salao");
    let preco = precoUnitarioDoItem(noCanal as any, item.comboSelections as any);
    // Piso que aceita o desconto da meia pizza mais barata (lib/preco-combo.ts).
    const minimo = pisoDoPreco(noCanal as any);
    if (preco < minimo) preco = minimo;
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1)));
    itensValidados.push({
      menuProductId: produto.id,
      quantity,
      price: preco,
      comboSelections: item.comboSelections ?? null,
      tableGuestId: item.tableGuestId ? String(item.tableGuestId) : null,
      notes: item.notes ? String(item.notes).trim().slice(0, 200) || null : null,
    });
  }

  if (recusados.length > 0) {
    // Recusar o pedido inteiro, não o item: lançar MENOS do que o garçom
    // conferiu com o cliente é pior do que pedir para lançar de novo.
    return { ok: false, status: 400, error: `Estes itens não estão no cardápio da mesa: ${recusados.join(", ")}. ${tenteDeNovo}` };
  }

  // Estoque disponível: o garçom lança do celular com o cardápio que abriu
  // no começo do turno.
  const estoque = await conferirEstoque(targetFranchiseeId, itensValidados);
  if (!estoque.ok) {
    return { ok: false, status: 409, error: `${estoque.mensagem} Ajuste o pedido e lance de novo.` };
  }

  const totalAmount = itensValidados.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Só aceita vincular a item quem realmente está NESTA mesa. Sem esta
  // conferência, um id qualquer no corpo da requisição jogaria o consumo na
  // conta de uma pessoa de outra mesa.
  const pedidos = itensValidados.map((i) => i.tableGuestId).filter(Boolean) as string[];
  const idsValidos = new Set<string>();
  if (pedidos.length > 0) {
    const daMesa = await prisma.tableGuest.findMany({
      where: { id: { in: pedidos }, tableSessionId: id },
      select: { id: true },
    });
    daMesa.forEach((g: any) => idsValidos.add(g.id));
  }

  const dailyOrderNumber = await generateDailyOrderNumber(targetFranchiseeId);

  const nomeQueVeio = String(opcoes.customerName ?? "").trim().slice(0, 80);
  const defaultName = nomeQueVeio || tableSession.customerName || `Mesa ${tableSession.table.number}`;

  const order = await prisma.customerOrder.create({
    data: {
      franchiseeId: targetFranchiseeId,
      dailyOrderNumber,
      customerName: defaultName,
      customerPhone: "00000000000",
      customerAddress: `Mesa ${tableSession.table.number}`,
      deliveryType: "MESA",
      paymentMethod: "N/A", // Payment happens at session close
      notes: String(opcoes.notes ?? "").trim().slice(0, 500),
      totalAmount,
      deliveryFee: 0,
      status: "ACEITO",
      source: "PRESENCIAL",
      tableSessionId: id,
      items: {
        create: itensValidados.map((item): Prisma.CustomerOrderItemUncheckedCreateWithoutOrderInput => ({
          menuProductId: item.menuProductId,
          quantity: item.quantity,
          price: item.price,
          // De quem é este item. Nulo = da mesa inteira (couvert, entrada
          // para dividir), e nesse caso entra no rateio geral no fechamento.
          // É o que permite rachar a conta pelo consumo real de cada um em
          // vez de dividir por igual — que é onde alguém sempre paga a
          // bebida do outro.
          tableGuestId: item.tableGuestId && idsValidos.has(item.tableGuestId) ? item.tableGuestId : null,
          // Coluna Json: ausente (undefined) vira o nulo do banco; null literal o
          // Prisma recusa para Json.
          comboSelections: item.comboSelections ? (typeof item.comboSelections === "string" ? item.comboSelections : JSON.stringify(item.comboSelections)) : undefined,
          // Observação do item ("sem cebola"): vai para a cozinha e para a comanda.
          notes: item.notes,
        })),
      },
    },
  });

  // Realiza a baixa imediata no estoque do pedido
  const { deductStockForOrder } = await import("@/lib/stock");
  deductStockForOrder(order.id).catch(err =>
    console.error("[Stock] Erro ao deduzir estoque de pedido de mesa:", err)
  );

  // Enfileira impressão automática
  try {
    const fullOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            menuProduct: { select: { id: true, name: true, isBeverage: true } }
          }
        }
      }
    });

    if (fullOrder) {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(targetFranchiseeId, fullOrder, opcoes.origemDaImpressao);
    }
  } catch (printErr) {
    console.error("[Mesa] Erro ao enfileirar impressão automática:", printErr);
  }

  return { ok: true, order };
}
