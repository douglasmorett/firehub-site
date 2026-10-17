/**
 * A POSIÇÃO QUE A LOJA ENSINOU — o operador arrasta o pino de um pedido na
 * roteirização e o próximo pedido do mesmo endereço já nasce no lugar certo.
 *
 * ── Por que existe (NIK Esfihas, 16/10/2026) ───────────────────────────────
 *
 * Endereço de Brasília (quadra, conjunto, lote) e CEP que os Correios não
 * conhecem derrotam qualquer geocodificador de texto. O cliente da Wabiz pede
 * toda semana do mesmo endereço: quem sabe onde ele mora é o operador da loja,
 * e ele só deve precisar dizer UMA vez.
 *
 * ── O que é guardado ───────────────────────────────────────────────────────
 *
 * Uma linha por (loja, chave): a chave é o texto do endereço normalizado
 * ("t:…") e, com CEP de rua e número, "c:<CEP>|<número>"
 * (lib/ponto-do-pedido.ts, `chavesDoAprendizado`). Só da LOJA que ensinou —
 * o operador de uma loja não mexe no mapa da outra. Cresce só com correção
 * manual (não com cada pedido): a base de "bairros aprendidos" que crescia com
 * o uso foi recusada pelo dono em 26/09/2026; esta cresce com o trabalho da
 * loja e some depois de um ano sem uso (faxina dos caches).
 *
 * Tabela por SQL cru, fora do schema.prisma: CREATE TABLE IF NOT EXISTS no
 * boot (instrumentation.ts). Faltando, a roteirização segue como antes — só
 * deixa de aprender.
 */
import { prisma } from "@/lib/prisma";
import { chavesDoAprendizado, type Ponto } from "@/lib/ponto-do-pedido";

let tabelaOk = false;

export const DIAS_SEM_USO_DO_APRENDIDO = 365;

export async function garantirTabelaDePontosAprendidos(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(String(process.env.DATABASE_URL || ""))) return false;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PontoAprendido" (
        "franchiseeId" TEXT NOT NULL,
        "chave" TEXT NOT NULL,
        "lat" DOUBLE PRECISION NOT NULL,
        "lng" DOUBLE PRECISION NOT NULL,
        "endereco" TEXT,
        "pedidoId" TEXT,
        "autor" TEXT,
        "usos" INTEGER NOT NULL DEFAULT 0,
        "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        CONSTRAINT "PontoAprendido_pkey" PRIMARY KEY ("franchiseeId", "chave")
      )`);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Ponto aprendido] não consegui criar a tabela: ${err?.message}`);
    return false;
  }
}

/**
 * A posição ensinada de cada endereço desta loja (os que têm). A chave do
 * texto inteiro vence a do CEP com número. Nunca lança: sem a tabela, vazio.
 */
export async function pontosAprendidos(franchiseeId: string, enderecos: string[]): Promise<Map<string, Ponto>> {
  const saida = new Map<string, Ponto>();
  if (!franchiseeId || enderecos.length === 0) return saida;
  if (!(await garantirTabelaDePontosAprendidos())) return saida;
  const chavesPorEndereco = new Map<string, string[]>();
  for (const e of enderecos) {
    const chaves = chavesDoAprendizado(e);
    if (chaves.length > 0) chavesPorEndereco.set(e, chaves);
  }
  const todas = [...new Set([...chavesPorEndereco.values()].flat())];
  if (todas.length === 0) return saida;
  try {
    const linhas = await prisma.$queryRawUnsafe<{ chave: string; lat: number; lng: number }[]>(
      `SELECT "chave", "lat", "lng" FROM "PontoAprendido" WHERE "franchiseeId" = $1 AND "chave" = ANY($2)`,
      franchiseeId,
      todas,
    );
    const porChave = new Map(linhas.map((l) => [l.chave, l]));
    const usadas = new Set<string>();
    for (const [endereco, chaves] of chavesPorEndereco) {
      const achada = chaves.map((c) => porChave.get(c)).find(Boolean);
      if (!achada) continue;
      saida.set(endereco, { lat: Number(achada.lat), lng: Number(achada.lng) });
      usadas.add(achada.chave);
    }
    if (usadas.size > 0) {
      prisma
        .$executeRawUnsafe(
          `UPDATE "PontoAprendido" SET "usos" = "usos" + 1, "ultimoUso" = (NOW() AT TIME ZONE 'UTC')
            WHERE "franchiseeId" = $1 AND "chave" = ANY($2)`,
          franchiseeId,
          [...usadas],
        )
        .catch(() => undefined);
    }
  } catch (e: any) {
    console.warn(`[Ponto aprendido] leitura falhou: ${e?.message}`);
  }
  return saida;
}

/**
 * Guarda a posição que o operador deu para o endereço. Devolve quantas chaves
 * foram gravadas (0 = endereço curto demais para servir de chave, ou banco fora).
 */
export async function aprenderPonto(a: {
  franchiseeId: string;
  endereco: string;
  ponto: Ponto;
  pedidoId?: string | null;
  autor?: string | null;
}): Promise<number> {
  const chaves = chavesDoAprendizado(a.endereco);
  if (!a.franchiseeId || chaves.length === 0) return 0;
  if (!(await garantirTabelaDePontosAprendidos())) return 0;
  let gravadas = 0;
  for (const chave of chaves) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PontoAprendido" ("franchiseeId","chave","lat","lng","endereco","pedidoId","autor")
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("franchiseeId","chave") DO UPDATE SET
           "lat"=EXCLUDED."lat","lng"=EXCLUDED."lng","endereco"=EXCLUDED."endereco",
           "pedidoId"=EXCLUDED."pedidoId","autor"=EXCLUDED."autor",
           "atualizadoEm"=(NOW() AT TIME ZONE 'UTC'),"ultimoUso"=(NOW() AT TIME ZONE 'UTC')`,
        a.franchiseeId,
        chave,
        a.ponto.lat,
        a.ponto.lng,
        String(a.endereco || "").slice(0, 300),
        a.pedidoId || null,
        a.autor ? String(a.autor).slice(0, 120) : null,
      );
      gravadas++;
    } catch (e: any) {
      console.warn(`[Ponto aprendido] gravação falhou: ${e?.message}`);
    }
  }
  return gravadas;
}

/** O DELETE da faxina: posição que ninguém usou em um ano sai. */
export function sqlDaFaxinaDosPontosAprendidos(dias: number = DIAS_SEM_USO_DO_APRENDIDO): string {
  const d = Number.isInteger(dias) && dias > 0 ? dias : DIAS_SEM_USO_DO_APRENDIDO;
  return `DELETE FROM "PontoAprendido" WHERE "ultimoUso" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '${d} days'`;
}
