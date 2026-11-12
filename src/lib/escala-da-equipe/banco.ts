/**
 * ESCALA DA EQUIPE — o banco (lib/escala-da-equipe/regras.ts tem as contas).
 *
 * Cinco tabelas próprias, criadas no primeiro uso por SQL cru, fora do
 * schema.prisma (como LancheDaEquipe e SenhaDoGerente):
 *
 *   EscalaConfig     uma linha por loja: o código do link público, os prazos
 *                    e as funções que o link mostra.
 *   EscalaPessoa     os freelancers do módulo — e, para quem já existe em
 *                    outro cadastro (login de funcionário, motoboy), o
 *                    COMPLEMENTO: telefone, função, diária combinada e Pix. O
 *                    nome continua vindo da origem (User/Motoboy), a verdade.
 *   EscalaTurno      data do calendário (DATE), início e fim "HH:MM", função,
 *                    vagas, observação.
 *   EscalaInscricao  quem vem em cada turno: tipo + id da pessoa, o nome
 *                    gravado (o turno impresso não muda se o cadastro sumir),
 *                    de onde veio (link/painel) e o hash da chave de desistir.
 *   EscalaPagamento  o dono marcou que pagou a pessoa por aquele turno: valor,
 *                    forma, quem e quando. Desfazer marca `desfeitoEm` (fica
 *                    o histórico); só um pagamento valendo por inscrição.
 *                    Quem já foi pago não sai do turno (nem o turno é apagado)
 *                    sem desfazer o pagamento antes — o dinheiro não some da
 *                    conta em silêncio.
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
import { acertosDoPeriodo } from "@/lib/acerto-pago";
import {
  CONFIG_PADRAO, acertoQueCobre, acharPeloTelefone, chaveDaPessoa, chaveDoTelefone, diaDoExpedienteDoTurno, diaEMes, dividirValor, lerChavePix,
  lerConfigDaEscala, normalizarFuncao, numeroDoDia, ordenarTurnos, turnosSeSobrepoem,
  type ConfigDaEscala, type DadosDoTurno, type FormaDePagamento, type ItemDePagamento, type OrigemDaInscricao, type PagamentoFeito,
  type TipoDePessoa, type TipoDePix,
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
  // O Pix (12/11/2026): o tipo da chave e de onde veio a última troca — "troca-link"
  // = alguém trocou a chave pelo link, e o dono vê o aviso antes de pagar.
  `ALTER TABLE "EscalaPessoa" ADD COLUMN IF NOT EXISTS "pixTipo" TEXT`,
  `ALTER TABLE "EscalaPessoa" ADD COLUMN IF NOT EXISTS "pixOrigem" TEXT`,
  `ALTER TABLE "EscalaPessoa" ADD COLUMN IF NOT EXISTS "pixAtualizadoEm" TIMESTAMP(3)`,
  // Sem chave estrangeira para a inscrição de propósito: o pagamento desfeito
  // fica no histórico mesmo que a pessoa saia do turno depois.
  `CREATE TABLE IF NOT EXISTS "EscalaPagamento" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "inscricaoId" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "pessoaTipo" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "forma" TEXT,
    "obs" TEXT,
    "pagoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagoPor" TEXT,
    "desfeitoEm" TIMESTAMP(3),
    "desfeitoPor" TEXT,
    CONSTRAINT "EscalaPagamento_pkey" PRIMARY KEY ("id")
  )`,
  // Um pagamento VALENDO por inscrição: dois cliques em "pago" não pagam duas vezes.
  `CREATE UNIQUE INDEX IF NOT EXISTS "EscalaPagamento_inscricao_key" ON "EscalaPagamento"("inscricaoId") WHERE "desfeitoEm" IS NULL`,
  `CREATE INDEX IF NOT EXISTS "EscalaPagamento_lojaId_data_idx" ON "EscalaPagamento"("lojaId", "data")`,
];

/** "Agora" para coluna TIMESTAMP sem fuso: sempre em UTC, qualquer que seja o fuso da sessão do banco. */
const agoraEmUtc = () => Prisma.sql`(${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

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
  pixTipo: TipoDePix | null;
  /** "troca-link" = a chave foi trocada pelo link (o dono confere antes de pagar). */
  pixOrigem: string | null;
  pixAtualizadoEm: string | null;
  obs: string | null;
  ativo: boolean;
  origem: OrigemDaInscricao;
  /** De onde vêm os dados: "Login de funcionário (e-mail)", "Motoboy cadastrado". */
  detalhe: string | null;
  /** A diária do cadastro do motoboy, quando a escala não tem a sua. */
  diariaDaOrigem: number | null;
};

type LinhaDaPessoa = {
  id: string; tipo: string; refId: string | null; nome: string; telefone: string | null; funcao: string | null; cpf: string | null;
  pix: string | null; pixTipo: string | null; pixOrigem: string | null; pixAtualizadoEm: Date | null; diaria: number | null; obs: string | null; ativo: boolean; origem: string;
};
const pixDaLinha = (c: LinhaDaPessoa | undefined) => ({
  pix: c?.pix ?? null, pixTipo: (c?.pixTipo as TipoDePix | null) ?? null, pixOrigem: c?.pixOrigem ?? null,
  pixAtualizadoEm: c?.pixAtualizadoEm ? new Date(c.pixAtualizadoEm).toISOString() : null,
});

export async function pessoasDaLoja(lojaId: string, opcoes: { inativos?: boolean } = {}): Promise<PessoaDaEscala[]> {
  await garantirTabelasDaEscala();
  const [linhas, equipe, motoboys] = await Promise.all([
    prisma.$queryRaw<LinhaDaPessoa[]>(Prisma.sql`SELECT "id", "tipo", "refId", "nome", "telefone", "funcao", "cpf", "pix", "pixTipo", "pixOrigem", "pixAtualizadoEm", "diaria", "obs", "ativo", "origem" FROM "EscalaPessoa" WHERE "lojaId" = ${lojaId}`),
    prisma.user.findMany({ where: { ownerId: lojaId, role: "STAFF" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    prisma.motoboy.findMany({ where: { franchiseeId: lojaId, active: true }, select: { id: true, name: true, phone: true, paymentType: true, dailyRate: true }, orderBy: { name: "asc" } }),
  ]);
  const complemento = new Map(linhas.filter((l) => l.refId).map((l) => [`${l.tipo}:${l.refId}`, l]));
  const pessoas: PessoaDaEscala[] = [];
  for (const u of equipe) {
    const c = complemento.get(`equipe:${u.id}`);
    pessoas.push({
      tipo: "equipe", id: u.id, nome: u.name || u.email, telefone: c?.telefone ?? null, funcao: c?.funcao ?? null,
      diaria: c?.diaria ?? null, cpf: null, ...pixDaLinha(c), obs: c?.obs ?? null, ativo: true, origem: "painel",
      detalhe: `Login de funcionário (${u.email})`, diariaDaOrigem: null,
    });
  }
  for (const m of motoboys) {
    const c = complemento.get(`motoboy:${m.id}`);
    const daOrigem = (m.paymentType === "DAILY_RATE" || m.paymentType === "BOTH") && Number(m.dailyRate) > 0 ? Number(m.dailyRate) : null;
    pessoas.push({
      tipo: "motoboy", id: m.id, nome: m.name, telefone: c?.telefone || m.phone || null, funcao: c?.funcao || "Motoboy",
      diaria: c?.diaria ?? daOrigem, cpf: null, ...pixDaLinha(c), obs: c?.obs ?? null, ativo: true, origem: "painel",
      detalhe: "Motoboy cadastrado (tela Motoboys)", diariaDaOrigem: daOrigem,
    });
  }
  for (const l of linhas) {
    if (l.tipo !== "freelancer" || (!l.ativo && !opcoes.inativos)) continue;
    pessoas.push({
      tipo: "freelancer", id: l.id, nome: l.nome, telefone: l.telefone, funcao: l.funcao, diaria: l.diaria, cpf: l.cpf, ...pixDaLinha(l),
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

/** A chave Pix do formulário: vazio = sem Pix; inválida = erro com a frase. */
function pixDaEntrada(e: Record<string, unknown>): { pix: string | null; pixTipo: TipoDePix | null } {
  if (!String(e.pix ?? "").trim()) return { pix: null, pixTipo: null };
  const l = lerChavePix(e.pix, e.pixTipo);
  if (!l.ok) throw new ErroDaEscala(l.erro, 400, "PIX_INVALIDO");
  return { pix: l.chave, pixTipo: l.tipo };
}

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
  const cpf = texto(e.cpf, 20), obs = texto(e.obs, 300);
  const { pix, pixTipo } = pixDaEntrada(e);
  const conferido = e.pixConferido === true;
  const ativo = e.ativo === undefined ? true : e.ativo === true;
  if (opcoes.id) {
    // Trocou a chave pelo painel (ou marcou "conferi com a pessoa"): a origem
    // passa a ser o painel e o aviso de "trocada pelo link" some.
    const r = await prisma.$executeRaw(Prisma.sql`
      UPDATE "EscalaPessoa" SET "nome" = ${nome}, "telefone" = ${telefone}, "telefoneChave" = ${chaveDoTelefone(telefone)}, "funcao" = ${funcao},
        "cpf" = ${cpf}, "pix" = ${pix}, "pixTipo" = ${pixTipo}, "obs" = ${obs}, "ativo" = ${ativo},
        "pixOrigem" = CASE WHEN "pix" IS DISTINCT FROM ${pix} OR (${conferido} AND "pix" IS NOT NULL) THEN 'painel' ELSE "pixOrigem" END,
        "pixAtualizadoEm" = CASE WHEN "pix" IS DISTINCT FROM ${pix} THEN ${agoraEmUtc()} ELSE "pixAtualizadoEm" END,
        "diaria" = ${opcoes.podeVerDiaria ? Prisma.sql`${reais(e.diaria)}` : Prisma.sql`"diaria"`}, "updatedAt" = now()
      WHERE "id" = ${opcoes.id} AND "lojaId" = ${lojaId} AND "tipo" = 'freelancer'`);
    if (!r) throw new ErroDaEscala("Freelancer não encontrado.", 404);
    return opcoes.id;
  }
  const id = randomUUID();
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "EscalaPessoa" ("id", "lojaId", "tipo", "nome", "telefone", "telefoneChave", "funcao", "cpf", "pix", "pixTipo", "pixOrigem", "pixAtualizadoEm", "diaria", "obs", "ativo", "origem")
      VALUES (${id}, ${lojaId}, 'freelancer', ${nome}, ${telefone}, ${chaveDoTelefone(telefone)}, ${funcao}, ${cpf}, ${pix}, ${pixTipo},
        ${pix ? opcoes.origem || "painel" : null}, ${pix ? agoraEmUtc() : null},
        ${opcoes.podeVerDiaria ? reais(e.diaria) : null}, ${obs}, true, ${opcoes.origem || "painel"})`);
  } catch (err: any) {
    if (String(err?.message || "").includes("EscalaPessoa_telefone_key")) throw new ErroDaEscala("Este telefone já está cadastrado.", 409);
    throw err;
  }
  return id;
}

/** O complemento de quem é da equipe ou motoboy: telefone, função, Pix, diária e observação. */
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
  const { pix, pixTipo } = pixDaEntrada(e);
  const conferido = e.pixConferido === true;
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EscalaPessoa" ("id", "lojaId", "tipo", "refId", "nome", "telefone", "telefoneChave", "funcao", "pix", "pixTipo", "pixOrigem", "pixAtualizadoEm", "diaria", "obs", "origem")
    VALUES (${randomUUID()}, ${lojaId}, ${tipo}, ${refId}, ${existe}, ${telefone}, ${chaveDoTelefone(telefone)}, ${funcao}, ${pix}, ${pixTipo},
      ${pix ? "painel" : null}, ${pix ? agoraEmUtc() : null}, ${opcoes.podeVerDiaria ? diaria : null}, ${obs}, 'painel')
    ON CONFLICT ("lojaId", "tipo", "refId") WHERE "refId" IS NOT NULL DO UPDATE SET
      "nome" = EXCLUDED."nome", "telefone" = EXCLUDED."telefone", "telefoneChave" = EXCLUDED."telefoneChave", "funcao" = EXCLUDED."funcao",
      "pix" = EXCLUDED."pix", "pixTipo" = EXCLUDED."pixTipo",
      "pixOrigem" = CASE WHEN "EscalaPessoa"."pix" IS DISTINCT FROM EXCLUDED."pix" OR ${conferido} THEN EXCLUDED."pixOrigem" ELSE "EscalaPessoa"."pixOrigem" END,
      "pixAtualizadoEm" = CASE WHEN "EscalaPessoa"."pix" IS DISTINCT FROM EXCLUDED."pix" THEN EXCLUDED."pixAtualizadoEm" ELSE "EscalaPessoa"."pixAtualizadoEm" END,
      "obs" = EXCLUDED."obs", "updatedAt" = now()
      ${opcoes.podeVerDiaria ? Prisma.sql`, "diaria" = EXCLUDED."diaria"` : Prisma.empty}`);
}

/**
 * O Pix que a pessoa informou pelo link. `troca` = já tinha chave e trocou
 * (quem chama conferiu a chave do aparelho): fica marcado "troca-link" e o
 * dono vê o aviso antes de pagar — o link identifica só pelo telefone.
 */
export async function gravarPixPeloLink(lojaId: string, pessoa: Pick<PessoaDaEscala, "tipo" | "id" | "nome">, chave: string, tipo: TipoDePix, troca: boolean): Promise<void> {
  await garantirTabelasDaEscala();
  const origem = troca ? "troca-link" : "link";
  if (pessoa.tipo === "freelancer") {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "EscalaPessoa" SET "pix" = ${chave}, "pixTipo" = ${tipo}, "pixOrigem" = ${origem}, "pixAtualizadoEm" = ${agoraEmUtc()}, "updatedAt" = now()
      WHERE "id" = ${pessoa.id} AND "lojaId" = ${lojaId} AND "tipo" = 'freelancer'`);
    return;
  }
  // Equipe/motoboy: só a chave no complemento (cria a linha se ainda não houver).
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "EscalaPessoa" ("id", "lojaId", "tipo", "refId", "nome", "pix", "pixTipo", "pixOrigem", "pixAtualizadoEm", "origem")
    VALUES (${randomUUID()}, ${lojaId}, ${pessoa.tipo}, ${pessoa.id}, ${pessoa.nome.slice(0, 80)}, ${chave}, ${tipo}, ${origem}, ${agoraEmUtc()}, 'link')
    ON CONFLICT ("lojaId", "tipo", "refId") WHERE "refId" IS NOT NULL DO UPDATE SET
      "pix" = EXCLUDED."pix", "pixTipo" = EXCLUDED."pixTipo", "pixOrigem" = EXCLUDED."pixOrigem", "pixAtualizadoEm" = EXCLUDED."pixAtualizadoEm", "updatedAt" = now()`);
}

/** Este aparelho tem a chave de alguma inscrição desta pessoa? (a prova para trocar o Pix pelo link) */
export async function aparelhoDaPessoa(lojaId: string, pessoa: { tipo: string; id: string }, chaves: unknown[]): Promise<boolean> {
  const hashes = chaves.filter((c): c is string => typeof c === "string" && c.length >= 10 && c.length <= 64).slice(0, 200).map(hashDaChave);
  if (!hashes.length) return false;
  await garantirTabelasDaEscala();
  const [l] = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "EscalaInscricao" WHERE "lojaId" = ${lojaId} AND "pessoaTipo" = ${pessoa.tipo} AND "pessoaId" = ${pessoa.id} AND "chaveHash" = ANY(${hashes}) LIMIT 1`);
  return !!l;
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

/** Mudar o DIA de um turno com gente já paga desencontraria o pagamento do dia trabalhado: recusa. */
export async function editarTurno(lojaId: string, id: string, t: DadosDoTurno): Promise<void> {
  await garantirTabelasDaEscala();
  const r = await prisma.$executeRaw(Prisma.sql`
    UPDATE "EscalaTurno" SET "data" = ${t.data}::date, "inicio" = ${t.inicio}, "fim" = ${t.fim}, "funcao" = ${t.funcao},
      "vagas" = ${t.vagas}, "obs" = ${t.obs}, "updatedAt" = now()
    WHERE "id" = ${id} AND "lojaId" = ${lojaId}
      AND ("data" = ${t.data}::date OR NOT EXISTS (SELECT 1 FROM "EscalaPagamento" p WHERE p."turnoId" = ${id} AND p."desfeitoEm" IS NULL))`);
  if (r) return;
  const [existe] = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "EscalaTurno" WHERE "id" = ${id} AND "lojaId" = ${lojaId}`);
  if (!existe) throw new ErroDaEscala("Turno não encontrado.", 404);
  throw new ErroDaEscala("Este turno já tem gente paga. Para mudar o dia, desfaça os pagamentos antes (ou crie outro turno).", 409, "TEM_PAGAMENTO");
}

// O que as funções daqui usam do banco — serve tanto para a transação quanto para o prisma de fora.
type Transacao = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

/**
 * Quem destas inscrições já foi pago? Chame com as linhas da inscrição
 * TRAVADAS (FOR UPDATE): o "marcar pago" trava as mesmas linhas, então tirar
 * e pagar ao mesmo tempo não deixam um pagamento sem a inscrição.
 */
async function recusarSeJaPago(tx: Transacao, inscricaoIds: string[], frase: (nomes: string) => string) {
  if (!inscricaoIds.length) return;
  const pagos = await tx.$queryRaw<{ nome: string }[]>(Prisma.sql`
    SELECT "nome" FROM "EscalaPagamento" WHERE "inscricaoId" = ANY(${inscricaoIds}) AND "desfeitoEm" IS NULL`);
  if (pagos.length) throw new ErroDaEscala(frase(pagos.map((p) => p.nome).join(", ")), 409, "PAGO");
}

/**
 * Apaga o turno (e as inscrições, em cascata). Com gente inscrita, só com
 * `confirmado` — a tela pergunta antes ("3 pessoas vão sair da escala").
 */
export async function apagarTurno(lojaId: string, id: string, confirmado: boolean): Promise<void> {
  await garantirTabelasDaEscala();
  await prisma.$transaction(async (tx) => {
    const [t] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "EscalaTurno" WHERE "id" = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`);
    if (!t) throw new ErroDaEscala("Turno não encontrado.", 404);
    const inscritos = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "EscalaInscricao" WHERE "turnoId" = ${id} FOR UPDATE`);
    // Mesmo com "confirmar": quem já foi pago não pode sumir junto com o turno.
    await recusarSeJaPago(tx, inscritos.map((i) => i.id), (nomes) => `Neste turno já foi pago: ${nomes}. Desfaça o pagamento antes de apagar o turno.`);
    if (inscritos.length > 0 && !confirmado) throw new ErroDaEscala(`Este turno tem ${inscritos.length} pessoa(s) inscrita(s).`, 409, "TEM_INSCRITOS");
    await tx.$executeRaw(Prisma.sql`DELETE FROM "EscalaTurno" WHERE "id" = ${id} AND "lojaId" = ${lojaId}`);
  });
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

/** O painel tira a pessoa do turno (a qualquer hora) — menos quem já foi pago por ele. */
export async function tirarInscricao(lojaId: string, inscricaoId: string): Promise<void> {
  await garantirTabelasDaEscala();
  await prisma.$transaction(async (tx) => {
    const [i] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "EscalaInscricao" WHERE "id" = ${inscricaoId} AND "lojaId" = ${lojaId} FOR UPDATE`);
    if (!i) throw new ErroDaEscala("Essa inscrição já não existe.", 404);
    await recusarSeJaPago(tx, [inscricaoId], (nome) => `${nome} já foi pago(a) por este turno. Desfaça o pagamento antes de tirar do turno.`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM "EscalaInscricao" WHERE "id" = ${inscricaoId} AND "lojaId" = ${lojaId}`);
  });
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
  await prisma.$transaction(async (tx) => {
    const [ainda] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "EscalaInscricao" WHERE "id" = ${inscricaoId} AND "lojaId" = ${lojaId} FOR UPDATE`);
    if (!ainda) return;
    await recusarSeJaPago(tx, [inscricaoId], () => "A loja já registrou o pagamento deste turno. Para sair, fale com a loja.");
    await tx.$executeRaw(Prisma.sql`DELETE FROM "EscalaInscricao" WHERE "id" = ${inscricaoId} AND "lojaId" = ${lojaId}`);
  });
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


// ── Pagamentos (só o dono) ──────────────────────────────────────────────────

type LinhaDoPagamento = { id: string; inscricaoId: string; valor: number; forma: string | null; obs: string | null; pagoEm: Date; pagoPor: string | null };
const doPagamento = (l: LinhaDoPagamento): PagamentoFeito => ({
  id: l.id, valor: Number(l.valor), forma: l.forma === "pix" || l.forma === "dinheiro" ? l.forma : null, obs: l.obs,
  pagoEm: new Date(l.pagoEm).toISOString(), pagoPor: l.pagoPor,
});

type AcertoResumido = { id: string; em: string; dias: string[] };

/** Os acertos pagos (não desfeitos) do motoboy que alcançam os dias (do expediente) destes turnos. */
async function acertosDosMotoboys(lojaId: string, turnos: Array<{ pessoaId: string; data: string; inicio: string }>): Promise<Map<string, AcertoResumido[]>> {
  if (!turnos.length) return new Map();
  const dias = turnos.map(diaDoExpedienteDoTurno).sort();
  return acertosDoPeriodo({ lojaId, motoboyIds: [...new Set(turnos.map((t) => t.pessoaId))], de: dias[0], ate: dias[dias.length - 1] })
    .catch(() => new Map<string, AcertoResumido[]>());
}

/**
 * Cada inscrição dos turnos com o pagamento (se houver) e, para motoboy, o
 * acerto pago que já cobre o dia (lib/acerto-pago.ts). A diária é a atual da
 * pessoa — o pagamento feito guarda o valor que valeu naquele dia.
 */
export async function itensDePagamento(lojaId: string, turnos: TurnoDaEscala[], pessoas: PessoaDaEscala[]): Promise<ItemDePagamento[]> {
  const pares = turnos.flatMap((t) => t.inscritos.map((i) => ({ t, i })));
  if (!pares.length) return [];
  await garantirTabelasDaEscala();
  const linhas = await prisma.$queryRaw<LinhaDoPagamento[]>(Prisma.sql`
    SELECT "id", "inscricaoId", "valor", "forma", "obs", "pagoEm", "pagoPor" FROM "EscalaPagamento"
    WHERE "lojaId" = ${lojaId} AND "inscricaoId" = ANY(${pares.map((p) => p.i.id)}) AND "desfeitoEm" IS NULL`);
  const pago = new Map(linhas.map((l) => [l.inscricaoId, doPagamento(l)]));
  const acertos = await acertosDosMotoboys(lojaId, pares.filter((p) => p.i.pessoaTipo === "motoboy").map((p) => ({ pessoaId: p.i.pessoaId, data: p.t.data, inicio: p.t.inicio })));
  const diaria = new Map(pessoas.map((p) => [chaveDaPessoa(p.tipo, p.id), p.diaria]));
  return pares.map(({ t, i }) => {
    const a = i.pessoaTipo === "motoboy" ? acertoQueCobre(acertos.get(i.pessoaId), t) : null;
    return {
      inscricaoId: i.id, turnoId: t.id, data: t.data, inicio: t.inicio, fim: t.fim, funcao: t.funcao,
      pessoaTipo: i.pessoaTipo, pessoaId: i.pessoaId, nome: i.nome, diaria: diaria.get(chaveDaPessoa(i.pessoaTipo, i.pessoaId)) ?? null,
      pagamento: pago.get(i.id) ?? null,
      acerto: a ? { id: a.id, em: a.em, dia: diaDoExpedienteDoTurno(t) } : null,
    };
  });
}

export type PedidoDePagamento = { inscricaoIds: string[]; valor: number | null; forma: FormaDePagamento | null; obs: string | null };

/**
 * Marca como pagas as inscrições — uma, ou o "pagar tudo" de uma pessoa.
 * `valor` = o total pago; sem ele, a diária combinada de cada turno. Com
 * várias inscrições, o total é dividido pela diária de cada uma (dividirValor).
 *
 * Recusa: turno que ainda não aconteceu, inscrição já paga, e turno de motoboy
 * cujo dia já foi pago no acerto (lá vale a conta do acerto — dois controles
 * pagando o mesmo dia é pagar em dobro).
 *
 * O que pode mudar no meio (a pessoa sair do turno, outro clique pagar antes)
 * é conferido de novo com as linhas da inscrição TRAVADAS; o índice único de
 * "um pagamento valendo por inscrição" é a última trava.
 */
export async function marcarPago(lojaId: string, pedido: PedidoDePagamento, quem: string, hoje: string): Promise<number> {
  await garantirTabelasDaEscala();
  const ids = [...new Set(pedido.inscricaoIds.filter((x) => typeof x === "string" && x))].slice(0, 200);
  if (!ids.length) throw new ErroDaEscala("Escolha o turno a pagar.");
  type Linha = { id: string; turnoId: string; pessoaTipo: TipoDePessoa; pessoaId: string; nome: string; data: string; inicio: string };
  const ler = (db: Transacao, travar: boolean) => db.$queryRaw<Linha[]>(Prisma.sql`
    SELECT i."id", i."turnoId", i."pessoaTipo", i."pessoaId", i."nome", to_char(t."data", 'YYYY-MM-DD') AS "data", t."inicio"
    FROM "EscalaInscricao" i JOIN "EscalaTurno" t ON t."id" = i."turnoId"
    WHERE i."lojaId" = ${lojaId} AND i."id" = ANY(${ids}) ORDER BY i."id" ${travar ? Prisma.sql`FOR UPDATE OF i` : Prisma.empty}`);

  // Fora da transação: as consultas que usam o prisma global (o banco local
  // dos tutoriais tem UMA conexão — dentro da transação, elas esperariam para sempre).
  const antes = await ler(prisma, false);
  if (antes.length !== ids.length) throw new ErroDaEscala("Algum turno mudou (a pessoa saiu ou o turno foi apagado). Atualize a tela.", 409);
  const futuro = antes.find((l) => numeroDoDia(l.data) > numeroDoDia(hoje));
  if (futuro) throw new ErroDaEscala(`O turno de ${diaEMes(futuro.data)} ainda não aconteceu — marque o pagamento depois que a pessoa trabalhar.`, 409, "FUTURO");
  const acertos = await acertosDosMotoboys(lojaId, antes.filter((l) => l.pessoaTipo === "motoboy"));
  const noAcerto = antes.find((l) => l.pessoaTipo === "motoboy" && acertoQueCobre(acertos.get(l.pessoaId), l));
  if (noAcerto) {
    throw new ErroDaEscala(`${noAcerto.nome} já recebeu o dia ${diaEMes(diaDoExpedienteDoTurno(noAcerto))} no acerto do motoboy. Para mudar, desfaça o acerto no relatório dos motoboys.`, 409, "NO_ACERTO");
  }
  const diaria = new Map((await pessoasDaLoja(lojaId, { inativos: true })).map((p) => [chaveDaPessoa(p.tipo, p.id), p.diaria]));
  const diarias = antes.map((l) => diaria.get(chaveDaPessoa(l.pessoaTipo, l.pessoaId)) ?? null);
  let valores: number[];
  if (pedido.valor != null) {
    if (!(pedido.valor > 0) || pedido.valor > 1_000_000) throw new ErroDaEscala("Digite o valor pago.", 400, "SEM_VALOR");
    valores = dividirValor(pedido.valor, diarias);
  } else {
    const k = diarias.findIndex((d) => !(Number(d) > 0));
    if (k >= 0) throw new ErroDaEscala(`${antes[k].nome} não tem diária combinada: digite o valor pago.`, 400, "SEM_VALOR");
    valores = diarias.map(Number);
  }
  const valorDe = new Map(antes.map((l, k) => [l.id, valores[k]]));
  const obs = texto(pedido.obs, 300);

  try {
    await prisma.$transaction(async (tx) => {
      const travadas = await ler(tx, true);
      if (travadas.length !== ids.length) throw new ErroDaEscala("Algum turno mudou (a pessoa saiu ou o turno foi apagado). Atualize a tela.", 409);
      const ja = await tx.$queryRaw<{ nome: string; data: string }[]>(Prisma.sql`
        SELECT "nome", to_char("data", 'YYYY-MM-DD') AS "data" FROM "EscalaPagamento" WHERE "inscricaoId" = ANY(${ids}) AND "desfeitoEm" IS NULL`);
      if (ja.length) throw new ErroDaEscala(`Já está marcado como pago: ${ja.map((j) => `${j.nome} (${diaEMes(j.data)})`).join(", ")}. Atualize a tela.`, 409, "JA_PAGO");
      const linhas = travadas.map((l) => Prisma.sql`(${randomUUID()}, ${lojaId}, ${l.id}, ${l.turnoId}, ${l.pessoaTipo}, ${l.pessoaId}, ${l.nome}, ${l.data}::date,
        ${valorDe.get(l.id) ?? 0}, ${pedido.forma}, ${obs}, ${agoraEmUtc()}, ${quem.slice(0, 120)})`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "EscalaPagamento" ("id", "lojaId", "inscricaoId", "turnoId", "pessoaTipo", "pessoaId", "nome", "data", "valor", "forma", "obs", "pagoEm", "pagoPor")
        VALUES ${Prisma.join(linhas)}`);
    });
  } catch (err: any) {
    if (String(err?.message || "").includes("EscalaPagamento_inscricao_key")) throw new ErroDaEscala("Esse turno acabou de ser marcado como pago. Atualize a tela.", 409, "JA_PAGO");
    throw err;
  }
  return ids.length;
}

/** Desfaz o pagamento: fica no banco, marcado (quem e quando), e a inscrição volta a "a pagar". */
export async function desfazerPagamento(lojaId: string, id: string, quem: string): Promise<void> {
  await garantirTabelasDaEscala();
  const r = await prisma.$executeRaw(Prisma.sql`
    UPDATE "EscalaPagamento" SET "desfeitoEm" = ${agoraEmUtc()}, "desfeitoPor" = ${quem.slice(0, 120)}
    WHERE "id" = ${id} AND "lojaId" = ${lojaId} AND "desfeitoEm" IS NULL`);
  if (!r) throw new ErroDaEscala("Esse pagamento não existe ou já foi desfeito.", 404);
}

export type EscalaDoMotoboy = { pix: string | null; pixTipo: TipoDePix | null; pixOrigem: string | null; pago: number; dias: string[] };

/**
 * Para a tela do acerto do motoboy ("onde faz com o motoboy, coloca lá
 * também"): o Pix que ele deu na escala e quanto a escala já registrou como
 * pago a ele em dias do EXPEDIENTE dentro de [de, ate] — para o dono não
 * pagar o mesmo dia duas vezes. Não mexe na conta do acerto.
 */
export async function escalaDosMotoboys(lojaId: string, de: string, ate: string): Promise<Record<string, EscalaDoMotoboy>> {
  await garantirTabelasDaEscala();
  const [chaves, pagos] = await Promise.all([
    prisma.$queryRaw<{ refId: string; pix: string; pixTipo: string | null; pixOrigem: string | null }[]>(Prisma.sql`
      SELECT "refId", "pix", "pixTipo", "pixOrigem" FROM "EscalaPessoa" WHERE "lojaId" = ${lojaId} AND "tipo" = 'motoboy' AND "refId" IS NOT NULL AND "pix" IS NOT NULL`),
    // O turno da madrugada do dia seguinte ainda é do expediente de `ate`: busca um dia a mais e filtra.
    prisma.$queryRaw<{ pessoaId: string; valor: number; data: string; inicio: string | null }[]>(Prisma.sql`
      SELECT p."pessoaId", p."valor", to_char(p."data", 'YYYY-MM-DD') AS "data", t."inicio"
      FROM "EscalaPagamento" p LEFT JOIN "EscalaTurno" t ON t."id" = p."turnoId"
      WHERE p."lojaId" = ${lojaId} AND p."pessoaTipo" = 'motoboy' AND p."desfeitoEm" IS NULL
        AND p."data" BETWEEN ${de}::date AND (${ate}::date + 1)`),
  ]);
  const r: Record<string, EscalaDoMotoboy> = {};
  const de_ = (id: string) => (r[id] ||= { pix: null, pixTipo: null, pixOrigem: null, pago: 0, dias: [] });
  for (const c of chaves) Object.assign(de_(c.refId), { pix: c.pix, pixTipo: (c.pixTipo as TipoDePix | null) ?? null, pixOrigem: c.pixOrigem });
  for (const p of pagos) {
    const dia = diaDoExpedienteDoTurno({ data: p.data, inicio: p.inicio || "12:00" });
    if (dia < de || dia > ate) continue;
    const m = de_(p.pessoaId);
    m.pago = Math.round((m.pago + Number(p.valor)) * 100) / 100;
    if (!m.dias.includes(dia)) m.dias.push(dia);
  }
  for (const m of Object.values(r)) m.dias.sort();
  return r;
}
