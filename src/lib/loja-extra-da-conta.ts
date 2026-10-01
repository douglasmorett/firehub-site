/**
 * LOJA EXTRA DA CONTA — a que o lojista abre pelo "Nova loja" do painel
 * (api/store/create), com `accountGroupId` apontando para a loja principal.
 *
 * Regra do dono (01/10/2026): é o MESMO cliente. A loja extra fica com o
 * vendedor e o embaixador da principal — o embaixador leva a comissão dela
 * também ("mesmo grupo, mesmo link"). O admin pode trocar os dois depois, no
 * seletor da aba Lojistas, como em qualquer loja.
 *
 * A loja nova já nasce com eles (api/store/create). Este arquivo acerta as que
 * nasceram antes da regra, como a Yakisoba do san, do China Pow.
 */
import { prisma } from "@/lib/prisma";

/**
 * A marca de que o acerto já rodou, numa linha da CrmConfig. Sem ela, todo
 * boot devolveria o vendedor à loja extra que o admin deixou "sem vendedor"
 * de propósito — a escolha dele tem que valer.
 */
const MARCA = "migracao:loja-extra-herda-da-principal";

/** Só a loja extra sem vendedor; vendedor parado ou excluído não é herdado. */
const VENDEDOR_DA_PRINCIPAL = `
  UPDATE "User" f
  SET "vendedorId" = m."vendedorId", "vendedorStatus" = 'AGUARDANDO', "vendedorAtribuidoEm" = NOW()
  FROM "User" m
  JOIN "Ambassador" a ON a."id" = m."vendedorId" AND a."isVendedor" = true AND a."active" = true
  WHERE f."accountGroupId" = m."id" AND f."id" <> m."id"
    AND f."role" = 'FRANCHISEE' AND f."vendedorId" IS NULL
`;

/** Só a loja extra sem embaixador; embaixador inativo não é herdado (como no cadastro). */
const EMBAIXADOR_DA_PRINCIPAL = `
  UPDATE "User" f
  SET "ambassadorId" = m."ambassadorId"
  FROM "User" m
  JOIN "Ambassador" a ON a."id" = m."ambassadorId" AND a."active" = true
  WHERE f."accountGroupId" = m."id" AND f."id" <> m."id"
    AND f."role" = 'FRANCHISEE' AND f."ambassadorId" IS NULL
`;

/**
 * Roda no boot (instrumentation.ts), depois das tabelas do CRM. Uma vez na
 * vida do banco: a marca e os dois UPDATEs vão na mesma transação — se um
 * UPDATE falhar, a marca volta junto e o próximo boot tenta de novo; duas
 * instâncias subindo juntas, só a que gravou a marca faz o acerto.
 */
export async function acertarLojasExtrasUmaVez(): Promise<void> {
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return;
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const marcou = await tx.$executeRawUnsafe(
        `INSERT INTO "CrmConfig" ("id", "dados", "atualizadoEm") VALUES ($1, '{}'::jsonb, NOW()) ON CONFLICT ("id") DO NOTHING`,
        MARCA,
      );
      if (Number(marcou) === 0) return null;
      const vendedor = await tx.$executeRawUnsafe(VENDEDOR_DA_PRINCIPAL);
      const embaixador = await tx.$executeRawUnsafe(EMBAIXADOR_DA_PRINCIPAL);
      return { vendedor: Number(vendedor), embaixador: Number(embaixador) };
    });
    if (resultado) {
      console.log(
        `[Boot] Lojas extras acertadas com a principal: ${resultado.vendedor} com vendedor, ${resultado.embaixador} com embaixador.`,
      );
    }
  } catch (err: any) {
    console.error(`[Boot] 🛑 Acerto das lojas extras falhou (tenta de novo no próximo boot): ${err?.message}`);
  }
}
