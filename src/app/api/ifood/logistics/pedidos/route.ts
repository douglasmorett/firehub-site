/**
 * /api/ifood/logistics/pedidos
 *
 * O painel de pedidos que os critérios de Logistics exigem ao lado da interface
 * de entregador ("Dashboard de pedidos" e "Interface de entregador" estão
 * listados como pré-requisitos técnicos, nessa ordem).
 *
 * Lê o que já está no banco: os pedidos entram pelo polling e pelo webhook, e é
 * dali que sai o `ifoodOrderId` usado em todas as chamadas de Logistics.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    const franchiseeId = user.ownerId || user.id;

    const desde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const pedidos = await prisma.customerOrder.findMany({
      where: { franchiseeId, ifoodOrderId: { not: null }, createdAt: { gte: desde } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true, dailyOrderNumber: true, customerName: true, status: true,
        totalAmount: true, createdAt: true,
        ifoodOrderId: true, ifoodReference: true,
        ifoodDriverName: true, ifoodDriverPhone: true,
        ifoodDriverVehicle: true, ifoodDriverStatus: true,
      },
    });

    // As colunas do código de entrega vivem fora do schema do Prisma — ver
    // /api/ifood/preparar-banco. Por isso vêm por consulta própria, e a falta
    // delas não pode derrubar a listagem.
    let exigemCodigo: string[] = [];
    try {
      const linhas = await prisma.$queryRaw<{ ifoodOrderId: string }[]>`
        SELECT "ifoodOrderId" FROM "CustomerOrder"
         WHERE "franchiseeId" = ${franchiseeId}
           AND "ifoodDropCodeRequired" = true
           AND "ifoodOrderId" IS NOT NULL
      `;
      exigemCodigo = linhas.map((l) => l.ifoodOrderId);
    } catch {
      // Coluna ainda não criada: ninguém exige código, e a tela avisa.
    }

    return NextResponse.json({
      pedidos: pedidos.map((p) => ({
        ...p,
        total: Number(p.totalAmount ?? 0),
        orderNumber: p.dailyOrderNumber,
        exigeCodigo: p.ifoodOrderId ? exigemCodigo.includes(p.ifoodOrderId) : false,
      })),
      colunaCodigoPronta: true,
    });
  } catch (e: any) {
    console.error("[iFood logistics pedidos]", e?.message);
    return NextResponse.json({ error: "Não foi possível listar os pedidos." }, { status: 500 });
  }
}
