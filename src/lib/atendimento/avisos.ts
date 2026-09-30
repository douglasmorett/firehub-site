import { prisma } from "@/lib/prisma";
import { mesmoTelefone } from "@/lib/telefone";
import { sendEmail } from "@/lib/mail";
import { avisarNumeroPeloFireHub, WHATSAPP_DO_DOUGLAS } from "@/lib/server-monitor";
import { configDoAtendimento } from "./config";

/**
 * Avisos da equipe: o dono ("pediram uma pessoa", "o número caiu") e o
 * vendedor ("contato novo na sua carteira", "marcaram na sua agenda").
 *
 * ── NADA SAI SOZINHO PELO WHATSAPP DO FIREHUB ───────────────────────────────
 *
 * Aquele número só RESPONDE quem escreveu (o robô, a tela, o celular). O
 * FireHub já perdeu um número por notificação automática — regra do Douglas,
 * 30/09/2026. Por isso:
 *   - o dono é avisado pelo canal de alertas internos de sempre
 *     (`avisarNumeroPeloFireHub`, o mesmo do "banco fora do ar"), só para o
 *     WhatsApp pessoal dele — ele não lê e-mail;
 *   - o vendedor é avisado por E-MAIL (o login dele no portal).
 */

export async function avisarDono(texto: string): Promise<boolean> {
  const config = await configDoAtendimento();
  const destino = config.avisarNoWhatsApp || WHATSAPP_DO_DOUGLAS;
  // O próprio número do atendimento não é destino de aviso.
  if (config.conexao.telefone && mesmoTelefone(destino, config.conexao.telefone)) return false;
  return avisarNumeroPeloFireHub(destino, texto).catch(() => false);
}

/**
 * O número é da própria equipe (o dono ou um vendedor)? Se alguém da equipe
 * escreve para o WhatsApp do FireHub, não pode virar lead novo com o robô
 * vendendo o sistema para o próprio vendedor.
 */
export async function numeroDaEquipe(telefone: string | null | undefined): Promise<boolean> {
  if (!telefone) return false;
  const config = await configDoAtendimento();
  if (mesmoTelefone(telefone, WHATSAPP_DO_DOUGLAS) || (config.avisarNoWhatsApp && mesmoTelefone(telefone, config.avisarNoWhatsApp))) return true;
  const equipe = await prisma.ambassador.findMany({ where: { isVendedor: true, phone: { not: null } }, select: { phone: true } });
  return equipe.some((v) => mesmoTelefone(telefone, v.phone));
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** E-mail curto para o vendedor: o que aconteceu e o botão para abrir no portal. */
export async function avisarVendedor(vendedorId: string, aviso: { assunto: string; texto: string; link: string }): Promise<boolean> {
  const config = await configDoAtendimento();
  if (!config.avisoAoVendedor) return false;
  const v = await prisma.ambassador.findUnique({ where: { id: vendedorId }, select: { name: true, email: true, active: true, isVendedor: true } });
  // Quem saiu da equipe não recebe mais aviso de lead.
  if (!v?.active || !v.isVendedor || !v.email) return false;
  const primeiroNome = v.name.split(/\s+/)[0];
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #0F172A;">
      <p style="font-size: 15px;">Oi, ${escapar(primeiroNome)}!</p>
      <p style="font-size: 15px; line-height: 1.5;">${escapar(aviso.texto).replace(/\n/g, "<br>")}</p>
      <p style="margin: 24px 0;">
        <a href="${escapar(aviso.link)}" style="background: #E8360C; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: 700;">Abrir no portal</a>
      </p>
      <p style="font-size: 12px; color: #64748B;">FireHub · área do vendedor</p>
    </div>`;
  try {
    const r = await sendEmail({ to: v.email, subject: aviso.assunto, html, text: `${aviso.texto}\n\n${aviso.link}` });
    return r.success;
  } catch {
    return false;
  }
}
