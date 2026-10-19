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
import { executarDDL } from "@/lib/ddl-do-boot";
import { chavesDoAprendizado, chaveDaVizinhanca, distanciaKm, lerPontoGravado, type Ponto } from "@/lib/ponto-do-pedido";
import { ancorasDasEntregas, type Ancora } from "@/lib/ancora-do-cep";
import { cepDoEndereco } from "@/lib/cep";
import { canalDoPedido } from "@/lib/canal-do-pedido";

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
    await executarDDL("pontos-aprendidos", [
      `
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
      )`,
      `ALTER TABLE "PontoAprendido" ADD COLUMN IF NOT EXISTS "vizinhanca" TEXT`,
      `CREATE INDEX IF NOT EXISTS "PontoAprendido_vizinhanca_idx" ON "PontoAprendido" ("franchiseeId", "vizinhanca")`,
    ]);
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
  /** O endereço; os vizinhos da mesma quadra e conjunto; ou o mesmo CEP (os dois últimos, aproximados). */
  pela: "endereco" | "vizinhanca" | "cep";
  /** Na vizinhança e no CEP: quantas correções entraram. */
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

const medianaDe = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  const k = o.length >> 1;
  return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2;
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
  if (vizinhancaPorEndereco.size > 0) {
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
  }

  // Sem posição nem vizinhança: as correções da loja no MESMO CEP (NIK,
  // 18/10/2026: "se puxar pelo CEP dá certo, os endereços aqui são muito
  // parecidos"). Em 14 dias, 91 dos pedidos da Wabiz sem âncora repetiam o CEP
  // de um pedido anterior — condomínio (73092-900), quadra comercial
  // (73005-080), "SES quadra 13"… Uma correção serve ao CEP inteiro, aproximada;
  // correções do mesmo CEP espalhadas por mais de 800 m não valem. CEP de
  // cidade inteira (final 000) não é lugar.
  const cepPorEndereco = new Map<string, string>();
  for (const e of chavesPorEndereco.keys()) {
    if (saida.has(e)) continue;
    const cep = cepDoEndereco(e);
    if (cep && !cep.endsWith("000")) cepPorEndereco.set(e, cep);
  }
  if (cepPorEndereco.size > 0) {
    try {
      const linhas = await prisma.$queryRawUnsafe<{ lat: number; lng: number; endereco: string | null }[]>(
        `SELECT "lat", "lng", "endereco" FROM "PontoAprendido"
          WHERE "franchiseeId" = $1 AND "chave" LIKE 't:%' AND "endereco" ~ '[0-9]{5}-?[0-9]{3}' LIMIT 5000`,
        franchiseeId,
      );
      const porCep = new Map<string, Ponto[]>();
      for (const l of linhas || []) {
        const cep = cepDoEndereco(l.endereco);
        if (cep) porCep.set(cep, [...(porCep.get(cep) || []), { lat: Number(l.lat), lng: Number(l.lng) }]);
      }
      for (const [endereco, cep] of cepPorEndereco) {
        const pontos = porCep.get(cep);
        if (!pontos?.length) continue;
        const lats = pontos.map((p) => p.lat);
        const lngs = pontos.map((p) => p.lng);
        const faixa = { n: pontos.length, minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
        if (!vizinhancaServe(faixa)) continue;
        saida.set(endereco, { lat: medianaDe(lats), lng: medianaDe(lngs), pela: "cep", correcoes: pontos.length });
      }
    } catch (e: any) {
      console.warn(`[Ponto aprendido] leitura pelo CEP falhou: ${e?.message}`);
    }
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

// ── A ÂNCORA DO CEP: AS ENTREGAS COM PONTO DA PRÓPRIA LOJA ────────────────────
//
// Ver lib/ancora-do-cep.ts. Aqui só a leitura: as entregas dos últimos 120
// dias que têm ponto de quem SABE onde é a casa — o parceiro (iFood, 99…), o
// pino/GPS do cliente e a posição dada pela loja. Ponto achado pelo texto
// (nosso, "mapa"/"bairro") e os aproximados (aprendido, vizinhança) não entram:
// seria o mapa ensinando o mapa. Nada é gravado — a âncora é lida de novo a
// cada 30 min, e cresce sozinha com cada pedido do iFood.

export const DIAS_DA_ANCORA = 120;
const VALIDADE_DA_ANCORA_MS = 30 * 60_000;
const TETO_DE_ENTREGAS_DA_ANCORA = 4000;
const ancorasNaMemoria = new Map<string, { ate: number; ancoras: Promise<Map<string, Ancora>> }>();

/** As âncoras de quadra + conjunto desta loja. Nunca lança: banco fora = vazio. */
export function ancorasDaLoja(franchiseeId: string): Promise<Map<string, Ancora>> {
  if (!franchiseeId) return Promise.resolve(new Map());
  const guardada = ancorasNaMemoria.get(franchiseeId);
  if (guardada && guardada.ate > Date.now()) return guardada.ancoras;
  const ancoras = (async () => {
    try {
      const linhas = await prisma.$queryRawUnsafe<
        { customerAddress: string | null; customerLatLng: unknown; source: string | null; openDeliveryChannel: string | null; ifoodOrderId: string | null }[]
      >(
        `SELECT "customerAddress", "customerLatLng", "source", "openDeliveryChannel", "ifoodOrderId"
           FROM "CustomerOrder"
          WHERE "franchiseeId" = $1 AND "deliveryType" = 'DELIVERY' AND "customerLatLng" IS NOT NULL
            AND "customerAddress" IS NOT NULL AND "createdAt" > NOW() - INTERVAL '${DIAS_DA_ANCORA} days'
          ORDER BY "createdAt" DESC LIMIT ${TETO_DE_ENTREGAS_DA_ANCORA}`,
        franchiseeId,
      );
      const entregas: { endereco: string; ponto: Ponto }[] = [];
      for (const l of linhas || []) {
        const g = lerPontoGravado(l.customerLatLng, canalDoPedido(l).ehMarketplace);
        if (g && (g.fonte === "parceiro" || g.fonte === "cliente" || g.fonte === "manual")) {
          entregas.push({ endereco: String(l.customerAddress), ponto: g.ponto });
        }
      }
      return ancorasDasEntregas(entregas);
    } catch (e: any) {
      console.warn(`[Âncora do CEP] leitura das entregas falhou: ${e?.message}`);
      ancorasNaMemoria.delete(franchiseeId);
      return new Map<string, Ancora>();
    }
  })();
  ancorasNaMemoria.set(franchiseeId, { ate: Date.now() + VALIDADE_DA_ANCORA_MS, ancoras });
  if (ancorasNaMemoria.size > 500) ancorasNaMemoria.delete(ancorasNaMemoria.keys().next().value as string);
  return ancoras;
}

/** Zera a memória das âncoras. SÓ PARA TESTE. */
export function esquecerAncorasParaTeste() {
  ancorasNaMemoria.clear();
}
