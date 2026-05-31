import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORÁRIO — Verifica e corrige role de usuário.
 * GET /api/admin/check-role?email=xxx
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email");

  if (!email) {
    // List all users with their roles
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, city: true, cpfCnpj: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ users });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, city: true, cpfCnpj: true, isFranqueadoHakim: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found", email }, { status: 404 });
  }

  return NextResponse.json({ user });
}

/**
 * POST /api/admin/check-role  { email, role }
 * Corrige a role de um usuário
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { email, role } = await req.json();
  if (!email || !role) {
    return NextResponse.json({ error: "email and role required" }, { status: 400 });
  }

  if (!["FRANCHISEE", "ADMIN"].includes(role)) {
    return NextResponse.json({ error: "role must be FRANCHISEE or ADMIN" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { role },
    select: { id: true, email: true, name: true, role: true },
  });

  return NextResponse.json({ success: true, user: updated });
}
