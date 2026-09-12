/**
 * Geocodificação no SERVIDOR, com cache no banco.
 *
 * ── Por que saiu do navegador ───────────────────────────────────────────────
 *
 * O mapa da roteirização resolvia cada endereço chamando o Nominatim direto do
 * navegador da loja. O Nominatim limita por IP: 1 requisição por segundo, e
 * quem passa disso leva 429 por dezenas de minutos. Numa loja, o IP é o do
 * Wi-Fi — compartilhado com todo mundo que está naquele prédio, naquela rua ou
 * atrás do mesmo CGNAT do provedor.
 *
 * Foi exatamente o que a loja do Lucas Pimenta viveu na noite de 11/09/2026: a
 * roteirização não carregava no Wi-Fi e funcionava na hora ao trocar para os
 * dados móveis — outro IP, outro balde de limite. Nada a ver com a internet
 * dele estar ruim, e por isso testar a velocidade da conexão não mostrava nada.
 *
 * Aqui o IP é um só: o do servidor. E cada endereço é resolvido UMA vez para
 * todas as lojas — o segundo pedido para a mesma rua sai do banco, sem rede.
 * O navegador nunca mais fala com o geocodificador.
 */
import { prisma } from "@/lib/prisma";
import {
  criarGeocodificador,
  parseAddressDetails,
  cleanAddressForGeocoding,
  estadoPeloEndereco,
  dicionarioDeBairro,
  type Ponto,
} from "@/lib/geocodificacao";

export type PedidoDeGeocodificacao = {
  /** Id do pedido, só para devolver o resultado casado. */
  id: string;
  /** Endereço como o cliente escreveu. */
  endereco: string;
};

export type ResultadoGeocodificacao = {
  id: string;
  lat: number;
  lng: number;
  origem: string;
  doCache: boolean;
};

/** A chave do cache ignora acento, caixa e espaço repetido. */
export function chaveDeCache(endereco: string, cidade: string): string {
  const limpa = (t: string) =>
    (t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${limpa(cidade)}|${limpa(endereco)}`.slice(0, 400);
}

let tabelaPronta = false;
async function garantirTabela() {
  if (tabelaPronta) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GeocodeCache" (
      "chave" TEXT PRIMARY KEY,
      "lat" DOUBLE PRECISION NOT NULL,
      "lng" DOUBLE PRECISION NOT NULL,
      "origem" TEXT,
      "bairro" TEXT,
      "cidade" TEXT,
      "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "usos" INTEGER NOT NULL DEFAULT 1,
      "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  tabelaPronta = true;
}

/**
 * Uma fila por processo: o Nominatim aceita 1 chamada por segundo POR IP, e o
 * IP aqui é o do servidor inteiro. Duas lojas roteirizando ao mesmo tempo, sem
 * esta fila, derrubariam o limite para todas as outras.
 */
let ultimaVez: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = ultimaVez.then(fn, fn);
  ultimaVez = proxima.catch(() => undefined);
  return proxima;
}

export async function geocodificarNoServidor(
  pedidos: PedidoDeGeocodificacao[],
  loja: { cidade: string; endereco?: string | null; centro: Ponto },
): Promise<ResultadoGeocodificacao[]> {
  if (pedidos.length === 0) return [];
  await garantirTabela().catch((e) => {
    console.warn("[Geocodificação] tabela de cache indisponível:", e?.message);
  });

  const cidade = loja.cidade || "";
  const chaves = pedidos.map((p) => chaveDeCache(p.endereco, cidade));

  // 1. o que já está no banco
  const noCache = new Map<string, { lat: number; lng: number; origem: string | null }>();
  try {
    const linhas = await prisma.$queryRawUnsafe<{ chave: string; lat: number; lng: number; origem: string | null }[]>(
      `SELECT "chave", "lat", "lng", "origem" FROM "GeocodeCache" WHERE "chave" = ANY($1)`,
      chaves,
    );
    for (const l of linhas) noCache.set(l.chave, l);
    if (linhas.length > 0) {
      prisma
        .$executeRawUnsafe(
          `UPDATE "GeocodeCache" SET "usos" = "usos" + 1, "ultimoUso" = NOW() WHERE "chave" = ANY($1)`,
          linhas.map((l) => l.chave),
        )
        .catch(() => undefined);
    }
  } catch (e: any) {
    console.warn("[Geocodificação] leitura do cache falhou:", e?.message);
  }

  const estado = estadoPeloEndereco(loja.endereco);
  const geo = criarGeocodificador({ storeCity: cidade, estado, centroDaLoja: loja.centro });
  const saida: ResultadoGeocodificacao[] = [];
  const paraGravar: { chave: string; lat: number; lng: number; origem: string; bairro: string }[] = [];

  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    const chave = chaves[i];
    const achado = noCache.get(chave);
    if (achado) {
      saida.push({ id: p.id, lat: achado.lat, lng: achado.lng, origem: achado.origem || "cache", doCache: true });
      continue;
    }
    const { neighborhood, streetName, houseNumber } = parseAddressDetails(p.endereco, cidade);
    const cleanedStreet = cleanAddressForGeocoding(p.endereco);
    const dictFallback = dicionarioDeBairro(neighborhood, loja.centro);
    try {
      const { coords, origem } = await naFila(() =>
        geo.geocodificarItem({ idx: i, neighborhood, streetName, houseNumber, cleanedStreet, dictFallback }),
      );
      saida.push({ id: p.id, lat: coords.lat, lng: coords.lng, origem, doCache: false });
      // Só entra no cache o que veio de fonte de verdade. "Caiu na loja" é
      // ausência de resposta — guardar isso seria congelar o erro para sempre,
      // inclusive para as outras lojas.
      if (!/loja \(endereço não localizado\)/.test(origem)) {
        paraGravar.push({ chave, lat: coords.lat, lng: coords.lng, origem, bairro: neighborhood });
      }
    } catch (e: any) {
      console.warn(`[Geocodificação] ${p.endereco.slice(0, 60)}: ${e?.message}`);
    }
  }

  if (paraGravar.length > 0) {
    try {
      for (const g of paraGravar) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "GeocodeCache" ("chave","lat","lng","origem","bairro","cidade")
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT ("chave") DO UPDATE SET "lat"=EXCLUDED."lat","lng"=EXCLUDED."lng","origem"=EXCLUDED."origem","ultimoUso"=NOW()`,
          g.chave, g.lat, g.lng, g.origem, g.bairro, cidade,
        );
      }
    } catch (e: any) {
      console.warn("[Geocodificação] gravação do cache falhou:", e?.message);
    }
  }

  return saida;
}
