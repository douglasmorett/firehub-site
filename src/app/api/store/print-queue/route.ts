import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Fila em memória por franqueado (rápido e sem overhead)
const queueMap = new Map<string, any[]>();
const queuedOrderKeys = new Set<string>();

export function pushJobToPrintQueue(targetId: string, order: any, storeName?: string, paperWidth?: string) {
  if (!targetId || !order) return;

  const statusUpper = (order.status || "").toUpperCase();
  if (statusUpper === "CRIANDO_IA" || statusUpper === "AGUARDANDO_PAGAMENTO") {
    console.log(`[PrintQueue] 🛑 Pedido #${order.dailyOrderNumber || order.id} está em rascunho (${statusUpper}). Ignorando impressão.`);
    return;
  }

  // Ignorar enfileiramento de pedidos antigos (criados há mais de 6 horas) para evitar a impressão retroativa de notas de ontem
  const orderCreatedTime = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
  if (Date.now() - orderCreatedTime > 6 * 60 * 60 * 1000) {
    console.log(`[PrintQueue] 🛑 Pedido #${order.dailyOrderNumber || order.id} criado há mais de 6h (ontem). Ignorando enfileiramento.`);
    return;
  }

  const candidateKeys = [
    order.id ? `${targetId}:id:${order.id}` : null,
    order.ifoodReference ? `${targetId}:ifood:${order.ifoodReference}` : null,
    order.openDeliveryReference ? `${targetId}:jotaja:${order.openDeliveryReference}` : null,
    order.openDeliveryOrderId ? `${targetId}:opd:${order.openDeliveryOrderId}` : null,
    order.dailyOrderNumber ? `${targetId}:seq:${order.dailyOrderNumber}` : null,
    order.orderSeqNumber ? `${targetId}:seq:${order.orderSeqNumber}` : null,
  ].filter(Boolean) as string[];

  const isAlreadyQueued = candidateKeys.some(k => queuedOrderKeys.has(k));
  if (isAlreadyQueued) {
    console.log(`[PrintQueue] ⚠️ Pedido #${order.dailyOrderNumber || order.orderSeqNumber || order.openDeliveryReference || order.ifoodReference || order.id} já enfileirado anteriormente. Ignorando duplicata.`);
    return;
  }

  for (const k of candidateKeys) {
    queuedOrderKeys.add(k);
  }

  if (queuedOrderKeys.size > 5000) {
    queuedOrderKeys.clear();
  }

  const job = {
    id: "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    order,
    storeName: storeName || "FIREHUB",
    paperWidth: paperWidth || "80mm",
    createdAt: new Date().toISOString(),
  };

  if (!queueMap.has(targetId)) {
    queueMap.set(targetId, []);
  }
  const q = queueMap.get(targetId)!;
  q.push(job);
  if (q.length > 50) q.shift();
  console.log(`[PrintQueue] 🖨️ Auto-print job ${job.id} enfileirado para o franqueado ${targetId}!`);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { franchiseeId, order, storeName, paperWidth } = body;

    let targetId = franchiseeId;
    if (!targetId && session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, ownerId: true }
      });
      targetId = u?.ownerId || u?.id;
    }

    if (!targetId) {
      return NextResponse.json({ error: "Franchisee ID obrigatorio" }, { status: 400 });
    }

    pushJobToPrintQueue(targetId, order, storeName, paperWidth);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const franchiseeId = searchParams.get("franchiseeId");
    const all = searchParams.get("all") === "true";
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

    const filterFreshJobs = (jobsList: any[]) => {
      return jobsList.filter(job => {
        const jobCreated = job.createdAt ? new Date(job.createdAt).getTime() : Date.now();
        const orderCreated = job.order?.createdAt ? new Date(job.order.createdAt).getTime() : jobCreated;
        return jobCreated >= sixHoursAgo && orderCreated >= sixHoursAgo;
      });
    };

    if (all || !franchiseeId) {
      const allJobs: any[] = [];
      for (const [_, jobs] of queueMap.entries()) {
        allJobs.push(...filterFreshJobs(jobs));
      }
      queueMap.clear();
      return NextResponse.json({ jobs: allJobs });
    }

    const q = queueMap.get(franchiseeId) || [];
    queueMap.set(franchiseeId, []);
    return NextResponse.json({ jobs: filterFreshJobs(q) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
