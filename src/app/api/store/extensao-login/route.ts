import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "E-mail e senha são obrigatórios" }, { status: 400 });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const user = await prisma.user.findFirst({
      where: { email: cleanEmail },
    });

    if (!user || !user.password) {
      return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      token: user.id,
      storeName: user.name || "Minha Loja FireHub",
      email: user.email,
    });
  } catch (err: any) {
    console.error("[Extension Login API Error]", err);
    return NextResponse.json({ error: "Erro ao autenticar" }, { status: 500 });
  }
}
