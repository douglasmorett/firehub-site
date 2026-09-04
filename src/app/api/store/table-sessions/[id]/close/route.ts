import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { lerPagamentos, somarPagamentos } from "@/lib/pagamentos-da-mesa";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { paymentMethods, serviceFeePercent, waiterTip } = data;

    const tableSession = await prisma.tableSession.findUnique({
      where: { id },
      include: {
        table: true,
        orders: true
      }
    });

    if (!tableSession || tableSession.table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (tableSession.status !== "OPEN") {
      return NextResponse.json({ error: "Session is not open" }, { status: 400 });
    }

    // Pedido cancelado não entra na conta. A tela de conta por pessoa já os
    // ignora; se aqui somasse, o garçom veria um total na tela, pagaria esse
    // valor e o fechamento recusaria por "faltar" dinheiro que ninguém deve.
    const pedidosValidos = tableSession.orders.filter((o) => o.status !== "CANCELADO");
    const subtotal = pedidosValidos.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const serviceFee = serviceFeePercent ? (subtotal * serviceFeePercent) / 100 : 0;
    const tipAmount = waiterTip ? Number(waiterTip) : 0;
    const totalAmount = subtotal + serviceFee + tipAmount;

    // ── A SOMA DOS PAGAMENTOS TEM QUE FECHAR COM A CONTA ──────────────────
    // O comentário antigo dizia "Validate payment methods total", mas nada era
    // validado: a soma era calculada e a mesa fechava com qualquer valor —
    // inclusive R$ 0,00. Uma mesa de R$ 300 podia ser encerrada sem ninguém
    // pagar, e o caixa fechava com sobra falsa no fim do dia.
    //
    // Agora recusa quando falta dinheiro. Sobra é aceita (troco/gorjeta em
    // dinheiro é comum), mas falta não.
    const centavos = (n: number) => Math.round((Number(n) || 0) * 100);

    // ── QUEM MANDA É O QUE JÁ ESTÁ GRAVADO ────────────────────────────────
    // As baixas agora são registradas uma a uma enquanto a mesa está aberta
    // (rota `pagamentos`), então elas sobrevivem a tablet reiniciado e a troca
    // de garçom. Havendo baixas gravadas, são ELAS que valem: aceitar o corpo
    // por cima deixaria uma tela desatualizada apagar dinheiro que já entrou.
    //
    // O corpo continua valendo quando não há nada gravado — é o caminho de
    // quem ainda está na tela antiga e o de liberar mesa sem consumo.
    const jaGravados = lerPagamentos(tableSession.paymentMethods);
    const pagamentosEfetivos =
      jaGravados.length > 0
        ? jaGravados
        : lerPagamentos(Array.isArray(paymentMethods) ? paymentMethods : []);

    const totalPaid = somarPagamentos(pagamentosEfetivos);

    const faltando = centavos(totalAmount) - centavos(totalPaid);

    // Tolerância de 1 centavo: arredondamento de taxa de serviço não pode
    // travar o fechamento de uma mesa real.
    if (faltando > 1) {
      return NextResponse.json(
        {
          error: "pagamento_incompleto",
          mensagem:
            `Faltam R$ ${(faltando / 100).toFixed(2).replace(".", ",")} para fechar a mesa. ` +
            `A conta é de R$ ${totalAmount.toFixed(2).replace(".", ",")} e foram informados ` +
            `R$ ${totalPaid.toFixed(2).replace(".", ",")}.`,
          totalDaConta: Number(totalAmount.toFixed(2)),
          totalInformado: Number(totalPaid.toFixed(2)),
          faltando: Number((faltando / 100).toFixed(2)),
        },
        { status: 400 }
      );
    }

    // Wrap in transaction
    await prisma.$transaction(async (tx) => {
      // 1. Update orders status to ENTREGUE
      if (pedidosValidos.length > 0) {
        // NOT: cancelado continua cancelado. Sem o filtro, fechar a mesa
        // ressuscitava o pedido cancelado como ENTREGUE e ele voltava para o
        // faturamento do dia.
        await tx.customerOrder.updateMany({
          where: { tableSessionId: id, status: { not: "CANCELADO" } },
          data: { status: "ENTREGUE" }
        });
      }

      // Calculate waiter commission if linked
      let waiterCommission = 0;
      if (tableSession.waiterId) {
        waiterCommission = serviceFee + tipAmount;
      }

      // 2. Update session to CLOSED
      await tx.tableSession.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          totalPaid,
          serviceFee,
          waiterTip: tipAmount > 0 ? tipAmount : undefined,
          waiterCommission: waiterCommission > 0 ? waiterCommission : undefined,
          paymentMethods: pagamentosEfetivos.length > 0 ? (pagamentosEfetivos as any) : undefined
        }
      });
    });

    // NFC-e automática dos pedidos da mesa (se a loja marcou a forma de
    // pagamento na tela Fiscal). Fire-and-forget: a mesa fecha na hora e a
    // nota que falhar aparece como "Falhou" na aba Notas fiscais.
    try {
      const { emitirNfceAutomatica } = await import("@/lib/fiscal-automatico");
      const entregues = await prisma.customerOrder.findMany({
        where: { tableSessionId: id, status: "ENTREGUE", fiscalStatus: { not: "EMITTED" } },
        select: { id: true },
      });
      for (const pedido of entregues) emitirNfceAutomatica(pedido.id).catch(() => {});
    } catch {}

    return NextResponse.json({ success: true, message: "Session closed successfully" });
  } catch (error: any) {
    console.error("[Table Sessions Close POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
