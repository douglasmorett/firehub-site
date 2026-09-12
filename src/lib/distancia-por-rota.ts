import { prisma } from "@/lib/prisma";

/**
 * A distância que a moto REALMENTE percorre, pelas ruas.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O FireHub sempre cobrou por RAIO: a linha reta entre a loja e o cliente, que
 * é o círculo desenhado no mapa. É simples de explicar e de desenhar, mas
 * castiga quem está do outro lado de um rio, de uma linha de trem ou de um
 * morro — 1,2 km em linha reta que são 6 km de moto. O iFood e a Brendi cobram
 * por rota, e o lojista que veio de lá sente a diferença no primeiro dia.
 *
 * O raio continua sendo o padrão. A loja escolhe rota quando quiser, e as
 * faixas que ela já cadastrou continuam valendo — o que muda é só o número que
 * entra na comparação.
 *
 * ── Nunca segura um pedido ──────────────────────────────────────────────────
 *
 * Roteamento é chamada de rede, e a lição do Nominatim já foi paga aqui: o
 * Wi-Fi da loja divide IP com a rua inteira e o serviço passa a recusar. Então
 * esta função **nunca** é um ponto de falha:
 *
 *   - prazo curto (3,5 s) e uma tentativa só;
 *   - qualquer erro devolve `null`, e quem chama volta para a linha reta;
 *   - o que já foi calculado fica em cache, no banco e na memória do processo.
 *
 * Um pedido sair com a taxa do raio é infinitamente melhor que um pedido não
 * sair.
 *
 * ── Por que OSRM ────────────────────────────────────────────────────────────
 *
 * É o roteador que o OpenStreetMap mantém, não pede chave e responde em
 * milissegundos. O servidor de demonstração pede uso comedido — daí o cache
 * agressivo: um par loja→cliente é calculado UMA vez e serve para sempre, e
 * como o arredondamento é de 4 casas (~11 metros), a casa do cliente que pede
 * toda semana cai sempre na mesma chave.
 *
 * `OSRM_URL` no ambiente aponta para uma instância própria quando houver.
 */

const BASE = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const PRAZO_MS = 3500;

/** ~11 metros. Preciso o bastante para a porta, grosso o bastante para reusar. */
const casas = (n: number) => Number(n.toFixed(4));

export function chaveDaRota(
  origem: { lat: number; lng: number },
  destino: { lat: number; lng: number },
): string {
  return `${casas(origem.lat)},${casas(origem.lng)}>${casas(destino.lat)},${casas(destino.lng)}`;
}

/** Cache do processo: a mesma loja atende o mesmo bairro a noite inteira. */
const naMemoria = new Map<string, number>();

let tabelaPronta = false;
async function garantirTabela(): Promise<boolean> {
  if (tabelaPronta) return true;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RotaCache" (
        "chave" TEXT PRIMARY KEY,
        "km" DOUBLE PRECISION NOT NULL,
        "minutos" DOUBLE PRECISION,
        "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "usos" INTEGER NOT NULL DEFAULT 1,
        "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT NOW()
      )
    `);
    tabelaPronta = true;
    return true;
  } catch {
    // Sem tabela o cache é só o da memória. Não é motivo para não rotear.
    return false;
  }
}

/**
 * Quantos km de rua entre os dois pontos, ou `null` quando não deu para saber.
 *
 * `null` é resposta legítima e frequente: sem internet, serviço fora, endereço
 * no meio do mato. Quem chama volta para a linha reta.
 */
export async function distanciaPorRotaKm(
  origem: { lat: number; lng: number },
  destino: { lat: number; lng: number },
): Promise<number | null> {
  if (!Number.isFinite(origem?.lat) || !Number.isFinite(origem?.lng)) return null;
  if (!Number.isFinite(destino?.lat) || !Number.isFinite(destino?.lng)) return null;

  const chave = chaveDaRota(origem, destino);
  const daMemoria = naMemoria.get(chave);
  if (daMemoria !== undefined) return daMemoria;

  const temTabela = await garantirTabela();
  if (temTabela) {
    try {
      const linhas = await prisma.$queryRawUnsafe<{ km: number }[]>(`SELECT "km" FROM "RotaCache" WHERE "chave" = $1`, chave);
      const km = Number(linhas?.[0]?.km);
      if (Number.isFinite(km) && km > 0) {
        naMemoria.set(chave, km);
        prisma.$executeRawUnsafe(`UPDATE "RotaCache" SET "usos" = "usos" + 1, "ultimoUso" = NOW() WHERE "chave" = $1`, chave).catch(() => {});
        return km;
      }
    } catch {}
  }

  try {
    // `overview=false` porque não precisamos do desenho da rota, só do número —
    // e o desenho é o que pesa na resposta.
    const url = `${BASE}/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=false&alternatives=false&steps=false`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(PRAZO_MS),
      headers: { "User-Agent": "FireHub/1.0 (contato@firehubfood.com.br)" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d?.code !== "Ok" || !Array.isArray(d?.routes) || d.routes.length === 0) return null;

    const metros = Number(d.routes[0]?.distance);
    const segundos = Number(d.routes[0]?.duration);
    if (!Number.isFinite(metros) || metros <= 0) return null;

    const km = Math.round((metros / 1000) * 100) / 100;
    // Rota absurda é rota errada: acima de 200 km o endereço caiu noutra
    // cidade, e usar isso cobraria uma fortuna ou recusaria a entrega.
    if (km > 200) return null;

    naMemoria.set(chave, km);
    if (temTabela) {
      prisma.$executeRawUnsafe(
        `INSERT INTO "RotaCache" ("chave","km","minutos") VALUES ($1,$2,$3)
         ON CONFLICT ("chave") DO UPDATE SET "usos" = "RotaCache"."usos" + 1, "ultimoUso" = NOW()`,
        chave,
        km,
        Number.isFinite(segundos) ? Math.round(segundos / 60) : null,
      ).catch(() => {});
    }
    return km;
  } catch {
    return null;
  }
}

export type MedicaoDeDistancia = "RAIO" | "ROTA";

/**
 * Como esta loja mede a distância — pelo `deliveryZoneType`.
 *
 * "ROTA" é um TIPO de área, não uma opção à parte, e isso é de propósito: as
 * faixas em km são exatamente as mesmas do raio, muda só o número que entra
 * na comparação. Guardar num segundo lugar (deliveryConfig) criaria o estado
 * impossível de "área por bairro medindo por rota".
 *
 * Qualquer outro valor — inclusive os antigos "KM" e "RADIUS" — é raio, que é
 * como toda loja cadastrada até aqui funciona.
 */
export function medicaoDaLoja(deliveryZoneType: unknown): MedicaoDeDistancia {
  return String(deliveryZoneType || "").toUpperCase() === "ROTA" ? "ROTA" : "RAIO";
}
