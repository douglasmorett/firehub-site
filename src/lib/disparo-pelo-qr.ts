/**
 * O que o disparo e a recuperação pelo QR Code (lado do servidor) dividem:
 * gravar no `chatbotConfig` sem atropelar o resto e saber quem pediu para
 * parar. O porquê do aceite está em lib/disparo-em-massa.ts.
 */
import { prisma } from "@/lib/prisma";
import { telefoneDaMeta } from "@/lib/disparo-oficial/regras";

/**
 * Junta `campos` no chatbotConfig da loja NO BANCO (jsonb `||`), sem reescrever
 * o objeto inteiro. Reescrever a partir de uma cópia lida antes desfazia o que
 * a loja mudou nesse meio tempo — o cron leva até uma hora por loja, e um
 * "desfazer o aceite" dado nesse intervalo voltava a valer como aceito.
 */
export async function mesclarNoChatbotConfig(lojaId: string, campos: Record<string, unknown>): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "chatbotConfig" =
       (CASE WHEN jsonb_typeof("chatbotConfig") = 'object' THEN "chatbotConfig" ELSE '{}'::jsonb END) || $2::jsonb
     WHERE "id" = $1`,
    lojaId,
    JSON.stringify(campos)
  );
}

/**
 * Quem tocou em "Parar promoções" no Disparo oficial desta loja. Pediu para
 * não receber promoção da loja: também não recebe pelo QR. Sem a tabela (boot
 * ainda não criou), ninguém.
 */
export async function descadastradosDaLoja(lojaId: string): Promise<Set<string>> {
  try {
    const linhas = await (prisma as any).disparoDescadastro.findMany({ where: { franchiseeId: lojaId }, select: { telefone: true } });
    return new Set<string>(linhas.map((l: any) => l.telefone));
  } catch {
    return new Set<string>();
  }
}

/** A chave de um telefone para comparar com o oficial (com 55 e com o 9). */
export function chaveDoTelefone(bruto: unknown): string {
  return telefoneDaMeta(bruto) || String(bruto ?? "").replace(/\D/g, "");
}
