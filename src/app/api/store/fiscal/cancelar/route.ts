import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cancelarNfce } from "@/lib/fiscal-emissao";
import { tokenDoAmbiente } from "@/lib/fiscal-credenciais";
import { normalizarConfigFiscal, notaDoPedido } from "@/lib/fiscal-config";
import { cancelamentoDaNota, travaDaNotaFiscal } from "@/lib/edicao-de-pedido";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/store/fiscal/cancelar — cancela uma NFC-e autorizada na SEFAZ.
 *
 * A tela sempre prometeu ("para cancelar o pedido, cancele a nota primeiro,
 * em até 30 minutos") — mas não existia rota nenhuma: a promessa apontava
 * para o nada. O prazo é da SEFAZ, e a recusa dela volta na íntegra.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    // Cancelar documento fiscal é ato do titular perante a SEFAZ.
    if (user.role === "STAFF") {
      return NextResponse.json(
        { error: "Só o responsável pela loja pode cancelar nota fiscal." },
        { status: 403 }
      );
    }

    const lojaId = user.ownerId || user.id;
    const body = await req.json().catch(() => ({}));
    const { orderId, justificativa } = body;

    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
    if (!justificativa || String(justificativa).trim().length < 15) {
      return NextResponse.json(
        { error: "A justificativa precisa ter pelo menos 15 caracteres — é exigência da SEFAZ." },
        { status: 400 }
      );
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      // status e tipo de entrega: dizem se a mercadoria já saiu (a outra
      // metade da regra do cancelamento, lib/edicao-de-pedido).
      select: { id: true, franchiseeId: true, status: true, deliveryType: true, fiscalStatus: true, fiscalInfo: true },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    const fiscalAtual = (order.fiscalInfo as any) || {};
    if (order.fiscalStatus !== "EMITTED" || !fiscalAtual.nfceKey) {
      return NextResponse.json(
        { error: "sem_nota", mensagem: "Este pedido não tem nota autorizada para cancelar." },
        { status: 409 }
      );
    }

    // ── Contingência: primeiro a SEFAZ efetiva ────────────────────────────
    // A nota off-line ainda não chegou à SEFAZ: não há o que cancelar lá. O
    // cron consulta a cada 2 minutos até ela efetivar (ou ser recusada).
    if (fiscalAtual.contingencia === true) {
      return NextResponse.json(
        {
          error: "em_contingencia",
          mensagem:
            "Esta nota foi emitida em CONTINGÊNCIA e a SEFAZ ainda não a recebeu — não dá para cancelar agora. " +
            "Use \"Consultar situação\" em alguns minutos: efetivada, ela pode ser cancelada se a mercadoria não saiu " +
            "e dentro dos 30 minutos da autorização.",
        },
        { status: 409 }
      );
    }

    // ── A regra do cancelamento, antes de gastar o evento ─────────────────
    // Ajuste SINIEF 19/16, cl. 15ª: só cancela se a mercadoria NÃO saiu e em
    // até 30 minutos da autorização (lib/edicao-de-pedido →
    // cancelamentoDaNota). A rota mandava o evento para qualquer nota e
    // repassava a recusa da SEFAZ — ou, pior, a SEFAZ aceitava o cancelamento
    // de uma nota cuja mercadoria já tinha saído. Fora da regra, a frase diz o
    // caminho: devolução/estorno com o contador, e depois registrar a
    // devolução aqui (api/store/fiscal/devolucao) para liberar o pedido.
    // "incerto" (sem a hora da autorização ou sem o status) tenta: quem
    // decide é a SEFAZ. Nota de homologação é teste e cancela livre.
    if (Number(fiscalAtual.ambiente) !== 2) {
      const cancelamento = cancelamentoDaNota(order);
      if (cancelamento.cabe === false) {
        return NextResponse.json(
          {
            error: cancelamento.porque === "saiu" ? "mercadoria_saiu" : "prazo_encerrado",
            mensagem:
              (travaDaNotaFiscal(order, "cancelar a nota") ??
                "Esta nota não pode mais ser cancelada. Fale com o contador sobre a devolução/estorno.") +
              " Depois que o contador fizer a devolução, registre-a em Notas fiscais → \"Registrar devolução\" para liberar o pedido.",
            podeRegistrarDevolucao: true,
          },
          { status: 409 }
        );
      }
    }

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });
    // Cancela a NOTA, não o pedido (lib/fiscal-config → notaDoPedido):
    //  - a ref é a da nota. Na conta da mesa ela é `mesa-<sessão>`, gravada em
    //    todos os pedidos da conta; `firehub-<id do pedido>` não existe na
    //    Focus, e o titular recebia "nota não encontrada" com o prazo correndo;
    //  - o ambiente é o em que a nota saiu, com o token dele: a nota de
    //    homologação emitida antes de a loja passar para produção não existe
    //    no servidor de produção.
    const config = normalizarConfigFiscal(loja?.fiscalConfig);
    const nota = notaDoPedido(order);

    // ── Emissor próprio: evento 110111 direto na SEFAZ ────────────────────
    // A nota de `provedor: "sefaz"` não existe na Focus: o cancelamento vai
    // com o certificado da loja, no ambiente da nota, e o evento
    // (procEventoNFe) vai para o cofre — é ele que o contador recebe. A regra
    // legal acima vale igual.
    if ((order.fiscalInfo as any)?.provedor === "sefaz") {
      const { cancelarNotaDoPedidoNaSefaz } = await import("@/lib/nfce/emissao-da-loja");
      const r = await cancelarNotaDoPedidoNaSefaz({
        lojaId,
        config,
        pedido: order,
        pedidosDaNota: nota.pedidos,
        ambiente: nota.ambiente,
        justificativa: String(justificativa).trim(),
      });
      return NextResponse.json(r.corpo, { status: r.status });
    }

    const configDaNota = { ...config, ambiente: nota.ambiente ?? config.ambiente };
    if (!tokenDoAmbiente(configDaNota)) {
      return NextResponse.json(
        { error: "nao_configurado", mensagem: "Provedor de emissão não configurado." },
        { status: 409 }
      );
    }

    const resultado = await cancelarNfce(configDaNota, nota.idDaNota, String(justificativa).trim());

    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.motivo, mensagem: resultado.mensagem, detalhe: resultado.detalhe ?? null },
        { status: resultado.motivo === "erro_de_comunicacao" ? 502 : 409 }
      );
    }

    // A nota da conta da mesa é UMA para todos os pedidos da conta: cancelada
    // ela, todos ficam CANCELED — senão os outros continuariam mostrando uma
    // chave que a SEFAZ já cancelou. Só os que têm a MESMA chave: um pedido
    // que por algum caminho tenha nota própria não é tocado.
    const daNota = nota.pedidos.length > 1
      ? await prisma.customerOrder.findMany({
          where: { id: { in: nota.pedidos }, franchiseeId: lojaId },
          select: { id: true, fiscalInfo: true },
        })
      : [{ id: order.id, fiscalInfo: order.fiscalInfo }];
    const alvos = daNota.filter((p) => p.id === order.id || (p.fiscalInfo as any)?.nfceKey === fiscalAtual.nfceKey);
    await prisma.$transaction(
      alvos.map((p) =>
        prisma.customerOrder.update({
          where: { id: p.id },
          data: {
            fiscalStatus: "CANCELED",
            fiscalInfo: {
              ...((p.fiscalInfo as any) || {}),
              canceladaEm: resultado.canceladaEm,
              protocoloCancelamento: resultado.protocolo,
              justificativaCancelamento: String(justificativa).trim(),
              // O XML do evento é o que prova o cancelamento na fiscalização —
              // e vai no pacote do contador (lib/contador-pacote).
              ...(resultado.urlDoXmlCancelamento ? { xmlCancelamentoUrl: resultado.urlDoXmlCancelamento } : {}),
            },
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      protocolo: resultado.protocolo,
      mensagem:
        `Nota cancelada na SEFAZ (${resultado.mensagemSefaz}). ` +
        `Protocolo do cancelamento: ${resultado.protocolo}.` +
        (alvos.length > 1 ? ` A nota era da conta da mesa: os ${alvos.length} pedidos da conta ficaram cancelados na parte fiscal.` : ""),
    });
  } catch (err: any) {
    console.error("[Fiscal Cancelar] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
