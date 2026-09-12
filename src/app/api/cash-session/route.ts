import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cupomBancadoPelo99, ehDo99Food } from "@/lib/cupom-do-parceiro";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { FUSO_PADRAO } from "@/lib/fuso";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";

async function getUser(session: any) {
  const u = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!u) return null;
  const targetId = u.ownerId || u.id;
  return { ...u, targetId };
}

/**
 * Esperado do turno: o que a loja vendeu desde que este caixa foi aberto,
 * separado por onde o dinheiro entra.
 *
 * Virou função porque a ABERTURA de um caixa novo também precisa disto: ela
 * encerra o turno anterior e, sem calcular, gravava um turno inteiro com tudo
 * zerado (ver o comentário no POST).
 */
async function calcularEsperadoDoTurno(
  targetId: string,
  openSession: { id: string; openedAt: Date; openingAmount: number }
) {
  // Se tem sessão aberta, calcular os valores esperados com base em TODOS os pedidos do período
  // `food99Online` e `food99Coupons` sao novos. Ficavam os dois dentro das
  // linhas do iFood — o dinheiro pago online no 99Food somava em
  // `ifoodOnline`, e o cupom bancado pelo 99 nao aparecia em lugar nenhum,
  // porque o 99Food nao manda campo equivalente ao `discountIfood`.
  let expected = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, food99Online: 0, food99Coupons: 0, total: 0 };
  // -- VENDA QUE NUNCA VIRA CEDULA ---------------------------------------
  //
  // O `else` do fim da cascata mandava para DINHEIRO tudo que nao casasse com
  // uma forma conhecida. E onde caia a refeicao fiada da equipe ("Conta
  // Funcionario"), o pedido de mesa (que nasce "N/A" e nunca recebe a forma
  // real) e qualquer rotulo novo que uma integracao invente. Medido no banco
  // em 28/08/2026: R$ 4.175,24 em 45 dias exigidos da gaveta sem que uma
  // cedula tivesse entrado -- R$ 3.533,96 so de refeicao de funcionario.
  //
  // O operador via "Faltam R$ X" todo dia, sem pista do motivo. Falta que
  // aparece sempre e nunca se explica e falta que o lojista aprende a ignorar,
  // e ai o caixa deixa de conferir qualquer coisa.
  //
  // Sai da conferencia e volta em linha propria -- mesmo tratamento que ja foi
  // dado a `pendentesDePagamento`. Some da conta, nao da tela.
  // `mesasAbertas`: pedidos de mesa cuja mesa AINDA não fechou. Não há dinheiro
  // deles em lugar nenhum ainda — entram como informação, nunca conferência.
  let foraDaConferencia = { fiado: 0, fiadoQtd: 0, naoIdentificado: 0, naoIdentificadoQtd: 0, mesasAbertas: 0, mesasAbertasQtd: 0 };
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
        franchiseeId: targetId,
        // CRIANDO_IA é rascunho que o assistente ainda está montando: não é
        // pedido, não tem valor fechado e não pode entrar em conta nenhuma.
        // AGUARDANDO_PAGAMENTO continua vindo de propósito, para ser separado
        // no laço em vez de sumir sem explicação.
        status: { notIn: ["CANCELADO", "CRIANDO_IA"] },
        createdAt: { gte: openSession.openedAt },
      },
      select: { status: true, paymentMethod: true, paymentMethods: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true, discountTotal: true, discountMerchant: true, notes: true, tableSessionId: true, openDeliveryChannel: true, discountDetails: true },
    });

    // Uma parte de pagamento (do balcão dividido ou da baixa da mesa) na sua
    // forma. A mesma régua do laço abaixo, para as duas nunca divergirem.
    const somarParte = (metodo: string, v: number) => {
      const m = metodo.toLowerCase();
      if (m.includes("dinheiro") || m.includes("cash")) expected.cash += v;
      else if (m.includes("débito") || m.includes("debito") || m.includes("debit")) expected.debit += v;
      else if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) expected.credit += v;
      else if (m.includes("pix")) expected.pix += v;
      else if (m.includes("voucher") || m.includes("vale") || m.includes("meal") || m.includes("food")) expected.voucher += v;
      else if (m.includes("cart") || m.includes("maquin")) expected.credit += v;
      else {
        foraDaConferencia.naoIdentificado += v;
        foraDaConferencia.naoIdentificadoQtd += 1;
      }
    };

    for (const o of orders) {
      const pm = (o.paymentMethod || "").toLowerCase();
      const src = ((o as any).source || "").toUpperCase();

      // ── PEDIDO DE MESA: O DINHEIRO ESTÁ NA MESA, NÃO NO PEDIDO ──────────
      //
      // O pedido de mesa nasce com paymentMethod "N/A" e nunca recebe a forma
      // real: a baixa (Dinheiro, Débito, Crédito, Pix) é gravada na SESSÃO da
      // mesa, no fechamento dela, junto com a taxa de serviço. Contar o pedido
      // aqui pela forma dele é contar "N/A" — foi assim que o fechamento da
      // Pastel da Paulista em 09/09 mostrou 26 pedidos "não identificados" e
      // R$ 1.416,69 fora da conferência, com a caixa sem conseguir fechar.
      //
      // Então o pedido de mesa sai deste laço. Mesa já FECHADA: o valor entra
      // pelas baixas da sessão, por forma, no bloco logo depois do laço. Mesa
      // ainda ABERTA: ninguém pagou nada ainda; vira a linha "mesas abertas",
      // informação para o lojista saber que existe conta em andamento.
      if ((o as any).tableSessionId) {
        const fechado = o.status === "ENTREGUE" || o.status === "ENCERRADO";
        if (!fechado) {
          foraDaConferencia.mesasAbertas += o.totalAmount || 0;
          foraDaConferencia.mesasAbertasQtd += 1;
        }
        continue;
      }

      // ── PAGAMENTO DIVIDIDO (BALCÃO) ─────────────────────────────────────
      //
      // Metade no Pix, metade em dinheiro: cada parte vai para a SUA linha da
      // conferência. Ler o `paymentMethod` de texto ("Dividido: Pix R$ 20,00 +
      // Dinheiro R$ 15,00") pela régua de palavras jogaria o pedido inteiro na
      // primeira forma que casasse.
      const partes = lerPagamentos((o as any).paymentMethods);
      if (partes.length > 0) {
        expected.total += o.totalAmount || 0;
        for (const p of partes) somarParte(p.method, p.amount);
        continue;
      }

      const channelDisc = (o.discountIfood && o.discountIfood > 0)
        ? o.discountIfood
        : (o.discountTotal && o.discountMerchant && o.discountTotal > o.discountMerchant
            ? o.discountTotal - o.discountMerchant
            : (o.notes?.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)?.[1]
                ? parseFloat(o.notes.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)![1].replace(",", "."))
                : 0));
      // -- O CUPOM DA PLATAFORMA NAO ENTRA NA GAVETA -----------------------
      //
      // Era `val = totalAmount + channelDisc` para TODAS as linhas: o desconto
      // bancado pelo iFood voltava para dentro do valor do pedido e passava a
      // ser cobrado de quem confere. Em 45 dias, R$ 43.245,98 somados ao
      // esperado, dos quais R$ 7.522,67 foram parar em linha que alguem tem
      // que conferir de verdade -- gaveta, debito, credito e pix. O cliente
      // que pagou R$ 30 com R$ 10 de cupom entrega R$ 20; a gaveta nao sabe o
      // que e cupom.
      //
      // `valReal` e o que a pessoa entrega -- e ele que vai para as linhas
      // conferiveis. `valRepasse` so existe na linha do iFood pago online, que
      // e informativa e travada na tela: ali o cupom faz parte do que a
      // plataforma repassa.
      const valReal = o.totalAmount || 0;
      const valRepasse = valReal + channelDisc;

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
        pendentesValor += valReal;
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

      // Fiado: consumo da equipe e venda anotada. Tem ficha propria e e
      // acertado depois -- nunca passa pela gaveta no fechamento do dia.
      const ehFiado = pm.includes("funcion") || pm.includes("fiado");

      if (ehDo99Food(o as any) && isOnlinePayment) {
        // Linha propria: o lojista confere o repasse do 99Food contra o extrato
        // DELES, nao contra o do iFood. Somados, os dois numeros nao conferem
        // com nenhum dos dois extratos.
        expected.food99Online += valRepasse;
        expected.total += valRepasse;
      } else if (src === "IFOOD" && isOnlinePayment) {
        expected.ifoodOnline += valRepasse;
        expected.total += valRepasse;
      } else if (isOnlinePayment && !ehVendaDeSalao) {
        expected.ifoodOnline += valRepasse;
        expected.total += valRepasse;
      } else if (ehFiado) {
        foraDaConferencia.fiado += valReal;
        foraDaConferencia.fiadoQtd += 1;
      } else if (pm.includes("dinheiro") || pm.includes("cash")) {
        expected.cash += valReal;
        expected.total += valReal;
      } else if (pm.includes("débito") || pm.includes("debito") || pm.includes("debit")) {
        expected.debit += valReal;
        expected.total += valReal;
      } else if (pm.includes("crédito") || pm.includes("credito") || pm.includes("credit")) {
        expected.credit += valReal;
        expected.total += valReal;
      } else if (pm.includes("pix")) {
        expected.pix += valReal;
        expected.total += valReal;
      } else if (pm.includes("voucher") || pm.includes("vale") || pm.includes("meal") || pm.includes("food")) {
        expected.voucher += valReal;
        expected.total += valReal;
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
        expected.credit += valReal;
        expected.total += valReal;
      } else {
        // Antes: `expected.cash += val`. Jogar o desconhecido na gaveta e
        // exatamente o que produz falta sem causa -- o pedido de mesa com
        // "N/A", o "Pendente" do robo, o rotulo que a proxima integracao
        // inventar. Fica visivel numa linha propria, fora da conferencia, ate
        // alguem identificar o que e.
        foraDaConferencia.naoIdentificado += valReal;
        foraDaConferencia.naoIdentificadoQtd += 1;
      }

      // Desconto custeado pela PLATAFORMA — informativo, nunca entra na gaveta.
      //
      // O iFood manda em campo proprio. O 99Food nao manda nada equivalente: o
      // que ele manda e a lista de promocoes com `shop_subside_price`, quanto
      // daquele desconto saiu do bolso da LOJA. O resto e dinheiro deles.
      // O dado ja estava gravado desde sempre em discountDetails.promocoes —
      // so nunca tinha sido lido (lib/cupom-do-parceiro.ts).
      if (o.discountIfood && o.discountIfood > 0) {
        expected.ifoodCoupons += o.discountIfood;
      }
      const do99 = cupomBancadoPelo99(o as any);
      if (do99 > 0) expected.food99Coupons += do99;
    }
    // -- O TROCO DE ABERTURA CONTA NOS DOIS LUGARES ------------------------
    // Ele entrava so em `expected.cash`, e nunca em `expected.total` -- que e
    // somado dentro do laco dos pedidos. O rodape do fechamento saia menor que
    // a soma das proprias linhas impressas acima dele (R$ 472,10 de diferenca
    // no turno de 27/08 da Hakim Centro). Quem confere linha por linha e
    // depois olha o TOTAL nao tinha como fazer os dois baterem.
    // ── AS BAIXAS DAS MESAS FECHADAS NESTE TURNO ──────────────────────────
    //
    // É aqui que o dinheiro da mesa entra na conferência — por forma, como o
    // garçom registrou, e já com a taxa de serviço (que não existe em pedido
    // nenhum, só na sessão). O critério é a mesa ter FECHADO depois de o caixa
    // abrir: uma mesa aberta às 20h e paga às 23h é dinheiro deste turno, e a
    // data do pedido não diz isso — a do fechamento diz.
    //
    // Envelopado em try/catch pelo mesmo motivo das movimentações: se por
    // qualquer razão isto falhar, o caixa continua fechando como antes.
    try {
      const mesasFechadas = await prisma.tableSession.findMany({
        where: {
          status: "CLOSED",
          closedAt: { gte: openSession.openedAt },
          table: { franchiseeId: targetId },
        },
        select: { paymentMethods: true },
      });
      for (const mesa of mesasFechadas) {
        for (const p of lerPagamentos(mesa.paymentMethods)) {
          const m = p.method.toLowerCase();
          const v = p.amount;
          if (m.includes("dinheiro") || m.includes("cash")) expected.cash += v;
          else if (m.includes("débito") || m.includes("debito") || m.includes("debit")) expected.debit += v;
          else if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) expected.credit += v;
          else if (m.includes("pix")) expected.pix += v;
          else if (m.includes("voucher") || m.includes("vale") || m.includes("meal") || m.includes("food")) expected.voucher += v;
          else if (m.includes("maquininha") || m.includes("cartão") || m.includes("cartao")) expected.credit += v;
          else {
            // Forma que a mesa gravou e o caixa não soube ler: continua
            // visível, fora da conferência, em vez de sumir na gaveta.
            foraDaConferencia.naoIdentificado += v;
            foraDaConferencia.naoIdentificadoQtd += 1;
            continue;
          }
          expected.total += v;
        }
      }
    } catch (e: any) {
      console.error("[Caixa] Não consegui somar as baixas das mesas do turno:", e?.message);
    }

    expected.cash += openSession.openingAmount;
    expected.total += openSession.openingAmount;

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
          where: { cashSessionId: openSession.id, franchiseeId: targetId },
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

  return {
    expected,
    foraDaConferencia,
    pendentesValor,
    pendentesQuantidade,
    movimentacaoEntradas,
    movimentacaoSaidas,
  };
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
    // `cashClosedAt` encerra o turno dos garçons pelo link: sessão emitida
    // antes deste instante é recusada e o celular volta para o login.
    data: { cashOpen: false, cashClosedAt: new Date() },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true, storeTimezone: true } });
  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: ownerInfo.storeTimezone || FUSO_PADRAO });
    const msg = `🔴 *Caixa Fechado*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *FECHADO* às ${timeStr}.\n\nDiferença no caixa: R$ ${Number(difference.toFixed(2)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  return NextResponse.json({ success: true, difference });
}
