/**
 * src/lib/filtro-do-feed.ts — QUAIS pedidos o feed do painel devolve
 * (/api/customer-order/poll).
 *
 * Mora aqui, e não dentro da rota, para que a resposta completa, a de "só o
 * que mudou" e o teste de equivalência (scripts/teste-feed-so-o-que-mudou.ts)
 * usem exatamente o MESMO filtro. Os comentários abaixo vieram da rota.
 */
import type { Prisma } from "@prisma/client";
import { CHEGOU_A_LOJA } from "@/lib/pagamento-na-entrega";

export const ACTIVE_STATUSES = ["NOVO", "CRIANDO_IA", "ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA"];

/** Teto de idade do pedido "em andamento" que ignora o período (ver o OR abaixo). */
export const DIAS_ATIVO_SEM_PERIODO = 7;

export function filtroDoFeed({
  validFranchiseeIds,
  from,
  to,
  ATIVO_SEM_PERIODO_DESDE,
}: {
  validFranchiseeIds: string[];
  from: Date;
  to: Date;
  ATIVO_SEM_PERIODO_DESDE: Date;
}): Prisma.CustomerOrderWhereInput {
  return {
    franchiseeId: { in: validFranchiseeIds },
    // ENCERRADO nunca é desenhado no painel — `filteredOrders` o descarta
    // na primeira linha. Trazê-lo era transferência pura sem destino.
    status: { not: "ENCERRADO" },
    AND: [{
      OR: [
        // Em andamento: visível mesmo fora do período escolhido, porque é o
        // pedido que a loja ainda precisa tocar. Mas com um teto de idade.
        //
        // Sem o teto, um pedido que travou em NOVO/ACEITO e nunca foi
        // entregue nem cancelado voltava ao painel TODO DIA, para sempre.
        // Foi o que aconteceu com quatro pedidos duplicados do JotaJá de
        // 31/07 e 01/08/2026: seguiram entulhando o painel e a
        // roteirização por mais de um mês, e não havia saída limpa — o
        // cancelamento pela tela dispara WhatsApp ao cliente, e marcar
        // ENTREGUE emitiria NFC-e e contaria a venda.
        //
        // Nada é apagado: passado o teto, o pedido volta a obedecer ao
        // período, então basta abrir a data dele para encontrá-lo e
        // resolvê-lo. Sete dias é folgado para qualquer operação real —
        // pedido em andamento há uma semana não é operação, é resíduo.
        {
          AND: [
            { status: { in: ACTIVE_STATUSES } },
            { createdAt: { gte: ATIVO_SEM_PERIODO_DESDE } },
          ],
        },
        // Finalizado/cancelado: só dentro do período que a tela mostra.
        { createdAt: { gte: from, lte: to } },
        // Agendado para o período, ainda que criado antes dele. Continua
        // valendo para o agendamento distante, que não tem teto de idade.
        { scheduledDatetime: { gte: from, lte: to } },
      ],
    },
    // Pedido pelo site cancelado sem nunca ter sido pago não é cancelamento
    // da loja (lib/pagamento-na-entrega.ts).
    CHEGOU_A_LOJA],
    // ── PENDENTE DE PAGAMENTO: O DO BALCÃO APARECE, O DO CHECKOUT NÃO ─────
    //
    // Este feed escondia TODO AGUARDANDO_PAGAMENTO. Como é ele que alimenta
    // o painel de pedidos, o pedido do totem — que nasce nesse status — dava
    // as caras por um segundo (o SSR o traz) e sumia assim que o primeiro
    // poll substituía a lista inteira. O cliente que escolhe "Pagar no
    // caixa" entrega o dinheiro no balcão e o atendente não tinha o pedido
    // em tela NENHUMA para liberar: comanda nunca ia para a cozinha,
    // paymentPaidAt nunca era carimbado, estoque não baixava. Dinheiro na
    // gaveta sem venda registrada.
    //
    // Devolver todo AGUARDANDO_PAGAMENTO trocaria um problema por outro: o
    // checkout do site usa o MESMO status enquanto o cliente está na tela do
    // gateway (api/customer-order/route.ts:257), e ali quem confirma é o
    // webhook — sem nada para uma pessoa fazer. Cada carrinho abandonado no
    // Pix online viraria card permanente no painel.
    //
    // O critério é "precisa de gente": no totem o cliente está de pé no
    // balcão e só o atendente move o pedido adiante. Por isso só a origem
    // TOTEM atravessa o filtro. A impressão continua protegida à parte
    // (print-queue e GlobalPrintListener excluem este status), então
    // aparecer no painel não imprime comanda antes da hora.
    OR: [
      { status: { notIn: ["AGUARDANDO_PAGAMENTO"] } },
      { status: "AGUARDANDO_PAGAMENTO", source: "TOTEM" },
    ],
  };
}

/** Mais que isto mudou de uma vez? A rota devolve a lista completa. */
export const LIMITE_DE_MUDANCAS = 150;

/**
 * Os pedidos da loja atualizados depois de `desde`, dentro da janela em que um
 * pedido pode estar na lista (em andamento até 7 dias, ou criado no período).
 *
 * É o índice (franchiseeId, createdAt) que deixa isto barato — sem o corte, o
 * banco varreria o histórico inteiro da loja a cada rodada. O pedido agendado
 * criado antes da janela que SAIR do filtro não é visto aqui; a lista completa
 * que o navegador pede a cada 60 s o tira.
 *
 * Devolve null quando mudaram mais de LIMITE_DE_MUDANCAS: aí a resposta volta
 * completa, por segurança.
 */
export async function idsQueMudaram(
  db: { customerOrder: { findMany: (args: any) => Promise<Array<{ id: string }>> } },
  { validFranchiseeIds, from, ATIVO_SEM_PERIODO_DESDE, desde }: { validFranchiseeIds: string[]; from: Date; ATIVO_SEM_PERIODO_DESDE: Date; desde: Date },
): Promise<string[] | null> {
  const desdeDaJanela = new Date(Math.min(from.getTime(), ATIVO_SEM_PERIODO_DESDE.getTime()));
  const rows = await db.customerOrder.findMany({
    where: { franchiseeId: { in: validFranchiseeIds }, createdAt: { gte: desdeDaJanela }, updatedAt: { gte: desde } },
    select: { id: true },
    take: LIMITE_DE_MUDANCAS + 1,
  });
  return rows.length > LIMITE_DE_MUDANCAS ? null : rows.map((r) => r.id);
}

/** O filtro do feed restrito ao que mudou depois de `desde`. */
export function soOQueMudou(filtro: Prisma.CustomerOrderWhereInput, desde: Date): Prisma.CustomerOrderWhereInput {
  return { AND: [filtro, { updatedAt: { gte: desde } }] };
}
