import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const { name, role, phone, cpf, creditLimit, active } = await req.json();

  const employee = await prisma.storeEmployee.findUnique({ where: { id } });
  if (!employee) {
    return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  }

  const updated = await prisma.storeEmployee.update({
    where: { id },
    data: {
      ...(name && { name: name.trim() }),
      ...(role !== undefined && { role: role?.trim() || null }),
      ...(phone !== undefined && { phone: phone?.trim() || null }),
      ...(cpf !== undefined && { cpf: cpf?.trim() || null }),
      ...(creditLimit !== undefined && {
        creditLimit: creditLimit ? parseFloat(String(creditLimit)) : null,
      }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
  });

  return NextResponse.json({ success: true, employee: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  // Desativa o funcionário (soft delete para preservar histórico financeiro)
  const updated = await prisma.storeEmployee.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ success: true, employee: updated });
}
