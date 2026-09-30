import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pendenciasParaEmitir, type ResultadoDaEmissao } from "@/lib/fiscal-emissao";
import { caminhoDaNotaDoPedido, normalizarConfigFiscal, respostaDaNotaDaConta } from "@/lib/fiscal-config";
import { consultarNotaDoPedido, emitirNfceDaMesa, emitirNfceDoPedidoPelaTela, type FalhaInterna } from "@/lib/fiscal-automatico";

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
 * A nota e a gravação são as da emissão automática (lib/fiscal-automatico):
 * `emitirNfceDoPedidoPelaTela` para o pedido comum (a nota de `pedidoParaNota`,
 * com canal, intermediador, endereço, pagamento dividido, troco e quem pagou
 * o cupom; contingência gravada com a marca) e `emitirNfceDaMesa` com
 * `manual` para a conta da mesa. Esta rota só confere quem pede, a loja e o
 * pedido, e traduz o resultado para a tela.
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

    // O merchant do iFood e o shop do 99Food vão como identificador do
    // intermediador (rejeição 438) quando o pedido não traz o dele.
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true, ifoodMerchantId: true, food99MerchantId: true },
    });
    // NORMALIZADA (lib/fiscal-config): o legado "producao" por extenso virava
    // NaN e a nota ia para homologação; e a normalização carimba de que
    // ambiente é o token colado à mão antes de qualquer troca de ambiente.
    const config = normalizarConfigFiscal(loja?.fiscalConfig);

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
    // (A loja cadastrada pela Focus não tem `csc` gravado, só o CSC do
    // ambiente em `cscNaFocus` — pendenciasParaEmitir aceita.)
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
    if (String(order.status || "").toUpperCase().startsWith("CANCEL")) {
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
    // Processando: a ref já está consumida no provedor. Emitir de novo não
    // resolve — consultar resolve.
    if (fiscalAtual.processando === true && order.fiscalStatus !== "EMITTED" && order.fiscalStatus !== "CANCELED") {
      return NextResponse.json(
        {
          error: "nota_em_processamento",
          mensagem: "A nota deste pedido está em processamento na SEFAZ. Use \"Consultar situação\" — não emita de novo.",
        },
        { status: 409 }
      );
    }

    // Pedido de mesa não tem nota avulsa: a NFC-e é UMA por conta, com todas
    // as rodadas e as formas em que a mesa pagou. Com a conta fechada, este
    // botão emite a nota da CONTA, à mão (lib/fiscal-config →
    // caminhoDaNotaDoPedido): a conta paga fora da emissão automática (52 das
    // 479 contas fechadas do Pastel da Paulista, Dinheiro e Voucher, medido em
    // 24/09/2026), a nota da conta rejeitada, a do RESTANTE quando uma rodada
    // já tem nota própria, e a REEMISSÃO depois de a loja cancelar a nota da
    // conta. Vem depois do "já emitida" de propósito: a rodada que já saiu na
    // nota da conta diz qual é a chave.
    const conta = order.tableSessionId
      ? await prisma.tableSession.findFirst({
          where: { id: order.tableSessionId, franchiseeId: lojaId },
          select: {
            status: true,
            orders: { select: { id: true, dailyOrderNumber: true, status: true, fiscalStatus: true, fiscalInfo: true } },
          },
        })
      : null;
    const caminho = caminhoDaNotaDoPedido(order, conta ? { status: conta.status, pedidos: conta.orders } : null);
    if (caminho.caminho === "recusa") return NextResponse.json(caminho.corpo, { status: 409 });
    if (caminho.caminho === "conta") {
      // O CPF digitado no modal vai para a nota da conta: ela usa o primeiro
      // documento entre os pedidos da conta (lib/fiscal-momento →
      // montarNotaDaMesa), então ele fica gravado em todos.
      if (documentoInformado) {
        await prisma.customerOrder.updateMany({
          where: { tableSessionId: caminho.tableSessionId, franchiseeId: lojaId },
          data: { customerCpfCnpj: documentoInformado },
        });
      }
      const daConta = await emitirNfceDaMesa(caminho.tableSessionId, { manual: true });
      const depois = await prisma.customerOrder.findUnique({
        where: { id: order.id },
        select: { fiscalStatus: true, fiscalInfo: true },
      });
      const resposta = respostaDaNotaDaConta(daConta, depois);
      return NextResponse.json(
        { ...resposta.corpo, ...(caminho.restante ? { restante: true } : {}), ...(caminho.reemissao ? { reemissao: true } : {}) },
        { status: resposta.status }
      );
    }

    const { resultado, reemissao } = await emitirNfceDoPedidoPelaTela(
      order,
      { ifoodMerchantId: loja?.ifoodMerchantId ?? null, food99MerchantId: loja?.food99MerchantId ?? null },
      config,
      { documentoInformado }
    );

    // Documento digitado no modal fica gravado no pedido: reemissão, consulta
    // e histórico passam a carregar o mesmo CPF que foi para a nota.
    if (documentoInformado && documentoInformado !== order.customerCpfCnpj) {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: { customerCpfCnpj: documentoInformado },
      });
    }

    return responderEmissao(resultado, reemissao);
  } catch (err: any) {
    console.error("[Fiscal Emitir] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/** O resultado da emissão de um pedido comum, para a tela. */
function responderEmissao(resultado: ResultadoDaEmissao | FalhaInterna, reemissao: boolean) {
  // "Processando" não é falha: a SEFAZ recebeu a nota e ainda não respondeu.
  // O pedido fica PENDING com a marca; o GET desta rota ("Consultar
  // situação") e o cron resolvem o estado final.
  if (!resultado.ok && resultado.motivo === "processando") {
    return NextResponse.json({ error: "processando", mensagem: resultado.mensagem }, { status: 202 });
  }
  if (!resultado.ok) {
    const status = resultado.motivo === "erro_de_comunicacao" ? 502 : resultado.motivo === "erro_interno" ? 500 : 409;
    return NextResponse.json(
      {
        error: resultado.motivo,
        mensagem: resultado.mensagem,
        pendencias: "pendencias" in resultado ? resultado.pendencias ?? [] : [],
        detalhe: "detalheDaRejeicao" in resultado ? resultado.detalheDaRejeicao ?? null : null,
      },
      { status }
    );
  }
  return NextResponse.json({
    success: true,
    chaveDeAcesso: resultado.chaveDeAcesso,
    numero: resultado.numero,
    serie: resultado.serie,
    protocolo: resultado.protocolo,
    ambiente: resultado.ambiente,
    urlDoXml: resultado.urlDoXml,
    urlDoDanfe: resultado.urlDoDanfe,
    // Contingência off-line: a nota vale para o cliente e o DANFE TEM de ser
    // impresso, mas a SEFAZ ainda vai receber (até 24 h) e pode recusar. A
    // tela mostra o aviso e o DANFE; o cron acompanha até efetivar.
    contingencia: resultado.emContingencia === true,
    ...(reemissao ? { reemissao: true } : {}),
    // Deixa explícito quando é teste: homologação NÃO tem valor fiscal.
    aviso:
      [
        resultado.emContingencia ? resultado.aviso ?? null : null,
        resultado.ambiente === 2 ? "Nota emitida em HOMOLOGAÇÃO — é um teste e não tem valor fiscal." : null,
      ].filter(Boolean).join(" ") || null,
  });
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
