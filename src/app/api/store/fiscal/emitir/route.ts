import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { consultarNotaDoPedido } from "@/lib/fiscal-automatico";
import { emitirNotaPeloPainel } from "@/lib/fiscal-emitir-pelo-painel";

export const dynamic = "force-dynamic";
// A emissão pode esperar a SEFAZ processar (até ~12s de consultas) além dos
// 45s de timeout do POST ao provedor.
export const maxDuration = 60;

/**
 * Emite a NFC-e de um pedido.
 *
 * Esta rota não existia. O botão "Emitir" da tela fiscal era
 * `setTimeout(1200)` + `alert("✅ Nota Fiscal emitida com sucesso")` — nenhuma
 * chamada de rede, nenhuma gravação, nenhum documento. A partir daqui, ou a nota
 * é autorizada pela SEFAZ e o retorno traz chave e protocolo de verdade, ou o
 * retorno diz exatamente o que impediu.
 *
 * Esta rota só confere quem pede e a loja; a emissão (pedido, nota, gravação e
 * a resposta para a tela) é a de lib/fiscal-emitir-pelo-painel.ts — a mesma
 * que o Bill usa.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    const { orderId, cpfCnpj } = await req.json().catch(() => ({}));
    const r = await emitirNotaPeloPainel(lojaId, orderId, cpfCnpj);
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err: any) {
    console.error("[Fiscal Emitir] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * GET /api/store/fiscal/emitir?orderId=... — consulta a situação real da nota
 * no provedor e sincroniza o pedido.
 *
 * Existe para as notas que ficaram "processando" (SEFAZ lenta) e para
 * acompanhar a contingência: a ref já está consumida no Focus e reemitir não
 * resolve — consultar resolve. A gravação é a MESMA do cron
 * (lib/fiscal-automatico → sincronizarNota): no ambiente da nota, em todos os
 * pedidos dela (a conta da mesa), e sem desfazer a contingência por uma
 * consulta que não achou a nota ou não conseguiu falar com o provedor.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    const orderId = new URL(req.url).searchParams.get("orderId");
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: { id: true, franchiseeId: true, fiscalStatus: true, fiscalInfo: true },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    const { resultado, semToken } = await consultarNotaDoPedido(order, lojaId);
    if (semToken || !resultado) {
      return NextResponse.json(
        { error: "nao_configurado", mensagem: "Provedor de emissão não configurado para o ambiente desta nota." },
        { status: 409 }
      );
    }

    if (resultado.ok) {
      return NextResponse.json({
        success: true,
        situacao: resultado.emContingencia ? "contingencia" : "autorizada",
        chaveDeAcesso: resultado.chaveDeAcesso,
        numero: resultado.numero,
        protocolo: resultado.protocolo,
        urlDoDanfe: resultado.urlDoDanfe,
        ...(resultado.emContingencia ? { mensagem: resultado.aviso ?? "A nota continua em contingência: a SEFAZ ainda não efetivou." } : {}),
      });
    }

    if (resultado.motivo === "processando") {
      return NextResponse.json({ situacao: "processando", mensagem: resultado.mensagem }, { status: 202 });
    }

    return NextResponse.json(
      {
        situacao: resultado.motivo,
        mensagem: resultado.mensagem,
        detalhe: resultado.detalheDaRejeicao ?? null,
      },
      { status: resultado.motivo === "erro_de_comunicacao" ? 502 : 409 }
    );
  } catch (err: any) {
    console.error("[Fiscal Consultar] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
