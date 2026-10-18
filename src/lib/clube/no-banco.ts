/**
 * CLUBE DO APLICATIVO — o que mora no banco.
 *
 * Tabelas próprias criadas no primeiro uso (mesma categoria de
 * lib/app-da-loja/plano.ts): se faltarem, o clube some e o pedido sai normal.
 *
 * - "ClubeDaLoja": a config da marca (chave = principal do grupo) e o segredo
 *   da URL do webhook.
 * - "ClubeAssinatura": um assinante por marca e telefone (8 últimos dígitos).
 *   `callback` = o que vai no link do checkout e volta da Cakto.
 * - "ClubeEventoVisto": trava para o mesmo pagamento não somar dois meses.
 * - "ClubePedido": o desconto que cada pedido levou (números do painel).
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar, mesmoSegredo } from "@/lib/cofre";
import { finalDoTelefone } from "@/lib/pedidos-do-telefone";
import { principalDoGrupo } from "@/lib/vitrine-do-grupo";
import { appLigadoNaConta } from "@/lib/app-da-loja/instalacoes";
import {
  lerConfigDoClube,
  novoPagoAte,
  situacaoDaAssinatura,
  type Assinatura,
  type ConfigDoClube,
  type SituacaoNoCardapio,
  type StatusGravado,
} from "@/lib/clube/regras";
import { chaveDoPagamento, type EventoDaCakto } from "@/lib/clube/cakto";
import { STATUS_FORA_DA_VENDA } from "@/lib/relatorios/base";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "ClubeDaLoja" (
     "chave" TEXT NOT NULL,
     "config" JSONB NOT NULL DEFAULT '{}',
     "segredoDaUrl" TEXT,
     "segredoDaCaktoCifrado" TEXT,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ClubeDaLoja_pkey" PRIMARY KEY ("chave")
   )`,
  `CREATE TABLE IF NOT EXISTS "ClubeAssinatura" (
     "id" TEXT NOT NULL,
     "chave" TEXT NOT NULL,
     "telefoneFinal" TEXT NOT NULL,
     "telefone" TEXT NOT NULL,
     "clienteId" TEXT,
     "nome" TEXT,
     "email" TEXT,
     "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
     "pagoAte" TIMESTAMP(3),
     "desde" TIMESTAMP(3),
     "canceladoEm" TIMESTAMP(3),
     "assinaturaExterna" TEXT,
     "callback" TEXT NOT NULL,
     "ultimoEvento" TEXT,
     "pagamentos" INTEGER NOT NULL DEFAULT 0,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ClubeAssinatura_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ClubeAssinatura_chave_tel" ON "ClubeAssinatura" ("chave", "telefoneFinal")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ClubeAssinatura_callback" ON "ClubeAssinatura" ("callback")`,
  `CREATE TABLE IF NOT EXISTS "ClubeEventoVisto" (
     "chave" TEXT NOT NULL,
     "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ClubeEventoVisto_pkey" PRIMARY KEY ("chave")
   )`,
  `CREATE TABLE IF NOT EXISTS "ClubePedido" (
     "pedidoId" TEXT NOT NULL,
     "chave" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "assinaturaId" TEXT NOT NULL,
     "desconto" DOUBLE PRECISION NOT NULL,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ClubePedido_pkey" PRIMARY KEY ("pedidoId")
   )`,
  `CREATE INDEX IF NOT EXISTS "ClubePedido_chave_criado" ON "ClubePedido" ("chave", "criadoEm")`,
];

let pronto = false;
export async function garantirEstruturaDoClube(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) { pronto = true; return true; }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Clube] Estrutura falhou:", err?.message);
  }
  return pronto;
}

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === "string" ? d : null);

// ── A MARCA ─────────────────────────────────────────────────────────────────

/** A chave do clube desta loja (a principal do grupo) — null se a loja não existe. */
export async function chaveDoClubeDaLoja(lojaId: string): Promise<string | null> {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, accountGroupId: true } });
  return loja ? principalDoGrupo(loja) : null;
}

export type ClubeDaConta = {
  chave: string;
  config: ConfigDoClube;
  segredoDaUrl: string | null;
  temSegredoDaCakto: boolean;
};

export async function lerClube(chave: string): Promise<ClubeDaConta> {
  const vazio: ClubeDaConta = { chave, config: lerConfigDoClube(null), segredoDaUrl: null, temSegredoDaCakto: false };
  if (!(await garantirEstruturaDoClube())) return vazio;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "config", "segredoDaUrl", "segredoDaCaktoCifrado" FROM "ClubeDaLoja" WHERE "chave" = $1`,
      chave,
    );
    const r = rows[0];
    if (!r) return vazio;
    return { chave, config: lerConfigDoClube(r.config), segredoDaUrl: r.segredoDaUrl ?? null, temSegredoDaCakto: !!r.segredoDaCaktoCifrado };
  } catch (e: any) {
    console.error("[Clube] lerClube:", e?.message);
    return vazio;
  }
}

/**
 * O clube que vale para o cardápio desta loja: só com o plano do app ligado
 * (o clube é benefício do aplicativo) e o clube ligado com o link do checkout.
 */
export async function clubeValendoNaLoja(lojaId: string): Promise<ClubeDaConta | null> {
  try {
    const chave = await chaveDoClubeDaLoja(lojaId);
    if (!chave) return null;
    const [clube, app] = await Promise.all([lerClube(chave), appLigadoNaConta(lojaId)]);
    if (!app || !clube.config.ativo || !clube.config.linkDoCheckout) return null;
    return clube;
  } catch {
    return null;
  }
}

export async function gravarClube(
  chave: string,
  config: ConfigDoClube,
  opcoes: { segredoDaCakto?: string | null } = {},
): Promise<ClubeDaConta> {
  if (!(await garantirEstruturaDoClube())) throw new Error("Não foi possível preparar o clube agora.");
  const atual = await lerClube(chave);
  const segredoDaUrl = atual.segredoDaUrl || crypto.randomBytes(18).toString("base64url");
  const novoSegredo = typeof opcoes.segredoDaCakto === "string" ? opcoes.segredoDaCakto.trim() : undefined;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ClubeDaLoja" ("chave","config","segredoDaUrl","segredoDaCaktoCifrado","atualizadoEm")
     VALUES ($1, $2::jsonb, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT ("chave") DO UPDATE SET
       "config" = EXCLUDED."config",
       "segredoDaUrl" = COALESCE("ClubeDaLoja"."segredoDaUrl", EXCLUDED."segredoDaUrl"),
       "segredoDaCaktoCifrado" = CASE WHEN $5 THEN EXCLUDED."segredoDaCaktoCifrado" ELSE "ClubeDaLoja"."segredoDaCaktoCifrado" END,
       "atualizadoEm" = CURRENT_TIMESTAMP`,
    chave,
    JSON.stringify(config),
    segredoDaUrl,
    novoSegredo ? cifrar(novoSegredo) : null,
    novoSegredo !== undefined,
  );
  return lerClube(chave);
}

/**
 * O webhook é desta marca? Aceita o segredo da NOSSA URL (`?s=`, gerado aqui)
 * ou o segredo que a Cakto manda no corpo, quando a loja colou ele no painel.
 */
export async function webhookAutentico(chave: string, daUrl: string, doCorpo: string): Promise<boolean> {
  if (!(await garantirEstruturaDoClube())) return false;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "segredoDaUrl", "segredoDaCaktoCifrado" FROM "ClubeDaLoja" WHERE "chave" = $1`,
    chave,
  );
  const r = rows[0];
  if (!r) return false;
  if (daUrl && r.segredoDaUrl && mesmoSegredo(daUrl, r.segredoDaUrl)) return true;
  const daCakto = decifrar(r.segredoDaCaktoCifrado);
  return !!(doCorpo && daCakto && mesmoSegredo(doCorpo, daCakto));
}

// ── O ASSINANTE ─────────────────────────────────────────────────────────────

export type LinhaDoAssinante = {
  id: string;
  chave: string;
  telefone: string;
  clienteId: string | null;
  nome: string | null;
  email: string | null;
  status: StatusGravado;
  pagoAte: string | null;
  desde: string | null;
  canceladoEm: string | null;
  callback: string;
  ultimoEvento: string | null;
  pagamentos: number;
  atualizadoEm: string | null;
};

function linha(r: any): LinhaDoAssinante {
  return {
    id: r.id,
    chave: r.chave,
    telefone: r.telefone,
    clienteId: r.clienteId ?? null,
    nome: r.nome ?? null,
    email: r.email ?? null,
    status: (["AGUARDANDO", "ATIVO", "PENDENTE", "CANCELADO"].includes(r.status) ? r.status : "AGUARDANDO") as StatusGravado,
    pagoAte: iso(r.pagoAte),
    desde: iso(r.desde),
    canceladoEm: iso(r.canceladoEm),
    callback: r.callback,
    ultimoEvento: r.ultimoEvento ?? null,
    pagamentos: Number(r.pagamentos) || 0,
    atualizadoEm: iso(r.atualizadoEm),
  };
}

export const paraAssinatura = (l: Pick<LinhaDoAssinante, "status" | "pagoAte" | "desde">): Assinatura => ({
  status: l.status,
  pagoAte: l.pagoAte,
  desde: l.desde,
});

export async function assinanteDoTelefone(chave: string, telefone: string): Promise<LinhaDoAssinante | null> {
  const final = finalDoTelefone(telefone);
  if (!final || !(await garantirEstruturaDoClube())) return null;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "ClubeAssinatura" WHERE "chave" = $1 AND "telefoneFinal" = $2`,
    chave,
    final,
  );
  return rows[0] ? linha(rows[0]) : null;
}

export async function situacaoDoTelefone(chave: string, telefone: string, agora = new Date()): Promise<{ situacao: SituacaoNoCardapio; assinante: LinhaDoAssinante | null }> {
  const assinante = await assinanteDoTelefone(chave, telefone);
  return { situacao: situacaoDaAssinatura(assinante ? paraAssinatura(assinante) : null, agora), assinante };
}

/**
 * O cliente apertou "Assinar": garante a linha dele (AGUARDANDO, se nova) e
 * devolve o `callback` que vai no link. Quem já foi assinante mantém a linha —
 * o pagamento novo reativa.
 */
export async function prepararAssinatura(
  chave: string,
  c: { clienteId: string; telefone: string; nome: string | null },
): Promise<LinhaDoAssinante> {
  const final = finalDoTelefone(c.telefone);
  if (!final) throw new Error("Telefone inválido.");
  if (!(await garantirEstruturaDoClube())) throw new Error("Não foi possível preparar o clube agora.");
  const id = crypto.randomBytes(12).toString("base64url");
  const callback = `clb-${crypto.randomBytes(15).toString("base64url")}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ClubeAssinatura" ("id","chave","telefoneFinal","telefone","clienteId","nome","callback")
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ("chave","telefoneFinal") DO UPDATE SET
       "clienteId" = EXCLUDED."clienteId",
       "nome" = COALESCE("ClubeAssinatura"."nome", EXCLUDED."nome"),
       "atualizadoEm" = CURRENT_TIMESTAMP`,
    id,
    chave,
    final,
    String(c.telefone).replace(/\D/g, ""),
    c.clienteId,
    c.nome,
    callback,
  );
  const l = await assinanteDoTelefone(chave, c.telefone);
  if (!l) throw new Error("Não foi possível preparar a assinatura.");
  return l;
}

// ── O WEBHOOK ───────────────────────────────────────────────────────────────

export type ResultadoDoEvento =
  | { ok: true; assinanteId: string; status: StatusGravado; pagoAte: string | null; repetido?: boolean }
  | { ok: true; ignorado: string };

/** Primeira vez que esta chave aparece? (trava do pagamento repetido) */
async function primeiraVez(chave: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO "ClubeEventoVisto" ("chave") VALUES ($1) ON CONFLICT ("chave") DO NOTHING`,
    chave.slice(0, 300),
  );
  return Number(n) > 0;
}

export async function aplicarEventoDaCakto(chave: string, e: EventoDaCakto, agora = new Date()): Promise<ResultadoDoEvento> {
  if (!e.acao) return { ok: true, ignorado: `evento sem efeito: ${e.evento || "?"}` };
  if (!(await garantirEstruturaDoClube())) throw new Error("estrutura do clube indisponível");

  // Quem é: pelo callback (veio do nosso botão) → pela assinatura da Cakto → pelo telefone.
  let rows: any[] = [];
  if (e.callback) {
    rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ClubeAssinatura" WHERE "chave" = $1 AND "callback" = $2`, chave, e.callback);
  }
  if (!rows.length && e.assinaturaId) {
    rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ClubeAssinatura" WHERE "chave" = $1 AND "assinaturaExterna" = $2`, chave, e.assinaturaId);
  }
  const final = finalDoTelefone(e.telefone);
  if (!rows.length && final) {
    rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ClubeAssinatura" WHERE "chave" = $1 AND "telefoneFinal" = $2`, chave, final);
  }
  let atual: LinhaDoAssinante | null = rows[0] ? linha(rows[0]) : null;

  if (!atual) {
    // Comprou pelo link sem passar pelo app: só pagamento cria assinante (pelo telefone).
    if (e.acao !== "pagou") return { ok: true, ignorado: "assinante desconhecido para evento negativo" };
    if (!final || !e.telefone) return { ok: true, ignorado: "pagamento sem telefone nem callback" };
    const id = crypto.randomBytes(12).toString("base64url");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ClubeAssinatura" ("id","chave","telefoneFinal","telefone","nome","email","callback")
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("chave","telefoneFinal") DO NOTHING`,
      id, chave, final, e.telefone, e.nome, e.email, `clb-${crypto.randomBytes(15).toString("base64url")}`,
    );
    const r = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ClubeAssinatura" WHERE "chave" = $1 AND "telefoneFinal" = $2`, chave, final);
    atual = r[0] ? linha(r[0]) : null;
    if (!atual) throw new Error("não consegui criar o assinante");
  }

  const trava = chaveDoPagamento(e);
  if (trava && !(await primeiraVez(`${chave}:${trava}`))) {
    return { ok: true, assinanteId: atual.id, status: atual.status, pagoAte: atual.pagoAte, repetido: true };
  }

  let status: StatusGravado = atual.status;
  let pagoAte = atual.pagoAte;
  let desde = atual.desde;
  let canceladoEm = atual.canceladoEm;
  let pagamentos = atual.pagamentos;
  if (e.acao === "pagou") {
    status = "ATIVO";
    pagoAte = novoPagoAte(atual.pagoAte, e.pagoEm && e.pagoEm.getTime() <= agora.getTime() ? e.pagoEm : agora);
    if (!desde || atual.status === "AGUARDANDO" || atual.status === "CANCELADO") desde = desde || agora.toISOString();
    canceladoEm = null;
    pagamentos += 1;
  } else if (e.acao === "atrasou") {
    // A cobrança da renovação não passou: o desconto sai na hora e o cardápio
    // mostra "pague o clube" (Douglas: "não aprovar a assinatura… aparece a
    // mensagem para ele pagar"). A Cakto ainda tenta de novo; passou, volta.
    if (status !== "CANCELADO") status = "PENDENTE";
  } else if (e.acao === "cancelou") {
    status = "CANCELADO";
    canceladoEm = agora.toISOString();
  } else if (e.acao === "estornou") {
    status = "PENDENTE";
    pagoAte = agora.toISOString();
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "ClubeAssinatura" SET
       "status" = $2, "pagoAte" = $3::timestamp, "desde" = $4::timestamp, "canceladoEm" = $5::timestamp,
       "pagamentos" = $6, "ultimoEvento" = $7,
       "assinaturaExterna" = COALESCE($8, "assinaturaExterna"),
       "email" = COALESCE("email", $9), "nome" = COALESCE("nome", $10),
       "atualizadoEm" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    atual.id,
    status,
    pagoAte,
    desde,
    canceladoEm,
    pagamentos,
    `${e.evento} ${agora.toISOString()}`.slice(0, 120),
    e.assinaturaId,
    e.email,
    e.nome,
  );
  return { ok: true, assinanteId: atual.id, status, pagoAte };
}

// ── O PEDIDO ────────────────────────────────────────────────────────────────

export async function registrarDescontoDoClube(p: { pedidoId: string; chave: string; lojaId: string; assinaturaId: string; desconto: number }): Promise<void> {
  try {
    if (!(await garantirEstruturaDoClube())) return;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ClubePedido" ("pedidoId","chave","lojaId","assinaturaId","desconto") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("pedidoId") DO NOTHING`,
      p.pedidoId, p.chave, p.lojaId, p.assinaturaId, p.desconto,
    );
  } catch (e: any) {
    console.error("[Clube] registrar desconto:", e?.message);
  }
}

// ── O PAINEL ────────────────────────────────────────────────────────────────

export async function assinantesDoClube(chave: string): Promise<LinhaDoAssinante[]> {
  if (!(await garantirEstruturaDoClube())) return [];
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "ClubeAssinatura" WHERE "chave" = $1 AND ("status" <> 'AGUARDANDO' OR "pagoAte" IS NOT NULL) ORDER BY "atualizadoEm" DESC LIMIT 1000`,
    chave,
  );
  return rows.map(linha);
}

/** Pedidos com desconto do clube desde `desde` — só os que são venda (régua de lib/relatorios/base.ts). */
export async function pedidosDoClube(chave: string, desde: Date): Promise<{ pedidos: number; desconto: number; faturamento: number }> {
  if (!(await garantirEstruturaDoClube())) return { pedidos: 0, desconto: 0, faturamento: 0 };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS "pedidos", COALESCE(SUM(c."desconto"),0)::float AS "desconto", COALESCE(SUM(o."totalAmount"),0)::float AS "faturamento"
         FROM "ClubePedido" c JOIN "CustomerOrder" o ON o."id" = c."pedidoId"
        WHERE c."chave" = $1 AND c."criadoEm" >= $2 AND NOT (UPPER(o."status") = ANY($3::text[]))`,
      chave,
      desde,
      [...STATUS_FORA_DA_VENDA],
    );
    const r = rows[0] || {};
    return { pedidos: Number(r.pedidos) || 0, desconto: Number(r.desconto) || 0, faturamento: Number(r.faturamento) || 0 };
  } catch (e: any) {
    console.error("[Clube] pedidosDoClube:", e?.message);
    return { pedidos: 0, desconto: 0, faturamento: 0 };
  }
}
