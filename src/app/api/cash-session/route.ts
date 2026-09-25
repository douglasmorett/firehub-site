import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { FUSO_PADRAO } from "@/lib/fuso";
// Só o fechamento imprime sozinho. O cupom de abertura continua em
// lib/cupom-do-caixa, para o botão "imprimir de novo" do histórico.
import { cupomDeFechamentoDeCaixa } from "@/lib/cupom-do-caixa";
import { enfileirarCupomDoCaixa, assistenteOuvindoAFila } from "@/lib/imprimir-caixa";
// O esperado e o retrato do turno moram em lib/esperado-do-turno.ts: a 2ª via
// (api/cash-session/imprimir) também precisa deles, e rota não exporta função.
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";

async function getUser(session: any) {
  const u = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!u) return null;
  const targetId = u.ownerId || u.id;
  return { ...u, targetId };
}

// GET - retorna sessão aberta atual e pedidos presenciais do período
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Sessão aberta atual
  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  const dados = openSession
    ? await calcularEsperadoDoTurno(user.targetId, openSession)
    : {
        expected: { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, food99Online: 0, food99Coupons: 0, total: 0 },
        foraDaConferencia: { fiado: 0, fiadoQtd: 0, naoIdentificado: 0, naoIdentificadoQtd: 0, mesasAbertas: 0, mesasAbertasQtd: 0 },
        pendentesValor: 0, pendentesQuantidade: 0, movimentacaoEntradas: 0, movimentacaoSaidas: 0,
      };
  const { expected, foraDaConferencia, pendentesValor, pendentesQuantidade, movimentacaoEntradas, movimentacaoSaidas } = dados;

  // ── O DINHEIRO DA GAVETA PODE SER DE ANTES DESTE TURNO ─────────────────
  //
  // O esperado só conhece pedido feito DEPOIS da abertura do caixa. Quando a
  // loja vende com o caixa fechado — ou quando alguém abre um caixa novo sem
  // fechar o anterior — as cédulas desses pedidos continuam na gaveta, mas
  // não estão em conta nenhuma. O operador conta a gaveta inteira e o
  // fechamento acusa SOBRA do tamanho exato do que ficou de fora.
  //
  // Medido na Hakim Centro em 31/08/2026: 27 pedidos (R$ 1.351,14) ficaram
  // num turno encerrado sem conferência às 21:18; o turno seguinte abriu com
  // troco zero e fechou acusando R$ 827,71 de sobra.
  //
  // Não entra no esperado — seria adivinhar quanto daquilo ainda está na
  // gaveta. Vai para a tela como explicação da diferença.
  let foraDoTurno = { valor: 0, quantidade: 0, dinheiro: 0, desde: null as string | null };
  if (openSession) {
    const anterior = await prisma.cashSession.findFirst({
      where: {
        franchiseeId: user.targetId,
        status: "CLOSED",
        closedAt: { not: null, lte: openSession.openedAt },
      },
      orderBy: { closedAt: "desc" },
      select: { closedAt: true },
    });
    if (anterior?.closedAt && anterior.closedAt < openSession.openedAt) {
      const orfaos = await prisma.customerOrder.findMany({
        where: {
          franchiseeId: user.targetId,
          status: { notIn: ["CANCELADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
          createdAt: { gt: anterior.closedAt, lt: openSession.openedAt },
        },
        select: { totalAmount: true, paymentMethod: true, source: true, paymentPaidAt: true, gatewayProvider: true },
      });
      for (const o of orfaos) {
        const pm = (o.paymentMethod || "").toLowerCase();
        foraDoTurno.valor += o.totalAmount || 0;
        foraDoTurno.quantidade += 1;
        if ((pm.includes("dinheiro") || pm.includes("cash")) && !pm.includes("online")) {
          foraDoTurno.dinheiro += o.totalAmount || 0;
        }
      }
      foraDoTurno.desde = anterior.closedAt.toISOString();
    }
  }

  // Quanto foi contado na gaveta no último fechamento: é a sugestão de troco
  // de abertura do próximo turno. Abrir com zero enquanto a gaveta tem o
  // dinheiro do turno anterior é o que fabrica "sobra" no fechamento.
  const ultimoFechamento = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "CLOSED", closingCash: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { closingCash: true, closedAt: true },
  });

  return NextResponse.json({
    session: openSession,
    expected,
    cashOpen: user.cashOpen,
    // A tela mostra os dois números separados: o operador precisa ver QUANTO
    // saiu, não só um "esperado" já líquido que ele não consegue conferir.
    movimentacao: {
      entradas: Number(movimentacaoEntradas.toFixed(2)),
      saidas: Number(movimentacaoSaidas.toFixed(2)),
    },
    // Fora do esperado de propósito: é pedido que ninguém pagou (totem
    // abandonado, cartão recusado, senha do "pagar no caixa" que nunca voltou
    // ao balcão). Sair da conferência era o objetivo; sair da tela não —
    // pendência que o sistema esconde é pendência que ninguém cobra.
    pendentesDePagamento: {
      valor: Number(pendentesValor.toFixed(2)),
      quantidade: pendentesQuantidade,
    },
    // Vendas que existem, mas nao em cedula: fiado da equipe e forma de
    // pagamento que o sistema nao soube ler. Informacao, nunca conferencia.
    foraDaConferencia: {
      fiado: Number(foraDaConferencia.fiado.toFixed(2)),
      fiadoQtd: foraDaConferencia.fiadoQtd,
      naoIdentificado: Number(foraDaConferencia.naoIdentificado.toFixed(2)),
      naoIdentificadoQtd: foraDaConferencia.naoIdentificadoQtd,
      // Mesas ainda abertas: conta em andamento, sem dinheiro recebido.
      mesasAbertas: Number(foraDaConferencia.mesasAbertas.toFixed(2)),
      mesasAbertasQtd: foraDaConferencia.mesasAbertasQtd,
    },
    // Vendas de antes deste caixa abrir, cujo dinheiro pode estar na gaveta.
    foraDoTurno: {
      valor: Number(foraDoTurno.valor.toFixed(2)),
      quantidade: foraDoTurno.quantidade,
      dinheiro: Number(foraDoTurno.dinheiro.toFixed(2)),
      desde: foraDoTurno.desde,
    },
    ultimoFechamento: ultimoFechamento
      ? { cash: ultimoFechamento.closingCash || 0, em: ultimoFechamento.closedAt?.toISOString() || null }
      : null,
  });
}

// POST - abrir caixa com valor inicial
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { openingAmount = 0 } = await req.json();

  // ── ABRIR CAIXA ENCERRAVA O TURNO ANTERIOR EM SILÊNCIO ────────────────
  //
  // Este trecho era um `updateMany` seco: marcava CLOSED e ia embora. O turno
  // anterior ficava gravado com esperado 0, contado 0, `difference` 0 e
  // `closedBy` vazio — no histórico ele aparece como um turno que fechou
  // certinho. Na Hakim Centro, em 31/08/2026, foi assim que 27 pedidos
  // (R$ 1.351,14) e um troco de R$ 569,15 saíram da conferência sem que
  // ninguém tivesse contado nada.
  //
  // O efeito não para aí: o dinheiro daquele turno continua na gaveta e vira
  // SOBRA no fechamento do turno seguinte (foi R$ 827,71 no mesmo dia).
  //
  // Agora o esperado do turno interrompido é calculado e gravado, o fechamento
  // fica marcado como automático e `difference` fica NULO — não houve
  // conferência, e zero seria mentira. Quem abriu o caixa recebe de volta o
  // que ficou pendurado, para a tela poder avisar.
  const abertaAntes = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  let encerradaSemConferencia: { esperadoTotal: number; esperadoCash: number; abertoEm: string } | null = null;

  if (abertaAntes) {
    try {
      const d = await calcularEsperadoDoTurno(user.targetId, abertaAntes);
      const agora = new Date();
      await prisma.cashSession.update({
        where: { id: abertaAntes.id },
        data: {
          status: "CLOSED",
          closedAt: agora,
          expectedCash: Number(d.expected.cash.toFixed(2)),
          expectedDebit: Number(d.expected.debit.toFixed(2)),
          expectedCredit: Number(d.expected.credit.toFixed(2)),
          expectedPix: Number(d.expected.pix.toFixed(2)),
          expectedVoucher: Number(d.expected.voucher.toFixed(2)),
          expectedTotal: Number(d.expected.total.toFixed(2)),
          difference: null,
          closedBy: "sistema — encerrado ao abrir outro caixa",
          notes:
            `Turno encerrado automaticamente em ${agora.toLocaleString("pt-BR", { timeZone: user.storeTimezone || FUSO_PADRAO })} porque um caixa novo foi aberto. ` +
            `Ninguém conferiu a gaveta: o esperado ficou registrado e o contado não existe. ` +
            `O dinheiro deste turno continua na gaveta e vai aparecer como sobra no fechamento seguinte.`,
        },
      });
      encerradaSemConferencia = {
        esperadoTotal: Number(d.expected.total.toFixed(2)),
        esperadoCash: Number(d.expected.cash.toFixed(2)),
        abertoEm: abertaAntes.openedAt.toISOString(),
      };
    } catch (e: any) {
      console.error("[Caixa] Não consegui calcular o esperado do turno interrompido:", e?.message);
    }
  }

  // Rede de segurança: qualquer outra sessão aberta (duplicada por corrida)
  // continua sendo encerrada, como sempre foi.
  await prisma.cashSession.updateMany({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  // Criar nova sessão
  const cashSession = await prisma.cashSession.create({
    data: { franchiseeId: user.targetId, openingAmount: Number(openingAmount), status: "OPEN" },
  });

  // Marcar caixa como aberto no user e no owner
  await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    data: { cashOpen: true },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true, storeTimezone: true } });

  // ── A ABERTURA NÃO IMPRIME SOZINHA ─────────────────────────────────────
  //
  // Nasceu imprimindo junto com o fechamento (19/09/2026), pela ideia de que o
  // troco inicial no papel evita a "sobra" misteriosa do fechamento seguinte.
  // Na prática é bobina toda vez que alguém abre o caixa, e o troco inicial já
  // sai IMPRESSO no papel do fechamento, ao lado do que foi contado — que é
  // onde ele serve para alguma coisa. Decisão do dono no mesmo dia, depois de
  // ver o papel sair: abrir não precisa, só fechar.
  //
  // O cupom de abertura continua existindo e sai pelo botão "imprimir de novo"
  // do histórico do caixa (api/cash-session/imprimir): quem quiser o papel do
  // troco inicial tira um, quando quiser. O que sumiu foi a impressão
  // automática, não o documento.

  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: ownerInfo.storeTimezone || FUSO_PADRAO });
    const msg = `🟢 *Caixa Aberto*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *ABERTO* às ${timeStr} com R$ ${Number(openingAmount).toFixed(2).replace('.', ',')} de troco.\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  return NextResponse.json({ success: true, session: cashSession, encerradaSemConferencia });
}

// PUT - fechar caixa com valores contados
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json();
  const { closingCash, closingDebit, closingCredit, closingPix, closingVoucher,
    closingIfoodOnline, closingIfoodCoupons,
    closingFood99Online, closingFood99Coupons,
    justification } = body;

  // O que a TELA achava que era o esperado. Não entra na conta — serve só para
  // registrar no log quando ela estiver desatualizada (ver abaixo).
  const esperadoDaTela = {
    cash: Number(body.expectedCash || 0),
    total: Number(body.expectedTotal || 0),
  };

  // ── O CONFERIDO PRECISA FALAR A MESMA LÍNGUA DO ESPERADO ────────────────
  //
  // `expectedTotal` inclui as vendas já pagas online (iFood e cupons), que o
  // operador NÃO conta na gaveta — não há cédula para conferir. O conferido
  // somava só o que ele digitou, e a subtração acusava uma falta exatamente do
  // tamanho do online do dia: a tela mostrava "fecha certinho" (ela já somava
  // os dois) e o `difference` gravado na CashSession — o mesmo que vai no aviso
  // ao dono — dizia que faltou dinheiro. Loja com iFood fechava o caixa no
  // vermelho todo santo dia, sem ter perdido um centavo.
  //
  // `closingIfoodCoupons` saiu da soma: o cupom ja esta DENTRO do valor de cada
  // pedido que a plataforma pagou (entra em `ifoodOnline` pelo `valRepasse` do
  // GET). Soma-lo de novo aqui criava sobra falsa do tamanho dos cupons do dia
  // -- R$ 528,11 no turno de 27/08. A linha continua na tela como informacao;
  // ela so nao pode entrar na conta duas vezes.
  //
  // `closingFood99Online` entra pelo MESMO motivo do iFood, e esquecer isto
  // reproduziria o bug inteiro: o `expectedTotal` ja soma o online do 99Food,
  // entao deixa-lo de fora do conferido acusaria falta do tamanho exato do
  // que o 99 pagou no dia. `closingFood99Coupons` fica de fora pela mesma
  // razao dos cupons do iFood: o cupom ja esta DENTRO do valor do pedido.
  const totalInformed = (closingCash || 0) + (closingDebit || 0) + (closingCredit || 0) +
    (closingPix || 0) + (closingVoucher || 0) +
    (closingIfoodOnline || 0) + (closingFood99Online || 0);

  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  let difference = 0;
  // O que o cupom do fechamento precisa. Preenchido dentro do if, impresso
  // depois de os pedidos da rua serem finalizados — o papel diz quantos foram.
  let paraOCupom: {
    esperado: { cash: number; debit: number; credit: number; pix: number; voucher: number; total: number };
    abertoEm: Date; trocoInicial: number;
    // O retrato do turno vai junto: é o servidor que apura, no mesmo instante
    // em que grava o fechamento, para o papel não poder divergir do banco.
    doServidor: Awaited<ReturnType<typeof calcularEsperadoDoTurno>>;
  } | null = null;
  if (openSession) {
    // ── O ESPERADO É RECALCULADO AQUI, NO SERVIDOR ─────────────────────────
    //
    // Até 19/09/2026 estes números vinham do CORPO DA REQUISIÇÃO — ou seja, do
    // que a tela do fechamento tinha em mãos. E a tela calcula uma vez, quando
    // carrega. Num turno que abre 23h e fecha 6h30, tudo que aconteceu no meio
    // ficava de fora do "esperado": pedido novo, sangria, reforço — e,
    // principalmente, PEDIDO CANCELADO. Cancelar um pedido depois de a tela
    // abrir não o tirava da conta, e o caixa fechava cobrando da gaveta um
    // valor que ninguém recebeu. Foi a queixa do dono sobre o caixa da Hakim.
    //
    // É a mesma classe do que já foi corrigido em outras contas deste arquivo:
    // valor que o cliente manda é intenção, não prova. Quem soma é o servidor,
    // no instante do fechamento, pela MESMA função que a tela consulta — então
    // a tela nunca mostra um número que o fechamento não vá reproduzir.
    // `retrato`: o papel do fechamento lista entregadores, cancelados e os
    // mais vendidos — consulta que a tela, que chama isto a cada abertura do
    // fechamento, não precisa pagar.
    const doServidor = await calcularEsperadoDoTurno(user.targetId, openSession, { retrato: true });
    const expectedCash = Number(doServidor.expected.cash.toFixed(2));
    const expectedDebit = Number(doServidor.expected.debit.toFixed(2));
    const expectedCredit = Number(doServidor.expected.credit.toFixed(2));
    const expectedPix = Number(doServidor.expected.pix.toFixed(2));
    const expectedVoucher = Number(doServidor.expected.voucher.toFixed(2));
    const expectedTotal = Number(doServidor.expected.total.toFixed(2));
    difference = Number((totalInformed - expectedTotal).toFixed(2));
    paraOCupom = {
      esperado: { cash: expectedCash, debit: expectedDebit, credit: expectedCredit, pix: expectedPix, voucher: expectedVoucher, total: expectedTotal },
      abertoEm: openSession.openedAt,
      trocoInicial: Number(openSession.openingAmount || 0),
      doServidor,
    };

    // Tela velha não é erro — é aviso. Se a divergência for grande, o operador
    // fechou olhando um número que já não existia, e é bom saber disso depois.
    const defasagem = Math.abs(esperadoDaTela.total - expectedTotal);
    if (defasagem > 0.01) {
      console.warn(
        `[Caixa] Tela desatualizada ao fechar ${openSession.id}: ela mostrava esperado R$ ${esperadoDaTela.total.toFixed(2)}, ` +
        `o servidor apurou R$ ${expectedTotal.toFixed(2)} (defasagem R$ ${defasagem.toFixed(2)}). Gravado o do servidor.`
      );
    }

    await prisma.cashSession.update({
      where: { id: openSession.id },
      data: {
        status: "CLOSED", closedAt: new Date(),
        closingCash: Number(closingCash || 0),
        closingDebit: Number(closingDebit || 0),
        closingCredit: Number(closingCredit || 0),
        closingPix: Number(closingPix || 0),
        closingVoucher: Number(closingVoucher || 0),
        expectedCash: Number(expectedCash || 0),
        expectedDebit: Number(expectedDebit || 0),
        expectedCredit: Number(expectedCredit || 0),
        expectedPix: Number(expectedPix || 0),
        expectedVoucher: Number(expectedVoucher || 0),
        expectedTotal: Number(expectedTotal || 0),
        difference,
        justification: justification || null,
        closedBy: session.user?.name || session.user?.email || "",
      },
    });
  }

  // 🔧 Auto-finalizar pedidos travados em SAIU_ENTREGA com mais de 3h
  // Isso limpa pedidos que nunca foram confirmados como entregues pelo motoboy
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  let finalizadosNoFechamento = 0;
  try {
    const stuckResult = await prisma.customerOrder.updateMany({
      where: {
        franchiseeId: user.targetId,
        status: "SAIU_ENTREGA",
        // ── TODOS, e não só os de mais de 3h ─────────────────────────────
        //
        // O corte de 3h deixava para trás justamente o que fecha o turno: o
        // pedido que saiu às 6h e o caixa fechou às 6h30. Ele continuava
        // SAIU_ENTREGA para sempre — e, como o esperado do caixa soma todo
        // pedido não cancelado, o dinheiro dele já tinha sido cobrado da
        // gaveta no fechamento (R$ 112,29 em dinheiro no turno da Hakim de
        // 18/09) sem nunca virar venda concluída.
        //
        // Fechar o caixa é dizer "o turno acabou". Decisão do dono
        // (19/09/2026): tudo que estava na rua é dado por entregue junto, e a
        // tela avisa QUANTOS são antes de o operador confirmar — ver
        // GET /api/cash-session, campo `saiuParaEntrega`.
        ...(openSession ? { createdAt: { gte: openSession.openedAt } } : { createdAt: { lt: threeHoursAgo } }),
        // ── PEDIDO DE MESA NÃO ESTÁ "NA RUA" ─────────────────────────────
        //
        // O KDS dá a mesa por pronta como dá a retirada — SAIU_ENTREGA —, e
        // este updateMany a levava junto para ENTREGUE com a mesa AINDA
        // aberta. Hakim Centro, mesa 4: aberta desde 06/09/2026 com o pedido
        // #76 "finalizado" no fechamento do caixa, sem ninguém ter pago —
        // cancelar respondia "Este pedido já foi finalizado" e a mesa ficou
        // 459 h na tela. O dinheiro da mesa entra pelas baixas quando ELA
        // fecha (lib/esperado-do-turno.ts), e é o fechamento dela que dá os
        // pedidos por entregues (table-sessions/[id]/close).
        tableSessionId: null,
      },
      data: { status: "ENTREGUE", updatedAt: new Date() },
    });
    finalizadosNoFechamento = stuckResult.count;
    if (stuckResult.count > 0) {
      console.log(`[CashSession Close] ✅ ${stuckResult.count} pedidos que estavam na rua foram dados como entregues junto com o caixa`);
    }
  } catch (err) {
    console.error("[CashSession Close] Erro ao finalizar pedidos travados:", err);
  }

  // Marcar caixa como fechado no user e no owner
  await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    // `cashClosedAt` encerra o turno dos garçons pelo link: sessão emitida
    // antes deste instante é recusada e o celular volta para o login.
    data: { cashOpen: false, cashClosedAt: new Date() },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true, storeTimezone: true } });

  // ── O PAPEL DO FECHAMENTO ──────────────────────────────────────────────
  //
  // Esperado ao lado do contado, forma por forma. Sem o lado a lado, "faltou
  // R$ 274,32" não diz em qual forma faltou e o lojista não tem por onde
  // começar a procurar (foi a dúvida do dono no caixa da Hakim, 19/09/2026).
  // Sai depois da finalização dos pedidos da rua, para o papel poder dizer
  // quantos foram dados como entregues junto com o caixa.
  //
  // ── QUEM DECIDE SE IMPRIME É QUEM ESTÁ FECHANDO ────────────────────────
  //
  // O papel saía sempre. Numa loja que fecha o caixa três vezes por dia (troca
  // de turno) isso é bobina gasta sem ninguém pedir, e numa loja sem
  // impressora de caixa é fila de impressão enchendo com papel que não sai.
  // Agora a tela pergunta antes. `imprimir` ausente continua imprimindo: é o
  // que toda versão anterior do painel manda, e sumir com o papel de quem já
  // conta com ele seria pior do que gastar bobina.
  const querImprimir = body?.imprimir !== false;
  if (openSession && paraOCupom && querImprimir) {
    try {
      await enfileirarCupomDoCaixa(user.targetId, cupomDeFechamentoDeCaixa({
        sessionId: openSession.id,
        loja: ownerInfo?.storeName || "",
        fuso: ownerInfo?.storeTimezone || FUSO_PADRAO,
        operador: session.user?.name || session.user?.email || "",
        abertoEm: paraOCupom.abertoEm,
        fechadoEm: new Date(),
        trocoInicial: paraOCupom.trocoInicial,
        valores: {
          esperado: paraOCupom.esperado,
          contado: {
            cash: Number(closingCash || 0), debit: Number(closingDebit || 0),
            credit: Number(closingCredit || 0), pix: Number(closingPix || 0),
            voucher: Number(closingVoucher || 0),
          },
          diferenca: difference,
          online: { ifood: Number(closingIfoodOnline || 0), food99: Number(closingFood99Online || 0) },
          onlineEsperado: Number((paraOCupom.doServidor.expected.ifoodOnline + paraOCupom.doServidor.expected.food99Online).toFixed(2)),
          movimentacoes: {
            entradas: paraOCupom.doServidor.movimentacaoEntradas,
            saidas: paraOCupom.doServidor.movimentacaoSaidas,
          },
          foraDaConferencia: paraOCupom.doServidor.foraDaConferencia,
          pendentes: {
            valor: paraOCupom.doServidor.pendentesValor,
            quantidade: paraOCupom.doServidor.pendentesQuantidade,
          },
          detalhe: paraOCupom.doServidor.detalhe,
          finalizadosNoFechamento,
          justificativa: justification || null,
        },
      }), session.user?.name || session.user?.email || "");
    } catch (e: any) {
      console.error("[Caixa] Não consegui enfileirar o cupom de fechamento:", e?.message);
    }
  }

  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: ownerInfo.storeTimezone || FUSO_PADRAO });
    const msg = `🔴 *Caixa Fechado*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *FECHADO* às ${timeStr}.\n\nDiferença no caixa: R$ ${difference.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  // A tela precisa saber se o papel vai sair de verdade: sem o Assistente
  // puxando a fila, o fechamento fica parado nela (ver assistenteOuvindoAFila).
  const impressao = openSession && paraOCupom && querImprimir
    ? { assistenteOuvindo: await assistenteOuvindoAFila(user.targetId) }
    : undefined;

  return NextResponse.json({ success: true, difference, ...(impressao ? { impressao } : {}) });
}
