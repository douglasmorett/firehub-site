import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { storeId } = await context.params;
    const body = await request.json();
    const { asaasWalletId } = body;

    if (!asaasWalletId) {
      return NextResponse.json({ error: "Wallet ID is required" }, { status: 400 });
    }

    // Verify ownership
    const user = await prisma.user.findUnique({
      where: { id: storeId }
    });

    if (!user || user.email !== session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Update wallet ID
    await prisma.user.update({
      where: { id: storeId },
      data: { asaasWalletId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving wallet ID:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
