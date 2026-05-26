import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/ifood/fix-ownership
 * Reatribui todos os pedidos iFood para o usuário logado
 * e configura o ifoodMerchantId no perfil.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ifoodMerchantId: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const merchantId = process.env.IFOOD_MERCHANT_UUID;

  // 1. Atualizar ifoodMerchantId no perfil do usuário logado
  if (merchantId && user.ifoodMerchantId !== merchantId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { ifoodMerchantId: merchantId } as any,
    });
  }

  // 2. Encontrar todos os pedidos iFood que NÃO pertencem ao usuário logado
  const orphanOrders = await (prisma.customerOrder as any).findMany({
    where: {
      source: "IFOOD",
      franchiseeId: { not: user.id },
    },
    select: { id: true, ifoodReference: true, franchiseeId: true },
  });

  // 3. Reatribuir todos para o usuário logado
  if (orphanOrders.length > 0) {
    await (prisma.customerOrder as any).updateMany({
      where: {
        source: "IFOOD",
        franchiseeId: { not: user.id },
      },
      data: { franchiseeId: user.id },
    });
  }

  return NextResponse.json({
    success: true,
    userId: user.id,
    merchantIdSet: merchantId,
    reassigned: orphanOrders.length,
    reassignedOrders: orphanOrders.map((o: any) => ({
      id: o.id,
      ref: o.ifoodReference,
      oldFranchisee: o.franchiseeId,
    })),
  });
}
