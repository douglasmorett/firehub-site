import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria a tabela "PrazoVisita" — o medidor da página de venda /prazos.
 *
 * Por que uma rota em vez de `prisma db push`, e por que isso é seguro: vale
 * palavra por palavra o que está escrito em /api/admin/colunas-preco. Resumo:
 * a DATABASE_URL de produção não está na mão de ninguém, mas a aplicação já
 * está conectada; o SQL é fixo no código; é ADITIVO (CREATE TABLE IF NOT
 * EXISTS) e idempotente; e sem `?criar=sim` esta rota só CONSULTA.
 *
 * A tabela fica FORA do schema.prisma de propósito. Quem lê e escreve nela é
 * SQL cru, em dois lugares só (/api/prazos/visita e o painel). Assim, se a
 * tabela não existir ainda, o que quebra é o painel de métricas — e não toda
 * consulta do site que use `include`, que foi o jeito de derrubar o cardápio
 * em 24/08/2026.
 *
 * Uma linha por VISITA, não por evento: a página é uma só e o que interessa
 * é o comportamento da pessoa (quanto tempo ficou, até onde rolou, se
 * clicou). Evento a evento encheria a tabela de lixo para responder as
 * mesmas perguntas.
 *
 * Nada de dado pessoal: sem IP, sem e-mail, sem cookie que atravesse
 * domínio. `sessao` é um id aleatório que vive no sessionStorage daquela
 * aba — fechou a aba, acabou.
 *
 * Uso:
 *   GET /api/admin/prazos-visitas            → diz se a tabela existe
 *   GET /api/admin/prazos-visitas?criar=sim  → cria (pode rodar de novo)
 */

const SQL_CRIAR = `
  CREATE TABLE IF NOT EXISTS "PrazoVisita" (
    "sessao"       TEXT PRIMARY KEY,
    "em"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagina"       TEXT,
    "origem"       TEXT,
    "campanha"     TEXT,
    "conteudo"     TEXT,
    "gatilho"      TEXT,
    "referencia"   TEXT,
    "dispositivo"  TEXT,
    "segundos"     INTEGER NOT NULL DEFAULT 0,
    "rolagem"      INTEGER NOT NULL DEFAULT 0,
    "cliquesCta"   INTEGER NOT NULL DEFAULT 0,
    "cliquesZap"   INTEGER NOT NULL DEFAULT 0,
    "planoVisto"   INTEGER,
    "marcos"       JSONB NOT NULL DEFAULT '[]'::jsonb
  );
`;

const SQL_INDICES = [
  `CREATE INDEX IF NOT EXISTS "PrazoVisita_em_idx" ON "PrazoVisita" ("em");`,
  `CREATE INDEX IF NOT EXISTS "PrazoVisita_origem_idx" ON "PrazoVisita" ("origem");`,
];

async function existe(): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ existe: boolean }[]>(
    `SELECT to_regclass('public."PrazoVisita"') IS NOT NULL AS existe;`,
  );
  return !!r?.[0]?.existe;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Só ADMIN" }, { status: 403 });
  }

  const criar = req.nextUrl.searchParams.get("criar") === "sim";

  try {
    if (!criar) {
      const ja = await existe();
      return NextResponse.json({
        tabela: "PrazoVisita",
        existe: ja,
        ...(ja ? { total: await contar() } : { comoCriar: "adicione ?criar=sim nesta URL" }),
      });
    }

    await prisma.$executeRawUnsafe(SQL_CRIAR);
    for (const sql of SQL_INDICES) await prisma.$executeRawUnsafe(sql);

    return NextResponse.json({ ok: true, tabela: "PrazoVisita", existe: await existe(), total: await contar() });
  } catch (err: any) {
    console.error("[prazos-visitas]", err?.message);
    return NextResponse.json({ error: err?.message || "Falhou" }, { status: 500 });
  }
}

async function contar(): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "PrazoVisita";`);
  return Number(r?.[0]?.n ?? 0);
}
