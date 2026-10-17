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
import { lojaBloqueadaPorMensalidade, MENSAGEM_LOJA_INDISPONIVEL } from "@/lib/loja-bloqueada";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { conferirEstoque } from "@/lib/estoque-restante";
import { validarItensDoSalao, type ItemParaLancar } from "@/lib/itens-do-salao";

// O formato do item que chega é o mesmo da conferência; re-exportado para
// quem já importava daqui.
export type { ItemParaLancar };

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

  // Loja bloqueada por mensalidade não lança pedido — nem pelo QR do cliente,
  // nem pelo app do garçom (que não passa pela tela de bloqueio do painel).
  if (await lojaBloqueadaPorMensalidade(targetFranchiseeId)) {
    return { ok: false, status: 403, error: MENSAGEM_LOJA_INDISPONIVEL };
  }

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
  // A conferência (produto da loja e do salão, dia e horário, preço do canal
  // com o combo, quantidade de 1 a 99) mora em lib/itens-do-salao.ts — a
  // mesma do pedido de balcão do garçom.
  const conferidos = await validarItensDoSalao({ franchiseeId: targetFranchiseeId, items, comoTentarDeNovo: tenteDeNovo });
  if (!conferidos.ok) return conferidos;
  const itensValidados = conferidos.itens;

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
