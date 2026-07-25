import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;
  const where = user.role === "ADMIN" ? {} : { franchiseeId: targetFranchiseeId };

  const products = await prisma.menuProduct.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, price: true, category: true,
      imageUrl: true, active: true, isCombo: true, isBeverage: true,
      activePDV: true, cost: true, tags: true, availableDays: true, description: true,
    },
  });

  return NextResponse.json(products);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const data = await req.json();
  const targetFranchiseeId = user.ownerId || user.id;
  const franchiseeId = user.role === "ADMIN" && data.franchiseeId ? data.franchiseeId : targetFranchiseeId;

  const { id, comboGroups, ...rest } = data;

  const product = await prisma.menuProduct.create({
    data: {
      ...rest,
      tags: rest.tags ? JSON.stringify(rest.tags) : null,
      availableDays: rest.availableDays ? JSON.stringify(rest.availableDays) : null,
      franchiseeId,
    }
  });

  return NextResponse.json(product);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const data = await req.json();
  const { id, comboGroups, ...updateData } = data;

  if (updateData.tags) {
    updateData.tags = JSON.stringify(updateData.tags);
  }
  if (updateData.availableDays !== undefined) {
    updateData.availableDays = updateData.availableDays ? JSON.stringify(updateData.availableDays) : null;
  }

  const product = await prisma.menuProduct.update({
    where: { id },
    data: updateData
  });

  return NextResponse.json(product);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const data = await req.json();
  
  try {
    await prisma.menuProduct.delete({ where: { id: data.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    // Soft delete if deletion fails due to relation constraints
    await prisma.menuProduct.update({ where: { id: data.id }, data: { active: false } });
    return NextResponse.json({ success: true, softDeleted: true });
  }
}
