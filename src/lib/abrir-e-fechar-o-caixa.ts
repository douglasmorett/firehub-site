/**
 * ABRIR E FECHAR O CAIXA — o corpo do POST (abrir) e do PUT (fechar) de
 * api/cash-session, fora da rota para o Bill (lib/assessor/modulos/caixa.ts)
 * gravar pelo MESMO caminho da tela: encerrar o turno pendurado, quem abriu,
 * esperado recalculado no servidor, pedidos da rua dados por entregues, NFC-e,
 * papel do fechamento e aviso ao dono.
 *
 * A rota continua dona da sessão: ela resolve quem está logado e passa aqui
 * quem abre (`quem`) e o nome do operador que fecha (vai em closedBy, no papel
 * e no aviso).
 */
import { prisma } from "@/lib/prisma";
import { alertaLigado, mandarParaOsNumerosDoDono, numerosDoDono } from "@/lib/alertas-do-dono";
import { avisoDoTrocoDaAbertura } from "@/lib/troco-da-abertura";
import { FUSO_PADRAO } from "@/lib/fuso";
// Só o fechamento imprime sozinho. O cupom de abertura continua em
// lib/cupom-do-caixa, para o botão "imprimir de novo" do histórico.
import { cupomDeFechamentoDeCaixa } from "@/lib/cupom-do-caixa";
import { enfileirarCupomDoCaixa, assistenteOuvindoAFila } from "@/lib/imprimir-caixa";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { secoesDoFechamento } from "@/lib/secoes-do-fechamento";
import { conferirFechamento, lerContado, mensagemDoCaixaFechado } from "@/lib/conferencia-do-caixa";
import type { QuemAbriu } from "@/lib/resumo-do-caixa-aberto";
import { gravarQuemAbriu } from "@/lib/quem-abriu-o-caixa";
import { caixaAbertoPara, caixaPorUsuarioLigado } from "@/lib/caixa-por-usuario";
import { donoDoCaixa } from "@/lib/caixa-por-usuario-regras";

/** Quem mexe no caixa: o login (`id`) e a loja dele (`targetId` = ownerId || id). */
export type QuemMexeNoCaixa = { id: string; targetId: string; storeTimezone?: string | null };

/**
 * O último caixa FECHADO que vale para este login: o da loja (chave
 * desligada, a consulta de sempre) ou o último do próprio login (caixa por
 * usuário — o troco sugerido é o que ficou na gaveta DELE, não na do colega).
 */
export async function ultimoCaixaFechado(lojaId: string, usuarioId: string, porUsuario: boolean) {
  const onde = { franchiseeId: lojaId, status: "CLOSED", closedAt: { not: null } };
  if (!porUsuario) {
    return prisma.cashSession.findFirst({ where: onde, orderBy: { closedAt: "desc" }, select: { closingCash: true, closedAt: true, closedBy: true } });
  }
  const recentes = await prisma.cashSession.findMany({ where: onde, orderBy: { closedAt: "desc" }, take: 60, select: { closingCash: true, closedAt: true, closedBy: true, abertoPor: true } });
  const meu = recentes.find((c) => donoDoCaixa(c.abertoPor) === usuarioId);
  return meu ? { closingCash: meu.closingCash, closedAt: meu.closedAt, closedBy: meu.closedBy } : null;
}

/** POST /api/cash-session: abre o caixa com o troco inicial. */
export async function abrirCaixa(user: QuemMexeNoCaixa, openingAmount: number, quem: QuemAbriu) {
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
  // Caixa por usuário: o caixa "anterior" é só o DESTE login. Abrir o meu
  // caixa nunca encerra o do colega — é para isso que a chave existe.
  const porUsuario = await caixaPorUsuarioLigado(user.targetId);
  const abertaAntes = await caixaAbertoPara(user.targetId, user.id, porUsuario);

  let encerradaSemConferencia: { esperadoTotal: number; esperadoCash: number; abertoEm: string } | null = null;

  // O último fechamento DE VERDADE, antes de esta abertura encerrar alguma
  // coisa: é contra o dinheiro contado nele que o troco de agora se confere
  // (lib/troco-da-abertura.ts).
  const ultimoFechado = await ultimoCaixaFechado(user.targetId, user.id, porUsuario);

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
          // Caixa por usuário: o mesmo login abre outro caixa na hora, então o
          // turno da loja segue (a numeração não volta ao #1, lib/order-number.ts).
          ...(porUsuario ? { abertoPor: { ...((abertaAntes.abertoPor as Record<string, unknown> | null) || {}), turnoContinua: true } as any } : {}),
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
  // continua sendo encerrada, como sempre foi. No caixa por usuário, só as
  // DESTE login — os caixas abertos dos colegas seguem abertos.
  if (porUsuario) {
    const meus = (await prisma.cashSession.findMany({ where: { franchiseeId: user.targetId, status: "OPEN" }, select: { id: true, abertoPor: true } }))
      .filter((c) => donoDoCaixa(c.abertoPor) === user.id)
      .map((c) => c.id);
    if (meus.length > 0) {
      await prisma.cashSession.updateMany({ where: { id: { in: meus }, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } });
    }
  } else {
    await prisma.cashSession.updateMany({
      where: { franchiseeId: user.targetId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }

  // Criar nova sessão. No caixa por usuário, o dono do caixa vai JUNTO na
  // criação (e não depois, como o "quem abriu" de sempre): um caixa por
  // usuário sem a marca seria lido como o compartilhado e contaria as vendas
  // dos colegas — a marca não pode ficar para uma segunda gravação que falhe.
  const cashSession = await prisma.cashSession.create({
    data: {
      franchiseeId: user.targetId, openingAmount: Number(openingAmount), status: "OPEN",
      ...(porUsuario ? { abertoPor: { ...quem, usuarioId: user.id, porUsuario: true } } : {}),
    },
  });

  // Caixa compartilhado: à parte e sem lançar (lib/quem-abriu-o-caixa.ts) — o
  // caixa já está aberto aqui, e falhar a gravação só deixa o "quem" em "—".
  if (!porUsuario) await gravarQuemAbriu(cashSession.id, user.targetId, quem);

  // Marcar caixa como aberto no user e no owner
  await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    data: { cashOpen: true },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true, storeTimezone: true, chatbotConfig: true } });

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

  // Para o principal e os outros números do dono (aba Alertas do chatbot),
  // pela instância da própria loja. O dono pode desligar em Chatbot IA →
  // Notificações ("caixa_aberto_fechado", ligado por padrão).
  const numerosDoAviso = numerosDoDono(ownerInfo?.notificationPhone, ownerInfo?.chatbotConfig);
  if (ownerInfo && numerosDoAviso.length > 0 && alertaLigado(ownerInfo.chatbotConfig, "caixa_aberto_fechado")) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: ownerInfo.storeTimezone || FUSO_PADRAO });
    // Douglas, 11/10/2026: fechou com um valor e abriu com outro, quer saber.
    const trocoNaoBate = avisoDoTrocoDaAbertura({
      anterior: ultimoFechado?.closedAt ? { closingCash: ultimoFechado.closingCash, closedAt: ultimoFechado.closedAt, closedBy: ultimoFechado.closedBy } : null,
      haviaCaixaAberto: Boolean(abertaAntes),
      troco: Number(openingAmount),
      tz: ownerInfo.storeTimezone || FUSO_PADRAO,
    });
    // Caixa por usuário: o dono precisa saber DE QUEM é o caixa que abriu.
    const deQuem = porUsuario ? ` (caixa de *${quem.nome}*)` : "";
    const msg = `🟢 *Caixa Aberto*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}*${deQuem} acabou de ser *ABERTO* às ${timeStr} com R$ ${Number(openingAmount).toFixed(2).replace('.', ',')} de troco.${trocoNaoBate ? `\n\n${trocoNaoBate}` : ""}\n\n_Ass: Seu Assistente FireHub 🔥_`;
    mandarParaOsNumerosDoDono(user.targetId, numerosDoAviso, msg).catch(() => 0);
  }

  return { session: cashSession, encerradaSemConferencia };
}

/**
 * PUT /api/cash-session: fecha o caixa com o que foi contado. `body` é o corpo
 * da tela (closingCash… nulo = forma não conferida, justification, imprimir).
 */
export async function fecharCaixa(user: QuemMexeNoCaixa, body: any, operador: string) {
  const { justification } = body;
  // ── FORMA EM BRANCO NÃO É "CONTEI ZERO" ─────────────────────────────────
  //
  // A tela mandava `Number("") || 0`: a forma deixada em branco chegava aqui
  // como R$ 0,00 contado e virava falta do tamanho do esperado dela — 67 de
  // 270 caixas em 30 dias com as cinco linhas em zero, −R$ 108.653 de "falta"
  // gravada e avisada ao dono (auditoria de 11/10/2026). Agora a tela manda
  // `null` no branco: a forma fica NÃO CONFERIDA (fora da diferença) e, sem
  // nenhuma contada, o caixa fecha SEM CONFERÊNCIA (diferença nula), como o
  // que se encerra sozinho ao abrir outro (lib/conferencia-do-caixa.ts). A
  // tela antiga, sem F5, ainda manda 0 — e continua valendo como zero.
  const contado = {
    cash: lerContado(body.closingCash),
    debit: lerContado(body.closingDebit),
    credit: lerContado(body.closingCredit),
    pix: lerContado(body.closingPix),
    voucher: lerContado(body.closingVoucher),
  };

  // O que a TELA achava que era o esperado. Não entra na conta — serve só para
  // registrar no log quando ela estiver desatualizada (ver abaixo).
  const esperadoDaTela = {
    cash: Number(body.expectedCash || 0),
    total: Number(body.expectedTotal || 0),
  };

  // ── O CONFERIDO FALA A MESMA LÍNGUA DO ESPERADO ─────────────────────────
  //
  // `expectedTotal` inclui o pago online (e o que o entregador do app cobrou),
  // que ninguém CONTA na gaveta. Até 19/09 o conferido somava só o digitado e
  // acusava falta do tamanho do online; depois a tela passou a mandar o online
  // dela para os dois lados empatarem — e, com a tela velha, o online que
  // entrou depois de ela abrir virava falta. Agora a diferença é só das formas
  // CONTADAS contra o esperado delas, apurado aqui (conferirFechamento): o
  // online fica fora dos dois lados, e os cupons nunca entraram.

  // Caixa por usuário: fecha o caixa DESTE login, nunca o do colega.
  const porUsuario = await caixaPorUsuarioLigado(user.targetId);
  const openSession = await caixaAbertoPara(user.targetId, user.id, porUsuario);

  let difference: number | null = 0;
  // O esperado e o contado das formas CONTADAS: o resultado que a tela mostra
  // depois de encerrar (no fechamento cego, é a primeira vez que o operador vê).
  let conferido: { esperado: number; contado: number } | null = null;
  let semConferencia = false;
  let naoConferidas: { nome: string; esperado: number }[] = [];
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
    const conferencia = conferirFechamento(
      { cash: expectedCash, debit: expectedDebit, credit: expectedCredit, pix: expectedPix, voucher: expectedVoucher },
      contado,
    );
    difference = conferencia.diferenca;
    semConferencia = conferencia.semConferencia;
    {
      const esperadoDe = { cash: expectedCash, debit: expectedDebit, credit: expectedCredit, pix: expectedPix, voucher: expectedVoucher };
      const contadas = (Object.keys(esperadoDe) as (keyof typeof esperadoDe)[]).filter((k) => contado[k] != null);
      conferido = {
        esperado: Number(contadas.reduce((t, k) => t + esperadoDe[k], 0).toFixed(2)),
        contado: Number(contadas.reduce((t, k) => t + (contado[k] as number), 0).toFixed(2)),
      };
    }
    naoConferidas = conferencia.naoConferidas;
    paraOCupom = {
      esperado: { cash: expectedCash, debit: expectedDebit, credit: expectedCredit, pix: expectedPix, voucher: expectedVoucher, total: expectedTotal },
      abertoEm: openSession.openedAt,
      trocoInicial: Number(openSession.openingAmount || 0),
      doServidor,
    };

    // Tela velha não é erro — é aviso. Se a divergência for grande, o operador
    // fechou olhando um número que já não existia, e é bom saber disso depois.
    const defasagem = Math.abs(esperadoDaTela.total - expectedTotal);
    // No fechamento cego a tela nunca teve o esperado: não é tela velha.
    if (defasagem > 0.01 && body?.caixaCego !== true) {
      console.warn(
        `[Caixa] Tela desatualizada ao fechar ${openSession.id}: ela mostrava esperado R$ ${esperadoDaTela.total.toFixed(2)}, ` +
        `o servidor apurou R$ ${expectedTotal.toFixed(2)} (defasagem R$ ${defasagem.toFixed(2)}). Gravado o do servidor.`
      );
    }

    await prisma.cashSession.update({
      where: { id: openSession.id },
      data: {
        status: "CLOSED", closedAt: new Date(),
        // null = a forma não foi contada (o Histórico mostra "não conferido").
        closingCash: contado.cash,
        closingDebit: contado.debit,
        closingCredit: contado.credit,
        closingPix: contado.pix,
        closingVoucher: contado.voucher,
        expectedCash: Number(expectedCash || 0),
        expectedDebit: Number(expectedDebit || 0),
        expectedCredit: Number(expectedCredit || 0),
        expectedPix: Number(expectedPix || 0),
        expectedVoucher: Number(expectedVoucher || 0),
        expectedTotal: Number(expectedTotal || 0),
        difference,
        justification: justification || null,
        closedBy: operador,
        // O que ficou sem contar, por escrito: o Histórico e a 2ª via leem do
        // contado nulo, mas quem abre o banco lê a nota.
        notes: semConferencia
          ? "Fechado sem conferir a gaveta: ninguém digitou a contagem. Sem falta nem sobra gravada."
          : naoConferidas.length > 0
            ? `Não conferido no fechamento (fora da diferença): ${naoConferidas.map((l) => `${l.nome} (esperado R$ ${l.esperado.toFixed(2).replace(".", ",")})`).join(", ")}.`
            : null,
      },
    });
  }

  // ── CAIXA POR USUÁRIO: A LOJA AINDA ESTÁ NO TURNO? ────────────────────
  //
  // Fechar o MEU caixa com o do colega aberto não é o fim do turno da loja:
  // os pedidos na rua não viram entregues, os garçons não são deslogados, o
  // caixa da loja continua "aberto" para o robô e para o site, e a numeração
  // dos pedidos não volta ao #1 (lib/order-number.ts lê a marca
  // `turnoContinua` gravada aqui). Quem fecha por último encerra o turno.
  let turnoContinua = false;
  let inicioDoTurnoDaLoja: Date | null = openSession?.openedAt ?? null;
  // (Sem caixa aberto deste login e com o do colega aberto, também não
  // encerra nada da loja.)
  if (porUsuario) {
    try {
      const outrosAbertos = await prisma.cashSession.count({ where: { franchiseeId: user.targetId, status: "OPEN" } });
      turnoContinua = outrosAbertos > 0;
      if (!openSession) {
        // nada deste login para marcar
      } else if (turnoContinua) {
        const marcado = { ...((openSession.abertoPor as Record<string, unknown> | null) || {}), turnoContinua: true };
        await prisma.cashSession.update({ where: { id: openSession.id }, data: { abertoPor: marcado as any } });
      } else {
        // O último a fechar: o turno da loja começou no primeiro caixa que
        // fechou deixando os outros abertos desde a abertura deste.
        const irmaos = await prisma.cashSession.findMany({
          where: { franchiseeId: user.targetId, status: "CLOSED", closedAt: { gte: openSession.openedAt } },
          select: { openedAt: true, abertoPor: true },
        });
        for (const c of irmaos) {
          if ((c.abertoPor as any)?.turnoContinua === true && inicioDoTurnoDaLoja && c.openedAt < inicioDoTurnoDaLoja) inicioDoTurnoDaLoja = c.openedAt;
        }
      }
    } catch (e: any) {
      console.error("[Caixa por usuário] não consegui conferir os outros caixas abertos:", e?.message);
    }
  }

  // 🔧 Auto-finalizar pedidos travados em SAIU_ENTREGA com mais de 3h
  // Isso limpa pedidos que nunca foram confirmados como entregues pelo motoboy
  const threeHoursAgoMs = 3 * 60 * 60 * 1000;
  const threeHoursAgo = new Date(Date.now() - threeHoursAgoMs);
  let finalizadosNoFechamento = 0;
  if (!turnoContinua) try {
    const naRua = {
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
        // Do turno OU de antes dele: o pedido preso de um dia anterior (que nenhum
        // fechamento pegou) também é dado por entregue. Só o `gte` do turno deixava
        // 24 pedidos de set–nov da Hakim Centro para sempre em SAIU_ENTREGA, e o
        // aviso "N pedidos em entrega" aparecia a cada fechamento, dizendo que seriam
        // finalizados sem nunca serem (Edu, 20/11/2026).
        ...(inicioDoTurnoDaLoja
          ? { OR: [{ createdAt: { gte: inicioDoTurnoDaLoja } }, { createdAt: { lt: threeHoursAgo } }] }
          : { createdAt: { lt: threeHoursAgo } }),
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
      };
    // Quem estava na rua, antes de virar ENTREGUE: o aviso de entregue sai
    // para os que saíram há pouco (logo abaixo).
    const saiamNaRua = await prisma.customerOrder.findMany({ where: naRua, select: { id: true, updatedAt: true } });
    const stuckResult = await prisma.customerOrder.updateMany({
      where: naRua,
      data: { status: "ENTREGUE", updatedAt: new Date() },
    });
    finalizadosNoFechamento = stuckResult.count;

    // ── O "ENTREGUE, AVALIE" DE QUEM SÓ FOI DADO POR ENTREGUE AQUI ─────────
    //
    // Loja que não clica "Entregue" pedido a pedido fecha o turno com tudo na
    // rua, e esses clientes nunca recebiam o agradecimento com o link da
    // avaliação (conferência de 09/10/2026, Douglas). Mas fechar o caixa às 6h
    // não pode acordar ninguém com "seu pedido foi entregue" de ontem: só o
    // pedido que saiu nas últimas 3 h, e só entre 8h e 23h no horário de
    // Brasília. Um a cada 10 s (Douglas, 09/10): rajada é o que o antispam do
    // WhatsApp procura.
    const horaAgora = Number(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
    const recentes = saiamNaRua.filter((o) => Date.now() - new Date(o.updatedAt).getTime() < threeHoursAgoMs);
    if (recentes.length > 0 && horaAgora >= 8 && horaAgora < 23) {
      import("@/lib/order-notifications")
        .then(async ({ sendOrderNotification }) => {
          for (const o of recentes) {
            await sendOrderNotification(o.id, "ENTREGUE").catch(() => {});
            await new Promise((r) => setTimeout(r, 10000));
          }
        })
        .catch(() => {});
    }
    if (stuckResult.count > 0) {
      console.log(`[CashSession Close] ✅ ${stuckResult.count} pedidos que estavam na rua foram dados como entregues junto com o caixa`);
    }
  } catch (err) {
    console.error("[CashSession Close] Erro ao finalizar pedidos travados:", err);
  }

  // NFC-e do turno: o updateMany acima dá pedidos por entregues sem passar
  // pelo gancho de status, e eles ficavam sem nota. A varredura emite os do
  // turno que chegaram à hora da nota e nunca tiveram tentativa. Loja com a
  // emissão desligada (hoje, todas) volta na primeira leitura.
  import("@/lib/fiscal-automatico")
    .then(({ emitirNotasEsquecidas }) => emitirNotasEsquecidas({ franchiseeId: user.targetId, desde: openSession?.openedAt ?? null }))
    .catch((err) => console.error("[CashSession Close] Erro ao disparar NFC-e do turno:", err?.message));

  // Marcar caixa como fechado no user e no owner — só quando a loja não
  // tem mais caixa aberto (caixa por usuário com colega ainda no caixa: a
  // loja continua aberta para o robô, o site e os garçons).
  if (!turnoContinua) await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    // `cashClosedAt` encerra o turno dos garçons pelo link: sessão emitida
    // antes deste instante é recusada e o celular volta para o login.
    data: { cashOpen: false, cashClosedAt: new Date() },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true, storeTimezone: true, chatbotConfig: true, printerConfig: true } });

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
        operador,
        abertoEm: paraOCupom.abertoEm,
        fechadoEm: new Date(),
        // O que a loja escolheu imprimir (lib/secoes-do-fechamento.ts).
        secoes: secoesDoFechamento(ownerInfo?.printerConfig),
        trocoInicial: paraOCupom.trocoInicial,
        valores: {
          esperado: paraOCupom.esperado,
          // null = forma não conferida; sem nenhuma, o papel diz "sem conferência".
          contado,
          diferenca: difference ?? 0,
          semConferencia,
          motivoSemConferencia: semConferencia ? "SEM_CONTAGEM" : null,
          // O online é travado: o mesmo valor (o do servidor) dos dois lados.
          online: { ifood: paraOCupom.doServidor.expected.ifoodOnline, food99: paraOCupom.doServidor.expected.food99Online },
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
      }), operador);
    } catch (e: any) {
      console.error("[Caixa] Não consegui enfileirar o cupom de fechamento:", e?.message);
    }
  }

  // ── O AVISO AO DONO DIZ O QUE ACONTECEU ───────────────────────────────
  // Era "Diferença no caixa: R$ -274,32": sem faltou/sobrou, sem o esperado e
  // o contado, e o caixa que ninguém contou chegava como falta do tamanho do
  // esperado. Agora: faltou/sobrou/conferiu (ou "fechado SEM conferir"), o
  // esperado e o contado das formas contadas, o que ficou em branco e as
  // vendas do turno (lib/conferencia-do-caixa.ts).
  // Desligável em Chatbot IA → Notificações, como o da abertura.
  const numerosDoAviso = numerosDoDono(ownerInfo?.notificationPhone, ownerInfo?.chatbotConfig);
  if (ownerInfo && numerosDoAviso.length > 0 && paraOCupom && alertaLigado(ownerInfo.chatbotConfig, "caixa_aberto_fechado")) {
    const fuso = ownerInfo.storeTimezone || FUSO_PADRAO;
    const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso });
    const msg = mensagemDoCaixaFechado({
      // Caixa por usuário: de quem é o caixa que fechou, ao lado da loja.
      loja: porUsuario && openSession ? `${ownerInfo.storeName || ""} — caixa de ${(openSession.abertoPor as any)?.nome || operador}` : ownerInfo.storeName || "",
      fechadoAs: hora(new Date()),
      abertoAs: hora(paraOCupom.abertoEm),
      esperado: paraOCupom.esperado,
      contado,
      trocoInicial: paraOCupom.trocoInicial,
      online: paraOCupom.doServidor.expected.ifoodOnline + paraOCupom.doServidor.expected.food99Online,
      vendas: paraOCupom.doServidor.detalhe.vendas,
    });
    mandarParaOsNumerosDoDono(user.targetId, numerosDoAviso, msg).catch(() => 0);
  }

  // A tela precisa saber se o papel vai sair de verdade: sem o Assistente
  // puxando a fila, o fechamento fica parado nela (ver assistenteOuvindoAFila).
  const impressao = openSession && paraOCupom && querImprimir
    ? { assistenteOuvindo: await assistenteOuvindoAFila(user.targetId) }
    : undefined;

  return { difference, semConferencia, conferido, ...(impressao ? { impressao } : {}) };
}
