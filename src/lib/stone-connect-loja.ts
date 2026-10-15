/**
 * /src/lib/stone-connect-loja.ts — a chave da Stone (Connect 2.0) de cada loja.
 *
 * A secret key (sk_...) movimenta a conta Pagar.me/Stone do lojista: vai
 * CIFRADA (lib/cofre.ts) e nunca volta para a tela — o painel só mostra
 * "conectada" e os 4 últimos caracteres.
 *
 * O `ServiceRefererName` NÃO mora aqui: ele é o id do FireHub como parceiro da
 * Stone, igual para todas as lojas (env STONE_CONNECT_SERVICE_REFERER_NAME).
 *
 * `fluxo` é como a conta foi credenciada na Stone (decisão do credenciamento,
 * por conta): LISTADO — a POS mostra a lista de pedidos abertos e quem está
 * nela escolhe o pedido e a forma; DIRETO — a POS abre a tela de pagamento
 * sozinha, no `tipoDireto` (crédito à vista, débito, pix ou voucher).
 *
 * Tabela própria, criada no primeiro uso (sem migração manual em produção).
 */
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import { ehTipoDireto, type TipoDireto } from "@/lib/stone-connect";

export type FluxoStone = "LISTADO" | "DIRETO";

export type LojaStone = {
  franchiseeId: string;
  fluxo: FluxoStone;
  tipoDireto: TipoDireto;
  finalDaChave: string | null;
  conectadaEm: Date;
  conectadaPor: string | null;
};

let pronta: Promise<void> | null = null;
function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "StoneConnectLoja" (
          "franchiseeId"  TEXT PRIMARY KEY,
          "chaveCifrada"  TEXT NOT NULL,
          "finalDaChave"  TEXT,
          "fluxo"         TEXT NOT NULL DEFAULT 'LISTADO',
          "tipoDireto"    TEXT NOT NULL DEFAULT 'credit',
          "conectadaEm"   TIMESTAMPTZ NOT NULL DEFAULT now(),
          "conectadaPor"  TEXT
        )`)
      .then(() => undefined)
      .catch((e) => {
        pronta = null;
        throw e;
      });
  }
  return pronta;
}

const ler = (l: any): LojaStone => ({
  franchiseeId: l.franchiseeId,
  fluxo: l.fluxo === "DIRETO" ? "DIRETO" : "LISTADO",
  tipoDireto: ehTipoDireto(l.tipoDireto) ? l.tipoDireto : "credit",
  finalDaChave: l.finalDaChave ?? null,
  conectadaEm: l.conectadaEm,
  conectadaPor: l.conectadaPor ?? null,
});

/** Situação da conexão, sem a chave. */
export async function lojaStone(franchiseeId: string): Promise<LojaStone | null> {
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "StoneConnectLoja" WHERE "franchiseeId" = $1`, franchiseeId);
  return r[0] ? ler(r[0]) : null;
}

/**
 * Chave aberta + configuração, para falar com a Stone. `null` se a loja não
 * conectou ou se a chave não abre (cofre trocado) — nos dois casos o lojista
 * precisa colar a chave de novo.
 */
export async function credencialStone(franchiseeId: string): Promise<(LojaStone & { chave: string }) | null> {
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "StoneConnectLoja" WHERE "franchiseeId" = $1`, franchiseeId);
  if (!r[0]) return null;
  const chave = decifrar(r[0].chaveCifrada);
  if (!chave) {
    console.error(`[Stone Connect] Chave da loja ${franchiseeId} não abriu no cofre — o lojista precisa colar de novo.`);
    return null;
  }
  return { ...ler(r[0]), chave };
}

/** Formato da secret key do Pagar.me: sk_ + letras/números (sk_test_ inclusive). */
export function chaveTemFormato(chave: string): boolean {
  return /^sk_[A-Za-z0-9_]{8,}$/.test(chave);
}

export async function gravarChaveStone(params: {
  franchiseeId: string;
  chave: string;
  fluxo: FluxoStone;
  tipoDireto: TipoDireto;
  por: string;
}): Promise<void> {
  await garantirTabela();
  const { franchiseeId, chave, fluxo, tipoDireto, por } = params;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "StoneConnectLoja" ("franchiseeId","chaveCifrada","finalDaChave","fluxo","tipoDireto","conectadaPor")
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ("franchiseeId") DO UPDATE SET
       "chaveCifrada" = EXCLUDED."chaveCifrada", "finalDaChave" = EXCLUDED."finalDaChave",
       "fluxo" = EXCLUDED."fluxo", "tipoDireto" = EXCLUDED."tipoDireto",
       "conectadaEm" = now(), "conectadaPor" = EXCLUDED."conectadaPor"`,
    franchiseeId, cifrar(chave), chave.slice(-4), fluxo, tipoDireto, por.slice(0, 120),
  );
}

/** Troca só o fluxo/tipo, sem pedir a chave de novo. */
export async function gravarFluxoStone(franchiseeId: string, fluxo: FluxoStone, tipoDireto: TipoDireto): Promise<boolean> {
  await garantirTabela();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "StoneConnectLoja" SET "fluxo" = $2, "tipoDireto" = $3 WHERE "franchiseeId" = $1`,
    franchiseeId, fluxo, tipoDireto,
  );
  return n > 0;
}

export async function desconectarStone(franchiseeId: string): Promise<void> {
  await garantirTabela();
  await prisma.$executeRawUnsafe(`DELETE FROM "StoneConnectLoja" WHERE "franchiseeId" = $1`, franchiseeId);
}
