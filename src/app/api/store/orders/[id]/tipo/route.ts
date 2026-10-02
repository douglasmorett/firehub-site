import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { empilharEdicao, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import { ehPagoOnline } from "@/lib/pagamento-na-entrega";
import { lerPartes } from "@/lib/pagamento-dividido";
import { avisoDaDiferencaDeTotal } from "@/lib/entrega-do-pedido";
import { recusaSeCaixaFechado } from "@/lib/caixa-aberto-servidor";
import {
  ROTULO_DO_DESTINO,
  ROTULO_DO_TIPO,
  STATUS_QUE_TROCAM,
  TIPO_GRAVADO,
  avaliarTrocaDeTipo,
  etiquetaDaTroca,
  tipoAtualDoPedido,
  totalSemATaxa,
  type TipoDeDestino,
} from "@/lib/troca-de-tipo";

/**
 * /api/store/orders/[id]/tipo — delivery que vira mesa ou balcão.
 *
 *   GET   → se dá para trocar e para onde, e as mesas da loja (livres e
 *           ocupadas) quando mesa é um dos destinos.
 *   PATCH { destino: "MESA" | "BALCAO", tableId? }
 *         → grava o tipo novo, tira a taxa e a entrega (motoboy, rota,
 *           repasse) e, na mesa, põe o pedido na conta dela — abrindo a mesa
 *           no nome do cliente se estiver livre.
 *
 * A regra é lib/troca-de-tipo.ts (a mesma que a tela lê).
 */

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true, deliveryType: true, tableSessionId: true,
  totalAmount: true, deliveryFee: true, notes: true, editHistory: true, dailyOrderNumber: true,
  customerName: true, customerAddress: true, motoboyId: true, dispatchedAt: true,
  paymentMethod: true, gatewayPaymentId: true, paymentMethods: true, paymentPaidAt: true,
  ifoodOrderId: true, openDeliveryOrderId: true, openDeliveryChannel: true,
  fiscalStatus: true, fiscalInfo: true,
} as const;

const reais = (n: number) => `R$ ${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")}`;

function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

async function contexto(params: Promise<{ id: string }>) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };

  const lojaId = operador.ownerId || operador.id;
  const { id } = await params;
  const order = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: lojaId }, select: CAMPOS });
  if (!order) return { erro: NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 }) };
  return { operador, lojaId, order };
}

/** As mesas da loja para a escolha: número, nome e quem está nela. */
async function mesasDaLoja(lojaId: string) {
  const mesas = await prisma.table.findMany({
    where: { franchiseeId: lojaId },
    select: {
      id: true, number: true, label: true,
      sessions: { where: { status: "OPEN" }, select: { id: true, customerName: true, waiterName: true }, take: 1 },
    },
    orderBy: { number: "asc" },
  });
  return mesas.map((m) => ({
    id: m.id,
    number: m.number,
    label: m.label,
    ocupada: m.sessions.length > 0,
    customerName: m.sessions[0]?.customerName || null,
    waiterName: m.sessions[0]?.waiterName || null,
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const avaliacao = avaliarTrocaDeTipo(ctx.order as any, ctx.operador);
    const mesas = avaliacao.pode && avaliacao.destinos.includes("MESA") ? await mesasDaLoja(ctx.lojaId) : [];
    return NextResponse.json({
      avaliacao,
      tipoAtual: tipoAtualDoPedido(ctx.order),
      deliveryFee: ctx.order.deliveryFee || 0,
      totalAmount: ctx.order.totalAmount || 0,
      totalDepois: totalSemATaxa(ctx.order),
      mesas,
    });
  } catch (err: any) {
    console.error("[Troca de tipo GET]", err);
    return NextResponse.json({ error: "Erro ao ler o pedido" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { operador, lojaId, order } = ctx;

    const corpo = await req.json().catch(() => ({}));
    const destino = String(corpo?.destino || "").toUpperCase() as TipoDeDestino;
    if (destino !== "MESA" && destino !== "BALCAO") {
      return NextResponse.json({ error: "Escolha mesa ou balcão." }, { status: 400 });
    }

    const avaliacao = avaliarTrocaDeTipo(order as any, operador);
    if (!avaliacao.pode) return NextResponse.json({ error: avaliacao.motivo }, { status: 403 });
    if (!avaliacao.destinos.includes(destino)) {
      return NextResponse.json({ error: `Este pedido não troca para ${ROTULO_DO_DESTINO[destino].toLowerCase()}.` }, { status: 400 });
    }
    const barrado = avaliacao.barrados[destino];
    if (barrado) return NextResponse.json({ error: barrado }, { status: 403 });

    const taxa = Math.round((order.deliveryFee || 0) * 100) / 100;
    const totalDepois = totalSemATaxa(order);
    const partesGravadas = lerPartes(order.paymentMethods);
    // Pago dividido em balcão: a soma das partes deixaria de bater com o total
    // sem a taxa. A correção de taxa já sabe redividir; aqui não repito a tela.
    if (destino === "BALCAO" && taxa > 0 && partesGravadas.length > 0) {
      return NextResponse.json(
        { error: "Este pedido foi pago dividido. Corrija antes a taxa de entrega para R$ 0,00 (Ver pedido → Corrigir taxa de entrega) e depois troque o tipo." },
        { status: 409 },
      );
    }

    const de = ROTULO_DO_TIPO[tipoAtualDoPedido(order)];
    const quem = nomeDoOperador(operador);

    // ── MESA: escolher (ou abrir) a mesa ────────────────────────────────────
    let mesa: { id: string; number: number } | null = null;
    if (destino === "MESA") {
      const tableId = String(corpo?.tableId || "");
      if (!tableId) return NextResponse.json({ error: "Escolha a mesa." }, { status: 400 });
      const achada = await prisma.table.findFirst({ where: { id: tableId, franchiseeId: lojaId }, select: { id: true, number: true } });
      if (!achada) return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
      mesa = achada;
      // O dinheiro da mesa entra no caixa quando ela fecha: sem caixa aberto
      // não se abre mesa nem se lança nela (lib/caixa-aberto-servidor.ts).
      const semCaixa = await recusaSeCaixaFechado(lojaId, "lançar o item");
      if (semCaixa) return semCaixa;
    }

    const para = mesa ? `Mesa ${mesa.number}` : ROTULO_DO_DESTINO[destino];
    const partes = [`${de} → ${para}`];
    if (taxa > 0) partes.push(`taxa de entrega ${reais(taxa)} → R$ 0,00`);
    if (order.motoboyId) partes.push("saiu do motoboy");

    const registro = {
      quando: new Date().toISOString(),
      quem,
      acao: "TIPO" as const,
      descricao: partes.join("; "),
      totalAntes: order.totalAmount || 0,
      totalDepois,
      tipoAntes: order.deliveryType,
      tipoDepois: TIPO_GRAVADO[destino],
      taxaAntes: taxa,
      // O endereço sai do pedido (a comanda e o card mostram a mesa); fica aqui.
      enderecoAntes: order.customerAddress || null,
      pagamentoAntes: order.paymentMethod || null,
    };
    const notas = `${String(order.notes || "").trim()} ${etiquetaDaTroca(de, para)}`.trim();

    // O que deixa de existir quando o pedido não é mais entrega.
    const semEntrega = {
      deliveryFee: 0,
      totalAmount: totalDepois,
      motoboyFee: null,
      motoboyId: null,
      motoboyPuxadoEm: null,
      routeId: null,
      isRoutePriority: false,
      deliveryDistance: null,
      entregaGratis: Prisma.DbNull,
    };

    // ── CONCORRÊNCIA ─────────────────────────────────────────────────────
    // O UPDATE só passa se o pedido ainda é o que esta conta leu: mesmo total,
    // mesma taxa, mesma nota, ainda fora de mesa e ainda antes de sair. Na
    // mesa, abrir a sessão e mover o pedido é uma coisa só (transação
    // serializável, como a abertura em api/store/table-sessions): se o pedido
    // mudou, a mesa não fica aberta à toa.
    const ondeOPedidoEsta = {
      id: order.id, franchiseeId: lojaId, tableSessionId: null,
      status: { in: [...STATUS_QUE_TROCAM] }, dispatchedAt: null,
      totalAmount: order.totalAmount, deliveryFee: order.deliveryFee, fiscalStatus: order.fiscalStatus,
    };

    let sessaoId: string | null = null;
    let abriuAMesa = false;
    let mudou = false;
    try {
      await prisma.$transaction(async (tx) => {
        if (mesa) {
          const aberta = await tx.tableSession.findFirst({ where: { tableId: mesa.id, status: "OPEN" }, select: { id: true } });
          if (aberta) {
            sessaoId = aberta.id;
          } else {
            const nova = await tx.tableSession.create({
              data: {
                tableId: mesa.id,
                franchiseeId: lojaId,
                customerName: order.customerName || null,
                status: "OPEN",
                openedAt: new Date(),
              },
              select: { id: true },
            });
            sessaoId = nova.id;
            abriuAMesa = true;
          }
        }
        const r = await tx.customerOrder.updateMany({
          where: ondeOPedidoEsta,
          data: {
            ...semEntrega,
            deliveryType: TIPO_GRAVADO[destino],
            notes: notas,
            editHistory: empilharEdicao(order.editHistory, registro as unknown as RegistroDeEdicao) as any,
            ...(mesa
              ? {
                  tableSessionId: sessaoId,
                  // "Mesa 5" no endereço é como a comanda e a conta acham a mesa (lib/andares-da-mesa).
                  customerAddress: `Mesa ${mesa.number}`,
                  // Pago no fechamento da mesa, como o pedido lançado pelo garçom.
                  paymentMethod: "N/A",
                  paymentMethods: Prisma.DbNull,
                  changeAmount: null,
                }
              : { customerAddress: "" }),
          },
        });
        if (r.count !== 1) {
          mudou = true;
          throw new Error("PEDIDO_MUDOU");
        }
      }, { isolationLevel: "Serializable" });
    } catch (err: any) {
      if (mudou) {
        return NextResponse.json({ error: "O pedido mudou enquanto você trocava o tipo. Abra o pedido de novo e confira." }, { status: 409 });
      }
      // Dois aparelhos abrindo a mesma mesa ao mesmo tempo: a serializável derruba um.
      if (err?.code === "P2034") {
        return NextResponse.json({ error: "A mesa acabou de ser mexida em outro aparelho. Tente de novo." }, { status: 409 });
      }
      throw err;
    }

    const diferenca = Math.round((totalDepois - (order.totalAmount || 0)) * 100) / 100;
    const aviso = destino === "BALCAO"
      ? avisoDaDiferencaDeTotal(diferenca, totalDepois, {
          pagoOnline: ehPagoOnline(order as any),
          finalizado: false,
          pagamentoConfirmado: order.paymentPaidAt != null,
          balcao: String(order.source || "").toUpperCase() === "PRESENCIAL",
          dividido: partesGravadas.length > 0,
        })
      : undefined;

    console.log(
      `[Troca de tipo] pedido ${order.id} (#${order.dailyOrderNumber ?? "—"}): ${registro.descricao}; ` +
      `total ${order.totalAmount} → ${totalDepois}${abriuAMesa ? "; abriu a mesa" : ""}; por ${quem}`,
    );

    return NextResponse.json({
      success: true,
      deliveryType: TIPO_GRAVADO[destino],
      tableSessionId: sessaoId,
      mesa: mesa?.number ?? null,
      abriuAMesa,
      totalAmount: totalDepois,
      deliveryFee: 0,
      descricao: registro.descricao,
      aviso,
    });
  } catch (err: any) {
    console.error("[Troca de tipo PATCH]", err);
    return NextResponse.json({ error: "Erro ao trocar o tipo do pedido" }, { status: 500 });
  }
}
