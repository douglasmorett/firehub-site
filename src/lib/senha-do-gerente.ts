/**
 * /src/lib/senha-do-gerente.ts
 *
 * Grava, lê e confere a SENHA DO GERENTE no banco (a regra mora em
 * lib/senha-do-gerente-regras.ts).
 *
 * ── A tabela fica fora do schema.prisma ─────────────────────────────────────
 * Como MotoboyPendencia e CashbackAjuste: SQL cru, `CREATE TABLE IF NOT EXISTS`
 * no boot (src/instrumentation.ts) e de novo no primeiro uso. Uma linha por
 * loja:
 *
 *   SenhaDoGerente  lojaId (chave) · hash (bcrypt) · exige (JSON: ação → true)
 *                   · atualizadoPor · updatedAt
 *
 * E fora da tabela User de propósito: há rota que lê o User inteiro e manda
 * campos para a tela; o hash aqui não pega carona em `findUnique` nenhum.
 *
 * Sem a tabela (o CREATE falhou), nenhuma loja tem senha — as ações seguem
 * como eram antes, e só salvar a configuração dá erro.
 */
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { horaEmUtc } from "@/lib/cashback-no-banco";
import {
  CABECALHO_DA_SENHA,
  CODIGO_SENHA_PEDIDA,
  FreioDaSenha,
  conferirSenhaDoGerenteCom,
  lerExigeSenha,
  senhaDoCabecalho,
  type AcaoProtegida,
  type ConfigDaSenha,
  type ExigeSenha,
  type ResultadoDaSenha,
} from "@/lib/senha-do-gerente-regras";

let tabelaOk = false;

/** A tabela existe? Uma vez por processo — e só marca DEPOIS de conseguir. Nunca lança. */
export async function garantirTabelaDaSenhaDoGerente(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SenhaDoGerente" (
      "lojaId" TEXT NOT NULL,
      "hash" TEXT,
      "exige" JSONB NOT NULL DEFAULT '{}',
      "atualizadoPor" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SenhaDoGerente_pkey" PRIMARY KEY ("lojaId")
    )`);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Senha do gerente] 🛑 Tabela SenhaDoGerente falhou: ${err?.message}`);
    return false;
  }
}

/** A configuração da loja, com o hash (só para o servidor). */
export async function lerConfigDaSenha(lojaId: string): Promise<ConfigDaSenha> {
  if (!(await garantirTabelaDaSenhaDoGerente())) return null;
  const linhas = await prisma.$queryRaw<{ hash: string | null; exige: unknown }[]>(Prisma.sql`
    SELECT "hash", "exige" FROM "SenhaDoGerente" WHERE "lojaId" = ${lojaId} LIMIT 1`);
  if (!linhas.length) return null;
  return { hash: linhas[0].hash || null, exige: lerExigeSenha(linhas[0].exige) };
}

/** O que a tela pode saber: se há senha e o que ela protege. Nunca o hash. */
export async function resumoDaSenha(lojaId: string): Promise<{ temSenha: boolean; exige: ExigeSenha }> {
  const c = await lerConfigDaSenha(lojaId).catch(() => null);
  return { temSenha: Boolean(c?.hash), exige: c ? c.exige : lerExigeSenha(null) };
}

/**
 * Grava a configuração. `senha`: string = troca a senha; null = apaga a senha
 * (e desliga tudo — interruptor sem senha não protege nada); undefined = deixa
 * a que está.
 */
export async function gravarConfigDaSenha(o: { lojaId: string; senha?: string | null; exige: ExigeSenha; quem: string }) {
  if (!(await garantirTabelaDaSenhaDoGerente())) throw new Error("tabela SenhaDoGerente indisponível");
  const exige = o.senha === null ? lerExigeSenha(null) : o.exige;
  const json = JSON.stringify(exige);
  const quem = o.quem.slice(0, 120);
  const agora = horaEmUtc(new Date());
  if (o.senha === undefined) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "SenhaDoGerente" ("lojaId", "hash", "exige", "atualizadoPor", "updatedAt")
      VALUES (${o.lojaId}, NULL, ${json}::jsonb, ${quem}, ${agora})
      ON CONFLICT ("lojaId") DO UPDATE SET "exige" = EXCLUDED."exige", "atualizadoPor" = EXCLUDED."atualizadoPor", "updatedAt" = EXCLUDED."updatedAt"`);
    return;
  }
  const hash = o.senha === null ? null : await bcrypt.hash(o.senha, 10);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "SenhaDoGerente" ("lojaId", "hash", "exige", "atualizadoPor", "updatedAt")
    VALUES (${o.lojaId}, ${hash}, ${json}::jsonb, ${quem}, ${agora})
    ON CONFLICT ("lojaId") DO UPDATE SET "hash" = EXCLUDED."hash", "exige" = EXCLUDED."exige", "atualizadoPor" = EXCLUDED."atualizadoPor", "updatedAt" = EXCLUDED."updatedAt"`);
}

/**
 * Um freio por processo, para todas as rotas: errar no fiado conta para a
 * pendência também. No globalThis para sobreviver ao recarregar do módulo no
 * next dev (e para o teste começar cada cenário zerado).
 */
const freio = (): FreioDaSenha => ((globalThis as any).__freioDaSenhaDoGerente ??= new FreioDaSenha());

/** Confere a senha desta ação nesta loja (o freio de tentativas vai junto). */
export async function conferirSenhaDoGerente(lojaId: string, acao: AcaoProtegida, senhaInformada: string | null | undefined): Promise<ResultadoDaSenha> {
  return conferirSenhaDoGerenteCom(
    { lerConfig: lerConfigDaSenha, comparar: (s, h) => bcrypt.compare(s, h), freio: freio() },
    lojaId,
    acao,
    senhaInformada,
  );
}

/** A senha do gerente bate? Para a própria tela de configuração (trocar exige a atual). Conta no freio. */
export async function senhaAtualConfere(lojaId: string, senha: string): Promise<ResultadoDaSenha> {
  const config = await lerConfigDaSenha(lojaId);
  if (!config?.hash) return { ok: true };
  // Conferida como se a ação estivesse ligada: o que importa aqui é a senha.
  return conferirSenhaDoGerenteCom(
    { lerConfig: async () => ({ hash: config.hash, exige: { ...config.exige, fiado: true } }), comparar: (s, h) => bcrypt.compare(s, h), freio: freio() },
    lojaId,
    "fiado",
    senha,
  );
}

/**
 * A trava das rotas: devolve a resposta de recusa, ou null se pode seguir.
 *
 *   const semSenha = await exigirSenhaDoGerente(req, lojaId, "fiado");
 *   if (semSenha) return semSenha;
 *
 * A senha vem no cabeçalho x-senha-do-gerente (a tela manda pelo
 * `comSenhaDoGerente` de components/SenhaDoGerente.tsx). Falha ao ler a
 * configuração TRAVA a ação protegida — mas só se a tabela existe: sem ela
 * nenhuma loja tem senha cadastrada para proteger nada.
 */
export async function exigirSenhaDoGerente(req: Request, lojaId: string, acao: AcaoProtegida): Promise<NextResponse | null> {
  let r: ResultadoDaSenha;
  try {
    r = await conferirSenhaDoGerente(lojaId, acao, senhaDoCabecalho(req.headers.get(CABECALHO_DA_SENHA)));
  } catch (err: any) {
    console.error(`[Senha do gerente] não conferiu (${acao}) na loja ${lojaId}:`, err?.message || err);
    return NextResponse.json({ error: "Não deu para conferir a senha do gerente agora. Tente de novo." }, { status: 503 });
  }
  if (r.ok) return null;
  if (r.codigo !== CODIGO_SENHA_PEDIDA) console.warn(`[Senha do gerente] ${r.codigo} em "${acao}" na loja ${lojaId}`);
  return NextResponse.json({ error: r.error, mensagem: r.error, codigo: r.codigo, acao: r.acao, restam: r.restam }, { status: r.status });
}
