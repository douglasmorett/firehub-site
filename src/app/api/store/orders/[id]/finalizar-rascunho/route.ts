import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { conferirEstoque } from "@/lib/estoque-restante";
import { avaliarEntrega, modoDaArea, type VeredictoDeEntrega } from "@/lib/area-de-entrega";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { comPrazo } from "@/lib/com-prazo";
import {
  camposDaEntrega,
  cotacaoDoPedido,
  entregaDaCotacao,
  entregaDoVeredicto,
  notasDaEntrega,
  type EntregaDoPedido,
} from "@/lib/entrega-do-pedido";
import {
  lerFinalizacao,
  notasDaFinalizacao,
  statusDaFinalizacao,
  totalComATaxa,
} from "@/lib/finalizar-rascunho";

/**
 * /api/store/orders/[id]/finalizar-rascunho — a loja termina o pedido que o
 * robô deixou em "IA criando…" (lib/finalizar-rascunho.ts conta o porquê).
 *
 *   GET  → o rascunho para a janela (itens, cliente, endereço, pagamento) e
 *          "segura" o rascunho: a faxina cancela rascunho parado há 20 min
 *          (checkAndCleanupStaleAiDrafts), e quem está com a janela aberta
 *          completando o pedido não pode perdê-lo no meio.
 *   POST → finaliza: o mesmo que o robô faz no fechamento — número do dia, o
 *          pedido "nasce agora", comanda na fila — mais a medida da entrega do
 *          jeito do balcão (a taxa é a que a loja decidiu; distância, ponto e
 *          repasse vêm da cotação assinada ou do mapa, com prazo).
 */

/** O mesmo prazo do balcão: o atendente está com o cliente na conversa. */
const PRAZO_DO_MAPA_MS = 10_000;

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true,
  customerName: true, customerPhone: true, customerAddress: true, deliveryType: true,
  paymentMethod: true, changeAmount: true, deliveryFee: true, totalAmount: true, motoboyFee: true,
  deliveryDistance: true, customerLatLng: true, entregaGratis: true, notes: true, dailyOrderNumber: true,
  items: { select: { id: true, menuProductId: true, productName: true, quantity: true, price: true, notes: true, menuProduct: { select: { name: true } } } },
} as const;

function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

async function contexto(params: Promise<{ id: string }>) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, role: true, ownerId: true },
  });
  if (!operador) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };

  const lojaId = operador.ownerId || operador.id;
  const { id } = await params;
  const order = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: lojaId }, select: CAMPOS });
  if (!order) return { erro: NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 }) };

  if (String(order.status).toUpperCase() !== "CRIANDO_IA") {
    return {
      erro: NextResponse.json(
        { error: "Este pedido já não é rascunho do robô — ele foi finalizado ou cancelado. A lista vai ser atualizada.", status: order.status },
        { status: 409 },
      ),
    };
  }
  return { lojaId, operador, order };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { order, lojaId } = ctx;

    // Segura o rascunho enquanto a janela está aberta (a faxina mede `updatedAt`).
    await prisma.customerOrder
      .updateMany({ where: { id: order.id, status: "CRIANDO_IA" }, data: { updatedAt: new Date() } })
      .catch(() => undefined);

    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { city: true, chatbotConfig: true } });
    const taxa = Number(order.deliveryFee) || 0;
    return NextResponse.json({
      pedido: {
        id: order.id,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress,
        deliveryType: order.deliveryType,
        paymentMethod: order.paymentMethod,
        changeAmount: order.changeAmount,
        deliveryFee: taxa,
        totalAmount: order.totalAmount,
        // Itens, descontos e frete grátis já compostos pelo robô, sem a taxa.
        subtotal: Math.max(0, Math.round(((Number(order.totalAmount) || 0) - taxa) * 100) / 100),
        notes: order.notes,
        itens: order.items.map((i) => ({
          id: i.id,
          nome: i.productName || i.menuProduct?.name || "Item",
          quantidade: i.quantity,
          preco: i.price,
          obs: i.notes || "",
        })),
      },
      cidadeDaLoja: loja?.city || "",
      statusAoFinalizar: statusDaFinalizacao(loja?.chatbotConfig),
    });
  } catch (error: any) {
    console.error("[Finalizar rascunho GET]", error);
    return NextResponse.json({ error: "Erro ao abrir o rascunho" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { order, lojaId, operador } = ctx;

    if (order.items.length === 0) {
      return NextResponse.json(
        { error: "O robô não lançou nenhum item neste rascunho. Lance o pedido pelo balcão e cancele o rascunho." },
        { status: 400 },
      );
    }

    const corpo = await req.json().catch(() => ({} as any));
    const lido = lerFinalizacao(corpo);
    if (!lido.ok) return NextResponse.json({ error: lido.erro, campo: lido.campo }, { status: 400 });
    const f = lido.dados;

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: {
        city: true, chatbotConfig: true,
        deliveryZones: true, deliveryZoneType: true, deliveryConfig: true, storeLatLng: true, storeAddress: true,
      },
    });

    // ── A ENTREGA: a medida do balcão (api/store/orders/presencial) ─────────
    // A taxa cobrada é a da loja. A distância, o ponto e o repasse do motoboy
    // vêm da cotação assinada que a janela pediu para ESTE texto de endereço;
    // sem ela, do mapa, com prazo — e sem medida o pedido sai assim mesmo,
    // com a etiqueta de conferência (o cron de distâncias mede depois).
    let campos: ReturnType<typeof camposDaEntrega> | null = null;
    let notasDeEntrega: string[] = [];
    if (f.tipo === "DELIVERY" && loja) {
      try {
        const partes = {
          street: typeof corpo?.customerStreet === "string" ? corpo.customerStreet : undefined,
          number: typeof corpo?.customerNumber === "string" ? corpo.customerNumber : undefined,
          neighborhood: typeof corpo?.customerNeighborhood === "string" ? corpo.customerNeighborhood : undefined,
          city: loja.city || undefined,
        };
        const modo = modoDaArea(loja as any);
        const cotacao = cotacaoDoPedido(corpo?.cotacao, {
          loja: lojaId,
          endereco: { ...partes, address: f.customerAddress },
          coords: null,
        });
        let entrega: EntregaDoPedido;
        if (cotacao) {
          entrega = entregaDaCotacao(cotacao, modo, null);
        } else {
          const avaliacao = await comPrazo<VeredictoDeEntrega>(
            avaliarEntrega(loja as any, {
              endereco: f.customerAddress,
              coords: null,
              bairro: partes.neighborhood,
              partes: partes.street || partes.number || partes.neighborhood ? partes : undefined,
            }),
            PRAZO_DO_MAPA_MS,
          ).catch(() => null);
          entrega = entregaDoVeredicto(avaliacao?.noPrazo ? avaliacao.valor : null, null, modo);
        }
        campos = camposDaEntrega(entrega, lerRegraDeRepasse(loja.deliveryConfig), loja.deliveryZones);
        notasDeEntrega = notasDaEntrega(entrega, { canal: "balcao", taxaCobrada: f.taxa });
      } catch (e: any) {
        console.error(`[Finalizar rascunho] entrega do pedido ${order.id} sem medida:`, e?.message || e);
      }
    }

    // Estoque disponível: o rascunho não conta como venda (STATUS_QUE_NAO_CONTAM);
    // ao virar pedido ele passa a contar, então confere-se agora.
    const estoque = await conferirEstoque(lojaId, order.items);
    if (!estoque.ok) {
      return NextResponse.json({ error: `${estoque.mensagem} Ajuste o pedido com o cliente.` }, { status: 409 });
    }

    const status = statusDaFinalizacao(loja?.chatbotConfig);
    const dailyOrderNumber = order.dailyOrderNumber || (await generateDailyOrderNumber(lojaId));
    const quem = nomeDoOperador(operador);
    const totalAmount = totalComATaxa(order.totalAmount, order.deliveryFee, f.taxa);

    // Só grava se AINDA é rascunho: o robô (o cliente voltou a falar) ou a
    // faxina podem ter mexido nele enquanto a janela estava aberta.
    const gravados = await prisma.customerOrder.updateMany({
      where: { id: order.id, franchiseeId: lojaId, status: "CRIANDO_IA" },
      data: {
        status,
        dailyOrderNumber,
        // O pedido nasce AGORA (o mesmo que o robô faz no fechamento): com a
        // hora do rascunho, a impressão e o prazo de entrega contariam desde a
        // primeira mensagem do cliente.
        createdAt: new Date(),
        printedAt: null,
        customerName: f.customerName,
        ...(f.customerPhone ? { customerPhone: f.customerPhone } : {}),
        customerAddress: f.customerAddress || order.customerAddress || "",
        deliveryType: f.tipo,
        paymentMethod: f.paymentMethod,
        changeAmount: f.troco,
        deliveryFee: f.taxa,
        totalAmount,
        ...(f.tipo === "DELIVERY"
          ? {
              ...(campos?.deliveryDistance != null ? { deliveryDistance: campos.deliveryDistance } : {}),
              ...(campos?.customerLatLng ? { customerLatLng: campos.customerLatLng as any } : {}),
              ...(campos?.motoboyFee != null ? { motoboyFee: campos.motoboyFee } : {}),
            }
          : { deliveryDistance: null, motoboyFee: null }),
        // Entrega cobrada deixou de ser grátis: a nota não pode mostrar "grátis" ao lado da taxa.
        ...(f.taxa > 0 && order.entregaGratis != null ? { entregaGratis: Prisma.DbNull } : {}),
        notes: notasDaFinalizacao(order.notes, quem, f.observacao, notasDeEntrega),
      },
    });
    if (gravados.count !== 1) {
      return NextResponse.json(
        { error: "O rascunho mudou enquanto você completava (o cliente voltou a falar com o robô, ou ele foi cancelado). Abra de novo e confira." },
        { status: 409 },
      );
    }

    console.log(`[Finalizar rascunho] pedido ${order.id} (#${dailyOrderNumber}) finalizado por ${quem}: ${status}, total R$ ${totalAmount}, entrega R$ ${f.taxa}`);

    const completo = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { items: { include: { menuProduct: true } } },
    });

    // Comanda na fila — o mesmo do fechamento pelo robô.
    try {
      if (completo) {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        pushJobToPrintQueue(lojaId, completo);
      }
    } catch (e: any) {
      console.error("[Finalizar rascunho] Erro ao enfileirar a comanda:", e?.message || e);
    }

    // Aceito direto: a baixa de insumo que a rota de status faz no ACEITO.
    if (status === "ACEITO") {
      import("@/lib/stock")
        .then(({ deductStockForOrder }) => deductStockForOrder(order.id))
        .catch((e) => console.error("[Finalizar rascunho] Erro ao deduzir estoque:", e?.message || e));
    }

    // O robô passou a conversa sem confirmar nada: o cliente recebe o "Pedido
    // recebido" com itens e total, como no pedido do site (a loja pode ter
    // desligado esses avisos — a própria função respeita).
    import("@/lib/order-notifications")
      .then(({ sendOrderNotification }) => sendOrderNotification(order.id, "CREATED"))
      .catch((e) => console.warn("[Finalizar rascunho] Aviso ao cliente falhou:", e?.message || e));

    return NextResponse.json({ success: true, order: completo });
  } catch (error: any) {
    console.error("[Finalizar rascunho POST]", error);
    return NextResponse.json({ error: "Erro ao finalizar o pedido" }, { status: 500 });
  }
}
