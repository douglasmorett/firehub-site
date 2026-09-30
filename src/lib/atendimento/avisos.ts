import { prisma } from "@/lib/prisma";
import { mesmoTelefone } from "@/lib/telefone";
import { avisarNumeroPeloFireHub, WHATSAPP_DO_DOUGLAS } from "@/lib/server-monitor";
import { configDoAtendimento } from "./config";
import { enviarTexto } from "./whatsapp";

/**
 * Avisos da equipe pelo WhatsApp: o dono ("pediram uma pessoa", "o número
 * caiu") e o vendedor ("marcaram uma demonstração na sua agenda").
 *
 * O dono não lê e-mail — aviso para ele é WhatsApp, num número DIFERENTE do
 * atendimento (o campo "Avisar neste WhatsApp" da tela). Mandar para o
 * próprio número do FireHub não chega a ninguém, então é ignorado.
 */

export async function avisarDono(texto: string): Promise<boolean> {
  const config = await configDoAtendimento();
  const destino = config.avisarNoWhatsApp || WHATSAPP_DO_DOUGLAS;
  if (config.conexao.telefone && mesmoTelefone(destino, config.conexao.telefone)) return false;
  if (config.conexao.conectado) {
    const r = await enviarTexto(destino, texto);
    if (r.ok) return true;
  }
  // O número do FireHub fora do ar é justamente um dos avisos: sai pelo
  // número que o sistema já usa para avisar lojista de queda.
  return avisarNumeroPeloFireHub(destino, texto, { peloAtendimento: false }).catch(() => false);
}

/**
 * O número é da própria equipe (o dono ou um vendedor)? Quem recebe os avisos
 * pelo WhatsApp do FireHub às vezes responde "ok" — e isso não pode virar lead
 * novo com o robô vendendo o sistema para o próprio vendedor.
 */
export async function numeroDaEquipe(telefone: string | null | undefined): Promise<boolean> {
  if (!telefone) return false;
  const config = await configDoAtendimento();
  if (mesmoTelefone(telefone, WHATSAPP_DO_DOUGLAS) || (config.avisarNoWhatsApp && mesmoTelefone(telefone, config.avisarNoWhatsApp))) return true;
  const equipe = await prisma.ambassador.findMany({ where: { isVendedor: true, phone: { not: null } }, select: { phone: true } });
  return equipe.some((v) => mesmoTelefone(telefone, v.phone));
}

export async function avisarVendedor(vendedorId: string, texto: string): Promise<boolean> {
  const config = await configDoAtendimento();
  if (!config.avisoAoVendedor || config.conexao.conectado === false) return false;
  const v = await prisma.ambassador.findUnique({ where: { id: vendedorId }, select: { phone: true, active: true, isVendedor: true } });
  // Quem saiu da equipe não recebe mais aviso de lead — nem continua ativo como embaixador.
  if (!v?.active || !v.isVendedor || !v.phone) return false;
  if (config.conexao.telefone && mesmoTelefone(v.phone, config.conexao.telefone)) return false;
  const r = await enviarTexto(v.phone, texto);
  return r.ok;
}
