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

const rawAppUrl = process.env.NEXTAUTH_URL || "";
const APP_URL = (rawAppUrl && !rawAppUrl.includes("[SENSITIVE]") && rawAppUrl.startsWith("http"))
  ? rawAppUrl.replace(/\/$/, "")
  : "https://firehubfood.com.br";

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
    const cleanEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        email: { equals: cleanEmail, mode: "insensitive" }
      },
      select: { id: true, email: true, name: true },
    });

    // ── SEM DIZER QUAIS E-MAILS EXISTEM ─────────────────────────────────────
    //
    // Responder "E-mail não cadastrado" transformava esta rota numa lista de
    // clientes: bastava testar endereços e anotar quais davam erro. Com a lista
    // em mãos, o passo seguinte é força bruta de senha nas contas certas.
    //
    // A resposta agora é a MESMA existindo ou não a conta. Quem tem conta
    // recebe o e-mail; quem não tem, não recebe nada — e não fica sabendo.
    if (!user) {
      console.warn(`[forgot-password] Pedido para e-mail sem conta (resposta neutra).`);
      // Mesmo formato do caminho de sucesso — inclusive as chaves — para não
      // haver como distinguir os dois pela resposta.
      return NextResponse.json({ ok: true, provider: "enviado" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExp = new Date(Date.now() + 1000 * 60 * 60); // 1 hora

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExp },
    });

    const resetUrl = `${APP_URL}/redefinir-senha?token=${resetToken}`;

    const emailHtml = `
      <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #E2E8F0;">
        <div style="background: linear-gradient(135deg, #DC2626, #B91C1C); padding: 32px; text-align: center;">
          <h1 style="color: #fff; font-size: 1.8rem; font-weight: 800; margin: 0; letter-spacing: -0.5px;">🔥 FIRE<span style="font-weight: 400;">HUB</span></h1>
        </div>
        <div style="padding: 40px 32px;">
          <h2 style="color: #1E293B; font-size: 1.2rem; margin: 0 0 12px; font-weight: 700;">Redefinição de senha</h2>
          <p style="color: #64748B; font-size: 0.95rem; line-height: 1.6; margin: 0 0 28px;">
            Olá, <strong>${user.name || "Restaurante"}</strong>.<br>
            Recebemos uma solicitação para redefinir a senha da sua conta FireHub.<br>
            Clique no botão abaixo para criar sua nova senha com segurança.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #DC2626, #B91C1C); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 700; font-size: 1rem; box-shadow: 0 4px 14px rgba(220,38,38,0.35);">
              🔐 Redefinir Minha Senha
            </a>
          </div>
          <p style="color: #94A3B8; font-size: 0.8rem; line-height: 1.5; text-align: center; margin: 24px 0 0;">
            Este link expira em <strong>1 hora</strong>. Se você não fez essa solicitação, basta desconsiderar este e-mail.
          </p>
        </div>
        <div style="background: #F8FAFC; padding: 16px 32px; text-align: center; border-top: 1px solid #F1F5F9;">
          <p style="color: #94A3B8; font-size: 0.75rem; margin: 0;">FireHub · Sistema Integrado de Gestão para Restaurantes</p>
        </div>
      </div>
    `;

    const { sendEmail } = await import("@/lib/mail");
    const mailResult = await sendEmail({
      to: cleanEmail,
      subject: "🔥 Redefinição de senha — FireHub",
      html: emailHtml,
    });

    if (!mailResult.success) {
      console.error("[forgot-password] Falha no disparo de e-mail:", mailResult.error);
      return NextResponse.json(
        { 
          error: `Não foi possível enviar o e-mail: ${mailResult.error || "Provedor indisponível"}. Configure as credenciais de e-mail.` 
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, provider: mailResult.provider });
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

    if (newPassword.trim().length < 6) {
      return NextResponse.json({ error: "A senha deve ter no mínimo 6 caracteres." }, { status: 400 });
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
