/**
 * A ASSINATURA DO MEU ASSESSOR — R$ 29,90 por mês, no boleto da mensalidade.
 *
 * Douglas, 14/10/2026: "esse modo aí do meu assessor pode ser cobrado. A gente
 * já entrega muita funcionalidade sem cobrar". Cobrar no Asaas pelo boleto que
 * a loja já paga todo mês (lib/billing.ts → closeBillingCycle) dispensa
 * checkout novo, cartão novo e webhook novo: vira uma linha da fatura, como o
 * Totem e o Tráfego pago.
 *
 * - A primeira ativação ganha 7 dias grátis; desligar e religar não renova.
 * - O mês cobra proporcional ao tempo ligado depois do teste: ligou no dia 20
 *   de um mês de 30, paga 11/30 de R$ 29,90. Nunca passa de R$ 29,90.
 * - Loja isenta (parceiro, conta da casa) não paga: a regra é a mesma da
 *   mensalidade (lojaIsenta, em billing.ts).
 */
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoAssessor } from "./estrutura-no-banco";

export const PRECO_DO_ASSESSOR = 29.9;
export const DIAS_DE_TESTE_DO_ASSESSOR = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export type Periodo = { de: string; ate: string | null };

export type EstadoDoAssessor = {
  ativo: boolean;
  testeAte: string | null;
  emTeste: boolean;
  /** Já usou o teste alguma vez (religar não dá outro). */
  jaTestou: boolean;
  periodos: Periodo[];
};

function lerPeriodos(bruto: unknown): Periodo[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((p: any) => p && typeof p.de === "string")
    .map((p: any) => ({ de: p.de, ate: typeof p.ate === "string" ? p.ate : null }));
}

/**
 * Quanto o assessor custa no mês [inicio, fim). Puro, para o teste.
 * Conta só o tempo ligado DEPOIS do teste grátis.
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
  let ligado = 0;
  for (const p of periodos) {
    const de = Math.max(new Date(p.de).getTime(), ini);
    const ate = Math.min(p.ate ? new Date(p.ate).getTime() : agora.getTime(), fimMs);
    if (ate > de) ligado += ate - de;
  }
  if (ligado <= 0) return 0;
  // Fração de dias, arredondada para cima: um dia começado conta inteiro.
  const diasDoMes = Math.round((fimMs - inicio.getTime()) / DIA_MS);
  const dias = Math.min(diasDoMes, Math.ceil(ligado / DIA_MS - 1e-9));
  return Math.round(((PRECO_DO_ASSESSOR * dias) / diasDoMes) * 100) / 100;
}

export async function estadoDoAssessor(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDoAssessor> {
  const vazio: EstadoDoAssessor = { ativo: false, testeAte: null, emTeste: false, jaTestou: false, periodos: [] };
  if (!(await garantirEstruturaDoAssessor())) return vazio;
  const a = await prisma.assessorAssinatura.findUnique({ where: { franchiseeId } });
  if (!a) return vazio;
  const testeAte = a.testeAte ? a.testeAte.toISOString() : null;
  return {
    ativo: a.ativo,
    testeAte,
    emTeste: Boolean(a.ativo && a.testeAte && a.testeAte.getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    periodos: lerPeriodos(a.periodos),
  };
}

export async function assessorEstaLigado(franchiseeId: string): Promise<boolean> {
  try {
    return (await estadoDoAssessor(franchiseeId)).ativo;
  } catch {
    return false;
  }
}

/** Liga (abre um trecho) ou desliga (fecha o trecho aberto). */
export async function ligarOuDesligarAssessor(franchiseeId: string, ligar: boolean, agora: Date = new Date()): Promise<EstadoDoAssessor> {
  if (!(await garantirEstruturaDoAssessor())) throw new Error("O Meu Assessor ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await prisma.assessorAssinatura.findUnique({ where: { franchiseeId } });
  const periodos = lerPeriodos(atual?.periodos);
  const iso = agora.toISOString();

  if (ligar) {
    if (atual?.ativo) return estadoDoAssessor(franchiseeId, agora);
    periodos.push({ de: iso, ate: null });
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DO_ASSESSOR * DIA_MS);
    await prisma.assessorAssinatura.upsert({
      where: { franchiseeId },
      create: { franchiseeId, ativo: true, testeAte, periodos: periodos as any },
      update: { ativo: true, testeAte, periodos: periodos as any },
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
