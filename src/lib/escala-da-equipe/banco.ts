/**
 * ESCALA DA EQUIPE — o banco (lib/escala-da-equipe/regras.ts tem as contas).
 *
 * Quatro tabelas próprias, criadas no primeiro uso por SQL cru, fora do
 * schema.prisma (como LancheDaEquipe e SenhaDoGerente):
 *
 *   EscalaConfig     uma linha por loja: o código do link público, os prazos
 *                    e as funções que o link mostra.
 *   EscalaPessoa     os freelancers do módulo — e, para quem já existe em
 *                    outro cadastro (login de funcionário, motoboy), o
 *                    COMPLEMENTO: telefone, função e diária combinada. O nome
 *                    continua vindo da origem (User/Motoboy), que é a verdade.
 *   EscalaTurno      data do calendário (DATE), início e fim "HH:MM", função,
 *                    vagas, observação.
 *   EscalaInscricao  quem vem em cada turno: tipo + id da pessoa, o nome
 *                    gravado (o turno impresso não muda se o cadastro sumir),
 *                    de onde veio (link/painel) e o hash da chave de desistir.
 *
 * ── A última vaga ───────────────────────────────────────────────────────────
 * Duas pessoas clicando na última vaga ao mesmo tempo: só uma entra. A
 * inscrição trava a LINHA do turno (SELECT … FOR UPDATE) dentro de uma
 * transação e só então conta as vagas; a segunda espera a primeira terminar
 * e, em READ COMMITTED, a contagem dela já enxerga a inscrição da primeira.
 * Um INSERT … WHERE count < vagas sozinho não basta: as duas leriam a mesma
 * foto do banco e entrariam as duas.
 */
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";
import {
  CONFIG_PADRAO, acharPeloTelefone, chaveDoTelefone, lerConfigDaEscala, normalizarFuncao, ordenarTurnos, turnosSeSobrepoem,
  type ConfigDaEscala, type DadosDoTurno, type OrigemDaInscricao, type TipoDePessoa,
} from "./regras";

/** Erro com a frase para a tela e o status HTTP. */
export class ErroDaEscala extends Error {
  constructor(mensagem: string, public status = 400, public codigo?: string) { super(mensagem); }
}

// ── Tabelas ──────────────────────────────────────────────────────────────────

const DDL = [
  `CREATE TABLE IF NOT EXISTS "EscalaConfig" (
    "lojaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "prazoInscricaoHoras" INTEGER NOT NULL DEFAULT 2,
    "permiteDesistir" BOOLEAN NOT NULL DEFAULT true,
    "prazoDesistenciaHoras" INTEGER NOT NULL DEFAULT 24,
    "funcoesNoLink" JSONB NOT NULL DEFAULT '[]',
    "linkAtivo" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoPor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EscalaConfig_pkey" PRIMARY KEY ("lojaId")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EscalaConfig_codigo_key" ON "EscalaConfig"("codigo")`,
  `CREATE TABLE IF NOT EXISTS "EscalaPessoa" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'freelancer',
    "refId" TEXT,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "telefoneChave" TEXT NOT NULL DEFAULT '',
    "funcao" TEXT,
    "cpf" TEXT,
    "pix" TEXT,
    "diaria" DOUBLE PRECISION,
    "obs" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL DEFAULT 'painel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EscalaPessoa_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "EscalaPessoa_lojaId_idx" ON "EscalaPessoa"("lojaId")`,
  // Um complemento por pessoa de outro cadastro.
  `CREATE UNIQUE INDEX IF NOT EXISTS "EscalaPessoa_ref_key" ON "EscalaPessoa"("lojaId", "tipo", "refId") WHERE "refId" IS NOT NULL`,
  // Um freelancer por telefone: dois cliques no link não criam a mesma pessoa duas vezes.
  `CREATE UNIQUE INDEX IF NOT EXISTS "EscalaPessoa_telefone_key" ON "EscalaPessoa"("lojaId", "telefoneChave") WHERE "tipo" = 'freelancer' AND "telefoneChave" <> ''`,
  `CREATE TABLE IF NOT EXISTS "EscalaTurno" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "inicio" TEXT NOT NULL,
    "fim" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "vagas" INTEGER NOT NULL DEFAULT 1,
    "obs" TEXT,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EscalaTurno_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "EscalaTurno_lojaId_data_idx" ON "EscalaTurno"("lojaId", "data")`,
  `CREATE TABLE IF NOT EXISTS "EscalaInscricao" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "pessoaTipo" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'painel',
    "chaveHash" TEXT,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EscalaInscricao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EscalaInscricao_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "EscalaTurno"("id") ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EscalaInscricao_turno_pessoa_key" ON "EscalaInscricao"("turnoId", "pessoaTipo", "pessoaId")`,
  `CREATE INDEX IF NOT EXISTS "EscalaInscricao_lojaId_pessoa_idx" ON "EscalaInscricao"("lojaId", "pessoaTipo", "pessoaId")`,
];

let tabelasOk = false;

/** As tabelas existem? Uma vez por processo, e só marca depois de conseguir. */
export async function garantirTabelasDaEscala(): Promise<void> {
  if (tabelasOk) return;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) throw new ErroDaEscala("Banco indisponível.", 503);
  try {
    await executarDDL("escala-da-equipe", DDL);
    tabelasOk = true;
  } catch (err: any) {
    console.error(`[Escala] 🛑 Tabelas da escala falharam: ${err?.message}`);
    throw new ErroDaEscala("A escala está fora do ar agora. Tente de novo em instantes.", 503);
  }
}

// ── Configuração e link ─────────────────────────────────────────────────────

/** Código do link: 10 letras/números sem os que se confundem (0/o, 1/l/i). */
function novoCodigo(): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = randomBytes(10);
  return Array.from(b, (x) => alfabeto[x % alfabeto.length]).join("");
}

export type ConfigComLink = ConfigDaEscala & { codigo: string };

type LinhaDaConfig = { codigo: string; prazoInscricaoHoras: number; permiteDesistir: boolean; prazoDesistenciaHoras: number; funcoesNoLink: unknown; linkAtivo: boolean };
const daLinha = (l: LinhaDaConfig): ConfigComLink => ({ ...lerConfigDaEscala(l as any), codigo: l.codigo });

/** A configuração da loja — criada (com código novo) na primeira vez que a tela abre. */
export async function configDaLoja(lojaId: string): Promise<ConfigComLink> {
  await garantirTabelasDaEscala();
  const [l] = await prisma.$queryRaw<LinhaDaConfig[]>(Prisma.sql`SELECT * FROM "EscalaConfig" WHERE "lojaId" = ${lojaId}`);
  if (l) return daLinha(l);
  // Corrida de duas abas abrindo juntas: ON CONFLICT faz a segunda ler a da primeira.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EscalaConfig" ("lojaId", "codigo", "prazoInscricaoHoras", "permiteDesistir", "prazoDesistenciaHoras", "funcoesNoLink", "linkAtivo")
    VALUES (${lojaId}, ${novoCodigo()}, ${CONFIG_PADRAO.prazoInscricaoHoras}, ${CONFIG_PADRAO.permiteDesistir}, ${CONFIG_PADRAO.prazoDesistenciaHoras}, '[]'::jsonb, true)
    ON CONFLICT ("lojaId") DO NOTHING`);
  const [nova] = await prisma.$queryRaw<LinhaDaConfig[]>(Prisma.sql`SELECT * FROM "EscalaConfig" WHERE "lojaId" = ${lojaId}`);
  return daLinha(nova);
}

export async function salvarConfig(lojaId: string, entrada: unknown, quem: string): Promise<ConfigComLink> {
  const atual = await configDaLoja(lojaId);
  const c = lerConfigDaEscala({ ...atual, ...(entrada && typeof entrada === "object" ? entrada : {}) } as any);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "EscalaConfig" SET "prazoInscricaoHoras" = ${c.prazoInscricaoHoras}, "permiteDesistir" = ${c.permiteDesistir},
      "prazoDesistenciaHoras" = ${c.prazoDesistenciaHoras}, "funcoesNoLink" = ${JSON.stringify(c.funcoesNoLink)}::jsonb,
      "linkAtivo" = ${c.linkAtivo}, "atualizadoPor" = ${quem.slice(0, 120)}, "updatedAt" = now()
    WHERE "lojaId" = ${lojaId}`);
  return { ...c, codigo: atual.codigo };
}

/** "Gerar link novo": o código antigo para de funcionar na hora (link vazado num grupo errado). */
export async function trocarCodigo(lojaId: string, quem: string): Promise<ConfigComLink> {
  await configDaLoja(lojaId);
  await prisma.$executeRaw(Prisma.sql`UPDATE "EscalaConfig" SET "codigo" = ${novoCodigo()}, "atualizadoPor" = ${quem.slice(0, 120)}, "updatedAt" = now() WHERE "lojaId" = ${lojaId}`);
  return configDaLoja(lojaId);
}

/** A loja dona de um código de link (página pública). Nulo = link velho ou inventado. */
export async function lojaPeloCodigo(codigo: string): Promise<{ lojaId: string; config: ConfigComLink } | null> {
  if (!/^[a-z0-9]{6,32}$/.test(codigo)) return null;
  await garantirTabelasDaEscala();
  const [l] = await prisma.$queryRaw<(LinhaDaConfig & { lojaId: string })[]>(Prisma.sql`SELECT * FROM "EscalaConfig" WHERE "codigo" = ${codigo}`);
  return l ? { lojaId: l.lojaId, config: daLinha(l) } : null;
}

// ── Pessoas ─────────────────────────────────────────────────────────────────

/** A lista unificada: equipe (logins de funcionário), motoboys ativos e freelancers. */
export type PessoaDaEscala = {
  tipo: TipoDePessoa;
  id: string;
  nome: string;
  telefone: string | null;
  funcao: string | null;
  diaria: number | null;
  cpf: string | null;
  pix: string | null;
  obs: string | null;
  ativo: boolean;
  origem: OrigemDaInscricao;
  /** De onde vêm os dados: "Login de funcionário (e-mail)", "Motoboy cadastrado". */
  detalhe: string | null;
  /** A diária do cadastro do motoboy, quando a escala não tem a sua. */
  diariaDaOrigem: number | null;
};

type LinhaDaPessoa = { id: string; tipo: string; refId: string | null; nome: string; telefone: string | null; funcao: string | null; cpf: string | null; pix: string | null; diaria: number | null; obs: string | null; ativo: boolean; origem: string };

export async function pessoasDaLoja(lojaId: string, opcoes: { inativos?: boolean } = {}): Promise<PessoaDaEscala[]> {
  await garantirTabelasDaEscala();
  const [linhas, equipe, motoboys] = await Promise.all([
    prisma.$queryRaw<LinhaDaPessoa[]>(Prisma.sql`SELECT "id", "tipo", "refId", "nome", "telefone", "funcao", "cpf", "pix", "diaria", "obs", "ativo", "origem" FROM "EscalaPessoa" WHERE "lojaId" = ${lojaId}`),
    prisma.user.findMany({ where: { ownerId: lojaId, role: "STAFF" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    prisma.motoboy.findMany({ where: { franchiseeId: lojaId, active: true }, select: { id: true, name: true, phone: true, paymentType: true, dailyRate: true }, orderBy: { name: "asc" } }),
  ]);
  const complemento = new Map(linhas.filter((l) => l.refId).map((l) => [`${l.tipo}:${l.refId}`, l]));
  const pessoas: PessoaDaEscala[] = [];
  for (const u of equipe) {
    const c = complemento.get(`equipe:${u.id}`);
    pessoas.push({
      tipo: "equipe", id: u.id, nome: u.name || u.email, telefone: c?.telefone ?? null, funcao: c?.funcao ?? null,
      diaria: c?.diaria ?? null, cpf: null, pix: null, obs: c?.obs ?? null, ativo: true, origem: "painel",
      detalhe: `Login de funcionário (${u.email})`, diariaDaOrigem: null,
    });
  }
  for (const m of motoboys) {
    const c = complemento.get(`motoboy:${m.id}`);
    const daOrigem = (m.paymentType === "DAILY_RATE" || m.paymentType === "BOTH") && Number(m.dailyRate) > 0 ? Number(m.dailyRate) : null;
    pessoas.push({
      tipo: "motoboy", id: m.id, nome: m.name, telefone: c?.telefone || m.phone || null, funcao: c?.funcao || "Motoboy",
      diaria: c?.diaria ?? daOrigem, cpf: null, pix: null, obs: c?.obs ?? null, ativo: true, origem: "painel",
      detalhe: "Motoboy cadastrado (tela Motoboys)", diariaDaOrigem: daOrigem,
    });
  }
  for (const l of linhas) {
    if (l.tipo !== "freelancer" || (!l.ativo && !opcoes.inativos)) continue;
    pessoas.push({
      tipo: "freelancer", id: l.id, nome: l.nome, telefone: l.telefone, funcao: l.funcao, diaria: l.diaria, cpf: l.cpf, pix: l.pix,
      obs: l.obs, ativo: l.ativo, origem: l.origem === "link" ? "link" : "painel", detalhe: null, diariaDaOrigem: null,
    });
  }
  return pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const texto = (v: unknown, max: number) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  return s || null;
};
const reais = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Telefone que já é de outra pessoa da loja? (freelancer novo não pode repetir) */
async function donoDoTelefone(lojaId: string, telefone: string | null, exceto?: { tipo: string; id: string }) {
  if (!telefone || !chaveDoTelefone(telefone)) return null;
  const todas = (await pessoasDaLoja(lojaId, { inativos: true })).filter((p) => !(exceto && p.tipo === exceto.tipo && p.id === exceto.id));
  return acharPeloTelefone(telefone, todas);
}

/**
 * Cadastra ou edita um freelancer (nome, telefone, função, CPF, Pix, diária,
 * observação, ativo). `podeVerDiaria` = é o dono: o funcionário não grava nem
 * apaga a diária combinada.
 */
export async function salvarFreelancer(lojaId: string, e: Record<string, unknown>, opcoes: { id?: string; origem?: OrigemDaInscricao; podeVerDiaria: boolean }): Promise<string> {
  await garantirTabelasDaEscala();
  const nome = texto(e.nome, 80);
  if (!nome) throw new ErroDaEscala("Escreva o nome da pessoa.");
  const telefone = texto(e.telefone, 30);
  if (telefone && !chaveDoTelefone(telefone)) throw new ErroDaEscala("Telefone com DDD, por favor (ex.: 22 99999-1234).");
  const outro = await donoDoTelefone(lojaId, telefone, opcoes.id ? { tipo: "freelancer", id: opcoes.id } : undefined);
  if (outro) throw new ErroDaEscala(`Este telefone já é de ${outro.nome}.`, 409);
  const funcao = normalizarFuncao(String(e.funcao ?? "")) || null;
  const cpf = texto(e.cpf, 20), pix = texto(e.pix, 120), obs = texto(e.obs, 300);
  const ativo = e.ativo === undefined ? true : e.ativo === true;
  if (opcoes.id) {
    const r = await prisma.$executeRaw(Prisma.sql`
      UPDATE "EscalaPessoa" SET "nome" = ${nome}, "telefone" = ${telefone}, "telefoneChave" = ${chaveDoTelefone(telefone)}, "funcao" = ${funcao},
        "cpf" = ${cpf}, "pix" = ${pix}, "obs" = ${obs}, "ativo" = ${ativo},
        "diaria" = ${opcoes.podeVerDiaria ? Prisma.sql`${reais(e.diaria)}` : Prisma.sql`"diaria"`}, "updatedAt" = now()
      WHERE "id" = ${opcoes.id} AND "lojaId" = ${lojaId} AND "tipo" = 'freelancer'`);
    if (!r) throw new ErroDaEscala("Freelancer não encontrado.", 404);
    return opcoes.id;
  }
  const id = randomUUID();
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "EscalaPessoa" ("id", "lojaId", "tipo", "nome", "telefone", "telefoneChave", "funcao", "cpf", "pix", "diaria", "obs", "ativo", "origem")
      VALUES (${id}, ${lojaId}, 'freelancer', ${nome}, ${telefone}, ${chaveDoTelefone(telefone)}, ${funcao}, ${cpf}, ${pix},
        ${opcoes.podeVerDiaria ? reais(e.diaria) : null}, ${obs}, true, ${opcoes.origem || "painel"})`);
  } catch (err: any) {
    if (String(err?.message || "").includes("EscalaPessoa_telefone_key")) throw new ErroDaEscala("Este telefone já está cadastrado.", 409);
    throw err;
  }
  return id;
}

/** O complemento de quem é da equipe ou motoboy: telefone, função, diária e observação. */
export async function salvarComplemento(lojaId: string, tipo: "equipe" | "motoboy", refId: string, e: Record<string, unknown>, opcoes: { podeVerDiaria: boolean }): Promise<void> {
  await garantirTabelasDaEscala();
  const existe = tipo === "equipe"
    ? await prisma.user.findFirst({ where: { id: refId, ownerId: lojaId, role: "STAFF" }, select: { name: true, email: true } }).then((u) => u && (u.name || u.email))
    : await prisma.motoboy.findFirst({ where: { id: refId, franchiseeId: lojaId }, select: { name: true } }).then((m) => m?.name);
  if (!existe) throw new ErroDaEscala("Pessoa não encontrada nesta loja.", 404);
  const telefone = texto(e.telefone, 30);
  if (telefone && !chaveDoTelefone(telefone)) throw new ErroDaEscala("Telefone com DDD, por favor (ex.: 22 99999-1234).");
  const outro = await donoDoTelefone(lojaId, telefone, { tipo, id: refId });
  if (outro) throw new ErroDaEscala(`Este telefone já é de ${outro.nome}.`, 409);
  const funcao = normalizarFuncao(String(e.funcao ?? "")) || null;
  const obs = texto(e.obs, 300);
  const diaria = reais(e.diaria);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EscalaPessoa" ("id", "lojaId", "tipo", "refId", "nome", "telefone", "telefoneChave", "funcao", "diaria", "obs", "origem")
    VALUES (${randomUUID()}, ${lojaId}, ${tipo}, ${refId}, ${existe}, ${telefone}, ${chaveDoTelefone(telefone)}, ${funcao}, ${opcoes.podeVerDiaria ? diaria : null}, ${obs}, 'painel')
    ON CONFLICT ("lojaId", "tipo", "refId") WHERE "refId" IS NOT NULL DO UPDATE SET
      "nome" = EXCLUDED."nome", "telefone" = EXCLUDED."telefone", "telefoneChave" = EXCLUDED."telefoneChave", "funcao" = EXCLUDED."funcao",
      "obs" = EXCLUDED."obs", "updatedAt" = now()
      ${opcoes.podeVerDiaria ? Prisma.sql`, "diaria" = EXCLUDED."diaria"` : Prisma.empty}`);
}

// ── Turnos ──────────────────────────────────────────────────────────────────

export type InscritoDoTurno = { id: string; pessoaTipo: TipoDePessoa; pessoaId: string; nome: string; origem: OrigemDaInscricao; createdAt: string };
export type TurnoDaEscala = DadosDoTurno & { id: string; inscritos: InscritoDoTurno[] };

type LinhaDoTurno = { id: string; data: string; inicio: string; fim: string; funcao: string; vagas: number; obs: string | null };
const SELECT_DO_TURNO = Prisma.sql`"id", to_char("data", 'YYYY-MM-DD') AS "data", "inicio", "fim", "funcao", "vagas", "obs"`;

export async function turnosDoPeriodo(lojaId: string, de: string, ate: string): Promise<TurnoDaEscala[]> {
  await garantirTabelasDaEscala();
  const turnos = await prisma.$queryRaw<LinhaDoTurno[]>(Prisma.sql`
    SELECT ${SELECT_DO_TURNO} FROM "EscalaTurno"
    WHERE "lojaId" = ${lojaId} AND "data" BETWEEN ${de}::date AND ${ate}::date`);
  if (!turnos.length) return [];
  const ids = turnos.map((t) => t.id);
  const inscricoes = await prisma.$queryRaw<(InscritoDoTurno & { turnoId: string; criado: Date })[]>(Prisma.sql`
    SELECT "id", "turnoId", "pessoaTipo", "pessoaId", "nome", "origem", "createdAt" AS "criado"
    FROM "EscalaInscricao" WHERE "turnoId" = ANY(${ids}) ORDER BY "createdAt"`);
  const por = new Map<string, InscritoDoTurno[]>();
  for (const i of inscricoes) {
    const lista = por.get(i.turnoId) || [];
    lista.push({ id: i.id, pessoaTipo: i.pessoaTipo, pessoaId: i.pessoaId, nome: i.nome, origem: i.origem === "link" ? "link" : "painel", createdAt: new Date(i.criado).toISOString() });
    por.set(i.turnoId, lista);
  }
  return ordenarTurnos(turnos.map((t) => ({ ...t, vagas: Number(t.vagas), inscritos: por.get(t.id) || [] })));
}

export async function criarTurnos(lojaId: string, turnos: DadosDoTurno[], quem: string): Promise<number> {
  await garantirTabelasDaEscala();
  if (!turnos.length) return 0;
  const linhas = turnos.map((t) => Prisma.sql`(${randomUUID()}, ${lojaId}, ${t.data}::date, ${t.inicio}, ${t.fim}, ${t.funcao}, ${t.vagas}, ${t.obs}, ${quem.slice(0, 120)})`);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EscalaTurno" ("id", "lojaId", "data", "inicio", "fim", "funcao", "vagas", "obs", "criadoPor")
    VALUES ${Prisma.join(linhas)}`);
  return turnos.length;
}

export async function editarTurno(lojaId: string, id: string, t: DadosDoTurno): Promise<void> {
  await garantirTabelasDaEscala();
  const r = await prisma.$executeRaw(Prisma.sql`
    UPDATE "EscalaTurno" SET "data" = ${t.data}::date, "inicio" = ${t.inicio}, "fim" = ${t.fim}, "funcao" = ${t.funcao},
      "vagas" = ${t.vagas}, "obs" = ${t.obs}, "updatedAt" = now()
    WHERE "id" = ${id} AND "lojaId" = ${lojaId}`);
  if (!r) throw new ErroDaEscala("Turno não encontrado.", 404);
}

/**
 * Apaga o turno (e as inscrições, em cascata). Com gente inscrita, só com
 * `confirmado` — a tela pergunta antes ("3 pessoas vão sair da escala").
 */
export async function apagarTurno(lojaId: string, id: string, confirmado: boolean): Promise<void> {
  await garantirTabelasDaEscala();
  const [c] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(i."id")::int AS n FROM "EscalaTurno" t LEFT JOIN "EscalaInscricao" i ON i."turnoId" = t."id"
    WHERE t."id" = ${id} AND t."lojaId" = ${lojaId}`);
  if (Number(c?.n) > 0 && !confirmado) throw new ErroDaEscala(`Este turno tem ${c.n} pessoa(s) inscrita(s).`, 409, "TEM_INSCRITOS");
  const r = await prisma.$executeRaw(Prisma.sql`DELETE FROM "EscalaTurno" WHERE "id" = ${id} AND "lojaId" = ${lojaId}`);
  if (!r) throw new ErroDaEscala("Turno não encontrado.", 404);
}

// ── Inscrições ──────────────────────────────────────────────────────────────

export type PessoaParaInscrever = { tipo: TipoDePessoa; id: string; nome: string };

/** A chave de desistir: só o aparelho que fez a inscrição a tem; o banco guarda o hash. */
export const hashDaChave = (chave: string) => createHash("sha256").update(chave).digest("hex");

/**
 * Inscreve a pessoa no turno, travando a vaga (ver o topo do arquivo).
 *
 *   - mesma pessoa duas vezes no turno: recusa ("você já está neste turno");
 *   - turno cheio: recusa — ou, pelo painel com `aumentarVaga`, abre mais uma
 *     vaga e encaixa (o dono decidiu chamar mais um);
 *   - `conferir(turno)`: as regras de quem chama (prazo do link, função no link);
 *   - `semSobreposicao`: o link não deixa a mesma pessoa em dois turnos que se
 *     cruzam no horário (o painel deixa — o dono sabe o que faz).
 *
 * Devolve o id da inscrição e, pelo link, a chave de desistir (só nesta resposta).
 */
export async function inscrever(lojaId: string, turnoId: string, pessoa: PessoaParaInscrever, opcoes: {
  origem: OrigemDaInscricao; quem?: string; aumentarVaga?: boolean; semSobreposicao?: boolean; comChave?: boolean;
  conferir?: (turno: LinhaDoTurno) => void;
}): Promise<{ id: string; chave: string | null; turno: LinhaDoTurno }> {
  await garantirTabelasDaEscala();
  const chave = opcoes.comChave ? randomBytes(18).toString("base64url") : null;
  const id = randomUUID();
  const turno = await prisma.$transaction(async (tx) => {
    const [t] = await tx.$queryRaw<LinhaDoTurno[]>(Prisma.sql`
      SELECT ${SELECT_DO_TURNO} FROM "EscalaTurno" WHERE "id" = ${turnoId} AND "lojaId" = ${lojaId} FOR UPDATE`);
    if (!t) throw new ErroDaEscala("Turno não encontrado (pode ter sido apagado).", 404);
    opcoes.conferir?.(t);
    const [ja] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "EscalaInscricao" WHERE "turnoId" = ${turnoId} AND "pessoaTipo" = ${pessoa.tipo} AND "pessoaId" = ${pessoa.id}`);
    if (ja) throw new ErroDaEscala(`${pessoa.nome} já está neste turno.`, 409, "JA_INSCRITO");
    const [c] = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "EscalaInscricao" WHERE "turnoId" = ${turnoId}`);
    const n = Number(c?.n) || 0;
    if (n >= Number(t.vagas)) {
      if (!opcoes.aumentarVaga) throw new ErroDaEscala("As vagas deste turno acabaram.", 409, "CHEIO");
      await tx.$executeRaw(Prisma.sql`UPDATE "EscalaTurno" SET "vagas" = ${n + 1}, "updatedAt" = now() WHERE "id" = ${turnoId}`);
    }
    if (opcoes.semSobreposicao) {
      // Os turnos da pessoa no dia de antes, no dia e no seguinte (o que vira a meia-noite).
      const outros = await tx.$queryRaw<LinhaDoTurno[]>(Prisma.sql`
        SELECT t."id", to_char(t."data", 'YYYY-MM-DD') AS "data", t."inicio", t."fim", t."funcao", t."vagas", t."obs"
        FROM "EscalaInscricao" i JOIN "EscalaTurno" t ON t."id" = i."turnoId"
        WHERE i."lojaId" = ${lojaId} AND i."pessoaTipo" = ${pessoa.tipo} AND i."pessoaId" = ${pessoa.id}
          AND t."data" BETWEEN (${t.data}::date - 1) AND (${t.data}::date + 1)`);
      const cruza = outros.find((o) => turnosSeSobrepoem(o, t));
      if (cruza) throw new ErroDaEscala(`Você já está no turno de ${cruza.funcao} das ${cruza.inicio} às ${cruza.fim}, que cruza com este.`, 409, "SOBREPOSTO");
    }
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "EscalaInscricao" ("id", "lojaId", "turnoId", "pessoaTipo", "pessoaId", "nome", "origem", "chaveHash", "criadoPor")
      VALUES (${id}, ${lojaId}, ${turnoId}, ${pessoa.tipo}, ${pessoa.id}, ${pessoa.nome.slice(0, 80)}, ${opcoes.origem}, ${chave ? hashDaChave(chave) : null}, ${opcoes.quem?.slice(0, 120) || null})`);
    return t;
  });
  return { id, chave, turno };
}

/** O painel tira a pessoa do turno (a qualquer hora). */
export async function tirarInscricao(lojaId: string, inscricaoId: string): Promise<void> {
  await garantirTabelasDaEscala();
  const r = await prisma.$executeRaw(Prisma.sql`DELETE FROM "EscalaInscricao" WHERE "id" = ${inscricaoId} AND "lojaId" = ${lojaId}`);
  if (!r) throw new ErroDaEscala("Essa inscrição já não existe.", 404);
}

/**
 * Desistir pelo link: só com a chave que o aparelho recebeu ao se inscrever
 * (ninguém tira o colega digitando o telefone dele), e dentro do prazo da loja.
 */
export async function desistirPeloLink(lojaId: string, inscricaoId: string, chave: string, podeDesistir: (turno: LinhaDoTurno) => boolean): Promise<void> {
  await garantirTabelasDaEscala();
  const [i] = await prisma.$queryRaw<(LinhaDoTurno & { chaveHash: string | null })[]>(Prisma.sql`
    SELECT i."chaveHash", t."id", to_char(t."data", 'YYYY-MM-DD') AS "data", t."inicio", t."fim", t."funcao", t."vagas", t."obs"
    FROM "EscalaInscricao" i JOIN "EscalaTurno" t ON t."id" = i."turnoId"
    WHERE i."id" = ${inscricaoId} AND i."lojaId" = ${lojaId}`);
  if (!i) throw new ErroDaEscala("Essa inscrição já não existe (a loja pode ter tirado).", 404);
  if (!i.chaveHash || !chave || hashDaChave(chave) !== i.chaveHash) throw new ErroDaEscala("Só dá para desistir pelo mesmo celular que fez a inscrição. Fale com a loja.", 403);
  if (!podeDesistir(i)) throw new ErroDaEscala("O prazo para desistir pelo link acabou. Fale direto com a loja.", 409);
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "EscalaInscricao" WHERE "id" = ${inscricaoId} AND "lojaId" = ${lojaId}`);
}

/** As inscrições futuras de uma pessoa (o "Minhas inscrições" do link). */
export async function inscricoesDaPessoa(lojaId: string, pessoa: { tipo: string; id: string }, desde: string): Promise<Array<LinhaDoTurno & { inscricaoId: string }>> {
  await garantirTabelasDaEscala();
  return prisma.$queryRaw<Array<LinhaDoTurno & { inscricaoId: string }>>(Prisma.sql`
    SELECT i."id" AS "inscricaoId", t."id", to_char(t."data", 'YYYY-MM-DD') AS "data", t."inicio", t."fim", t."funcao", t."vagas", t."obs"
    FROM "EscalaInscricao" i JOIN "EscalaTurno" t ON t."id" = i."turnoId"
    WHERE i."lojaId" = ${lojaId} AND i."pessoaTipo" = ${pessoa.tipo} AND i."pessoaId" = ${pessoa.id} AND t."data" >= (${desde}::date - 1)
    ORDER BY t."data", t."inicio"`);
}

