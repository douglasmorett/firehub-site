/**
 * POST /api/totem/payment/start
 *
 * Acende a cobrança no visor da maquininha que fica ao lado do totem.
 *
 * O pedido já existe (criado em /api/totem/order) e está esperando pagamento.
 * Aqui só sobe o valor na Point; quem confirma o pagamento é o webhook
 * /api/webhooks/mercadopago-point, depois de reconsultar a ordem no MP.
 *
 * Corpo: { token, orderId, terminalId?, forma? }
 *
 * Três caminhos, conforme a maquininha:
 *   - Stone pela nuvem (Connect 2.0, provider STONE_CONNECT): pedido na
 *     Pagar.me endereçado ao número de série da POS; quem confirma é o webhook
 *     /api/webhooks/stone-connect (ou a reconsulta do payment-status).
 *   - App do FireHub na maquininha (PagBank/Stone/Cielo/Getnet): fila.
 *   - Mercado Pago Point: ordem na nuvem do MP.
 * `forma` (credit|debit|pix|voucher) só vale na Stone em fluxo DIRETO.
 *
 * Antes dos três: licença com TEF ligado (pinpad PayGo no computador do totem)
 * responde `modo: "TEF"` e o totem pede a venda ao Assistente local.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTotem } from "@/lib/totem-auth";
import { consultarOrdem, criarOrdemPoint } from "@/lib/mp-point";
import { ESTADOS_DA_COBRANCA, PROVEDORES_COM_APP } from "@/lib/terminal-app";
import {
  consultarPedidoStone,
  criarPedidoStone,
  ehIdDePedidoStone,
  ehTipoDireto,
  pedidoVivo,
  serviceRefererName,
} from "@/lib/stone-connect";
import { credencialStone } from "@/lib/stone-connect-loja";
import { ESTADO_TEF_NO_PINPAD, formaDoPedidoTef, tefDaLicenca } from "@/lib/tef-do-totem";
import {
  PROVEDOR_STONE,
  aplicarPedidoStoneNoTotem,
  cancelarPedidoStone,
  cobrancaEhDaStone,
} from "@/lib/cobranca-stone-do-totem";

export const dynamic = "force-dynamic";

/**
 * Status em que a cobrança acabou: ou pagou, ou morreu. Qualquer outro
 * ("created", "action_required", e o que o MP acrescentar depois) significa que
 * ainda existe cobrança viva no visor — e mandar outra em cima acenderia duas
 * telas de pagamento para o mesmo pedido.
 */
const FINALIZADOS = new Set(["processed", "canceled", "refunded", "failed", "expired"]);

/**
 * A forma de pagamento deixa de ser o texto que a tela escolheu lá atrás.
 *
 * O pedido nasce rotulado pelo botão que o cliente tocou, e o rótulo nunca era
 * revisto. Quem toca em "Pagar no caixa" e depois passa o cartão na maquininha
 * ficava gravado como dinheiro no balcão. Aqui o servidor SABE qual caminho a
 * cobrança tomou — quando o visor acende, a venda é de maquininha, e é isso que
 * fica no banco para o fechamento e para o extrato da adquirente conferirem.
 */
const FORMA_MAQUININHA = "Cartão (Maquininha)";

/**
 * ── CAIXA FECHADO NÃO ACENDE COBRANÇA NOVA ──────────────────────────────────
 *
 * A trava de caixa existia só na criação do pedido (/api/totem/order). Mas
 * criar e cobrar são dois passos separados por minutos: pedido criado 22h50 com
 * o caixa aberto, gerente fecha o caixa 22h55, cliente toca em "Pagar na
 * maquininha" 22h56 — a cobrança acendia, o cartão passava e
 * `confirmOrderPayment` carimbava o pagamento, mandava para o KDS e imprimia a
 * comanda com o turno já fechado. É exatamente o que a regra do totem proíbe:
 * enquanto ligado ele vende, mas sem caixa aberto o pedido não se CONCLUI.
 *
 * A checagem fica nos dois pontos que acendem cobrança NOVA — e só neles. Os
 * caminhos que reconhecem cobrança que já existe (o `posOrderId` que voltou
 * `processed`, a cobrança viva no visor) seguem sem perguntar do caixa: ali o
 * cartão já passou, e recusar por caixa fechado deixaria o cliente com o valor
 * debitado e o pedido sem registro nenhum — o oposto do que esta trava protege.
 */
async function caixaEstaAberto(franchiseeId: string): Promise<boolean> {
  const aberto = await prisma.cashSession.findFirst({
    where: { franchiseeId, status: "OPEN" },
    select: { id: true },
  });
  return !!aberto;
}

/**
 * A tela mostra `error` no detalhe da falha, então a mensagem humana vai nele —
 * e o carrinho/pedido continuam de pé: o cliente cai no estado que já oferece
 * "Tentar de novo" e "Pagar no caixa", que é para onde a regra manda mandá-lo.
 */
function respostaDeCaixaFechado(numero: number | null) {
  const identificacao = numero ? ` (pedido ${numero})` : "";
  return NextResponse.json(
    {
      error:
        `O caixa da loja está fechado agora, então não dá para cobrar por aqui. ` +
        `Chame um atendente no balcão${identificacao} — ele finaliza para você sem perder o que você escolheu.`,
      code: "CAIXA_FECHADO",
    },
    { status: 409 },
  );
}

/**
 * Descobre em qual maquininha está acesa a cobrança que já existia.
 *
 * Não serve a maquininha que ESTA chamada escolheu: o start pode ter sido
 * chamado de novo com outro terminalId no corpo, e mandar o cliente olhar o
 * visor errado é pior do que não dizer nome nenhum. Vale o que foi gravado
 * quando a cobrança subiu e, na falta dele, o terminal_id que o próprio MP
 * devolveu na consulta.
 */
async function maquininhaDaCobranca(
  franchiseeId: string,
  posTerminalId: string | null,
  terminalIdNoMp: string | undefined,
): Promise<{ id: string; label: string } | null> {
  if (posTerminalId) {
    const gravada = await prisma.posTerminal.findFirst({
      where: { id: posTerminalId, franchiseeId },
      select: { id: true, label: true },
    });
    if (gravada) return gravada;
  }
  if (terminalIdNoMp) {
    const peloMp = await prisma.posTerminal.findFirst({
      where: { externalId: terminalIdNoMp, franchiseeId },
      select: { id: true, label: true },
    });
    if (peloMp) return peloMp;
  }
  return null;
}

type TerminalStone = { id: string; externalId: string; label: string };

/**
 * A cobrança deste pedido vai pela nuvem da Stone? Sim quando: já existe
 * cobrança Stone no pedido; ou a tela escolheu uma maquininha STONE_CONNECT;
 * ou, sem escolha, a maquininha do totem é STONE_CONNECT; ou ela é a única
 * maquininha ativa da loja. Cobrança anterior de OUTRA nuvem (Point) no pedido
 * fica com o caminho antigo — trocar de nuvem no meio da cobrança acenderia
 * duas telas de pagamento.
 */
async function caminhoDaStone(
  pedido: { franchiseeId: string; posOrderId: string | null; posTerminalId: string | null },
  licencaId: string,
  terminalId: unknown,
): Promise<{ existente: boolean; terminal: TerminalStone | null } | null> {
  const selecao = { id: true, externalId: true, label: true, provider: true, active: true } as const;
  const existente = await cobrancaEhDaStone(pedido.franchiseeId, pedido.posTerminalId, pedido.posOrderId);
  if (pedido.posOrderId && !existente) return null;

  let escolhido: { id: string; externalId: string; label: string; provider: string; active: boolean } | null = null;
  if (terminalId && typeof terminalId === "string") {
    escolhido = await prisma.posTerminal.findFirst({
      where: { id: terminalId, franchiseeId: pedido.franchiseeId, active: true },
      select: selecao,
    });
  } else {
    const vinculo = await prisma.totemLicense.findUnique({
      where: { id: licencaId },
      select: { posTerminal: { select: selecao } },
    });
    if (vinculo?.posTerminal?.active) {
      escolhido = vinculo.posTerminal;
    } else {
      const ativas = await prisma.posTerminal.findMany({
        where: { franchiseeId: pedido.franchiseeId, active: true },
        select: selecao,
        take: 2,
      });
      if (ativas.length === 1) escolhido = ativas[0];
    }
  }

  const terminal = escolhido?.provider === PROVEDOR_STONE ? escolhido : null;
  if (!terminal && !existente) return null;
  if (!terminal && existente && pedido.posTerminalId) {
    // Reconhecer a cobrança que já existe não depende da maquininha continuar
    // escolhida: vale a gravada quando a cobrança subiu.
    const gravada = await prisma.posTerminal.findFirst({
      where: { id: pedido.posTerminalId, franchiseeId: pedido.franchiseeId, provider: PROVEDOR_STONE },
      select: selecao,
    });
    return { existente, terminal: gravada?.active ? gravada : null };
  }
  return { existente, terminal };
}

/**
 * Cobrança pela nuvem da Stone. Mesmo contrato de resposta do Point — a tela
 * do totem não precisa saber de que nuvem é. O `posStatus` usa o vocabulário
 * do app (NO_TERMINAL, PAGO, RECUSADO...), que a tela já entende.
 */
async function cobrarNaStone(params: {
  pedido: {
    id: string;
    franchiseeId: string;
    totalAmount: number;
    dailyOrderNumber: number | null;
    posOrderId: string | null;
  };
  existente: boolean;
  terminal: TerminalStone | null;
  valorEmCentavos: number;
  forma: unknown;
}) {
  const { pedido, existente, terminal, valorEmCentavos, forma } = params;

  const cred = await credencialStone(pedido.franchiseeId);
  if (!cred) {
    return NextResponse.json(
      {
        error:
          "Esta loja ainda não cadastrou a chave da Stone. O lojista cadastra em Totem > Maquininhas > Stone pela nuvem.",
        code: "STONE_NAO_CONECTADO",
      },
      { status: 409 },
    );
  }
  if (!serviceRefererName()) {
    console.error("[Totem Stone Start] STONE_CONNECT_SERVICE_REFERER_NAME não configurada no servidor.");
    return NextResponse.json(
      { error: "Cobrança na Stone indisponível neste servidor. Chame um atendente.", code: "STONE_SEM_PARCEIRO" },
      { status: 503 },
    );
  }

  // ── Já existe cobrança Stone neste pedido? ─────────────────────────────
  if (existente && pedido.posOrderId) {
    const atual = await consultarPedidoStone(cred.chave, pedido.posOrderId);
    if (!atual.ok) {
      return NextResponse.json(
        {
          error: `Não deu para conferir a cobrança anterior na Stone (${atual.erro}). Tente de novo em alguns segundos.`,
          code: "STONE_INDISPONIVEL",
        },
        { status: 502 },
      );
    }
    let ordem = atual.dados;

    if (pedidoVivo(ordem) && !ordem.recusado) {
      await prisma.customerOrder.updateMany({
        where: { id: pedido.id, posOrderId: ordem.id },
        data: { posStatus: ESTADOS_DA_COBRANCA.noTerminal },
      });
      const visor = terminal ? { id: terminal.id, label: terminal.label } : null;
      return NextResponse.json({
        ok: true,
        reaproveitada: true,
        posOrderId: ordem.id,
        status: ESTADOS_DA_COBRANCA.noTerminal,
        terminal: visor,
        valor: pedido.totalAmount,
        modo: PROVEDOR_STONE,
        mensagem: visor ? `A cobrança já está na maquininha "${visor.label}".` : "A cobrança já está na maquininha.",
      });
    }

    // Recusada mas ainda aberta: derruba antes de mandar outra, senão a POS
    // fica com duas cobranças do mesmo pedido.
    if (pedidoVivo(ordem) && ordem.recusado) {
      const c = await cancelarPedidoStone(cred.chave, ordem.id);
      if (!c.ok) {
        return NextResponse.json(
          { error: `Não deu para tirar a cobrança recusada da maquininha (${c.erro}). Tente de novo.`, code: "STONE_INDISPONIVEL" },
          { status: 502 },
        );
      }
      ordem = c.ordem;
    }

    const efeito = await aplicarPedidoStoneNoTotem(pedido.id, cred.chave, ordem);
    if (efeito.pago) {
      return NextResponse.json({
        ok: true,
        pago: true,
        posOrderId: ordem.id,
        status: ESTADOS_DA_COBRANCA.pago,
        mensagem: "Este pedido já foi pago na maquininha.",
      });
    }
    // Morta (cancelada/fechada): segue e manda uma nova.
  }

  if (!terminal) {
    return NextResponse.json(
      {
        error: "Nenhuma maquininha vinculada a este totem. Escolha a maquininha do totem no painel, em Totem.",
        code: "TERMINAL_NAO_VINCULADO",
      },
      { status: 409 },
    );
  }

  if (!(await caixaEstaAberto(pedido.franchiseeId))) {
    return respostaDeCaixaFechado(pedido.dailyOrderNumber);
  }

  const { posTentativas: tentativa } = await prisma.customerOrder.update({
    where: { id: pedido.id },
    data: { posTentativas: { increment: 1 } },
    select: { posTentativas: true },
  });

  const identificacao = pedido.dailyOrderNumber
    ? `Pedido ${pedido.dailyOrderNumber}`
    : `Pedido ${pedido.id.slice(-6).toUpperCase()}`;
  const tipo = cred.fluxo === "DIRETO" ? (ehTipoDireto(forma) ? forma : cred.tipoDireto) : null;

  const r = await criarPedidoStone({
    chave: cred.chave,
    serial: terminal.externalId,
    referencia: pedido.id,
    valorEmCentavos,
    descricao: identificacao,
    nomeNaTela: `Totem - ${identificacao}`,
    tipo,
  });

  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      return NextResponse.json(
        {
          error: "A Stone recusou a chave da loja. O lojista precisa colar a chave de novo em Totem > Maquininhas.",
          code: "STONE_CHAVE_INVALIDA",
          detalhe: r.erro,
        },
        { status: 409 },
      );
    }
    // Sem resposta (timeout/5xx) o pedido pode ter nascido na Stone. Ele leva
    // a nossa referência: o webhook ou a reconsulta adotam ele pelo `code`.
    return NextResponse.json(
      { error: `A maquininha não aceitou a cobrança: ${r.erro}`, code: "STONE_FALHOU" },
      { status: 502 },
    );
  }

  // gatewayProvider NÃO entra aqui: acender a POS não é pagamento.
  await prisma.customerOrder.update({
    where: { id: pedido.id },
    data: {
      posOrderId: r.dados.id,
      posTerminalId: terminal.id,
      posStatus: ESTADOS_DA_COBRANCA.noTerminal,
      paymentMethod: FORMA_MAQUININHA,
    },
  });

  return NextResponse.json({
    ok: true,
    modo: PROVEDOR_STONE,
    posOrderId: r.dados.id,
    status: ESTADOS_DA_COBRANCA.noTerminal,
    tentativa,
    terminal: { id: terminal.id, label: terminal.label },
    valor: pedido.totalAmount,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { token, orderId, terminalId, forma } = await req.json().catch(() => ({}));

    const auth = await autenticarTotem(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const licenca = auth.licenca;

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
    }

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        franchiseeId: true,
        totalAmount: true,
        status: true,
        dailyOrderNumber: true,
        paymentPaidAt: true,
        posOrderId: true,
        posTerminalId: true,
      },
    });
    if (!pedido) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
    // Isolamento: o totem só cobra pedido da própria loja.
    if (pedido.franchiseeId !== licenca.franchiseeId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    if (pedido.paymentPaidAt) {
      return NextResponse.json(
        { error: "Este pedido já foi pago.", code: "JA_PAGO", pago: true },
        { status: 409 },
      );
    }
    if (pedido.status === "CANCELADO") {
      return NextResponse.json(
        { error: "Este pedido foi cancelado e não pode ser cobrado.", code: "PEDIDO_CANCELADO" },
        { status: 409 },
      );
    }

    const valorEmCentavos = Math.round((pedido.totalAmount || 0) * 100);
    if (valorEmCentavos <= 0) {
      return NextResponse.json(
        { error: "Pedido sem valor a cobrar.", code: "VALOR_INVALIDO" },
        { status: 409 },
      );
    }

    // ── TEF NO PINPAD DO TOTEM (PayGo, pelo Assistente) ──────────────────────
    // A licença com TEF ligado cobra no pinpad ligado ao computador do totem.
    // Aqui NÃO se marca nada que conte como pago: o servidor só devolve ao
    // totem o que ele precisa para pedir a venda ao Assistente local. Quem
    // carimba o pagamento é /api/totem/tef/resultado, com o "aprovado" do
    // pinpad em mãos (lib/tef-do-totem.ts). Pix fica com a maquininha.
    let tef: { segredoLocal: string } | null = null;
    try {
      tef = await tefDaLicenca(licenca.id);
    } catch (e: any) {
      console.error("[Totem Start] Não consegui conferir o TEF da licença:", e?.message);
      return NextResponse.json(
        { error: "Não deu para preparar o pinpad agora. Tente de novo em alguns segundos.", code: "TEF_INDISPONIVEL" },
        { status: 503 },
      );
    }
    if (tef && forma !== "pix") {
      if (!(await caixaEstaAberto(pedido.franchiseeId))) {
        return respostaDeCaixaFechado(pedido.dailyOrderNumber);
      }
      const { posTentativas } = await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: {
          posStatus: ESTADO_TEF_NO_PINPAD,
          posTentativas: { increment: 1 },
          paymentMethod: formaDoPedidoTef(null),
        },
        select: { posTentativas: true },
      });
      return NextResponse.json({
        success: true,
        modo: "TEF",
        pedidoId: pedido.id,
        valorCentavos: valorEmCentavos,
        segredoLocal: tef.segredoLocal,
        tentativa: posTentativas,
        instrucao: "Siga as instruções do pinpad",
      });
    }

    // ── STONE PELA NUVEM (Connect 2.0) ───────────────────────────────────────
    // Antes da fila do app: a fila pega QUALQUER maquininha com app da loja, e
    // um totem amarrado à Stone pela nuvem nunca chegaria aqui se a loja também
    // tiver uma maquininha com app.
    const stone = await caminhoDaStone(pedido, licenca.id, terminalId);
    if (stone) {
      return await cobrarNaStone({
        pedido,
        existente: stone.existente,
        terminal: stone.terminal,
        valorEmCentavos,
        forma,
      });
    }

    // ── MAQUININHA COM APP PRÓPRIO (PagBank) ─────────────────────────────────
    // A PagBank não deixa acender cobrança à distância: quem cobra é um app
    // Android rodando dentro do terminal Smart POS. O papel desta rota, nesse
    // caminho, é só colocar o pedido na fila — o app pergunta em
    // GET /api/pos/terminal/pendente e devolve o resultado em
    // POST /api/pos/terminal/resultado.
    //
    // A checagem vem ANTES do token do Mercado Pago de propósito: uma loja que
    // usa só PagBank não tem conta MP conectada, e exigir o token dela aqui
    // travaria a venda por uma credencial que ela não precisa ter.
    const terminalComApp = await prisma.posTerminal.findFirst({
      where: {
        franchiseeId: pedido.franchiseeId,
        active: true,
        provider: { in: [...PROVEDORES_COM_APP] },
        ...(terminalId && typeof terminalId === "string" ? { id: terminalId } : {}),
      },
      select: { id: true, label: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    });

    if (terminalComApp) {
      // Maquininha que não dá sinal há mais de dois minutos provavelmente está
      // desligada ou sem rede. Enfileirar a cobrança nela deixaria o cliente
      // olhando um visor apagado até o pedido expirar.
      const silencioEmMinutos = terminalComApp.lastSeenAt
        ? (Date.now() - terminalComApp.lastSeenAt.getTime()) / 60_000
        : Infinity;

      if (silencioEmMinutos > 2) {
        return NextResponse.json(
          {
            error: `A maquininha "${terminalComApp.label}" não está respondendo. Verifique se ela está ligada e conectada à internet.`,
            code: "TERMINAL_OFFLINE",
            ultimoContato: terminalComApp.lastSeenAt,
          },
          { status: 409 },
        );
      }

      if (!(await caixaEstaAberto(pedido.franchiseeId))) {
        return respostaDeCaixaFechado(pedido.dailyOrderNumber);
      }

      const { posTentativas } = await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: {
          posStatus: ESTADOS_DA_COBRANCA.aguardando,
          posTerminalId: terminalComApp.id,
          posTentativas: { increment: 1 },
          paymentMethod: FORMA_MAQUININHA,
        },
        select: { posTentativas: true },
      });

      return NextResponse.json({
        success: true,
        modo: "APP_NA_MAQUININHA",
        terminal: { id: terminalComApp.id, label: terminalComApp.label },
        tentativa: posTentativas,
        // A tela do totem espera exatamente isto para entrar na tela de espera.
        instrucao: `Pague na maquininha "${terminalComApp.label}"`,
      });
    }

    const loja = await prisma.user.findUnique({
      where: { id: pedido.franchiseeId },
      select: { mpAccessToken: true, storeName: true },
    });
    // Nunca o token global do FireHub: a maquininha é da loja e o dinheiro tem
    // que cair na conta dela.
    if (!loja?.mpAccessToken) {
      return NextResponse.json(
        {
          error:
            "Esta loja ainda não conectou a conta Mercado Pago. O lojista precisa conectar em Integrações > Mercado Pago antes de cobrar na maquininha.",
          code: "MP_NAO_CONECTADO",
        },
        { status: 409 },
      );
    }
    const accessToken = loja.mpAccessToken;

    // ── Já existe cobrança neste pedido? ─────────────────────────────────────
    // Esta conferência vem ANTES de escolher a maquininha de propósito. Se o
    // cliente já passou o cartão e o webhook não chegou, reconhecer isso não
    // pode depender de a maquininha continuar vinculada e em modo PDV: senão um
    // pedido JÁ PAGO responderia TERMINAL_NAO_VINCULADO e o cliente ficaria
    // parado na frente do totem com o valor debitado.
    // Id da Stone ("or_...") nunca vai para o Mercado Pago.
    if (pedido.posOrderId && !ehIdDePedidoStone(pedido.posOrderId)) {
      const atual = await consultarOrdem(accessToken, pedido.posOrderId);

      if (!atual.ok) {
        // Sem saber se a cobrança anterior ainda está viva, criar outra pode
        // deixar o cliente pagando duas vezes. Melhor mandar tentar de novo.
        return NextResponse.json(
          {
            error: `Não deu para conferir a cobrança anterior no Mercado Pago (${atual.erro}). Tente de novo em alguns segundos.`,
            code: "MP_INDISPONIVEL",
          },
          { status: 502 },
        );
      }

      const status = atual.dados.status;

      if (status === "processed") {
        // O webhook não chegou, mas o cartão passou. Confirmar aqui evita o
        // cliente parado na frente do totem esperando uma tela que não vem.
        // O gatewayProvider é carimbado só neste ponto, com pagamento provado:
        // fora daqui esse campo sozinho já conta como pedido recebido.
        await prisma.customerOrder.update({
          where: { id: pedido.id },
          data: {
            posStatus: status,
            gatewayProvider: "MERCADOPAGO_POINT",
            // Cartão comprovadamente passado na Point da loja: o rótulo do
            // botão da tela não manda mais nesta venda.
            paymentMethod: FORMA_MAQUININHA,
            ...(atual.dados.paymentId ? { gatewayPaymentId: atual.dados.paymentId } : {}),
          },
        });
        const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
        await confirmOrderPayment(pedido.id);
        return NextResponse.json({
          ok: true,
          pago: true,
          posOrderId: pedido.posOrderId,
          status,
          mensagem: "Este pedido já foi pago na maquininha.",
        });
      }

      if (!FINALIZADOS.has(status)) {
        await prisma.customerOrder.update({
          where: { id: pedido.id },
          data: { posStatus: status },
        });
        const visor = await maquininhaDaCobranca(
          pedido.franchiseeId,
          pedido.posTerminalId,
          atual.dados.terminalId,
        );
        return NextResponse.json({
          ok: true,
          reaproveitada: true,
          posOrderId: pedido.posOrderId,
          status,
          terminal: visor,
          valor: pedido.totalAmount,
          mensagem: visor
            ? `A cobrança já está no visor da "${visor.label}".`
            : "A cobrança já está no visor da maquininha.",
        });
      }
      // Cobrança anterior morreu (cancelada, expirada, recusada): segue e acende
      // uma nova, com número de tentativa diferente.
    }

    // ── Qual maquininha ───────────────────────────────────────────────────────
    // Preferência: a que a tela mandou, senão a que está amarrada a este totem.
    // O último recurso (loja com uma única maquininha ativa) evita travar a
    // venda por uma configuração que só tem uma resposta possível.
    let terminal:
      | { id: string; externalId: string; label: string; operatingMode: string | null }
      | null = null;

    if (terminalId && typeof terminalId === "string") {
      terminal = await prisma.posTerminal.findFirst({
        where: { id: terminalId, franchiseeId: licenca.franchiseeId, active: true },
        select: { id: true, externalId: true, label: true, operatingMode: true },
      });
      if (!terminal) {
        return NextResponse.json(
          { error: "Maquininha não encontrada nesta loja.", code: "TERMINAL_INVALIDO" },
          { status: 404 },
        );
      }
    } else {
      const vinculo = await prisma.totemLicense.findUnique({
        where: { id: licenca.id },
        select: {
          posTerminal: {
            select: { id: true, externalId: true, label: true, operatingMode: true, active: true },
          },
        },
      });
      if (vinculo?.posTerminal?.active) {
        terminal = vinculo.posTerminal;
      } else {
        const ativas = await prisma.posTerminal.findMany({
          where: { franchiseeId: licenca.franchiseeId, active: true },
          select: { id: true, externalId: true, label: true, operatingMode: true },
          take: 2,
        });
        if (ativas.length === 1) terminal = ativas[0];
      }
    }

    if (!terminal) {
      return NextResponse.json(
        {
          error:
            "Nenhuma maquininha vinculada a este totem. Escolha a maquininha do totem no painel, em Totem.",
          code: "TERMINAL_NAO_VINCULADO",
        },
        { status: 409 },
      );
    }

    // Só barra quando SABEMOS que está fora de PDV. Modo desconhecido (cadastro
    // antigo, sync que ainda não rodou) segue em frente: o MP recusa a criação e
    // o erro dele é mais preciso do que um palpite nosso.
    if (terminal.operatingMode && terminal.operatingMode !== "PDV") {
      return NextResponse.json(
        {
          error: `A maquininha "${terminal.label}" está em modo ${terminal.operatingMode} e ignora cobrança enviada pelo sistema. Ative o modo PDV no painel, em Maquininhas.`,
          code: "TERMINAL_FORA_DO_PDV",
        },
        { status: 409 },
      );
    }

    // Segundo ponto que acende cobrança nova: depois de escolhida a maquininha
    // e antes de queimar tentativa. Cobrança anterior morta que chegou até aqui
    // também passa por esta porta — reacender é cobrança nova.
    if (!(await caixaEstaAberto(pedido.franchiseeId))) {
      return respostaDeCaixaFechado(pedido.dailyOrderNumber);
    }

    // O contador sobe ANTES da chamada e vem do banco: a X-Idempotency-Key vale
    // 24h no MP, então repetir o número devolveria a ordem antiga em vez de
    // acender cobrança nova — e ele tem que vir do banco, não da memória, senão
    // um restart do servidor repete a chave.
    const { posTentativas: tentativa } = await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: { posTentativas: { increment: 1 } },
      select: { posTentativas: true },
    });

    const identificacao = pedido.dailyOrderNumber
      ? `Pedido ${pedido.dailyOrderNumber}`
      : `Pedido ${pedido.id.slice(-6).toUpperCase()}`;

    const r = await criarOrdemPoint({
      accessToken,
      terminalId: terminal.externalId,
      orderId: pedido.id,
      valorEmCentavos,
      descricao: loja.storeName ? `${identificacao} - ${loja.storeName}` : identificacao,
      tentativa,
    });

    if (!r.ok) {
      // Falha sem resposta (timeout, rede) ou 5xx: não dá para saber se a ordem
      // chegou a nascer do lado do MP. Devolver o contador faz a próxima
      // tentativa repetir a MESMA X-Idempotency-Key — se a ordem existir, o MP
      // devolve ela em vez de acender uma segunda cobrança e o cliente passar o
      // cartão duas vezes. O filtro por `posTentativas: tentativa` garante que
      // só o número que ESTA chamada queimou volte atrás.
      if (r.status === 0 || r.status >= 500) {
        await prisma.customerOrder.updateMany({
          where: { id: pedido.id, posTentativas: tentativa },
          data: { posTentativas: { decrement: 1 } },
        });
      }

      if (r.status === 401 || r.status === 403) {
        return NextResponse.json(
          {
            error:
              "A conexão da loja com o Mercado Pago expirou. O lojista precisa reconectar a conta em Integrações.",
            code: "MP_RECONECTAR",
            detalhe: r.erro,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: `A maquininha não aceitou a cobrança: ${r.erro}`, code: "MP_FALHOU" },
        { status: 502 },
      );
    }

    // gatewayProvider NÃO entra aqui. Acender o visor não é pagamento, e esse
    // campo sozinho já conta como recebido fora deste arquivo: o fechamento de
    // caixa (/api/cash-session) soma o pedido no esperado e a tela de pedidos
    // pinta o selo verde "Pago Online". Cobrança que expirou sem ninguém passar
    // o cartão viraria dinheiro que a loja acha que tem.
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: {
        posOrderId: r.dados.id,
        // Guarda o id do NOSSO cadastro, não o terminal_id do MP: é por ele que
        // a tela do operador chega ao nome ("Point do balcão") do visor certo.
        posTerminalId: terminal.id,
        posStatus: r.dados.status || "created",
        paymentMethod: FORMA_MAQUININHA,
      },
    });

    return NextResponse.json({
      ok: true,
      posOrderId: r.dados.id,
      status: r.dados.status,
      tentativa,
      terminal: { id: terminal.id, label: terminal.label },
      valor: pedido.totalAmount,
    });
  } catch (err) {
    console.error("[Totem Point Start] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
