import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // format: "2026-05"

  let where = {};
  if (month) {
    const [y, m] = month.split("-").map(Number);
    where = {
      payDate: {
        gte: new Date(y, m - 1, 1),
        lt: new Date(y, m, 1),
      },
    };
  }

  const entries = await prisma.payrollEntry.findMany({
    where,
    orderBy: { payDate: "desc" },
  });
  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { name, type, role, amount, description, payDate } = await req.json();
  const entry = await prisma.payrollEntry.create({
    data: { name, type, role, amount: parseFloat(amount), description, payDate: new Date(payDate) },
  });
  return NextResponse.json(entry);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await req.json();
  await prisma.payrollEntry.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
