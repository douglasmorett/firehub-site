import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  autenticarTerminal,
  ESTADOS_DA_COBRANCA,
  MINUTOS_ATE_DESTRAVAR,
} from "@/lib/terminal-app";

export const dynamic = "force-dynamic";

/**
 * GET /api/pos/terminal/pendente?token=...
 *
 * O app dentro da maquininha pergunta se tem cobrança esperando por ele.
 *
 * É o coração do caminho PagBank: como a adquirente não deixa a gente acender a
 * cobrança à distância, quem puxa é o aparelho. O app chama isto de poucos em
 * poucos segundos enquanto está ocioso; recebendo uma cobrança, ele passa o
 * cartão pela PlugPagServiceWrapper e devolve o resultado em
 * POST /api/pos/terminal/resultado.
 *
 * A cobrança é RESERVADA na mesma consulta que a entrega. Sem isso, duas
 * maquininhas da mesma loja perguntando ao mesmo tempo receberiam o mesmo
 * pedido e cobrariam dois clientes diferentes pelo mesmo lanche.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await autenticarTerminal(req.nextUrl.searchParams.get("token"));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const { terminal } = auth;

    const agora = new Date();

    // Ping e reserva na mesma viagem: o app pergunta a cada poucos segundos, e
    // uma escrita a mais por pergunta seria peso puro no banco.
    await prisma.posTerminal.update({
      where: { id: terminal.id },
      data: {
        lastSeenAt: agora,
        ...(req.nextUrl.searchParams.get("versao")
          ? { appVersion: req.nextUrl.searchParams.get("versao")! }
          : {}),
      },
    });

    // Cobrança presa há tempo demais volta para a fila. O app pode ter travado,
    // o aparelho pode ter desligado no meio — o pedido não pode ficar marcado
    // como "em cobrança" para sempre, senão o operador não consegue tentar de
    // novo e o cliente fica esperando na frente do totem.
    const limite = new Date(agora.getTime() - MINUTOS_ATE_DESTRAVAR * 60_000);
    await prisma.customerOrder.updateMany({
      where: {
        franchiseeId: terminal.franchiseeId,
        posTerminalId: terminal.id,
        posStatus: ESTADOS_DA_COBRANCA.noTerminal,
        paymentPaidAt: null,
        updatedAt: { lt: limite },
      },
      data: { posStatus: ESTADOS_DA_COBRANCA.aguardando },
    });

    // A fila desta maquininha: pedido endereçado a ela, ou ainda sem dono.
    const candidato = await prisma.customerOrder.findFirst({
      where: {
        franchiseeId: terminal.franchiseeId,
        posStatus: ESTADOS_DA_COBRANCA.aguardando,
        paymentPaidAt: null,
        status: { not: "CANCELADO" },
        OR: [{ posTerminalId: terminal.id }, { posTerminalId: null }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        dailyOrderNumber: true,
        totalAmount: true,
        customerName: true,
        posTentativas: true,
      },
    });

    if (!candidato) {
      return NextResponse.json({ cobranca: null, terminal: terminal.label });
    }

    // A reserva: só sai da fila se AINDA estiver aguardando. Se outro aparelho
    // tiver pegado entre a leitura e agora, o count vem 0 e este app segue sem
    // cobrança — melhor uma volta em branco do que dois cartões passados.
    const reservado = await prisma.customerOrder.updateMany({
      where: {
        id: candidato.id,
        posStatus: ESTADOS_DA_COBRANCA.aguardando,
        paymentPaidAt: null,
      },
      data: {
        posStatus: ESTADOS_DA_COBRANCA.noTerminal,
        posTerminalId: terminal.id,
      },
    });

    if (reservado.count === 0) {
      return NextResponse.json({ cobranca: null, terminal: terminal.label });
    }

    const identificacao = candidato.dailyOrderNumber
      ? `Pedido ${candidato.dailyOrderNumber}`
      : `Pedido ${candidato.id.slice(-6).toUpperCase()}`;

    return NextResponse.json({
      cobranca: {
        pedidoId: candidato.id,
        // Centavos, inteiro. O app não deve fazer conta com o valor: qualquer
        // arredondamento do lado dele vira diferença entre o que a tela do
        // totem mostrou e o que o cartão foi debitado.
        valorEmCentavos: Math.round(candidato.totalAmount * 100),
        descricao: identificacao,
        cliente: candidato.customerName || null,
        tentativa: candidato.posTentativas,
        // O app usa isto para não reenviar o mesmo resultado duas vezes.
        referencia: `${candidato.id}:${candidato.posTentativas}`,
      },
      terminal: terminal.label,
    });
  } catch (err) {
    console.error("[Terminal Pendente] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
