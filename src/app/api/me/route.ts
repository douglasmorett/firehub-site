import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ role: null, user: null }, { status: 401 });
  return NextResponse.json({
    id: (session.user as any)?.id || null,
    role: (session.user as any)?.role || null,
    email: session.user?.email || null,
    name: session.user?.name || null,
  });
}
