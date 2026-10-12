/**
 * lib/keeta/lojas.ts — qual loja do FireHub é qual loja da Keeta.
 *
 * Dois ids por loja:
 *   - o NOSSO (`merchantId`, 36–100 caracteres): vai no onboarding, no
 *     `x-polling-merchants`, no header `X-App-MerchantId` do webhook e volta em
 *     `order.merchant.id`. É `firehub-keeta-<id da loja>` — derivado, então o
 *     pedido diz sozinho de que loja é;
 *   - o da Keeta (`keetaMerchantId`, número): o que o lojista autorizou.
 *
 * A loja de um pedido sai SÓ daqui, e só de vínculo ativo. Nada de "primeira
 * loja ativa" (JotaJá, 14/08/2026), nada de herdar merchant antigo ao
 * reconectar (iFood, Pastel da Paulista caindo no merchant da Hakim), nada de
 * "a única loja conectada" (Brendi). Pedido de merchant desconhecido NÃO é
 * gravado em loja nenhuma: fica no payload cru e gera erro no log.
 *
 * Tabela própria, criada no primeiro uso.
 */
import { prisma } from "@/lib/prisma";

const PREFIXO = "firehub-keeta-";

export function merchantIdDaLoja(lojaId: string): string {
  const id = `${PREFIXO}${lojaId}`;
  // A Keeta exige no mínimo 36 caracteres; id de loja curto ganha enchimento
  // fixo (o mesmo sempre), para continuar derivável.
  return id.length >= 36 ? id : id.padEnd(36, "0");
}

let pronta: Promise<void> | null = null;
function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KeetaLoja" (
          "merchantId"       TEXT PRIMARY KEY,
          "franchiseeId"     TEXT NOT NULL UNIQUE,
          "keetaMerchantId"  BIGINT NOT NULL UNIQUE,
          "nomeNaKeeta"      TEXT,
          "ativa"            BOOLEAN NOT NULL DEFAULT true,
          "vinculadaEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
          "vinculadaPor"     TEXT,
          "desligadaEm"      TIMESTAMPTZ
        )`)
      .then(() => undefined)
      .catch((e) => {
        pronta = null;
        throw e;
      });
  }
  return pronta;
}

export type LojaKeeta = { merchantId: string; franchiseeId: string; keetaMerchantId: string; nomeNaKeeta: string | null; ativa: boolean };

const ler = (l: any): LojaKeeta => ({
  merchantId: l.merchantId,
  franchiseeId: l.franchiseeId,
  keetaMerchantId: String(l.keetaMerchantId),
  nomeNaKeeta: l.nomeNaKeeta ?? null,
  ativa: !!l.ativa,
});

/** A loja de um merchantId nosso — só vínculo ATIVO. */
export async function lojaDoMerchant(merchantId: string | null | undefined): Promise<LojaKeeta | null> {
  if (!merchantId) return null;
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "KeetaLoja" WHERE "merchantId" = $1 AND "ativa" = true`, String(merchantId));
  return linhas[0] ? ler(linhas[0]) : null;
}

export async function lojaKeetaDoFranqueado(franchiseeId: string): Promise<LojaKeeta | null> {
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "KeetaLoja" WHERE "franchiseeId" = $1`, franchiseeId);
  return linhas[0] ? ler(linhas[0]) : null;
}

export async function merchantsAtivos(): Promise<string[]> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT "merchantId" FROM "KeetaLoja" WHERE "ativa" = true ORDER BY "vinculadaEm"`);
    return linhas.map((l) => String(l.merchantId));
  } catch (e: any) {
    console.error("[Keeta] não li as lojas vinculadas:", e?.message);
    return [];
  }
}

/**
 * Grava o vínculo. Recusa — com motivo — em vez de sobrescrever:
 *   - loja da Keeta já ligada a OUTRA loja do FireHub;
 *   - loja do FireHub já ligada a OUTRA loja da Keeta.
 * Trocar o par é desligar o antigo antes, de propósito: é o erro que faz o
 * pedido de uma loja cair no painel da outra.
 */
export async function gravarVinculo(franchiseeId: string, keetaMerchantId: number, nomeNaKeeta: string | null, quem: string): Promise<{ ok: boolean; motivo?: string; loja?: LojaKeeta; novo?: boolean }> {
  await garantirTabela();
  const merchantId = merchantIdDaLoja(franchiseeId);
  const daKeeta = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "KeetaLoja" WHERE "keetaMerchantId" = $1`, BigInt(keetaMerchantId));
  if (daKeeta[0] && daKeeta[0].franchiseeId !== franchiseeId) {
    return { ok: false, motivo: `A loja ${keetaMerchantId} da Keeta já está ligada a outra loja do FireHub (${daKeeta[0].franchiseeId}).` };
  }
  const doFireHub = await lojaKeetaDoFranqueado(franchiseeId);
  if (doFireHub && doFireHub.keetaMerchantId !== String(keetaMerchantId)) {
    return { ok: false, motivo: `Esta loja já está ligada à loja ${doFireHub.keetaMerchantId} da Keeta. Desligue antes de trocar.` };
  }
  if (doFireHub) {
    await prisma.$executeRawUnsafe(
      `UPDATE "KeetaLoja" SET "ativa" = true, "desligadaEm" = NULL, "nomeNaKeeta" = COALESCE($2, "nomeNaKeeta") WHERE "franchiseeId" = $1`,
      franchiseeId,
      nomeNaKeeta,
    );
    return { ok: true, loja: { ...doFireHub, ativa: true }, novo: false };
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KeetaLoja" ("merchantId","franchiseeId","keetaMerchantId","nomeNaKeeta","vinculadaPor") VALUES ($1,$2,$3,$4,$5)`,
    merchantId,
    franchiseeId,
    BigInt(keetaMerchantId),
    nomeNaKeeta,
    quem,
  );
  return { ok: true, loja: { merchantId, franchiseeId, keetaMerchantId: String(keetaMerchantId), nomeNaKeeta, ativa: true }, novo: true };
}

/** Lojista revogou a autorização na Keeta (webhook 1302) ou desligou aqui. */
export async function desligarVinculo(filtro: { keetaMerchantId?: number | string; franchiseeId?: string }): Promise<number> {
  await garantirTabela();
  if (filtro.keetaMerchantId != null) {
    return prisma.$executeRawUnsafe(`UPDATE "KeetaLoja" SET "ativa" = false, "desligadaEm" = now() WHERE "keetaMerchantId" = $1`, BigInt(String(filtro.keetaMerchantId)));
  }
  if (filtro.franchiseeId) {
    return prisma.$executeRawUnsafe(`UPDATE "KeetaLoja" SET "ativa" = false, "desligadaEm" = now() WHERE "franchiseeId" = $1`, filtro.franchiseeId);
  }
  return 0;
}
