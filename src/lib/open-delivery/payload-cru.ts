/**
 * lib/open-delivery/payload-cru.ts — o pedido COMO CHEGOU, guardado no banco.
 *
 * ── Por que no banco ────────────────────────────────────────────────────────
 *
 * "Doc de parceiro é promessa": cinco bugs da Wabiz numa noite (22/09/2026), o
 * `type` da Brendi que o suporte disse ONLINE e veio PREPAID, o endereço em
 * `street`/`district` e não nos nomes da spec. Em todos, o conserto dependeu de
 * LER o payload real — e ele já não existia: o log em memória
 * (webhook-brendi-log.ts) some no restart, e o log do Coolify some a cada
 * deploy (container novo).
 *
 * Aqui fica uma linha por pedido/evento, por 30 dias, com os avisos da
 * tradução. A tabela é criada na primeira gravação de um canal novo — nenhuma
 * loja que não usa esse canal toca nela.
 *
 * Falhar aqui NUNCA custa o pedido: tudo é try/catch e só loga.
 */
import { prisma } from "@/lib/prisma";

const DIAS_GUARDADOS = 30;
let tabelaPronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!tabelaPronta) {
    tabelaPronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PayloadDoParceiro" (
          "id"            BIGSERIAL PRIMARY KEY,
          "canal"         TEXT NOT NULL,
          "tipo"          TEXT NOT NULL,
          "idNoParceiro"  TEXT,
          "franchiseeId"  TEXT,
          "recebidoEm"    TIMESTAMPTZ NOT NULL DEFAULT now(),
          "payload"       JSONB,
          "avisos"        JSONB
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "PayloadDoParceiro_canal_id" ON "PayloadDoParceiro" ("canal", "idNoParceiro")`,
      );
    })().catch((e) => {
      tabelaPronta = null; // tenta de novo na próxima
      throw e;
    });
  }
  return tabelaPronta;
}

let ultimaLimpeza = 0;

export async function guardarPayloadCru(registro: {
  canal: string;
  tipo: "pedido" | "evento" | "webhook";
  idNoParceiro?: string | null;
  franchiseeId?: string | null;
  payload: unknown;
  avisos?: string[];
}): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PayloadDoParceiro" ("canal","tipo","idNoParceiro","franchiseeId","payload","avisos")
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      registro.canal,
      registro.tipo,
      registro.idNoParceiro ?? null,
      registro.franchiseeId ?? null,
      JSON.stringify(registro.payload ?? null),
      JSON.stringify(registro.avisos ?? []),
    );
    // Limpeza no máximo uma vez por hora, de carona na gravação.
    if (Date.now() - ultimaLimpeza > 60 * 60_000) {
      ultimaLimpeza = Date.now();
      await prisma.$executeRawUnsafe(
        `DELETE FROM "PayloadDoParceiro" WHERE "recebidoEm" < now() - ($1 || ' days')::interval`,
        String(DIAS_GUARDADOS),
      );
    }
  } catch (e: any) {
    console.warn(`[${registro.canal}] não guardei o payload cru:`, e?.message);
  }
}
