import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.toLowerCase().trim();
  
  if (!code) return NextResponse.json({ type: "none" });

  const amb = await prisma.ambassador.findUnique({ where: { code } });
  if (amb && amb.active) return NextResponse.json({ type: "ambassador" });

  const partner = await prisma.user.findFirst({
    where: { OR: [{ slug: code }, { id: code }] }
  });
  if (partner) return NextResponse.json({ type: "partner" });

  return NextResponse.json({ type: "invalid" });
}
