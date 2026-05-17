import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ role: null }, { status: 401 });
  return NextResponse.json({ role: (session.user as any)?.role || null });
}
