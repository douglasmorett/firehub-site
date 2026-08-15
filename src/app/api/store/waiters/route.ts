import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

async function getFranchiseeId() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true }
  });
  if (!dbUser) return null;
  return dbUser.ownerId || dbUser.id;
}

export async function GET(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const waiters = await prisma.waiter.findMany({
      where: { franchiseeId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(waiters);
  } catch (error: any) {
    console.error("GET Waiters Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = await req.json();
    if (!data.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const waiter = await prisma.waiter.create({
      data: {
        franchiseeId,
        name: data.name,
        phone: data.phone || null,
        commissionRate: data.commissionRate !== undefined ? Number(data.commissionRate) : 10,
        active: data.active !== undefined ? data.active : true,
      },
    });
    return NextResponse.json(waiter);
  } catch (error: any) {
    console.error("POST Waiter Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = await req.json();
    if (!data.id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const waiter = await prisma.waiter.update({
      where: { id: data.id, franchiseeId },
      data: {
        name: data.name,
        phone: data.phone,
        commissionRate: data.commissionRate !== undefined ? Number(data.commissionRate) : undefined,
        active: data.active,
      },
    });
    return NextResponse.json(waiter);
  } catch (error: any) {
    console.error("PUT Waiter Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    await prisma.waiter.delete({
      where: { id, franchiseeId },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE Waiter Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
