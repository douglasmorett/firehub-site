import { prisma } from "@/lib/prisma";
import { mesmoTelefone } from "@/lib/telefone";
import { avisarNumeroPeloFireHub, WHATSAPP_DO_DOUGLAS } from "@/lib/server-monitor";
import { configDoAtendimento } from "./config";

/**
 * Avisos da equipe: só o dono ("pediram uma pessoa", "o número caiu").
 *
 * ── NADA SAI SOZINHO PELO WHATSAPP DO FIREHUB ───────────────────────────────
 *
 * Aquele número só RESPONDE quem escreveu (o robô, a tela, o celular). O
 * FireHub já perdeu um número por notificação automática — regra do Douglas,
 * 30/09/2026. Por isso o dono é avisado pelo canal de alertas internos de
 * sempre (`avisarNumeroPeloFireHub`, o mesmo do "banco fora do ar"), só para
 * o WhatsApp pessoal dele — ele não lê e-mail.
 *
 * ── O VENDEDOR NÃO RECEBE AVISO NENHUM ──────────────────────────────────────
 *
 * Nem e-mail, nem WhatsApp (Douglas, 02/10/2026: "a gente não vai avisar o
 * vendedor de nada, ele tem o painel dele"). Contato novo na carteira, pedido
 * de pessoa e reunião na agenda aparecem no portal do vendedor (/vendedor),
 * e é de lá que ele entra em contato com cada um da carteira.
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
