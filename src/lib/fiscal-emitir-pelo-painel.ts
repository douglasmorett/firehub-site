/**
 * A emissão da NFC-e de um pedido pelo painel — o botão 🧾 "Emitir NFC-e"
 * (POST api/store/fiscal/emitir) e o Bill (lib/assessor/modulos/fiscal.ts).
 *
 * Saiu da rota sem mudar nada: a rota confere a sessão e acha a loja; daqui
 * para baixo é o mesmo caminho para os dois, e a resposta é a da tela
 * ({ status, corpo }), que a rota devolve como JSON.
 *
 * A nota e a gravação são as da emissão automática (lib/fiscal-automatico):
 * `emitirNfceDoPedidoPelaTela` para o pedido comum (a nota de `pedidoParaNota`,
 * com canal, intermediador, endereço, pagamento dividido, troco e quem pagou
 * o cupom; contingência gravada com a marca) e `emitirNfceDaMesa` com
 * `manual` para a conta da mesa. Aqui só se confere a loja e o pedido, e se
 * traduz o resultado para a tela.
 */
import { prisma } from "@/lib/prisma";
import { pendenciasParaEmitir, type ResultadoDaEmissao } from "@/lib/fiscal-emissao";
import { caminhoDaNotaDoPedido, normalizarConfigFiscal, respostaDaNotaDaConta } from "@/lib/fiscal-config";
import { emitirNfceDaMesa, emitirNfceDoPedidoPelaTela, type FalhaInterna } from "@/lib/fiscal-automatico";

export type RespostaDaEmissao = { status: number; corpo: any };

export async function emitirNotaPeloPainel(lojaId: string, orderId: unknown, cpfCnpj: unknown): Promise<RespostaDaEmissao> {
  if (!orderId) return { corpo: { error: "orderId obrigatório" }, status: 400 };

  // CPF/CNPJ digitado no modal de emissão. Validado AQUI: documento inválido
  // na nota é rejeição certa da SEFAZ, e o lojista precisa saber antes.
  let documentoInformado: string | null = null;
  if (typeof cpfCnpj === "string" && cpfCnpj.trim()) {
    const digitos = cpfCnpj.replace(/\D/g, "");
    const { documentoValido } = await import("@/lib/fiscal-validacao");
    if (!documentoValido(digitos)) {
      return {
        corpo: {
          error: "documento_invalido",
          mensagem:
            "O CPF/CNPJ informado não é válido (os dígitos verificadores não conferem). " +
            "Corrija ou deixe em branco para emitir sem documento.",
        },
        status: 400,
      };
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
    return {
      corpo: {
        error: "emissao_desligada",
        mensagem:
          "A emissão de nota fiscal está DESLIGADA para esta loja. " +
          "Ligue em Fiscal → Configuração antes de emitir.",
      },
      status: 409,
    };
  }

  // Conferir antes de carregar o pedido: se a loja nem pode emitir, não faz
  // sentido montar a nota. E a mensagem que o lojista precisa ler é esta.
  // (A loja cadastrada pela Focus não tem `csc` gravado, só o CSC do
  // ambiente em `cscNaFocus` — pendenciasParaEmitir aceita.)
  const pendenciasDaLoja = pendenciasParaEmitir(config);
  if (pendenciasDaLoja.length > 0) {
    return {
      corpo: {
        error: "emissao_nao_configurada",
        mensagem:
          `Esta loja ainda não pode emitir nota fiscal: ${pendenciasDaLoja.length} pendência(s) ` +
          `no cadastro. Complete em Fiscal → Configuração.`,
        pendencias: pendenciasDaLoja,
      },
      status: 409,
    };
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId as string },
    include: { items: { include: { menuProduct: true } } },
  });

  if (!order) return { corpo: { error: "Pedido não encontrado" }, status: 404 };
  if (order.franchiseeId !== lojaId) {
    return { corpo: { error: "Este pedido não é desta loja" }, status: 403 };
  }

  // Venda cancelada não gera nota: seria pagar imposto sobre venda que não
  // aconteceu. A listagem trazia pedidos cancelados e o lote pré-selecionava
  // todos — este é o guarda que não depende da tela.
  if (String(order.status || "").toUpperCase().startsWith("CANCEL")) {
    return {
      corpo: {
        error: "pedido_cancelado",
        mensagem: "Este pedido foi CANCELADO — não se emite nota fiscal de venda cancelada.",
      },
      status: 409,
    };
  }

  // Nota já autorizada não se emite de novo — geraria duplicidade na SEFAZ.
  const fiscalAtual = (order.fiscalInfo as any) || {};
  if (order.fiscalStatus === "EMITTED" && fiscalAtual.nfceKey) {
    return {
      corpo: {
        error: "ja_emitida",
        mensagem: `Este pedido já tem nota autorizada (chave ${fiscalAtual.nfceKey}).`,
        fiscalInfo: fiscalAtual,
      },
      status: 409,
    };
  }
  // Processando: a ref já está consumida no provedor. Emitir de novo não
  // resolve — consultar resolve.
  if (fiscalAtual.processando === true && order.fiscalStatus !== "EMITTED" && order.fiscalStatus !== "CANCELED") {
    return {
      corpo: {
        error: "nota_em_processamento",
        mensagem: "A nota deste pedido está em processamento na SEFAZ. Use \"Consultar situação\" — não emita de novo.",
      },
      status: 409,
    };
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
  if (caminho.caminho === "recusa") return { corpo: caminho.corpo, status: 409 };
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
    return {
      corpo: { ...resposta.corpo, ...(caminho.restante ? { restante: true } : {}), ...(caminho.reemissao ? { reemissao: true } : {}) },
      status: resposta.status,
    };
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
}

/** O resultado da emissão de um pedido comum, para a tela. */
function responderEmissao(resultado: ResultadoDaEmissao | FalhaInterna, reemissao: boolean): RespostaDaEmissao {
  // "Processando" não é falha: a SEFAZ recebeu a nota e ainda não respondeu.
  // O pedido fica PENDING com a marca; o GET da rota ("Consultar
  // situação") e o cron resolvem o estado final.
  if (!resultado.ok && resultado.motivo === "processando") {
    return { corpo: { error: "processando", mensagem: resultado.mensagem }, status: 202 };
  }
  if (!resultado.ok) {
    const status = resultado.motivo === "erro_de_comunicacao" ? 502 : resultado.motivo === "erro_interno" ? 500 : 409;
    return {
      corpo: {
        error: resultado.motivo,
        mensagem: resultado.mensagem,
        pendencias: "pendencias" in resultado ? resultado.pendencias ?? [] : [],
        detalhe: "detalheDaRejeicao" in resultado ? resultado.detalheDaRejeicao ?? null : null,
      },
      status,
    };
  }
  return {
    corpo: {
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
    },
    status: 200,
  };
}
