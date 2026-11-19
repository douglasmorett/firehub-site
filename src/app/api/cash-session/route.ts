import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { FUSO_PADRAO } from "@/lib/fuso";
// O esperado e o retrato do turno moram em lib/esperado-do-turno.ts: a 2ª via
// (api/cash-session/imprimir) também precisa deles, e rota não exporta função.
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { formaDoPedido, formaDoTexto } from "@/lib/relatorios/formas-de-pagamento";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
// O resumo do caixa aberto (topo do "Movimentar caixa") e quem abriu.
import { quemEstaAbrindo, resumoCego, resumoDoCaixaAberto } from "@/lib/resumo-do-caixa-aberto";
import { lerQuemAbriuDoBanco } from "@/lib/quem-abriu-o-caixa";
// O fechamento cego (Minha Loja → Senha do gerente): o funcionário não recebe o esperado.
import { caixaCegoPara } from "@/lib/senha-do-gerente";
// Caixa por usuário (Minha Loja › Balcão, Pager & Caixa): cada login com o
// seu caixa. Desligado, `caixaAbertoPara` é a consulta de sempre.
import { caixaAbertoPara, caixaPorUsuarioLigado } from "@/lib/caixa-por-usuario";
// Abrir e fechar moram em lib/abrir-e-fechar-o-caixa.ts: o Bill grava por lá também.
import { abrirCaixa, fecharCaixa, ultimoCaixaFechado } from "@/lib/abrir-e-fechar-o-caixa";

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

  // Sessão aberta atual — com o caixa por usuário ligado, a DESTE login.
  const porUsuario = await caixaPorUsuarioLigado(user.targetId);
  const openSession = await caixaAbertoPara(user.targetId, user.id, porUsuario);

  const dados = openSession
    ? await calcularEsperadoDoTurno(user.targetId, openSession)
    : {
        expected: { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, food99Online: 0, food99Coupons: 0, total: 0 },
        foraDaConferencia: { fiado: 0, fiadoQtd: 0, naoIdentificado: 0, naoIdentificadoQtd: 0, mesasAbertas: 0, mesasAbertasQtd: 0, proprias: [] as { nome: string; valor: number; qtd: number }[] },
        pendentesValor: 0, pendentesQuantidade: 0, movimentacaoEntradas: 0, movimentacaoSaidas: 0, onlineProprio: 0, naMaquininha: null,
      };
  const { expected, foraDaConferencia, pendentesValor, pendentesQuantidade, movimentacaoEntradas, movimentacaoSaidas, onlineProprio, naMaquininha } = dados;
  // As vendas do turno separadas por tipo (Delivery, Retirada, Balcão, Mesas,
  // Totem) — a mesma apuração que vai para o papel do fechamento.
  const detalhe = "detalhe" in dados ? dados.detalhe : null;

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
  // Caixa por usuário: as vendas entre um fechamento e outra abertura caem no
  // caixa dos colegas (ou no principal), não na gaveta deste login — a
  // explicação não vale, e a conta pela loja inteira mentiria.
  if (openSession && !porUsuario) {
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
        select: { totalAmount: true, paymentMethod: true, paymentMethods: true, source: true, paymentPaidAt: true, gatewayProvider: true, openDeliveryChannel: true },
      });
      for (const o of orfaos) {
        foraDoTurno.valor += o.totalAmount || 0;
        foraDoTurno.quantidade += 1;
        // O dinheiro pela régua do caixa e do relatório (lib/relatorios/
        // formas-de-pagamento.ts): o pago online e o "CASH" do iFood não se
        // confundem, e o dividido conta só a parte em dinheiro.
        const partes = lerPagamentos(o.paymentMethods);
        foraDoTurno.dinheiro += partes.length > 0
          ? partes.filter((p) => formaDoTexto(p.method) === "DINHEIRO").reduce((s, p) => s + p.amount, 0)
          : formaDoPedido(o) === "DINHEIRO" ? o.totalAmount || 0 : 0;
      }
      foraDoTurno.desde = anterior.closedAt.toISOString();
    }
  }

  // Quanto foi contado na gaveta no último fechamento: é a sugestão de troco
  // de abertura do próximo turno. Abrir com zero enquanto a gaveta tem o
  // dinheiro do turno anterior é o que fabrica "sobra" no fechamento.
  //
  // O ÚLTIMO caixa fechado, contado ou não: desde 11/10/2026 o dinheiro deixado
  // em branco grava `closingCash` nulo, e pular o caixa sem contagem (como a
  // consulta fazia) sugeriria o troco de um fechamento de dias atrás.
  const ultimoCaixa = await ultimoCaixaFechado(user.targetId, user.id, porUsuario);
  const ultimoFechamento = ultimoCaixa?.closingCash != null ? ultimoCaixa : null;

  // ── O RESUMO DO CAIXA ABERTO (topo do "Movimentar caixa") ─────────────
  // Rearranjo do MESMO `dados` que a conferência acima usa — nenhuma soma
  // nova (lib/resumo-do-caixa-aberto.ts): o que o menu diz no meio do turno é
  // o que o fechamento vai cobrar. O fuso é o da LOJA (o funcionário logado
  // não tem fuso próprio), para a hora da abertura sair como na parede.
  let resumoDoCaixa: (ReturnType<typeof resumoDoCaixaAberto> & { fuso: string }) | null = null;
  if (openSession && detalhe) {
    const [abertoPor, loja] = await Promise.all([
      lerQuemAbriuDoBanco(openSession.id, user.targetId),
      prisma.user.findUnique({ where: { id: user.targetId }, select: { storeTimezone: true } }).catch(() => null),
    ]);
    resumoDoCaixa = {
      ...resumoDoCaixaAberto({ openedAt: openSession.openedAt, openingAmount: openSession.openingAmount, abertoPor }, { ...dados, detalhe }),
      fuso: loja?.storeTimezone || FUSO_PADRAO,
    };
  }

  // ── FECHAMENTO CEGO ────────────────────────────────────────────────────
  //
  // Lucas, Frangoso Trindade (11/11/2026): o atendente via o dinheiro
  // esperado e digitava a contagem até bater. Com o fechamento cego ligado, o
  // FUNCIONÁRIO não recebe nada que diga quanto deveria ter: o esperado das
  // formas contadas, a parte em dinheiro das vendas, o total vendido, o troco
  // feito pelo Pix e o dinheiro de antes do turno. Cortado AQUI, não na tela —
  // quem abrisse a resposta no navegador veria o número. O pago online (que
  // ninguém conta e fica travado) continua. O dono vê tudo sempre; o
  // resultado sai na resposta do fechamento (PUT), depois de encerrado.
  const cego = Boolean(openSession) && (await caixaCegoPara(user));
  if (cego) {
    return NextResponse.json({
      caixaCego: true,
      caixaPorUsuario: porUsuario,
      resumoDoCaixa: resumoDoCaixa ? { ...resumoCego(resumoDoCaixa), fuso: resumoDoCaixa.fuso } : null,
      session: openSession,
      expected: {
        ifoodOnline: expected.ifoodOnline, ifoodCoupons: expected.ifoodCoupons,
        food99Online: expected.food99Online, food99Coupons: expected.food99Coupons,
      },
      onlineDoSite: Number(onlineProprio.toFixed(2)),
      naMaquininha,
      cashOpen: user.cashOpen,
      movimentacao: { entradas: Number(movimentacaoEntradas.toFixed(2)), saidas: Number(movimentacaoSaidas.toFixed(2)) },
      pendentesDePagamento: { valor: Number(pendentesValor.toFixed(2)), quantidade: pendentesQuantidade },
      foraDaConferencia: {
        fiado: Number(foraDaConferencia.fiado.toFixed(2)),
        fiadoQtd: foraDaConferencia.fiadoQtd,
        naoIdentificado: Number(foraDaConferencia.naoIdentificado.toFixed(2)),
        naoIdentificadoQtd: foraDaConferencia.naoIdentificadoQtd,
        mesasAbertas: Number(foraDaConferencia.mesasAbertas.toFixed(2)),
        mesasAbertasQtd: foraDaConferencia.mesasAbertasQtd,
        proprias: foraDaConferencia.proprias || [],
      },
      foraDoTurno: { valor: Number(foraDoTurno.valor.toFixed(2)), quantidade: foraDoTurno.quantidade, dinheiro: 0, desde: foraDoTurno.desde },
      ultimoFechamento: ultimoFechamento
        ? { cash: ultimoFechamento.closingCash || 0, em: ultimoFechamento.closedAt?.toISOString() || null }
        : null,
      trocoInicial: Number(openSession!.openingAmount || 0),
      onlinePorCanal: detalhe ? detalhe.onlinePorCanal : [],
      cobradoPeloApp: detalhe ? detalhe.cobradoPeloApp || [] : [],
      cupomDaPlataforma: detalhe ? detalhe.cupomDaPlataforma : [],
      trocoNoPix: null,
      vendasPorTipo: null,
      cancelamentos: detalhe
        ? { pedidos: detalhe.cancelados, itens: detalhe.itensCancelados || [] }
        : null,
    });
  }

  return NextResponse.json({
    resumoDoCaixa,
    // A tela diz "o SEU caixa" quando cada login tem o seu.
    caixaPorUsuario: porUsuario,
    session: openSession,
    expected,
    // Quanto do pago online (já dentro de `expected.ifoodOnline`) veio do site
    // e dos outros canais da própria loja. Só a loja de demonstração usa.
    onlineDoSite: Number(onlineProprio.toFixed(2)),
    // O que passou na maquininha do motoboy, por forma: o selo "✓ conferido
    // na maquininha" embaixo de Débito, Crédito, Pix e Vale.
    naMaquininha,
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
      // Formas próprias da loja (a Macaíba): linha com o nome, fora da gaveta.
      proprias: foraDaConferencia.proprias || [],
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
    // Para a tela do fechamento dizer quanto do dinheiro esperado é o troco de
    // abertura (antes ela não dizia, e o operador procurava venda que não houve).
    trocoInicial: openSession ? Number(openSession.openingAmount || 0) : 0,
    // O pago online por canal e o cobrado pelo entregador do app: uma linha
    // travada para cada (a tela somava site, Brendi e Wabiz no "iFood").
    onlinePorCanal: detalhe ? detalhe.onlinePorCanal : [],
    cobradoPeloApp: detalhe ? detalhe.cobradoPeloApp || [] : [],
    // Os cupons pagos pelas plataformas, com quanto já está dentro do online.
    cupomDaPlataforma: detalhe ? detalhe.cupomDaPlataforma : [],
    // Troco feito pelo Pix (lib/troco-no-pix.ts): a tela diz quanto do dinheiro
    // esperado é nota inteira e quanto saiu do Pix — senão o operador procura
    // uma venda desse tamanho.
    trocoNoPix: detalhe?.trocoNoPix || null,
    // Só informação, como no papel: a soma dos tipos é o total faturado
    // (vendas.valor), não o esperado da conferência — o esperado tem o troco
    // de abertura e as movimentações, e não tem o fiado.
    vendasPorTipo: detalhe
      ? {
          vendas: detalhe.vendas, recebido: detalhe.recebido, ponte: detalhe.ponte, cupomDaPlataforma: detalhe.cupomDaPlataforma,
          porTipo: detalhe.porTipo, trocoDasMesas: { valor: detalhe.mesas.troco || 0, qtd: detalhe.mesas.trocoQtd || 0 },
        }
      : null,
    // Os cancelamentos do turno, um a um, com quem e o motivo — o pedido
    // cancelado inteiro e o item tirado (lib/cancelamentos-do-turno.ts). Só
    // informação: o dono confere antes de fechar.
    cancelamentos: detalhe
      ? { pedidos: detalhe.cancelados, itens: detalhe.itensCancelados || [] }
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

  // ── QUEM ABRIU ─────────────────────────────────────────────────────────
  // O topo do "Movimentar caixa" mostra quem abriu e quando (Allan, Delícia
  // de Casa, 17/10/2026). O suporte do FireHub entrando como a loja grava
  // "Suporte FireHub", não o nome da loja — mesma regra da correção do caixa
  // fechado.
  const impersonatedBy = (session.user as any)?.impersonatedBy as string | null | undefined;
  const suporte = impersonatedBy
    ? await prisma.user.findUnique({ where: { id: impersonatedBy }, select: { name: true } }).catch(() => null)
    : null;
  const quem = quemEstaAbrindo(user, impersonatedBy ? suporte || { name: null } : null);

  // O corpo da abertura (encerrar o turno pendurado, avisar o dono) mora em
  // lib/abrir-e-fechar-o-caixa.ts (o Bill abre pelo mesmo caminho).
  return NextResponse.json({ success: true, ...(await abrirCaixa(user, Number(openingAmount), quem)) });
}

// PUT - fechar caixa com valores contados
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json();
  // O corpo do fechamento mora em lib/abrir-e-fechar-o-caixa.ts (o Bill fecha pelo mesmo caminho).
  return NextResponse.json({ success: true, ...(await fecharCaixa(user, body, session.user?.name || session.user?.email || "")) });
}
