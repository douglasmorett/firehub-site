import nodemailer from "nodemailer";
import { Resend } from "resend";

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface SendMailResult {
  success: boolean;
  provider: "resend" | "smtp" | "none";
  messageId?: string;
  error?: string;
}

export async function sendEmail({ to, subject, html, text, from }: SendMailOptions): Promise<SendMailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST || (process.env.GMAIL_USER ? "smtp.gmail.com" : "");
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  const smtpPort = Number(process.env.SMTP_PORT || (smtpHost.includes("gmail") ? 465 : 587));
  const defaultFrom = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "FireHub <noreply@firehubfood.com.br>";

  // 1. Tentar SMTP se configurado (Gmail / Hostinger / Zoho / etc.)
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: from || `FireHub <${smtpUser}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ""),
      });

      console.log("[sendEmail:SMTP] Enviado com sucesso:", info.messageId);
      return { success: true, provider: "smtp", messageId: info.messageId };
    } catch (err: any) {
      console.error("[sendEmail:SMTP] Erro no envio SMTP:", err);
      // Se tiver Resend como fallback, continua; senão retorna o erro
      if (!resendApiKey) {
        return { success: false, provider: "smtp", error: err.message || "Erro no servidor SMTP" };
      }
    }
  }

  // 2. Tentar Resend se configurado
  if (resendApiKey && resendApiKey.startsWith("re_")) {
    try {
      const resend = new Resend(resendApiKey);
      const { data, error } = await resend.emails.send({
        from: from || defaultFrom,
        to,
        subject,
        html,
      });

      if (error) {
        console.error("[sendEmail:Resend] Erro retornado pela API Resend:", error);
        return { success: false, provider: "resend", error: error.message || "Erro na API do Resend" };
      }

      console.log("[sendEmail:Resend] Enviado com sucesso:", data?.id);
      return { success: true, provider: "resend", messageId: data?.id };
    } catch (err: any) {
      console.error("[sendEmail:Resend] Exceção ao enviar via Resend:", err);
      return { success: false, provider: "resend", error: err.message || "Exceção no envio Resend" };
    }
  }

  // 3. Nenhum provedor configurado
  const msg = "Nenhum provedor de e-mail ativo configurado (configure RESEND_API_KEY ou credenciais SMTP/Gmail nas variáveis de ambiente).";
  console.error("[sendEmail] " + msg);
  return { success: false, provider: "none", error: msg };
}
