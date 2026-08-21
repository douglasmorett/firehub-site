import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-store-token",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "E-mail e senha são obrigatórios" }, { status: 400, headers: corsHeaders });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanEmail },
          { email: { startsWith: cleanEmail.split("@")[0] } },
        ]
      },
    });

    if (!user) {
      return NextResponse.json({ error: "E-mail não cadastrado no FireHub" }, { status: 401, headers: corsHeaders });
    }

    let isValid = false;
    if (user.password) {
      isValid = await bcrypt.compare(password, user.password).catch(() => false);
    }

    // SEGURANÇA: Senha validada EXCLUSIVAMENTE via bcrypt — sem bypass

    if (!isValid) {
      return NextResponse.json({ error: "Senha incorreta para esta loja" }, { status: 401, headers: corsHeaders });
    }

    return NextResponse.json({
      success: true,
      token: user.id,
      storeName: user.storeName || user.name || "Hakim Centro",
      email: user.email,
    }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("[Extension Login API Error]", err);
    return NextResponse.json({ error: "Erro ao autenticar no servidor" }, { status: 500, headers: corsHeaders });
  }
}
