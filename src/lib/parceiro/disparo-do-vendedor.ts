/**
 * O que o VENDEDOR vê do disparo oficial (Douglas, 18/10/2026): só quanto ELE
 * ganha — por pacote e no mês. Margem do FireHub e custo da Meta não saem
 * daqui para a tela dele.
 */
import { prisma } from "@/lib/prisma";
import { custoMeta, precoPorDisparo } from "@/lib/disparo-oficial/regras";
import { COMISSAO_DO_DISPARO_PCT, ganhoPorPacote } from "@/lib/parceiro/regras";
import { custoDaDescricao } from "@/lib/performance-das-carteiras/regras";
import { intervaloDoMes, getCurrentYearMonth } from "@/lib/billing";

export const PACOTES_DE_EXEMPLO = [500, 1000, 2000, 5000];

/** "Pacote de N mensagens → você ganha R$ X", ao preço e custo de agora. */
export function pacotesDoVendedor(): { mensagens: number; ganho: number }[] {
  const preco = precoPorDisparo();
  const custo = custoMeta();
  return PACOTES_DE_EXEMPLO.map((m) => ({ mensagens: m, ganho: ganhoPorPacote(m, preco, custo) }));
}

/**
 * Quanto ele ganhou com disparo no mês: 3% da margem de cada recarga paga das
 * lojas que ele atende hoje (a mesma conta do split da recarga). Recarga
 * anterior ao split por recarga também entra na conta — é o que o combinado
 * daria; o que caiu de fato na carteira está no extrato do Asaas.
 */
export async function ganhoComDisparoNoMes(lojaIds: string[]): Promise<number> {
  if (!lojaIds.length) return 0;
  const { monthStart, monthEnd } = intervaloDoMes(getCurrentYearMonth(0));
  try {
    const recargas = await prisma.$queryRaw<{ valor: number; disparos: number; descricao: string | null }[]>`
      SELECT valor::float AS valor, disparos::int AS disparos, descricao FROM "DisparoRecarga"
      WHERE "franchiseeId" = ANY(${lojaIds}) AND status = 'PAGA' AND tipo <> 'AJUSTE'
        AND "pagaEm" >= ${monthStart} AND "pagaEm" < ${monthEnd}`;
    const atual = custoMeta();
    const total = recargas.reduce((s, r) => {
      const margem = Math.max(0, Number(r.valor) - Number(r.disparos) * (custoDaDescricao(r.descricao) ?? atual));
      return s + Math.floor(margem * COMISSAO_DO_DISPARO_PCT) / 100;
    }, 0);
    return Math.round(total * 100) / 100;
  } catch {
    return 0;
  }
}
