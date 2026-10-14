/**
 * A ASSINATURA DO BILL, SEU ASSESSOR — R$ 29,90 por mês, no boleto da mensalidade.
 *
 * Douglas, 14/10/2026: "esse modo aí do meu assessor pode ser cobrado. A gente
 * já entrega muita funcionalidade sem cobrar". Cobrar no Asaas pelo boleto que
 * a loja já paga todo mês (lib/billing.ts → closeBillingCycle) dispensa
 * checkout novo, cartão novo e webhook novo: vira uma linha da fatura, como o
 * Totem e o Tráfego pago.
 *
 * A regra é a do termo que o dono aceita ao ligar (lib/assessor/termo.ts):
 * - ficou ativo em algum momento do mês = R$ 29,90 do mês inteiro, uma vez só,
 *   mesmo desligando e religando no mesmo dia;
 * - desligou: o mês seguinte não é cobrado (a não ser que ligue de novo).
 * Não há teste grátis (a primeira versão, de 14/10 cedo, tinha 7 dias e
 * cobrava proporcional; nunca foi publicada). `testeAte` continua no banco e na
 * conta só por compatibilidade.
 *
 * Loja isenta (parceiro, conta da casa) não paga: a regra é a mesma da
 * mensalidade (lojaIsenta, em billing.ts).
 */
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoAssessor } from "./estrutura-no-banco";
import { VERSAO_DO_TERMO_DO_BILL } from "./termo";

export const PRECO_DO_ASSESSOR = 29.9;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `aceite` = o termo aceito ao ligar este trecho. */
export type Periodo = { de: string; ate: string | null; aceite?: AceiteDoTermo };

export type EstadoDoAssessor = {
  ativo: boolean;
  /** O mês corrente já entra no boleto (ficou ativo em algum momento dele). */
  cobradoEsteMes: boolean;
  periodos: Periodo[];
};

function lerPeriodos(bruto: unknown): Periodo[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((p: any) => p && typeof p.de === "string")
    .map((p: any) => ({ ...p, de: p.de, ate: typeof p.ate === "string" ? p.ate : null }));
}

/**
 * Quanto o Bill custa no mês [inicio, fim). Puro, para o teste.
 * Ativo em qualquer instante do mês (fora de um teste antigo) = o mês inteiro.
 */
export function valorDoAssessorNoMes(
  periodos: Periodo[],
  testeAte: Date | string | null | undefined,
  inicio: Date,
  fim: Date,
  agora: Date = new Date(),
): number {
  const fimDoTeste = testeAte ? new Date(testeAte).getTime() : 0;
  const ini = Math.max(inicio.getTime(), fimDoTeste);
  const fimMs = fim.getTime();
  if (ini >= fimMs) return 0;
  const ativoNoMes = periodos.some((p) => {
    const de = Math.max(new Date(p.de).getTime(), ini);
    const ate = Math.min(p.ate ? new Date(p.ate).getTime() : Math.max(agora.getTime(), de + 1), fimMs);
    return ate > de;
  });
  return ativoNoMes ? PRECO_DO_ASSESSOR : 0;
}

async function mesCorrente(franchiseeId: string, agora: Date) {
  // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
  const { intervaloDoMes, getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeTimezone: true } });
  const tz = loja?.storeTimezone || "America/Sao_Paulo";
  return intervaloDoMes(getCurrentYearMonth(0, tz), tz);
}

export async function estadoDoAssessor(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDoAssessor> {
  const vazio: EstadoDoAssessor = { ativo: false, cobradoEsteMes: false, periodos: [] };
  if (!(await garantirEstruturaDoAssessor())) return vazio;
  const a = await prisma.assessorAssinatura.findUnique({ where: { franchiseeId } });
  if (!a) return vazio;
  const periodos = lerPeriodos(a.periodos);
  let cobradoEsteMes = false;
  try {
    const { monthStart, monthEnd } = await mesCorrente(franchiseeId, agora);
    cobradoEsteMes = valorDoAssessorNoMes(periodos, a.testeAte, monthStart, monthEnd, agora) > 0;
  } catch {}
  return { ativo: a.ativo, cobradoEsteMes, periodos };
}

/** Só a coluna `ativo`: roda em toda mensagem do dono e em toda página do painel. */
export async function assessorEstaLigado(franchiseeId: string): Promise<boolean> {
  try {
    if (!(await garantirEstruturaDoAssessor())) return false;
    const a = await prisma.assessorAssinatura.findUnique({ where: { franchiseeId }, select: { ativo: true } });
    return Boolean(a?.ativo);
  } catch {
    return false;
  }
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho, com o aceite do termo) ou desliga (fecha o trecho aberto).
 * Ligar sem o aceite da versão em vigor é recusado.
 */
export async function ligarOuDesligarAssessor(
  franchiseeId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDoAssessor> {
  if (!(await garantirEstruturaDoAssessor())) throw new Error("O Bill ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await prisma.assessorAssinatura.findUnique({ where: { franchiseeId } });
  const periodos = lerPeriodos(atual?.periodos);
  const iso = agora.toISOString();

  if (ligar) {
    if (atual?.ativo) return estadoDoAssessor(franchiseeId, agora);
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DO_BILL) {
      throw new TermoNaoAceitoError("Para ativar o Bill é preciso aceitar o termo de contratação.");
    }
    periodos.push({ de: iso, ate: null, aceite: { ...aceite, em: iso } });
    await prisma.assessorAssinatura.upsert({
      where: { franchiseeId },
      create: { franchiseeId, ativo: true, periodos: periodos as any },
      update: { ativo: true, periodos: periodos as any },
    });
  } else {
    if (!atual?.ativo) return estadoDoAssessor(franchiseeId, agora);
    for (const p of periodos) if (!p.ate) p.ate = iso;
    await prisma.assessorAssinatura.update({ where: { franchiseeId }, data: { ativo: false, periodos: periodos as any } });
  }
  return estadoDoAssessor(franchiseeId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDoAssessorNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDoAssessor())) return 0;
    const a = await prisma.assessorAssinatura.findUnique({ where: { franchiseeId } });
    if (!a) return 0;
    return valorDoAssessorNoMes(lerPeriodos(a.periodos), a.testeAte, inicio, fim);
  } catch (err: any) {
    console.error("[Assessor] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
