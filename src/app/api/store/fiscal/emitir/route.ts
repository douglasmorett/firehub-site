import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  emitirNfce,
  consultarNfce,
  pendenciasParaEmitir,
  type ConfiguracaoFiscal,
  type ItemDaNota,
  type ResultadoDaEmissao,
} from "@/lib/fiscal-emissao";
import { montarItensDaNota } from "@/lib/fiscal-itens";

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
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    // CPF/CNPJ digitado no modal de emissão. Validado AQUI: documento inválido
    // na nota é rejeição certa da SEFAZ, e o lojista precisa saber antes.
    let documentoInformado: string | null = null;
    if (typeof cpfCnpj === "string" && cpfCnpj.trim()) {
      const digitos = cpfCnpj.replace(/\D/g, "");
      const { documentoValido } = await import("@/lib/fiscal-validacao");
      if (!documentoValido(digitos)) {
        return NextResponse.json(
          {
            error: "documento_invalido",
            mensagem:
              "O CPF/CNPJ informado não é válido (os dígitos verificadores não conferem). " +
              "Corrija ou deixe em branco para emitir sem documento.",
          },
          { status: 400 }
        );
      }
      documentoInformado = digitos;
    }

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true, storeName: true, name: true },
    });
    const config = (loja?.fiscalConfig as (ConfiguracaoFiscal & { enabled?: boolean }) | null) ?? {};

    // Módulo desligado na tela significa desligado. A emissão automática já
    // respeitava `enabled`; o botão Emitir não conferia e emitia nota REAL na
    // SEFAZ com o módulo aparentemente desativado — nota que depois só sai por
    // cancelamento, dentro do prazo legal.
    if (!config.enabled) {
      return NextResponse.json(
        {
          error: "emissao_desligada",
          mensagem:
            "A emissão de nota fiscal está DESLIGADA para esta loja. " +
            "Ligue em Fiscal → Configuração antes de emitir.",
        },
        { status: 409 }
      );
    }

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

    // Venda cancelada não gera nota: seria pagar imposto sobre venda que não
    // aconteceu. A listagem trazia pedidos cancelados e o lote pré-selecionava
    // todos — este é o guarda que não depende da tela.
    if (order.status === "CANCELADO") {
      return NextResponse.json(
        {
          error: "pedido_cancelado",
          mensagem: "Este pedido foi CANCELADO — não se emite nota fiscal de venda cancelada.",
        },
        { status: 409 }
      );
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

    // As linhas da nota saem de lib/fiscal-itens, que abre os combos usando o
    // `fiscalBreakdown` configurado na Engenharia de Cardápio Fiscal. Antes o
    // breakdown era só gravado e exibido: a tela dizia "🟢 Engenharia
    // Discriminada Ativa" e a nota saía com o combo em linha única.
    const itens: ItemDaNota[] = montarItensDaNota(order.items);

    const resultado = await emitirNfce(config, {
      id: order.id,
      numero: order.dailyOrderNumber ?? null,
      itens,
      valorTotal: order.totalAmount,
      taxaEntrega: order.deliveryFee || 0,
      desconto: order.discountTotal || 0,
      formaDePagamento: order.paymentMethod || "Dinheiro",
      documentoDoCliente: documentoInformado || order.customerCpfCnpj,
      nomeDoCliente: order.customerName,
      // Delivery é "entrega a domicílio" (presença 4), não venda de balcão.
      // Ia chumbado como presencial para todo pedido, inclusive o delivery,
      // que é o grosso do movimento das lojas.
      entregaEmDomicilio: order.deliveryType === "DELIVERY",
    });

    // Documento digitado no modal fica gravado no pedido: reemissão, consulta
    // e histórico passam a carregar o mesmo CPF que foi para a nota.
    if (documentoInformado && documentoInformado !== order.customerCpfCnpj) {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: { customerCpfCnpj: documentoInformado },
      });
    }

    // "Processando" não é falha: a SEFAZ recebeu a nota e ainda não respondeu.
    // Marcar FAILED aqui faria o lojista reemitir — e a ref já está consumida
    // no provedor. Fica PENDING com a marca de processamento; o GET desta rota
    // (Consultar situação) resolve o estado final.
    if (!resultado.ok && resultado.motivo === "processando") {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          fiscalStatus: "PENDING",
          fiscalInfo: {
            ...fiscalAtual,
            processando: true,
            ultimaTentativaEm: new Date().toISOString(),
          },
        },
      });
      return NextResponse.json(
        { error: "processando", mensagem: resultado.mensagem },
        { status: 202 }
      );
    }

    if (!resultado.ok) {
      // Grava a tentativa fracassada: o lojista precisa ver no histórico que
      // tentou e por que não passou, em vez de o pedido continuar "pendente"
      // como se ninguém tivesse mexido. updateMany com a trava de status:
      // se uma emissão concorrente acabou de autorizar (duplo clique), este
      // FAILED não pode sobrescrever o EMITTED e apagar a chave da nota.
      await prisma.customerOrder.updateMany({
        where: { id: order.id, NOT: { fiscalStatus: "EMITTED" } },
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

/**
 * GET /api/store/fiscal/emitir?orderId=... — consulta a situação real da nota
 * no provedor e sincroniza o pedido.
 *
 * Existe para as notas que ficaram "processando" (SEFAZ lenta): a ref já está
 * consumida no Focus e reemitir não resolve — consultar resolve. Se a nota foi
 * autorizada nesse meio tempo, o pedido vira EMITTED aqui.
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

    const resultado: ResultadoDaEmissao = await consultarNfce(config, order.id);
    const fiscalAtual = (order.fiscalInfo as any) || {};

    if (resultado.ok) {
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
        situacao: "autorizada",
        chaveDeAcesso: resultado.chaveDeAcesso,
        numero: resultado.numero,
        protocolo: resultado.protocolo,
        urlDoDanfe: resultado.urlDoDanfe,
      });
    }

    if (resultado.motivo === "processando") {
      return NextResponse.json(
        { situacao: "processando", mensagem: resultado.mensagem },
        { status: 202 }
      );
    }

    if (resultado.motivo === "rejeitada") {
      // Cancelada por fora (portal da SEFAZ, outro sistema) não é falha de
      // emissão: o estado verdadeiro do documento é CANCELADO.
      const foiCancelada = resultado.mensagem.includes("CANCELADA");
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          fiscalStatus: foiCancelada ? "CANCELED" : "FAILED",
          fiscalInfo: {
            ...fiscalAtual,
            processando: false,
            ultimaTentativaEm: new Date().toISOString(),
            ...(foiCancelada ? { canceladaEm: new Date().toISOString() } : { ultimoErro: resultado.mensagem }),
          },
        },
      });
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
