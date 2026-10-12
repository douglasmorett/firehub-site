/**
 * GET /api/app-da-loja/pedidos?ids=<id>,<id>,...
 *
 * A aba "Pedidos" do app próprio da loja (apps/loja). O app guarda no celular
 * os ids dos pedidos feitos por ele e pergunta aqui como cada um está. O id é
 * o segredo de quem pediu — o mesmo que abre /loja/<slug>/pedido/<id> —, então
 * isto devolve o que aquela página já mostra, e nada sobre quem não está na lista.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const MAXIMO = 30;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`app-loja-pedidos:${ip}`, { windowMs: 60_000, maxRequests: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "Muitas requisições." }, { status: 429 });

  const ids = String(req.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{8,40}$/.test(s))
    .slice(0, MAXIMO);
  if (ids.length === 0) return NextResponse.json({ pedidos: [] });

  const linhas = await prisma.customerOrder.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      dailyOrderNumber: true,
      totalAmount: true,
      deliveryType: true,
      createdAt: true,
      updatedAt: true,
      franchisee: { select: { storeName: true, slug: true } },
      items: { select: { quantity: true, productName: true, menuProduct: { select: { name: true } } }, take: 4 },
    },
  });

  const pedidos = linhas.map((p) => ({
    id: p.id,
    status: p.status,
    numero: p.dailyOrderNumber,
    total: Number(p.totalAmount) || 0,
    retirada: p.deliveryType !== "DELIVERY",
    criadoEm: p.createdAt,
    atualizadoEm: p.updatedAt,
    loja: p.franchisee?.storeName ?? null,
    slug: p.franchisee?.slug ?? null,
    resumo: p.items
      .map((i) => `${i.quantity}x ${i.productName || i.menuProduct?.name || "Item"}`)
      .join(", ")
      .slice(0, 140),
  }));
  return NextResponse.json({ pedidos });
}
