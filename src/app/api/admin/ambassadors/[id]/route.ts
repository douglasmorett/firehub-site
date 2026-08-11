import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH: Atualiza um embaixador
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const data = await req.json();
    
    if (data.commissionPercent) {
      data.commissionPercent = parseFloat(data.commissionPercent);
    }
    
    if (data.code) {
      data.code = data.code.toLowerCase().trim();
    }

    const ambassador = await prisma.ambassador.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json(ambassador);
  } catch (error: any) {
    console.error("[Ambassadors API] PATCH error:", error);
    return NextResponse.json({ error: "Erro ao atualizar embaixador" }, { status: 500 });
  }
}

// DELETE: Remove um embaixador
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    await prisma.ambassador.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Ambassadors API] DELETE error:", error);
    return NextResponse.json({ error: "Erro ao excluir embaixador" }, { status: 500 });
  }
}
