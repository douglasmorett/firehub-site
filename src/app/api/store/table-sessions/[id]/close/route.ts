import { NextRequest, NextResponse } from "next/server";
import { valorDoDesconto, type DescontoManual } from "@/lib/desconto-manual";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { recusaSeCaixaFechado } from "@/lib/caixa-aberto-servidor";
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

    // ── ESTE É O MOMENTO DO DINHEIRO ─────────────────────────────────────
    //
    // O fechamento de caixa soma as mesas FECHADAS depois da abertura do
    // turno. Fechar mesa sem caixa aberto é consumo que não cai em turno
    // nenhum: some da conferência e reaparece como diferença.
    //
    // Sim, isto prende a mesa até alguém abrir o caixa — e é o certo. O
    // dinheiro já existe; o que falta é onde registrá-lo. Abrir o caixa
    // destrava e a mesma conta fecha normalmente, nada se perde.
    const semCaixa = await recusaSeCaixaFechado(targetFranchiseeId, "fechar a conta");
    if (semCaixa) return semCaixa;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { paymentMethods, serviceFeePercent, waiterTip, desconto } = data;

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
    /** O desconto como veio no corpo, sem confiar em número pronto. */
    const lerDesconto = (bruto: any): DescontoManual | null => {
      if (!bruto || typeof bruto !== "object") return null;
      const valor = Number(bruto.valor);
      if (!Number.isFinite(valor) || valor <= 0) return null;
      return {
        tipo: bruto.tipo === "valor" ? "valor" : "percent",
        valor,
        motivo: String(bruto.motivo || "").slice(0, 60),
      };
    };

    const pedidosValidos = tableSession.orders.filter((o) => o.status !== "CANCELADO");
    const subtotal = pedidosValidos.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    // Taxa e gorjeta nunca negativas nem fora da faixa: com taxa de -100% a
    // conta zerava e a mesa fechava "paga" sem um centavo. Fora da faixa é
    // pedido malformado, não conta.
    const taxaPct = Number(serviceFeePercent) || 0;
    const gorjeta = Number(waiterTip) || 0;
    if (!Number.isFinite(taxaPct) || taxaPct < 0 || taxaPct > 100 || !Number.isFinite(gorjeta) || gorjeta < 0) {
      return NextResponse.json({ error: "Taxa de serviço ou gorjeta inválida" }, { status: 400 });
    }
    const tipAmount = gorjeta;

    // ── DESCONTO DADO NA MESA ─────────────────────────────────────────
    //
    // Recalculado AQUI a partir do tipo e do valor, nunca aceito pronto: o
    // fechamento confere se os pagamentos cobrem a conta, e um desconto
    // vindo pronto do navegador seria a própria conta sendo digitada por
    // quem paga. Incide sobre o CONSUMO, antes da taxa de serviço — a taxa
    // é sobre o que foi efetivamente cobrado.
    const descontoEmReais = valorDoDesconto(lerDesconto(desconto), subtotal);
    const consumoCobrado = Math.max(0, subtotal - descontoEmReais);
    const serviceFee = taxaPct ? (consumoCobrado * taxaPct) / 100 : 0;
    const totalAmount = consumoCobrado + serviceFee + tipAmount;

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
          // Quem fechou: pelo painel (nome do usuário) ou pelo link do garçom.
          closedByKind: operador.tipo,
          closedByName: rotuloDoOperador(operador),
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
