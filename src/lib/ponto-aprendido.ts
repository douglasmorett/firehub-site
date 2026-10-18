/**
 * A POSIÇÃO QUE A LOJA ENSINOU — o operador arrasta o pino de um pedido na
 * roteirização e o próximo pedido do mesmo endereço já nasce no lugar certo.
 * E o do VIZINHO (mesma quadra e conjunto, outro lote) nasce perto, marcado
 * como aproximado.
 *
 * ── Por que existe (NIK Esfihas, 16/10/2026) ───────────────────────────────
 *
 * Endereço de Brasília (quadra, conjunto, lote) e CEP que os Correios não
 * conhecem derrotam qualquer geocodificador de texto. O cliente da Wabiz pede
 * toda semana do mesmo endereço: quem sabe onde ele mora é o operador da loja,
 * e ele só deve precisar dizer UMA vez.
 *
 * ── A vizinhança (NIK, 17/10/2026) ─────────────────────────────────────────
 *
 * A NIK corrigiu ~8 pinos e "já teve outros pedidos para aqui depois e não
 * bateu": eram vizinhos — "Qd 03 Cj G lote 07" corrigido, outro lote do
 * Conjunto G chegando, e o mapa mandava a Quadra 3 para a Quadra 15. Em
 * Brasília a quadra + o conjunto já são o quarteirão. Cada linha do texto
 * inteiro ("t:") guarda também a chave de vizinhança do endereço
 * (lib/ponto-do-pedido.ts, `chaveDaVizinhanca`: "v:73030|q3|cjg"); o pedido
 * sem posição exata usa a MEDIANA das correções da vizinhança.
 *
 * Por que a mediana (e não a mais recente nem a média): cada correção é um
 * lote diferente do mesmo conjunto; o lote que vai chegar é qualquer um, e o
 * meio delas erra menos que uma ponta. A mediana (por eixo) aguenta um
 * arraste errado do operador quando já há três; com duas, é a média. E sai
 * das próprias linhas do texto: o operador que arrasta o MESMO pedido duas
 * vezes regrava a linha dele, não conta duas. Correções espalhadas por mais
 * de 800 m não são um quarteirão — a mesma quadra/conjunto em dois lugares
 * (ou erro de cadastro): aí a vizinhança não vale e segue o mapa.
 *
 * ── O que é guardado ───────────────────────────────────────────────────────
 *
 * Uma linha por (loja, chave): a chave é o texto do endereço normalizado
 * ("t:…", com a coluna "vizinhanca") e, com CEP de rua e número,
 * "c:<CEP>|<número>" (lib/ponto-do-pedido.ts, `chavesDoAprendizado`). Só da
 * LOJA que ensinou — o operador de uma loja não mexe no mapa da outra. Cresce
 * só com correção manual (não com cada pedido): a base de "bairros aprendidos"
 * que crescia com o uso foi recusada pelo dono em 26/09/2026; esta cresce com
 * o trabalho da loja e some depois de um ano sem uso (faxina dos caches).
 *
 * Tabela por SQL cru, fora do schema.prisma: CREATE TABLE IF NOT EXISTS no
 * boot (instrumentation.ts), e a coluna "vizinhanca" por ALTER … IF NOT EXISTS
 * (as linhas de antes ganham a chave na primeira subida). Faltando, a
 * roteirização segue como antes — só deixa de aprender. Loja sem nenhuma
 * correção não tem linha: nada muda para ela.
 */
import { prisma } from "@/lib/prisma";
import { chavesDoAprendizado, chaveDaVizinhanca, distanciaKm, type Ponto } from "@/lib/ponto-do-pedido";

let tabelaOk = false;

export const DIAS_SEM_USO_DO_APRENDIDO = 365;
/** Correções da mesma vizinhança mais espalhadas que isto não são um quarteirão. */
export const ESPALHAMENTO_MAXIMO_DA_VIZINHANCA_KM = 0.8;

/** As linhas antigas (antes da coluna) ganham a chave de vizinhança. '' = endereço sem quadra/conjunto. */
async function preencherVizinhancasAntigas() {
  const linhas = await prisma.$queryRawUnsafe<{ franchiseeId: string; chave: string; endereco: string | null }[]>(
    `SELECT "franchiseeId", "chave", "endereco" FROM "PontoAprendido"
      WHERE "vizinhanca" IS NULL AND "chave" LIKE 't:%' LIMIT 5000`,
  );
  for (const l of linhas || []) {
    await prisma.$executeRawUnsafe(
      `UPDATE "PontoAprendido" SET "vizinhanca" = $3 WHERE "franchiseeId" = $1 AND "chave" = $2`,
      l.franchiseeId,
      l.chave,
      chaveDaVizinhanca(l.endereco) || "",
    );
  }
}

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
        "vizinhanca" TEXT,
        CONSTRAINT "PontoAprendido_pkey" PRIMARY KEY ("franchiseeId", "chave")
      )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "PontoAprendido" ADD COLUMN IF NOT EXISTS "vizinhanca" TEXT`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "PontoAprendido_vizinhanca_idx" ON "PontoAprendido" ("franchiseeId", "vizinhanca")`,
    );
    tabelaOk = true;
  } catch (err: any) {
    console.error(`[Ponto aprendido] não consegui criar a tabela: ${err?.message}`);
    return false;
  }
  await preencherVizinhancasAntigas().catch((e) => console.warn(`[Ponto aprendido] vizinhança das linhas antigas: ${e?.message}`));
  return true;
}

/** A posição achada para o endereço: a dele ("endereco") ou a dos vizinhos ("vizinhanca", aproximada). */
export type PontoAprendidoAchado = Ponto & {
  pela: "endereco" | "vizinhanca";
  /** Na vizinhança: quantas correções da mesma quadra/conjunto entraram. */
  correcoes?: number;
};

type LinhaDaVizinhanca = {
  vizinhanca: string;
  lat: number;
  lng: number;
  n: number;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/** A vizinhança serve? Precisa de correção e de as correções caberem num quarteirão. */
export function vizinhancaServe(l: Pick<LinhaDaVizinhanca, "n" | "minLat" | "maxLat" | "minLng" | "maxLng">): boolean {
  if (!(Number(l.n) > 0)) return false;
  const espalhamento = distanciaKm(
    { lat: Number(l.minLat), lng: Number(l.minLng) },
    { lat: Number(l.maxLat), lng: Number(l.maxLng) },
  );
  return Number.isFinite(espalhamento) && espalhamento <= ESPALHAMENTO_MAXIMO_DA_VIZINHANCA_KM;
}

/**
 * A posição ensinada de cada endereço desta loja (os que têm). A chave do
 * texto inteiro vence a do CEP com número, e as duas vencem a vizinhança.
 * Nunca lança: sem a tabela, vazio.
 */
export async function pontosAprendidos(franchiseeId: string, enderecos: string[]): Promise<Map<string, PontoAprendidoAchado>> {
  const saida = new Map<string, PontoAprendidoAchado>();
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
      saida.set(endereco, { lat: Number(achada.lat), lng: Number(achada.lng), pela: "endereco" });
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

  // Sem a posição do endereço: a dos vizinhos (mesma quadra e conjunto).
  const vizinhancaPorEndereco = new Map<string, string>();
  for (const e of chavesPorEndereco.keys()) {
    if (saida.has(e)) continue;
    const v = chaveDaVizinhanca(e);
    if (v) vizinhancaPorEndereco.set(e, v);
  }
  if (vizinhancaPorEndereco.size === 0) return saida;
  try {
    const linhas = await prisma.$queryRawUnsafe<LinhaDaVizinhanca[]>(
      `SELECT "vizinhanca",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY "lat") AS "lat",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY "lng") AS "lng",
              COUNT(*)::int AS "n",
              MIN("lat") AS "minLat", MAX("lat") AS "maxLat", MIN("lng") AS "minLng", MAX("lng") AS "maxLng"
         FROM "PontoAprendido"
        WHERE "franchiseeId" = $1 AND "vizinhanca" = ANY($2) AND "chave" LIKE 't:%'
        GROUP BY "vizinhanca"`,
      franchiseeId,
      [...new Set(vizinhancaPorEndereco.values())],
    );
    const porVizinhanca = new Map(linhas.filter(vizinhancaServe).map((l) => [l.vizinhanca, l]));
    const usadas = new Set<string>();
    for (const [endereco, v] of vizinhancaPorEndereco) {
      const l = porVizinhanca.get(v);
      if (!l) continue;
      saida.set(endereco, { lat: Number(l.lat), lng: Number(l.lng), pela: "vizinhanca", correcoes: Number(l.n) });
      usadas.add(v);
    }
    if (usadas.size > 0) {
      // A correção que ainda serve aos vizinhos não sai na faxina.
      prisma
        .$executeRawUnsafe(
          `UPDATE "PontoAprendido" SET "ultimoUso" = (NOW() AT TIME ZONE 'UTC')
            WHERE "franchiseeId" = $1 AND "vizinhanca" = ANY($2)`,
          franchiseeId,
          [...usadas],
        )
        .catch(() => undefined);
    }
  } catch (e: any) {
    console.warn(`[Ponto aprendido] leitura da vizinhança falhou: ${e?.message}`);
  }
  return saida;
}

/**
 * Guarda a posição que o operador deu para o endereço. Devolve quantas chaves
 * foram gravadas (0 = endereço curto demais para servir de chave, ou banco
 * fora). A linha do texto leva a chave de vizinhança: é dela que sai a
 * mediana dos vizinhos (ver o topo).
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
  const vizinhanca = chaveDaVizinhanca(a.endereco) || "";
  let gravadas = 0;
  for (const chave of chaves) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PontoAprendido" ("franchiseeId","chave","lat","lng","endereco","pedidoId","autor","vizinhanca")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT ("franchiseeId","chave") DO UPDATE SET
           "lat"=EXCLUDED."lat","lng"=EXCLUDED."lng","endereco"=EXCLUDED."endereco",
           "pedidoId"=EXCLUDED."pedidoId","autor"=EXCLUDED."autor","vizinhanca"=EXCLUDED."vizinhanca",
           "atualizadoEm"=(NOW() AT TIME ZONE 'UTC'),"ultimoUso"=(NOW() AT TIME ZONE 'UTC')`,
        a.franchiseeId,
        chave,
        a.ponto.lat,
        a.ponto.lng,
        String(a.endereco || "").slice(0, 300),
        a.pedidoId || null,
        a.autor ? String(a.autor).slice(0, 120) : null,
        // Só a linha do texto conta na vizinhança: a do CEP é o mesmo endereço.
        chave.startsWith("t:") ? vizinhanca : null,
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
