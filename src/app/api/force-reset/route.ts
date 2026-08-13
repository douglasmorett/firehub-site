import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== "12345") return NextResponse.json({ error: "unauthorized" });

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: "contatohakim@gmail.com", mode: "insensitive" } }
    });

    if (!user) return NextResponse.json({ error: "User not found" });

    const newHash = await bcrypt.hash("123456", 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash }
    });

    return NextResponse.json({ success: true, message: "Password reset for " + user.email });
  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
