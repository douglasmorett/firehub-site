import { NextRequest, NextResponse } from "next/server";
import { valorDoDesconto, type DescontoManual } from "@/lib/desconto-manual";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { recusaSeCaixaFechado } from "@/lib/caixa-aberto-servidor";
import { lerPagamentos, somarPagamentos } from "@/lib/pagamentos-da-mesa";
import { comissaoDoGarcom, sanearTaxa } from "@/lib/conta-da-mesa";
import { lerDocumentoDoCliente, normalizarDocumento, problemaDoDocumento } from "@/lib/documento-do-cliente";
import { formaDoTexto } from "@/lib/relatorios/formas-de-pagamento";
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";
import { garantirTabelaDoFiadoDaMesa, lancarMesaNoFiado, lojasDoMesmoFiado } from "@/lib/fiado-da-mesa";
import { MODO_LOCAL } from "@/lib/modo-local";
import {
  FORMA_DO_FIADO_NA_MESA, descricaoDaMesaNoFiado, lerClienteDoFiado, valorParaOFiado, type ClienteDoFiado,
} from "@/lib/fiado-da-mesa-regras";

/** Último degrau da taxa sugerida — o mesmo da conta impressa (imprimir-conta). */
const TAXA_PADRAO = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Garçom sem "pode fechar a conta" no cadastro: o botão nem aparece para
    // ele, e aqui a porta fica fechada mesmo para quem chamar a rota na mão.
    if (operador.tipo === "garcom" && !operador.garcom.podeFecharConta) {
      return NextResponse.json({ error: "Este garçom não fecha conta. Peça ao caixa para fechar pelo painel." }, { status: 403 });
    }
    const targetFranchiseeId = operador.franchiseeId;

    // ── ESTE É O MOMENTO DO DINHEIRO ─────────────────────────────────────
    //
    // O fechamento de caixa soma as mesas FECHADAS depois da abertura do
    // turno. Fechar mesa sem caixa aberto é consumo que não cai em turno
    // nenhum: some da conferência e reaparece como diferença.
    //
    // Sim, isto prende a mesa até alguém abrir o caixa — e é o certo. O
    // dinheiro já existe; o que falta é onde registrá-lo. Abrir o caixa
    // destrava e a mesma conta fecha normalmente, nada se perde.
    const semCaixa = await recusaSeCaixaFechado(targetFranchiseeId, "fechar a conta");
    if (semCaixa) return semCaixa;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { paymentMethods, serviceFeePercent, waiterTip, desconto } = data;

    // ── "LANÇAR NO FIADO" (lib/fiado-da-mesa-regras.ts) ──────────────────
    // Com `fiado` no corpo, o que falta pagar da conta vira dívida de um
    // cliente do Fiado e a mesa fecha na hora — a mesa 9 que pagou e ninguém
    // deu baixa (Allan, Delícia de Casa). Mesmas travas do fechamento normal
    // (garçom que fecha conta, desconto, taxa, caixa aberto), mais o Fiado
    // ligado na loja e a senha do gerente, se o dono ligou para o fiado.
    let clienteDoFiado: ClienteDoFiado | null = null;
    if (data?.fiado != null) {
      const lido = lerClienteDoFiado(data.fiado);
      if (!lido.ok) return NextResponse.json({ error: lido.erro, mensagem: lido.erro }, { status: 400 });
      clienteDoFiado = lido.cliente;
    }
    // "CPF na nota" do fechamento (opcional). O que vier tem de ser documento
    // de verdade: é o destinatário da nota da conta (lib/fiscal-momento →
    // montarNotaDaMesa, que lê o primeiro documento entre os pedidos).
    if (normalizarDocumento(data.cpfCnpj)) {
      const problema = problemaDoDocumento(data.cpfCnpj);
      if (problema) return NextResponse.json({ error: problema, mensagem: problema }, { status: 400 });
    }
    const documentoDaConta = lerDocumentoDoCliente(data.cpfCnpj);
    // Garçom sem "pode dar desconto" no cadastro: o botão nem aparece para
    // ele, e um desconto que chegue mesmo assim não fecha a mesa.
    if (operador.tipo === "garcom" && !operador.garcom.podeDarDesconto && Number(desconto?.valor) > 0) {
      return NextResponse.json({ error: "Este garçom não dá desconto. Peça ao caixa para fechar com desconto pelo painel." }, { status: 403 });
    }

    const tableSession = await prisma.tableSession.findUnique({
      where: { id },
      include: {
        table: true,
        orders: true,
        waiter: { select: { commissionRate: true } },
      }
    });

    if (!tableSession || tableSession.table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (tableSession.status !== "OPEN") {
      return NextResponse.json({ error: "Session is not open" }, { status: 400 });
    }

    // Pedido cancelado não entra na conta. A tela de conta por pessoa já os
    // ignora; se aqui somasse, o garçom veria um total na tela, pagaria esse
    // valor e o fechamento recusaria por "faltar" dinheiro que ninguém deve.
    /** O desconto como veio no corpo, sem confiar em número pronto. */
    const lerDesconto = (bruto: any): DescontoManual | null => {
      if (!bruto || typeof bruto !== "object") return null;
      const valor = Number(bruto.valor);
      if (!Number.isFinite(valor) || valor <= 0) return null;
      return {
        tipo: bruto.tipo === "valor" ? "valor" : "percent",
        valor,
        motivo: String(bruto.motivo || "").slice(0, 60),
      };
    };

    const pedidosValidos = tableSession.orders.filter((o) => o.status !== "CANCELADO");
    const subtotal = pedidosValidos.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // ── PERMISSÕES DO GARÇOM PELO LINK (cadastro do garçom) ───────────────
    // Liberar mesa é fechar sem consumo; tirar a taxa é fechar com taxa
    // abaixo da taxa da loja (a comissão dele não conta: é o repasse, não o
    // que o cliente paga). O botão/caixa nem aparece para ele; aqui a porta
    // fica fechada também.
    if (operador.tipo === "garcom") {
      if (!operador.garcom.podeLiberarMesa && subtotal <= 0) {
        return NextResponse.json({ error: "Este garçom não libera mesa. Peça ao caixa para liberar pelo painel." }, { status: 403 });
      }
      if (!operador.garcom.podeTirarTaxa) {
        const loja = await prisma.user.findUnique({ where: { id: targetFranchiseeId }, select: { taxaServicoPadrao: true } });
        const taxaMinima = sanearTaxa(loja?.taxaServicoPadrao, TAXA_PADRAO);
        if ((Number(serviceFeePercent) || 0) < taxaMinima) {
          return NextResponse.json({ error: `Este garçom não tira a taxa de serviço (${taxaMinima}%). Peça ao caixa para fechar pelo painel.` }, { status: 403 });
        }
      }
    }
    // Taxa e gorjeta nunca negativas nem fora da faixa: com taxa de -100% a
    // conta zerava e a mesa fechava "paga" sem um centavo. Fora da faixa é
    // pedido malformado, não conta.
    const taxaPct = Number(serviceFeePercent) || 0;
    const gorjeta = Number(waiterTip) || 0;
    if (!Number.isFinite(taxaPct) || taxaPct < 0 || taxaPct > 100 || !Number.isFinite(gorjeta) || gorjeta < 0) {
      return NextResponse.json({ error: "Taxa de serviço ou gorjeta inválida" }, { status: 400 });
    }
    const tipAmount = gorjeta;

    // ── DESCONTO DADO NA MESA ─────────────────────────────────────────
    //
    // Recalculado AQUI a partir do tipo e do valor, nunca aceito pronto: o
    // fechamento confere se os pagamentos cobrem a conta, e um desconto
    // vindo pronto do navegador seria a própria conta sendo digitada por
    // quem paga. Incide sobre o CONSUMO, antes da taxa de serviço — a taxa
    // é sobre o que foi efetivamente cobrado.
    const descontoEmReais = valorDoDesconto(lerDesconto(desconto), subtotal);
    const consumoCobrado = Math.max(0, subtotal - descontoEmReais);
    const serviceFee = taxaPct ? (consumoCobrado * taxaPct) / 100 : 0;
    const totalAmount = consumoCobrado + serviceFee + tipAmount;

    // ── A SOMA DOS PAGAMENTOS TEM QUE FECHAR COM A CONTA ──────────────────
    // O comentário antigo dizia "Validate payment methods total", mas nada era
    // validado: a soma era calculada e a mesa fechava com qualquer valor —
    // inclusive R$ 0,00. Uma mesa de R$ 300 podia ser encerrada sem ninguém
    // pagar, e o caixa fechava com sobra falsa no fim do dia.
    //
    // Agora recusa quando falta dinheiro. Sobra é aceita (troco/gorjeta em
    // dinheiro é comum), mas falta não.
    const centavos = (n: number) => Math.round((Number(n) || 0) * 100);

    // ── QUEM MANDA É O QUE JÁ ESTÁ GRAVADO ────────────────────────────────
    // As baixas agora são registradas uma a uma enquanto a mesa está aberta
    // (rota `pagamentos`), então elas sobrevivem a tablet reiniciado e a troca
    // de garçom. Havendo baixas gravadas, são ELAS que valem: aceitar o corpo
    // por cima deixaria uma tela desatualizada apagar dinheiro que já entrou.
    //
    // O corpo continua valendo quando não há nada gravado — é o caminho de
    // quem ainda está na tela antiga e o de liberar mesa sem consumo.
    const jaGravados = lerPagamentos(tableSession.paymentMethods);
    let pagamentosEfetivos =
      jaGravados.length > 0
        ? jaGravados
        : lerPagamentos(Array.isArray(paymentMethods) ? paymentMethods : []);

    // Fiado só entra pelo "Lançar no fiado": é ele que diz QUEM deve. Uma
    // baixa "Fiado" solta fecharia a mesa sem dívida de ninguém — o caixa
    // tiraria o valor da conferência e ninguém cobraria.
    if (pagamentosEfetivos.some((p) => formaDoTexto(p.method) === "FIADO")) {
      const m = "Para deixar a conta no fiado, use \"Lançar no fiado\" no fechamento (escolhendo o cliente).";
      return NextResponse.json({ error: m, mensagem: m }, { status: 400 });
    }

    let totalPaid = somarPagamentos(pagamentosEfetivos);

    /** O que vai para o fiado, já conferido (null = fechamento normal). */
    let fiado: { valor: number; employeeId: string | null; novo: { nome: string; telefone: string | null } | null; nome: string; descricao: string } | null = null;
    if (clienteDoFiado) {
      // No Modo Contingência (FireHub no computador da loja) a tabela da
      // dívida não está na cópia que volta para a nuvem (lib/contingencia/
      // catalogo.ts): a mesa fecharia com "Fiado" e a dívida ficaria só no
      // computador. Melhor recusar do que perder quem deve.
      if (MODO_LOCAL) {
        const m = "Sem internet (modo contingência) a mesa não vai para o fiado. Feche a conta normalmente ou espere a conexão voltar.";
        return NextResponse.json({ error: m, mensagem: m }, { status: 503 });
      }
      const loja = await prisma.user.findUnique({ where: { id: targetFranchiseeId }, select: { employeeAccountEnabled: true } });
      if (!loja?.employeeAccountEnabled) {
        const m = "O Fiado está desligado nesta loja. O dono liga em Financeiro → Fiado.";
        return NextResponse.json({ error: m, mensagem: m }, { status: 400 });
      }
      const v = valorParaOFiado({ totalDaConta: totalAmount, jaPago: totalPaid });
      if (!v.ok) return NextResponse.json({ error: v.erro, mensagem: v.erro }, { status: 400 });

      let nome: string;
      let employeeId: string | null = null;
      if (clienteDoFiado.tipo === "existente") {
        const c = await prisma.storeEmployee.findUnique({ where: { id: clienteDoFiado.id }, select: { id: true, name: true, franchiseeId: true, active: true } });
        if (!c || !c.active || !(await lojasDoMesmoFiado(targetFranchiseeId)).includes(c.franchiseeId)) {
          const m = "Este cliente não está no fiado desta loja. Escolha outro ou cadastre um novo.";
          return NextResponse.json({ error: m, mensagem: m }, { status: 400 });
        }
        nome = c.name;
        employeeId = c.id;
      } else {
        nome = clienteDoFiado.nome;
      }

      // A senha vem DEPOIS das conferências da conta: ninguém digita senha
      // para ouvir em seguida que a mesa já estava paga.
      const semSenha = await exigirSenhaDoGerente(req, targetFranchiseeId, "fiado");
      if (semSenha) return semSenha;

      if (!(await garantirTabelaDoFiadoDaMesa())) {
        const m = "Não deu para lançar no fiado agora. Feche a conta normalmente ou tente de novo.";
        return NextResponse.json({ error: m, mensagem: m }, { status: 503 });
      }

      // O que a mesa consumiu, para o extrato do fiado dizer o que é a dívida.
      const itens = await prisma.customerOrderItem.findMany({
        where: { order: { tableSessionId: id, status: { not: "CANCELADO" } } },
        select: { quantity: true, productName: true, menuProduct: { select: { name: true } } },
      });
      const descricao = descricaoDaMesaNoFiado({
        numero: tableSession.table.number ?? null,
        itens: itens.map((i) => ({ nome: i.productName || i.menuProduct?.name || "Item", quantidade: Number(i.quantity) || 1 })),
      });

      fiado = {
        valor: v.valor, employeeId, nome, descricao,
        novo: clienteDoFiado.tipo === "novo" ? { nome: clienteDoFiado.nome, telefone: clienteDoFiado.telefone } : null,
      };
      // A conta fecha com uma baixa "Fiado" do que faltava: é por ela que o
      // caixa a tira da gaveta (lib/apuracao-do-turno.ts) e que o relatório
      // Formas de pagamento a mostra em "Fiado / Conta funcionário".
      pagamentosEfetivos = [...pagamentosEfetivos, {
        uid: crypto.randomUUID(),
        method: FORMA_DO_FIADO_NA_MESA,
        amount: v.valor,
        guestId: null,
        guestName: nome.slice(0, 80),
        at: new Date().toISOString(),
        por: rotuloDoOperador(operador),
      }];
      totalPaid = somarPagamentos(pagamentosEfetivos);
    }

    const faltando = centavos(totalAmount) - centavos(totalPaid);

    // Tolerância de 1 centavo: arredondamento de taxa de serviço não pode
    // travar o fechamento de uma mesa real.
    if (faltando > 1) {
      return NextResponse.json(
        {
          error: "pagamento_incompleto",
          mensagem:
            `Faltam R$ ${(faltando / 100).toFixed(2).replace(".", ",")} para fechar a mesa. ` +
            `A conta é de R$ ${totalAmount.toFixed(2).replace(".", ",")} e foram informados ` +
            `R$ ${totalPaid.toFixed(2).replace(".", ",")}.`,
          totalDaConta: Number(totalAmount.toFixed(2)),
          totalInformado: Number(totalPaid.toFixed(2)),
          faltando: Number((faltando / 100).toFixed(2)),
        },
        { status: 400 }
      );
    }

    // Wrap in transaction
    await prisma.$transaction(async (tx) => {
      // 0. A dívida do fiado, junto com o fechamento: ou os dois, ou nenhum.
      if (fiado) {
        let employeeId = fiado.employeeId;
        if (!employeeId && fiado.novo) {
          const novo = await tx.storeEmployee.create({
            data: { franchiseeId: targetFranchiseeId, name: fiado.novo.nome, phone: fiado.novo.telefone, role: "Cliente", active: true },
            select: { id: true },
          });
          employeeId = novo.id;
        }
        await lancarMesaNoFiado(tx, {
          lojaId: targetFranchiseeId,
          employeeId: employeeId!,
          tableSessionId: id,
          mesaNumero: tableSession.table.number ?? null,
          valor: fiado.valor,
          descricao: fiado.descricao,
          quem: rotuloDoOperador(operador),
        });
      }

      // 1. Update orders status to ENTREGUE
      if (pedidosValidos.length > 0) {
        // NOT: cancelado continua cancelado. Sem o filtro, fechar a mesa
        // ressuscitava o pedido cancelado como ENTREGUE e ele voltava para o
        // faturamento do dia.
        await tx.customerOrder.updateMany({
          where: { tableSessionId: id, status: { not: "CANCELADO" } },
          data: { status: "ENTREGUE" }
        });
      }

      // O que vai para o garçom da mesa: a parte da taxa que a loja repassa
      // (comissão dele) mais a gorjeta. Antes era a taxa inteira, mesmo na
      // casa que cobra 12% e repassa 10%.
      const waiterCommission = tableSession.waiterId
        ? comissaoDoGarcom({
            consumoCobrado,
            taxaCobradaPct: taxaPct,
            comissaoPct: tableSession.waiter?.commissionRate,
            gorjeta: tipAmount,
          })
        : 0;

      // 2. Update session to CLOSED
      await tx.tableSession.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          // Quem fechou: pelo painel (nome do usuário) ou pelo link do garçom.
          closedByKind: operador.tipo,
          closedByName: rotuloDoOperador(operador),
          totalPaid,
          serviceFee,
          waiterTip: tipAmount > 0 ? tipAmount : undefined,
          waiterCommission: waiterCommission > 0 ? waiterCommission : undefined,
          paymentMethods: pagamentosEfetivos.length > 0 ? (pagamentosEfetivos as any) : undefined
        }
      });
    });

    // NFC-e automática: UMA nota para a conta (não uma por pedido), com o
    // desconto e as formas em que a mesa pagou (lib/fiscal-automatico). O
    // desconto vai junto porque a sessão não tem onde guardá-lo.
    // Fire-and-forget: a mesa fecha na hora e a nota que falhar aparece como
    // "Falhou" na aba Notas fiscais.
    // O documento vai para TODOS os pedidos da conta antes da nota: é de lá
    // que a nota da conta o lê, e a reemissão pela tela lê o mesmo.
    if (documentoDaConta) {
      await prisma.customerOrder
        .updateMany({ where: { tableSessionId: id, franchiseeId: targetFranchiseeId }, data: { customerCpfCnpj: documentoDaConta } })
        .catch((err) => console.error("[Table Sessions Close] CPF da nota não gravado:", err?.message));
    }
    import("@/lib/fiscal-automatico")
      .then(({ emitirNfceDaMesa }) => emitirNfceDaMesa(id, { desconto: descontoEmReais }))
      .catch((err) => console.error("[Table Sessions Close] Erro ao disparar NFC-e da conta:", err?.message));

    if (fiado) console.log(`[Mesa ${id}] conta no fiado: R$ ${fiado.valor.toFixed(2)} para ${fiado.nome} — por ${rotuloDoOperador(operador)}`);
    return NextResponse.json({
      success: true,
      message: "Session closed successfully",
      ...(fiado ? { fiado: { cliente: fiado.nome, valor: fiado.valor } } : {}),
    });
  } catch (error: any) {
    console.error("[Table Sessions Close POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
