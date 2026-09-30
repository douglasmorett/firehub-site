import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cancelamentoDaNota } from "@/lib/edicao-de-pedido";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true, role: true, permissions: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    // A lista traz nome, CPF, telefone e endereço de cliente. A tela Fiscal só
    // abre para o funcionário com "Financeiro" marcado (lib/permissao-da-tela,
    // conferido no proxy.ts), mas a API não conferia: o funcionário sem a
    // caixinha chamava a rota direto. A regra é a da tela, com as permissões
    // lidas do banco agora.
    if (user.role === "STAFF" && !funcionarioAbre("/store/fiscal", user.permissions)) {
      return NextResponse.json(
        { error: "Sem acesso às notas fiscais: peça ao dono da loja para marcar \"Financeiro\" no seu cadastro em Equipe." },
        { status: 403 }
      );
    }

    const franchiseeId = user.ownerId || user.id;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const status = searchParams.get("status");
    const paymentMethod = searchParams.get("paymentMethod");

    const whereClause: any = { franchiseeId };

    if (fromDate || toDate) {
      // Dia LOCAL da loja (Brasil, -03:00), não UTC: com "Z", os pedidos das
      // 21h em diante caíam no dia seguinte e sumiam do filtro de "hoje".
      whereClause.createdAt = {};
      if (fromDate) whereClause.createdAt.gte = new Date(fromDate + "T00:00:00.000-03:00");
      if (toDate) whereClause.createdAt.lte = new Date(toDate + "T23:59:59.999-03:00");
    }

    if (status && status !== "ALL") {
      whereClause.fiscalStatus = status;
    }

    if (paymentMethod && paymentMethod !== "ALL") {
      whereClause.paymentMethod = { contains: paymentMethod, mode: "insensitive" };
    }

    const orders = await prisma.customerOrder.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            menuProduct: true,
          },
        },
        // A mesa e a situação da conta: a tela agrupa as rodadas na nota da
        // conta, troca "Emitir" por "Emitir nota da conta" e não pré-seleciona
        // rodada de mesa no lote.
        tableSession: { select: { id: true, status: true, closedAt: true, table: { select: { number: true, label: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // ── SÓ O QUE EXISTE DE VERDADE ──────────────────────────────────────────
    // Este bloco fabricava a nota inteira quando o pedido não tinha uma:
    //
    //   isEmitted   = pedido com mais de uma hora
    //   nfceNumber  = Math.floor(10000 + (created.getTime() % 89999))
    //   nfceKey     = "352608" + dígitos do id do lojista + "65001" + ...
    //   protocol    = "13526" + últimos 10 dígitos do timestamp
    //   impostos    = 13,45% do total, fixo
    //   xmlUrl      = rota que não existe
    //
    // Chave de acesso, número e protocolo são emitidos pela SEFAZ; inventar os
    // três e ainda marcar a nota como AUTORIZADA porque o pedido é velho fazia a
    // tela mostrar um documento fiscal que nunca existiu. O lojista guardava
    // aquela chave achando ter uma nota.
    //
    // Agora: se `fiscalInfo` tem dados reais gravados por uma emissão, mostra.
    // Se não tem, o pedido aparece como PENDENTE e ponto.
    const formattedOrders = orders.map((order) => {
      const fiscal = (order.fiscalInfo as any) || {};
      const foiEmitida = order.fiscalStatus === "EMITTED" && Boolean(fiscal.nfceKey);
      const emContingencia = foiEmitida && fiscal.contingencia === true;
      // A regra do cancelamento (mercadoria não saiu + 30 min) decidida no
      // servidor, a mesma da rota de cancelar: a tela só oferece "Cancelar"
      // quando cabe, e "Registrar devolução" quando não cabe mais.
      const cancelamento = foiEmitida && !emContingencia && Number(fiscal.ambiente) !== 2 ? cancelamentoDaNota(order) : null;
      const notaCancelada = order.fiscalStatus === "CANCELED" && Boolean(fiscal.nfceKey);
      const sessao = (order as any).tableSession as { id: string; status: string; closedAt: Date | null; table?: { number: number; label: string | null } | null } | null;

      const itemsFormatted = order.items.map((item: any) => {
        const mp = item.menuProduct;
        const temDetalhe =
          mp?.fiscalBreakdown && Array.isArray(mp.fiscalBreakdown) && mp.fiscalBreakdown.length > 0;

        return {
          id: item.id,
          // productName preserva o nome do momento da venda; menuProduct.name
          // muda se o lojista renomear o produto depois, e a nota tem que
          // refletir o que foi vendido.
          name: item.productName || mp?.name || "Item",
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * item.quantity,
          isCombo: Boolean(mp?.isCombo),
          ncm: mp?.ncm ?? null,
          cfop: mp?.cfop ?? null,
          fiscalBreakdown: temDetalhe ? mp.fiscalBreakdown : null,
          // O que impede este item de entrar numa nota, se for o caso.
          pendenciaFiscal: mp?.ncm ? null : "Produto sem NCM cadastrado",
        };
      });

      return {
        id: order.id,
        dailyOrderNumber:
          (order as any).dailyOrderNumber || (order as any).orderSeqNumber || order.id.slice(-5),
        customerName: order.customerName || "Cliente Consumidor",
        customerCpfCnpj: order.customerCpfCnpj || null,
        customerPhone: order.customerPhone || "—",
        customerAddress: order.customerAddress || "Balcão / Retirada",
        // A coluna "Tipo" da tela lia `deliveryType`, que esta rota não
        // mandava: toda linha aparecia como "Delivery", inclusive mesa e balcão.
        deliveryType: order.deliveryType ?? null,
        paymentMethod: order.paymentMethod || "Dinheiro",
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        createdAt: order.createdAt,
        // Status OPERACIONAL do pedido. A tela precisa dele para não oferecer
        // emissão de NFC-e de venda cancelada — imposto sobre venda que não
        // aconteceu — e para não carimbar "Concluído" em tudo.
        orderStatus: order.status,
        fiscalStatus: order.fiscalStatus || "PENDING",
        // `null` quando não houve emissão. A tela mostra "não emitida" em vez
        // de um documento inventado.
        fiscalInfo: foiEmitida
          ? {
              nfceNumber: fiscal.nfceNumber ?? null,
              serie: fiscal.serie ?? null,
              nfceKey: fiscal.nfceKey,
              protocol: fiscal.protocol ?? null,
              emittedAt: fiscal.emittedAt ?? null,
              ambiente: fiscal.ambiente ?? null,
              xmlUrl: fiscal.xmlUrl ?? null,
              pdfUrl: fiscal.pdfUrl ?? null,
              items: itemsFormatted,
              // Contingência off-line: a nota VALE para o cliente e o DANFE
              // tem de ser impresso — por isso ela é EMITTED e mostra o DANFE —,
              // mas a SEFAZ ainda não efetivou. A tela marca, e o cron (ou
              // "Consultar situação") acompanha até efetivar.
              contingencia: emContingencia,
              contingenciaDesde: emContingencia ? fiscal.contingenciaDesde ?? null : null,
              valorDaNota: typeof fiscal.valorDaNota === "number" ? fiscal.valorDaNota : null,
              // A nota da conta da mesa: os pedidos que ela cobre.
              notaDaConta: fiscal.notaDaConta
                ? { pedidos: Array.isArray(fiscal.notaDaConta.pedidos) ? fiscal.notaDaConta.pedidos.length : null, restante: fiscal.notaDaConta.restante === true }
                : null,
              devolucao: fiscal.devolucao ?? null,
              podeCancelar: cancelamento ? cancelamento.cabe !== false : Number(fiscal.ambiente) === 2 && !emContingencia,
              semCancelamentoPorque: cancelamento && cancelamento.cabe === false ? cancelamento.porque : null,
            }
          : notaCancelada
            ? {
                // A nota que a loja cancelou: a tela mostra qual foi e
                // oferece emitir outra (ref nova — lib/fiscal-automatico).
                cancelada: true,
                nfceNumber: fiscal.nfceNumber ?? null,
                serie: fiscal.serie ?? null,
                nfceKey: fiscal.nfceKey,
                canceladaEm: fiscal.canceladaEm ?? null,
                ambiente: fiscal.ambiente ?? null,
              }
          : fiscal.processando || fiscal.ultimoErro
            ? {
                // Nota em processamento na SEFAZ ou última tentativa recusada:
                // a tela precisa disso para oferecer "Consultar situação" e
                // mostrar o motivo — sem inventar documento nenhum.
                processando: Boolean(fiscal.processando),
                ultimoErro: fiscal.ultimoErro ?? null,
                ultimaTentativaEm: fiscal.ultimaTentativaEm ?? null,
                motivo: fiscal.motivo ?? null,
                retentativaEncerrada: fiscal.retentativaEncerrada === true,
                // O que falta, item a item (produto sem NCM...), gravado com a
                // falha (lib/fiscal-automatico → gravarResultado): a linha diz
                // qual produto corrigir, não só "1 problema(s) nos itens".
                pendencias: Array.isArray(fiscal.pendencias)
                  ? fiscal.pendencias.slice(0, 8).map((p: any) => ({ campo: String(p?.campo ?? ""), mensagem: String(p?.mensagem ?? "") }))
                  : [],
              }
            : null,
        // Pedido cancelado pelo parceiro (iFood, 99Food, Brendi, JotaJá,
        // disputa) com a nota ainda de pé: o aviso que o parceiro não passa
        // pela trava da nota (lib/fiscal-momento → alertaDoCancelamento). Some
        // quando a nota é cancelada ou a devolução é registrada.
        alerta: fiscal.alerta && !fiscal.devolucao && (foiEmitida || fiscal.processando === true) ? fiscal.alerta : null,
        tableSessionId: order.tableSessionId ?? null,
        mesa: sessao
          ? {
              numero: sessao.table?.number ?? null,
              nome: sessao.table?.label ?? null,
              contaFechada: String(sessao.status || "").toUpperCase() === "CLOSED",
            }
          : null,
        itens: itemsFormatted,
      };
    });

    return NextResponse.json({ success: true, orders: formattedOrders });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
