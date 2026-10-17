/**
 * Gravar e ler QUEM ABRIU o caixa (`CashSession.abertoPor`).
 *
 * O caixa guardava quem FECHOU (`closedBy`) e nunca quem abriu: o Allan, da
 * Delícia de Casa, chegava na loja com o caixa aberto e não tinha como saber
 * se tinha sido ele, a esposa ou o funcionário da tarde (17/10/2026).
 *
 * Por SQL, e não pelo `prisma.cashSession`, de propósito:
 *   • a abertura NUNCA pode depender disto — se a coluna faltar, o caixa abre
 *     do mesmo jeito e só o "quem abriu" fica "—";
 *   • o cliente do Prisma das worktrees é compartilhado e não é regenerado a
 *     cada branch; pelo SQL, o tipo não depende de `prisma generate`.
 *
 * As regras (quem é dono, equipe ou suporte, e como ler o gravado) são puras
 * e moram em lib/resumo-do-caixa-aberto.ts.
 */
import { prisma } from "@/lib/prisma";
import { COLUNA_QUEM_ABRIU_O_CAIXA } from "@/lib/garantir-colunas";
import { lerQuemAbriu, type QuemAbriu } from "@/lib/resumo-do-caixa-aberto";

const faltaColuna = (e: any) => /abertoPor/.test(String(e?.message || "")) && /does not exist|não existe/i.test(String(e?.message || ""));

/**
 * Grava quem abriu. Se a coluna ainda não existe (boot que não conseguiu
 * criar), cria na hora e tenta de novo uma vez. Nunca lança.
 */
export async function gravarQuemAbriu(caixaId: string, lojaId: string, quem: QuemAbriu): Promise<boolean> {
  const json = JSON.stringify(quem);
  const gravar = () => prisma.$executeRaw`
    UPDATE "CashSession" SET "abertoPor" = ${json}::jsonb
    WHERE "id" = ${caixaId} AND "franchiseeId" = ${lojaId}
  `;
  try {
    await gravar();
    return true;
  } catch (e: any) {
    if (faltaColuna(e)) {
      try {
        await prisma.$executeRawUnsafe(COLUNA_QUEM_ABRIU_O_CAIXA);
        await gravar();
        return true;
      } catch (e2: any) {
        console.error("[Caixa] Não consegui gravar quem abriu o caixa (coluna):", e2?.message);
        return false;
      }
    }
    console.error("[Caixa] Não consegui gravar quem abriu o caixa:", e?.message);
    return false;
  }
}

/**
 * Lê quem abriu. `null` = não se sabe (caixa de antes de 17/10/2026, coluna
 * ausente, consulta que falhou) — a tela mostra "—", não um palpite.
 */
export async function lerQuemAbriuDoBanco(caixaId: string, lojaId: string): Promise<QuemAbriu | null> {
  try {
    const linhas = await prisma.$queryRaw<{ abertoPor: unknown }[]>`
      SELECT "abertoPor" FROM "CashSession"
      WHERE "id" = ${caixaId} AND "franchiseeId" = ${lojaId}
      LIMIT 1
    `;
    return lerQuemAbriu(linhas[0]?.abertoPor);
  } catch (e: any) {
    if (!faltaColuna(e)) console.warn("[Caixa] Não consegui ler quem abriu o caixa:", e?.message);
    return null;
  }
}
