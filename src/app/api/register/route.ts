import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// CORS headers for cross-origin requests from firehubfood.com.br
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, phone, storeName, cnpj, cpf, city } = await req.json();

    // Validações básicas
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nome, e-mail e senha são obrigatórios." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 6 caracteres." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!cnpj) {
      return NextResponse.json(
        { error: "O CNPJ da empresa é obrigatório." },
        { status: 400, headers: corsHeaders }
      );
    }

    // Normalizar CNPJ (somente números)
    const cnpjClean = cnpj.replace(/\D/g, "");
    if (cnpjClean.length !== 14) {
      return NextResponse.json(
        { error: "CNPJ inválido." },
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Verificar se o CNPJ já está cadastrado (bloqueio principal — não importa o email)
    const existingByCnpj = await prisma.user.findFirst({
      where: { cpfCnpj: cnpjClean },
    });
    if (existingByCnpj) {
      return NextResponse.json(
        { error: "Este CNPJ já possui uma conta cadastrada no FireHub. Faça login ou entre em contato com o suporte." },
        { status: 409, headers: corsHeaders }
      );
    }

    // 2. Verificar se o email já existe
    const existingByEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingByEmail) {
      return NextResponse.json(
        { error: "Este e-mail já está cadastrado. Tente fazer login." },
        { status: 409, headers: corsHeaders }
      );
    }

    // Gerar slug único a partir do nome do restaurante
    const storeNameFinal = storeName || name;
    const baseSlug = storeNameFinal
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.user.findUnique({ where: { slug } })) {
      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário com role FRANCHISEE (dono de restaurante)
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: "FRANCHISEE",
        storeName: storeNameFinal,
        storePhone: phone || null,
        city: city || null,
        cpfCnpj: cnpjClean,
        slug,
        permissions: "",
        isFranqueadoHakim: false,
        storeOpen: true,
        cashOpen: false,
        autoAcceptOrders: false,
        storeAlertSound: "bell",
        storeOrderCount: 0,
        planPercent: 2,
        storeHours: {
          seg: { open: "09:00", close: "22:00", active: true },
          ter: { open: "09:00", close: "22:00", active: true },
          qua: { open: "09:00", close: "22:00", active: true },
          qui: { open: "09:00", close: "22:00", active: true },
          sex: { open: "09:00", close: "23:00", active: true },
          sab: { open: "09:00", close: "23:00", active: true },
          dom: { open: "09:00", close: "22:00", active: true },
        },
        paymentFees: {
          pix: true,
          credit: true,
          debit: true,
          cash: true,
          voucher: false,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Conta criada com sucesso!",
      userId: user.id,
      slug: user.slug,
      email: user.email,
      storeName: user.storeName,
    }, { headers: corsHeaders });
  } catch (error: unknown) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar conta. Tente novamente." },
      { status: 500, headers: corsHeaders }
    );
  }
}
