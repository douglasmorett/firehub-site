import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cancelarNfce, type ConfiguracaoFiscal } from "@/lib/fiscal-emissao";

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
      select: { id: true, franchiseeId: true, fiscalStatus: true, fiscalInfo: true },
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

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });
    const config = (loja?.fiscalConfig as ConfiguracaoFiscal | null) ?? {};
    if (!config.tokenDoProvedor) {
      return NextResponse.json(
        { error: "nao_configurado", mensagem: "Provedor de emissão não configurado." },
        { status: 409 }
      );
    }

    const resultado = await cancelarNfce(config, order.id, String(justificativa).trim());

    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.motivo, mensagem: resultado.mensagem, detalhe: resultado.detalhe ?? null },
        { status: resultado.motivo === "erro_de_comunicacao" ? 502 : 409 }
      );
    }

    await prisma.customerOrder.update({
      where: { id: order.id },
      data: {
        fiscalStatus: "CANCELED",
        fiscalInfo: {
          ...fiscalAtual,
          canceladaEm: resultado.canceladaEm,
          protocoloCancelamento: resultado.protocolo,
          justificativaCancelamento: String(justificativa).trim(),
        },
      },
    });

    return NextResponse.json({
      success: true,
      protocolo: resultado.protocolo,
      mensagem:
        `Nota cancelada na SEFAZ (${resultado.mensagemSefaz}). ` +
        `Protocolo do cancelamento: ${resultado.protocolo}.`,
    });
  } catch (err: any) {
    console.error("[Fiscal Cancelar] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
