import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import type { ConfiguracaoFiscal } from "@/lib/fiscal-emissao";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/fiscal/danfe?orderId=...&tipo=pdf|xml
 *
 * Baixa o DANFE (PDF) ou o XML da nota pelo servidor.
 *
 * Os caminhos que o Focus devolve (caminho_danfe / caminho_xml_nota_fiscal)
 * exigem autenticação Basic com o token do provedor — o link salvo no pedido
 * simplesmente não abre no navegador do lojista (401). O token não pode ir
 * para o cliente, então o servidor busca e repassa o arquivo.
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

    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId");
    const tipo = url.searchParams.get("tipo") === "xml" ? "xml" : "pdf";
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: { id: true, franchiseeId: true, fiscalStatus: true, fiscalInfo: true },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    const fiscal = (order.fiscalInfo as any) || {};
    const alvo = tipo === "xml" ? fiscal.xmlUrl : fiscal.pdfUrl;
    if (!alvo) {
      return NextResponse.json(
        { error: "sem_documento", mensagem: "Este pedido não tem nota autorizada com documento salvo." },
        { status: 404 }
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

    const autorizacao = Buffer.from(`${config.tokenDoProvedor}:`).toString("base64");
    const res = await fetch(alvo, {
      headers: { Authorization: `Basic ${autorizacao}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "provedor_recusou", mensagem: `O provedor respondeu HTTP ${res.status} ao buscar o documento.` },
        { status: 502 }
      );
    }

    const conteudo = Buffer.from(await res.arrayBuffer());
    const nomeBase = `nfce-${fiscal.serie ?? "s"}-${fiscal.nfceNumber ?? order.id.slice(-6)}`;
    return new NextResponse(conteudo, {
      headers: {
        "Content-Type": tipo === "xml" ? "application/xml" : "application/pdf",
        "Content-Disposition": `inline; filename="${nomeBase}.${tipo}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err: any) {
    console.error("[Fiscal DANFE] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
