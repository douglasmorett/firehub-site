/**
 * API de Recuperação de Senha
 * POST /api/auth/forgot-password  → gera token e envia email
 * POST /api/auth/reset-password   → valida token e atualiza senha
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const APP_URL = process.env.NEXTAUTH_URL || "https://firehubfood.com.br";

// ── POST /api/auth/forgot-password ────────────────────────────────
export async function POST(req: NextRequest) {
  // Rate limiting: 3 tentativas por 5 minutos por IP
  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`forgot:${ip}`, { windowMs: 300_000, maxRequests: 3 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em 5 minutos." },
      { status: 429 }
    );
  }

  const resend = new Resend(process.env.RESEND_API_KEY || "placeholder");
  const { email, newPassword, token } = await req.json();

  // FLUXO 1 — Solicitar recuperação de senha
  if (email && !token) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    // Mesmo que não encontre, retorna sucesso (segurança)
    if (!user) return NextResponse.json({ ok: true });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExp = new Date(Date.now() + 1000 * 60 * 60); // 1 hora

    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExp },
    });

    const resetUrl = `${APP_URL}/redefinir-senha?token=${resetToken}`;

    await resend.emails.send({
      from: "FireHub <onboarding@resend.dev>",
      to: email,
      subject: "🔥 Redefinição de senha — FireHub",
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <div style="background: linear-gradient(135deg, #DC2626, #B91C1C); padding: 32px; text-align: center;">
            <h1 style="color: #fff; font-size: 1.8rem; font-weight: 800; margin: 0;">🔥 FIRE<span style="font-weight: 400;">HUB</span></h1>
          </div>
          <div style="padding: 40px 32px;">
            <h2 style="color: #1E293B; font-size: 1.2rem; margin: 0 0 12px;">Redefinição de senha</h2>
            <p style="color: #64748B; font-size: 0.95rem; line-height: 1.6; margin: 0 0 28px;">
              Recebemos uma solicitação para redefinir a senha da sua conta FireHub.<br>
              Clique no botão abaixo para criar uma nova senha.
            </p>
            <a href="${resetUrl}" style="display: block; background: linear-gradient(135deg, #DC2626, #B91C1C); color: #fff; text-decoration: none; padding: 14px 24px; border-radius: 10px; font-weight: 700; font-size: 1rem; text-align: center; margin-bottom: 24px;">
              🔐 Redefinir minha senha
            </a>
            <p style="color: #94A3B8; font-size: 0.78rem; text-align: center; margin: 0;">
              Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição, ignore este e-mail.
            </p>
          </div>
          <div style="background: #F8FAFC; padding: 16px 32px; text-align: center;">
            <p style="color: #CBD5E1; font-size: 0.72rem; margin: 0;">FireHub · Sistema de gestão para restaurantes</p>
          </div>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  }

  // FLUXO 2 — Redefinir senha com token
  if (token && newPassword) {
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExp: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Token inválido ou expirado." }, { status: 400 });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetToken: null, resetTokenExp: null },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
}
