import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";

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

  // Se tem sessão aberta, calcular os valores esperados com base em TODOS os pedidos do período
  let expected = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, total: 0 };
  // Pedidos do turno que ainda não têm pagamento nenhum. Ficam FORA do
  // esperado (ver o porquê no laço abaixo) e voltam aqui só para o lojista
  // saber que existem — informação, nunca conferência.
  let pendentesValor = 0;
  let pendentesQuantidade = 0;
  let movimentacaoEntradas = 0;
  let movimentacaoSaidas = 0;
  if (openSession) {
    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: user.targetId,
        // CRIANDO_IA é rascunho que o assistente ainda está montando: não é
        // pedido, não tem valor fechado e não pode entrar em conta nenhuma.
        // AGUARDANDO_PAGAMENTO continua vindo de propósito, para ser separado
        // no laço em vez de sumir sem explicação.
        status: { notIn: ["CANCELADO", "CRIANDO_IA"] },
        createdAt: { gte: openSession.openedAt },
      },
      select: { status: true, paymentMethod: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true, discountTotal: true, discountMerchant: true, notes: true },
    });

    for (const o of orders) {
      const pm = (o.paymentMethod || "").toLowerCase();
      const src = ((o as any).source || "").toUpperCase();

      const channelDisc = (o.discountIfood && o.discountIfood > 0)
        ? o.discountIfood
        : (o.discountTotal && o.discountMerchant && o.discountTotal > o.discountMerchant
            ? o.discountTotal - o.discountMerchant
            : (o.notes?.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)?.[1]
                ? parseFloat(o.notes.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)![1].replace(",", "."))
                : 0));
      const val = (o.totalAmount || 0) + channelDisc;

      // ── PEDIDO SEM PAGAMENTO NÃO É DINHEIRO NA GAVETA ───────────────────
      //
      // O esperado somava todo pedido que não estivesse CANCELADO, e
      // AGUARDANDO_PAGAMENTO estava nesse bolo. O pedido do totem NASCE nesse
      // status, antes de o cartão passar (/api/totem/order), e nada o cancela
      // depois: quem desiste na tela da maquininha, tem o cartão recusado ou
      // vai embora com a senha do "pagar no caixa" deixa o pedido parado aí
      // para sempre. Como "Cartão (Maquininha)" e "Pagar no caixa" não casam
      // com nenhuma forma conhecida, ele caía no `else` lá embaixo e virava
      // DINHEIRO esperado — o fechamento cobrava da gaveta um valor que
      // ninguém entregou e o operador via "Faltam R$ X" sem pista nenhuma do
      // motivo. Num dia de totem isso não é um pedido: são vários.
      //
      // É a mesma classe de defeito já corrigida no DRE (ver o comentário do
      // saldo fantasma da Hakim Centro em src/app/store/financeiro/
      // DREClient.tsx): nome de forma de pagamento é intenção, não prova. Aqui
      // a prova é o status — quem paga sai de AGUARDANDO_PAGAMENTO dentro de
      // confirmOrderPayment, seja pelo webhook, pela maquininha ou pela mão do
      // atendente. Todo o resto do sistema (KDS, fila de impressão, poll,
      // numeração) já ignorava esse status; o caixa era o único que somava.
      //
      // Some do esperado, mas não some da tela: volta em `pendentesDePagamento`
      // para o lojista enxergar o que ficou pendurado sem que isso vire
      // diferença de caixa.
      if (o.status === "AGUARDANDO_PAGAMENTO") {
        pendentesValor += val;
        pendentesQuantidade += 1;
        continue;
      }

      // ── VENDA DE SALÃO NÃO É PAGAMENTO ONLINE ───────────────────────────
      //
      // `paymentPaidAt` diz que o pedido FOI PAGO — não diz por onde o dinheiro
      // entrou. Ele sozinho ligava `isOnlinePayment` e, como o único source
      // isento era "PDV", toda venda do totem caía em `expected.ifoodOnline`,
      // a linha travada de "iFood (Pago Online)" que a tela de fechamento soma
      // sozinha no total. O estrago era duplo e acontecia todo dia:
      //
      //   • cartão passado na Point DA PRÓPRIA LOJA sumia de crédito/débito.
      //     Ficava impossível conferir contra o extrato da adquirente e, quando
      //     o operador digitava esse extrato, o valor era contado duas vezes —
      //     sobra fantasma do tamanho exato das vendas do totem no cartão;
      //   • dinheiro vivo do "pagar no caixa" (que o atendente confirma e vira
      //     "Dinheiro (recebido por ...)") saía do esperado em dinheiro, porque
      //     este teste vem ANTES do `pm.includes("dinheiro")`. A gaveta fechava
      //     "certinha" faltando exatamente esse valor — e é justamente essa
      //     conferência que existe para pegar furo.
      //
      // O totem é venda de salão igual ao PDV: o cliente está aqui dentro e o
      // cartão passa na maquininha da loja. A exceção de "PDV" já provava que
      // o autor sabia disso; só faltou o totem entrar na mesma lista. Para
      // venda de salão quem manda é a forma de pagamento, não o carimbo de pago.
      const ehVendaDeSalao = src === "PDV" || src === "TOTEM";

      // Identificar pagamentos ON-LINE (iFood Pago Online, PIX Online, Crédito Online via App)
      // Pagamentos Online NÃO passam pelas maquininhas da loja nem dinheiro de motoboy!
      const isOnlinePayment =
        pm.includes("online") ||
        pm.includes("prepaid") ||
        pm.includes("ifood") ||
        pm.includes("pago_online") ||
        (!ehVendaDeSalao && !!(o.paymentPaidAt || o.gatewayProvider)) ||
        (src === "IFOOD" && !pm.includes("dinheiro") && !pm.includes("debito") && !pm.includes("débito") && !pm.includes("credito") && !pm.includes("crédito") && !pm.includes("maquininha") && !pm.includes("cobrar"));

      if (src === "IFOOD" && isOnlinePayment) {
        expected.ifoodOnline += val;
      } else if (isOnlinePayment && !ehVendaDeSalao) {
        expected.ifoodOnline += val;
      } else if (pm.includes("dinheiro") || pm.includes("cash")) {
        expected.cash += val;
      } else if (pm.includes("débito") || pm.includes("debito") || pm.includes("debit")) {
        expected.debit += val;
      } else if (pm.includes("crédito") || pm.includes("credito") || pm.includes("credit")) {
        expected.credit += val;
      } else if (pm.includes("pix")) {
        expected.pix += val;
      } else if (pm.includes("voucher") || pm.includes("vale") || pm.includes("meal") || pm.includes("food")) {
        expected.voucher += val;
      } else if (pm.includes("maquininha") || pm.includes("cartão") || pm.includes("cartao")) {
        // Cartão sem o tipo: o Mercado Pago Point não devolve se foi crédito ou
        // débito, então o pedido do totem fica com o genérico "Cartão
        // (Maquininha)" e nenhuma das faixas acima o reconhecia. Cair no `else`
        // abaixo era o pior destino possível — venda de cartão exigida da
        // gaveta em espécie. Vai para crédito, que é onde a maioria dessas
        // passagens de fato cai e, principalmente, é uma linha que o operador
        // consegue conferir contra o extrato da adquirente.
        // (Quando o app da maquininha informa o tipo, o paymentMethod já vem
        // "Cartão CRÉDITO/DÉBITO (maquininha)" e as faixas acima o pegam antes.)
        expected.credit += val;
      } else {
        expected.cash += val;
      }

      expected.total += val;

      // Somar desconto custeado pelo iFood (cupons iFood) — apenas informativo
      if (o.discountIfood && o.discountIfood > 0) {
        expected.ifoodCoupons += o.discountIfood;
      }
    }
    // Adicionar o troco inicial ao dinheiro esperado
    expected.cash += openSession.openingAmount;

    // ── Sangria e reforço lançados durante o turno ─────────────────────────
    //
    // Sem isto, o esperado era "pedidos em dinheiro + troco inicial" e mais
    // nada: uma sangria de R$ 200 aparecia no fechamento como R$ 200 de FALTA,
    // sem nenhuma explicação no sistema. Diferença que aparece todo dia sem
    // motivo é diferença que o lojista aprende a ignorar — e aí o caixa deixa
    // de conferir qualquer coisa.
    //
    // Envelopado em try/catch porque a tabela pode não existir ainda (boot que
    // não conseguiu criar): o caixa continua funcionando como sempre funcionou,
    // só sem a parcela nova.
    try {
      if (await temEstruturaDeCaixa()) {
        const movs = await prisma.cashMovement.findMany({
          where: { cashSessionId: openSession.id, franchiseeId: user.targetId },
          select: { tipo: true, valor: true },
        });
        for (const m of movs) {
          if (m.tipo === "ENTRADA") { movimentacaoEntradas += m.valor; expected.cash += m.valor; }
          else { movimentacaoSaidas += m.valor; expected.cash -= m.valor; }
        }
        expected.total += movimentacaoEntradas - movimentacaoSaidas;
      }
    } catch (e: any) {
      console.error("[Caixa] Não consegui somar as movimentações do turno:", e?.message);
    }
  }

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
  });
}

// POST - abrir caixa com valor inicial
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { openingAmount = 0 } = await req.json();

  // Fechar qualquer sessão aberta anterior
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

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true } });
  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const msg = `🟢 *Caixa Aberto*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *ABERTO* às ${timeStr} com R$ ${Number(openingAmount).toFixed(2).replace('.', ',')} de troco.\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  return NextResponse.json({ success: true, session: cashSession });
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
    expectedCash, expectedDebit, expectedCredit, expectedPix, expectedVoucher, expectedTotal,
    justification } = body;

  // ── O CONFERIDO PRECISA FALAR A MESMA LÍNGUA DO ESPERADO ────────────────
  //
  // `expectedTotal` inclui as vendas já pagas online (iFood e cupons), que o
  // operador NÃO conta na gaveta — não há cédula para conferir. O conferido
  // somava só o que ele digitou, e a subtração acusava uma falta exatamente do
  // tamanho do online do dia: a tela mostrava "fecha certinho" (ela já somava
  // os dois) e o `difference` gravado na CashSession — o mesmo que vai no aviso
  // ao dono — dizia que faltou dinheiro. Loja com iFood fechava o caixa no
  // vermelho todo santo dia, sem ter perdido um centavo.
  const totalInformed = (closingCash || 0) + (closingDebit || 0) + (closingCredit || 0) +
    (closingPix || 0) + (closingVoucher || 0) +
    (closingIfoodOnline || 0) + (closingIfoodCoupons || 0);
  const difference = totalInformed - (expectedTotal || 0);

  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  if (openSession) {
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
        difference: Number(difference.toFixed(2)),
        justification: justification || null,
        closedBy: session.user?.name || session.user?.email || "",
      },
    });
  }

  // 🔧 Auto-finalizar pedidos travados em SAIU_ENTREGA com mais de 3h
  // Isso limpa pedidos que nunca foram confirmados como entregues pelo motoboy
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  try {
    const stuckResult = await prisma.customerOrder.updateMany({
      where: {
        franchiseeId: user.targetId,
        status: "SAIU_ENTREGA",
        createdAt: { lt: threeHoursAgo },
      },
      data: { status: "ENTREGUE", updatedAt: new Date() },
    });
    if (stuckResult.count > 0) {
      console.log(`[CashSession Close] ✅ ${stuckResult.count} pedidos SAIU_ENTREGA finalizados automaticamente`);
    }
  } catch (err) {
    console.error("[CashSession Close] Erro ao finalizar pedidos travados:", err);
  }

  // Marcar caixa como fechado no user e no owner
  await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    data: { cashOpen: false },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true } });
  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const msg = `🔴 *Caixa Fechado*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *FECHADO* às ${timeStr}.\n\nDiferença no caixa: R$ ${Number(difference.toFixed(2)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  return NextResponse.json({ success: true, difference });
}
