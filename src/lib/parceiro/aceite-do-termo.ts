/**
 * O ACEITE DO TERMO DE COMISSIONAMENTO (lib/parceiro/termo-de-comissionamento.ts)
 * — tabela própria, criada por SQL cru no primeiro uso (sem migration), uma
 * linha por aceite: quem, qual versão, quando, de que IP e com que navegador.
 *
 * O aceite libera o PORTAL (o vendedor vê o termo antes das abas). O pagamento
 * NÃO depende dele: o split segue a regra de quem atende (lib/parceiro/regras.ts).
 */
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { VERSAO_DO_TERMO_DE_COMISSIONAMENTO } from "@/lib/parceiro/termo-de-comissionamento";

let pronta: Promise<boolean> | null = null;

export function garantirTabelaDoAceite(): Promise<boolean> {
  if (!pronta) {
    pronta = (async () => {
      try {
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AceiteDoTermoDeComissao" (
          id TEXT PRIMARY KEY,
          "ambassadorId" TEXT NOT NULL,
          versao TEXT NOT NULL,
          "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
          ip TEXT,
          "userAgent" TEXT
        )`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AceiteDoTermoDeComissao_ambassadorId_idx" ON "AceiteDoTermoDeComissao" ("ambassadorId", "aceitoEm")`);
        return true;
      } catch (e) {
        console.error("[Termo de comissionamento] Não deu para criar a tabela:", (e as Error)?.message);
        pronta = null;
        return false;
      }
    })();
  }
  return pronta;
}

export type Aceite = { versao: string; aceitoEm: string; ip: string | null; userAgent: string | null };

/** O último aceite de cada parceiro (para o admin). */
export async function ultimosAceites(ids: string[]): Promise<Map<string, Aceite>> {
  const saida = new Map<string, Aceite>();
  if (!ids.length || !(await garantirTabelaDoAceite())) return saida;
  const linhas = await prisma.$queryRaw<{ ambassadorId: string; versao: string; aceitoEm: string; ip: string | null; userAgent: string | null }[]>`
    SELECT DISTINCT ON ("ambassadorId") "ambassadorId", versao, ("aceitoEm"::text) AS "aceitoEm", ip, "userAgent"
    FROM "AceiteDoTermoDeComissao" WHERE "ambassadorId" = ANY(${ids})
    ORDER BY "ambassadorId", "aceitoEm" DESC`;
  for (const l of linhas) {
    // timestamp sem fuso, gravado em UTC (memória hora-do-banco-pelo-driver-neon-vem-deslocada).
    saida.set(l.ambassadorId, { versao: l.versao, aceitoEm: new Date(l.aceitoEm.replace(" ", "T") + "Z").toISOString(), ip: l.ip, userAgent: l.userAgent });
  }
  return saida;
}

/** Ele já aceitou a versão vigente? */
export async function aceitouAVersaoVigente(ambassadorId: string): Promise<boolean> {
  const a = (await ultimosAceites([ambassadorId])).get(ambassadorId);
  return !!a && a.versao === VERSAO_DO_TERMO_DE_COMISSIONAMENTO;
}

/** Grava o aceite da versão vigente (idempotente: aceitar de novo grava outra linha, a mais recente vale). */
export async function registrarAceite(ambassadorId: string, ip: string | null, userAgent: string | null): Promise<Aceite> {
  if (!(await garantirTabelaDoAceite())) throw new Error("Não deu para registrar o aceite agora. Tente de novo.");
  const agora = new Date();
  await prisma.$executeRaw`
    INSERT INTO "AceiteDoTermoDeComissao" (id, "ambassadorId", versao, "aceitoEm", ip, "userAgent")
    VALUES (${randomUUID()}, ${ambassadorId}, ${VERSAO_DO_TERMO_DE_COMISSIONAMENTO}, (${agora.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${ip ? ip.slice(0, 80) : null}, ${userAgent ? userAgent.slice(0, 400) : null})`;
  return { versao: VERSAO_DO_TERMO_DE_COMISSIONAMENTO, aceitoEm: agora.toISOString(), ip, userAgent };
}
