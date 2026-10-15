import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  autenticarTerminal,
  ESTADOS_DA_COBRANCA,
  MINUTOS_ATE_DESTRAVAR,
  provedorDaAdquirente,
} from "@/lib/terminal-app";
import { reservarCobrancaDaMesa, PREFIXO_DA_MESA } from "@/lib/cobranca-da-mesa-na-maquininha";

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
    // O app diz de qual adquirente é (a versão PagBank antiga não manda nada
    // e continua PAGBANK_APP). Quem sabe em que máquina roda é o app.
    const provedorInformado = provedorDaAdquirente(req.nextUrl.searchParams.get("adquirente"));
    const provedor = provedorInformado ?? terminal.provider;
    const atualizado = await prisma.posTerminal.update({
      where: { id: terminal.id },
      // O slug da loja vem na mesma viagem do ping: o modo garçom do app
      // precisa dele para o login (/api/garcom/login pede { slug, login, senha }).
      select: { franchisee: { select: { slug: true } } },
      data: {
        lastSeenAt: agora,
        ...(req.nextUrl.searchParams.get("versao")
          ? { appVersion: req.nextUrl.searchParams.get("versao")! }
          : {}),
        ...(provedorInformado && provedorInformado !== terminal.provider ? { provider: provedorInformado } : {}),
      },
    });

    // A Cielo exige no deeplink o Client-Id e o Access-Token do app do
    // desenvolvedor (FireHub), gerados no portal da Cielo — não são da loja.
    // Quem é esta maquininha e de que loja. O app usa no modo garçom: o
    // terminalId vai no POST da cobrança de mesa (para cair nesta máquina) e o
    // slug no login do garçom. Vai em TODA resposta 200, com ou sem cobrança;
    // a versão do app que não conhece os campos simplesmente os ignora.
    const identidade = { terminalId: terminal.id, lojaSlug: atualizado.franchisee?.slug ?? null };

    const extras =
      provedor === "CIELO_APP" && process.env.CIELO_CLIENT_ID && process.env.CIELO_ACCESS_TOKEN
        ? { credenciaisCielo: { clientId: process.env.CIELO_CLIENT_ID, accessToken: process.env.CIELO_ACCESS_TOKEN } }
        : {};
    const extrasComIdentidade: Record<string, unknown> = { ...identidade, ...extras };

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
      return responderComMesaOuNada(terminal, extrasComIdentidade);
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
      return responderComMesaOuNada(terminal, extrasComIdentidade);
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
        tipo: "PEDIDO",
      },
      terminal: terminal.label,
      ...extrasComIdentidade,
    });
  } catch (err) {
    console.error("[Terminal Pendente] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * Sem pedido do totem na fila, a vez é da cobrança de mesa. O totem vem antes
 * porque ali o cliente está sozinho em pé na frente da máquina; na mesa o
 * garçom está do lado e espera os poucos segundos.
 *
 * O `pedidoId` vai como "mesa:<id>": o app trata o id como texto opaco e o
 * devolve igual no resultado, então a versão que já está nas maquininhas cobra
 * mesa sem atualização.
 */
async function responderComMesaOuNada(
  terminal: { id: string; franchiseeId: string; label: string },
  extras: Record<string, unknown>,
) {
  const mesa = await reservarCobrancaDaMesa(terminal);
  if (!mesa) return NextResponse.json({ cobranca: null, terminal: terminal.label, ...extras });
  const numero = mesa.dados?.mesa;
  return NextResponse.json({
    cobranca: {
      pedidoId: `${PREFIXO_DA_MESA}${mesa.id}`,
      valorEmCentavos: mesa.valorCentavos,
      descricao: numero != null ? `Mesa ${numero}` : "Mesa",
      cliente: mesa.guestName || null,
      tentativa: mesa.tentativas,
      referencia: `${PREFIXO_DA_MESA}${mesa.id}:${mesa.tentativas}`,
      tipo: "MESA",
    },
    terminal: terminal.label,
    ...extras,
  });
}
