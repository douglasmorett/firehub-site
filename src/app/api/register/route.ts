import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

// CORS headers for cross-origin requests from firehubfood.com.br
export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(req) });
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting: 5 registros por minuto por IP
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`register:${ip}`, { windowMs: 60_000, maxRequests: 5 });
    if (!allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Tente novamente em 1 minuto." },
        { status: 429, headers: getCorsHeaders(req) }
      );
    }

    const { name, email, password, phone, storeName, cnpj, cpf, city, repasseConfig, refCode } = await req.json();

    // Validações básicas
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nome, e-mail e senha são obrigatórios." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 6 caracteres." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    if (!cnpj) {
      return NextResponse.json(
        { error: "O CNPJ da empresa é obrigatório." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    // Normalizar CNPJ (somente números)
    const cnpjClean = cnpj.replace(/\D/g, "");
    if (cnpjClean.length !== 14) {
      return NextResponse.json(
        { error: "CNPJ inválido." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    // 1. Verificar se o CNPJ já está cadastrado (bloqueio principal — não importa o email)
    const existingByCnpj = await prisma.user.findFirst({
      where: { cpfCnpj: cnpjClean },
    });
    if (existingByCnpj) {
      return NextResponse.json(
        { error: "Este CNPJ já possui uma conta cadastrada no FireHub. Faça login ou entre em contato com o suporte." },
        { status: 409, headers: getCorsHeaders(req) }
      );
    }

    // 2. Verificar se o email já existe
    const existingByEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingByEmail) {
      return NextResponse.json(
        { error: "Este e-mail já está cadastrado. Tente fazer login." },
        { status: 409, headers: getCorsHeaders(req) }
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

    // Hash da senha com alto nível de segurança (rounds: 12)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Buscar embaixador ou parceiro por refCode (se existir)
    let ambassadorId = null;
    let referredById = null;
    if (refCode) {
      const code = String(refCode).toLowerCase().trim();
      const amb = await prisma.ambassador.findUnique({ where: { code } });
      if (amb && amb.active) {
        ambassadorId = amb.id;
      } else {
        const partner = await prisma.user.findFirst({
          where: {
            OR: [
              { slug: code },
              { id: code }
            ]
          }
        });
        if (partner) {
          referredById = partner.id;
        }
      }
    }

    // Calcula o prazo de trial: 30 dias se tiver embaixador, senão 15 dias (inclusive para indique e ganhe normal)
    const trialDays = ambassadorId ? 30 : 15;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

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
        ambassadorId,
        referredById,
        trialEndsAt,
        ...(repasseConfig && Object.keys(repasseConfig).length > 0 ? { repasseConfig } : {}),
        permissions: "",
        isFranqueadoHakim: false,
        storeOpen: true,
        cashOpen: false,
        autoAcceptOrders: false,
        storeAlertSound: "bell",
        storeOrderCount: 0,
        planPercent: 1,
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
    }, { headers: getCorsHeaders(req) });
  } catch (error: unknown) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar conta. Tente novamente." },
      { status: 500, headers: getCorsHeaders(req) }
    );
  }
}
