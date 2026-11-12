import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { embaixadorPeloCodigo } from "@/lib/codigo-do-embaixador";
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.toLowerCase().trim();
  
  if (!code) return NextResponse.json({ type: "none" });

  const amb = await embaixadorPeloCodigo(code);
  if (amb && amb.active) return NextResponse.json({ type: "ambassador" });

  const partner = await prisma.user.findFirst({
    where: { OR: [{ slug: code }, { id: code }] }
  });
  if (partner) return NextResponse.json({ type: "partner" });

  return NextResponse.json({ type: "invalid" });
}
