import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { emitirNfce, pendenciasParaEmitir, type ConfiguracaoFiscal, type ItemDaNota } from "@/lib/fiscal-emissao";

export const dynamic = "force-dynamic";

/**
 * Emite a NFC-e de um pedido.
 *
 * Esta rota não existia. O botão "Emitir" da tela fiscal era
 * `setTimeout(1200)` + `alert("✅ Nota Fiscal emitida com sucesso")` — nenhuma
 * chamada de rede, nenhuma gravação, nenhum documento. A partir daqui, ou a nota
 * é autorizada pela SEFAZ e o retorno traz chave e protocolo de verdade, ou o
 * retorno diz exatamente o que impediu.
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

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true, storeName: true, name: true },
    });
    const config = (loja?.fiscalConfig as ConfiguracaoFiscal | null) ?? {};

    // Conferir antes de carregar o pedido: se a loja nem pode emitir, não faz
    // sentido montar a nota. E a mensagem que o lojista precisa ler é esta.
    const pendenciasDaLoja = pendenciasParaEmitir(config);
    if (pendenciasDaLoja.length > 0) {
      return NextResponse.json(
        {
          error: "emissao_nao_configurada",
          mensagem:
            `Esta loja ainda não pode emitir nota fiscal: ${pendenciasDaLoja.length} pendência(s) ` +
            `no cadastro. Complete em Fiscal → Configuração.`,
          pendencias: pendenciasDaLoja,
        },
        { status: 409 }
      );
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuProduct: true } } },
    });

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    // Nota já autorizada não se emite de novo — geraria duplicidade na SEFAZ.
    const fiscalAtual = (order.fiscalInfo as any) || {};
    if (order.fiscalStatus === "EMITTED" && fiscalAtual.nfceKey) {
      return NextResponse.json(
        {
          error: "ja_emitida",
          mensagem: `Este pedido já tem nota autorizada (chave ${fiscalAtual.nfceKey}).`,
          fiscalInfo: fiscalAtual,
        },
        { status: 409 }
      );
    }

    const itens: ItemDaNota[] = order.items.map((item) => {
      const p = item.menuProduct;
      return {
        codigo: p?.id ?? item.id,
        descricao: item.productName || p?.name || "Item",
        ncm: p?.ncm ?? "",
        cest: p?.cest ?? null,
        cfop: p?.cfop ?? "5102",
        unidadeComercial: "UN",
        quantidade: item.quantity,
        valorUnitario: item.price,
        valorTotal: item.price * item.quantity,
        origem: 0,
        csosn: p?.csosn ?? null,
        cst: null,
      };
    });

    const resultado = await emitirNfce(config, {
      id: order.id,
      numero: order.dailyOrderNumber ?? null,
      itens,
      valorTotal: order.totalAmount,
      formaDePagamento: order.paymentMethod || "Dinheiro",
      documentoDoCliente: order.customerCpfCnpj,
      nomeDoCliente: order.customerName,
    });

    if (!resultado.ok) {
      // Grava a tentativa fracassada: o lojista precisa ver no histórico que
      // tentou e por que não passou, em vez de o pedido continuar "pendente"
      // como se ninguém tivesse mexido.
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          fiscalStatus: "FAILED",
          fiscalInfo: {
            ...fiscalAtual,
            ultimaTentativaEm: new Date().toISOString(),
            ultimoErro: resultado.mensagem,
            motivo: resultado.motivo,
          },
        },
      });

      const status = resultado.motivo === "erro_de_comunicacao" ? 502 : 409;
      return NextResponse.json(
        {
          error: resultado.motivo,
          mensagem: resultado.mensagem,
          pendencias: resultado.pendencias ?? [],
          detalhe: resultado.detalheDaRejeicao ?? null,
        },
        { status }
      );
    }

    await prisma.customerOrder.update({
      where: { id: order.id },
      data: {
        fiscalStatus: "EMITTED",
        fiscalInfo: {
          nfceKey: resultado.chaveDeAcesso,
          nfceNumber: resultado.numero,
          serie: resultado.serie,
          protocol: resultado.protocolo,
          emittedAt: resultado.emitidaEm,
          ambiente: resultado.ambiente,
          xmlUrl: resultado.urlDoXml,
          pdfUrl: resultado.urlDoDanfe,
        },
      },
    });

    return NextResponse.json({
      success: true,
      chaveDeAcesso: resultado.chaveDeAcesso,
      numero: resultado.numero,
      serie: resultado.serie,
      protocolo: resultado.protocolo,
      ambiente: resultado.ambiente,
      urlDoXml: resultado.urlDoXml,
      urlDoDanfe: resultado.urlDoDanfe,
      // Deixa explícito quando é teste: homologação NÃO tem valor fiscal.
      aviso:
        resultado.ambiente === 2
          ? "Nota emitida em HOMOLOGAÇÃO — é um teste e não tem valor fiscal."
          : null,
    });
  } catch (err: any) {
    console.error("[Fiscal Emitir] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
