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
  isPointInSea,
  type Ponto,
} from "@/lib/geocodificacao";
import { geocodeAddress, geocodeStreetStructured, extrairLogradouro } from "@/lib/geocoding";

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

/**
 * Corta o que vier DEPOIS da sigla do estado.
 *
 * O 99Food monta o endereço com a observação do cliente colada no fim, passando
 * da UF: "R . Cuiabá, 742 - Trindade, São Gonçalo - RJ, Em cima da oficina do
 * Eduardo (Dudu)". A limpeza da lib remove "Ref:", "Comp:", "apto", "lote" —
 * mas não texto livre como esse, que entra na busca e faz o Nominatim não achar
 * nada. Medido em 15/09/2026: três endereços do Frangoso falhavam em TODA
 * tentativa, e os três resolveram assim que o rabicho saiu.
 *
 * Nada que sirva para geocodificar vem depois do estado, então o corte é seguro.
 * E ele é só para a BUSCA: o endereço gravado no pedido continua inteiro, com a
 * observação — ela é do motoboy, não do mapa.
 */
export function semRabichoDepoisDaUF(endereco: string): string {
  const e = String(endereco || "").trim();
  // " - RJ, qualquer coisa"  →  " - RJ".  Exige a vírgula: sem ela o texto
  // seguinte ainda pode ser parte do endereço.
  const cortado = e.replace(/(\s[-–]\s*[A-Za-z]{2})\s*,[\s\S]*$/, "$1").trim();
  // Só aceita o corte se sobrou endereço de verdade — nunca devolve um toco.
  return cortado.length >= 10 ? cortado : e;
}

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
/** Quantas consultas estão esperando a vez — o teto evita que uma loja com
 *  muitos endereços novos prenda a roteirização de todas as outras no mesmo
 *  container. Estourado o teto, a consulta é recusada e o navegador daquela
 *  loja resolve sozinho, como fazia antes. */
let naFilaAgora = 0;
const TETO_DA_FILA = 25;

function naFila<T>(fn: () => Promise<T>): Promise<T> {
  if (naFilaAgora >= TETO_DA_FILA) return Promise.reject(new Error("fila de geocodificação cheia"));
  naFilaAgora++;
  const proxima = ultimaVez.then(fn, fn).finally(() => { naFilaAgora--; });
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

  // ── ORÇAMENTO DE TEMPO ────────────────────────────────────────────────
  //
  // Cada endereço novo espera 1,1 s antes de CADA consulta e pode disparar até
  // cinco (rua estruturada, rua em texto, Photon, centróide do bairro, bairro
  // no Photon). Um lote grande passa fácil dos 60 s que a plataforma dá à rota
  // — e morrer no limite não devolvia nada e não gravava nada, então a próxima
  // tentativa recomeçava do zero e estourava de novo, para sempre.
  //
  // Com prazo, a rota devolve o que conseguiu e o navegador resolve o resto
  // pelo caminho antigo. Quem ficou de fora entra no cache na próxima abertura.
  const prazo = Date.now() + 25_000;

  for (let i = 0; i < pedidos.length; i++) {
    if (Date.now() > prazo && !noCache.has(chaves[i])) {
      console.warn(`[Geocodificação] prazo estourado: ${pedidos.length - i} endereço(s) ficaram para a próxima`);
      break;
    }
    const p = pedidos[i];
    const chave = chaves[i];
    const achado = noCache.get(chave);
    if (achado) {
      saida.push({ id: p.id, lat: achado.lat, lng: achado.lng, origem: achado.origem || "cache", doCache: true });
      continue;
    }
    const paraBuscar = semRabichoDepoisDaUF(p.endereco);
    const { neighborhood, streetName, houseNumber } = parseAddressDetails(paraBuscar, cidade);
    const cleanedStreet = cleanAddressForGeocoding(paraBuscar);
    const dictFallback = dicionarioDeBairro(neighborhood, loja.centro);
    try {
      const { coords, origem } = await naFila(() =>
        geo.geocodificarItem({ idx: i, neighborhood, streetName, houseNumber, cleanedStreet, dictFallback }),
      );
      saida.push({ id: p.id, lat: coords.lat, lng: coords.lng, origem, doCache: false });
      // Grava NA HORA, não no fim: o lote pode ser interrompido pelo prazo ou
      // pela plataforma, e o endereço que já custou uma ida à rede não pode se
      // perder — ele vale para todas as lojas, não só para esta.
      //
      // Só entra o que veio de fonte de verdade. "Caiu na loja" é ausência de
      // resposta; guardar isso congelaria o erro para sempre.
      if (!/loja \(endereço não localizado\)/.test(origem)) {
        await gravarNoCache({ chave, lat: coords.lat, lng: coords.lng, origem, bairro: neighborhood, cidade });
      }
    } catch (e: any) {
      console.warn(`[Geocodificação] ${p.endereco.slice(0, 60)}: ${e?.message}`);
    }
  }

  return saida;
}

/**
 * Onde fica a LOJA quando ela nunca marcou o ponto no mapa.
 *
 * Medido no banco em 19/09/2026: 32 das 41 lojas estão sem `storeLatLng`. Aquele
 * campo só é escrito quando o lojista abre Minha Loja → Área de entrega e salva
 * o pino — mas o ENDEREÇO dela está no cadastro desde o primeiro dia, e é ele
 * que o mapa precisa para abrir no lugar certo. Sem isso a roteirização abria
 * em Rio das Ostras (o padrão que ficou no código) para uma pizzaria de São
 * Paulo: a casinha da loja fincada a 400 km do fogão e, pior, o dicionário de
 * bairros de Rio das Ostras passando a valer para os pedidos dela.
 *
 * O endereço do cadastro vira coordenada UMA vez e fica no mesmo cache de
 * endereços dos pedidos (GeocodeCache) — a segunda abertura não vai à rede.
 *
 * Isto NÃO grava em `storeLatLng`: aquele campo decide raio e taxa de entrega
 * (lib/area-de-entrega.ts) e só o lojista, arrastando o pino, pode dizer que
 * ele está certo. Aqui é só de onde a câmera do mapa parte.
 */
let ultimaChamadaNominatim = 0;
async function ritmoDoNominatim() {
  const espera = ultimaChamadaNominatim + 1100 - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaChamadaNominatim = Date.now();
}

export async function pontoDeEndereco(
  endereco: string,
  cidade: string,
): Promise<{ lat: number; lng: number; origem: string } | null> {
  const texto = String(endereco || "").trim();
  const cid = String(cidade || "").trim();
  if (!texto && !cid) return null;

  await garantirTabela().catch(() => undefined);
  const chave = chaveDeCache(texto, cid);

  try {
    const linhas = await prisma.$queryRawUnsafe<{ lat: number; lng: number; origem: string | null }[]>(
      `SELECT "lat", "lng", "origem" FROM "GeocodeCache" WHERE "chave" = $1 LIMIT 1`,
      chave,
    );
    if (linhas[0]) {
      prisma
        .$executeRawUnsafe(`UPDATE "GeocodeCache" SET "usos" = "usos" + 1, "ultimoUso" = NOW() WHERE "chave" = $1`, chave)
        .catch(() => undefined);
      return { lat: linhas[0].lat, lng: linhas[0].lng, origem: linhas[0].origem || "cache" };
    }
  } catch (e: any) {
    console.warn("[Geocodificação] leitura do cache da loja falhou:", e?.message);
  }

  const estado = estadoPeloEndereco(texto);
  const sufixo = [cid, estado, "Brasil"].filter(Boolean).join(", ");

  const achado = await naFila(async () => {
    // 1. Busca estruturada (rua + cidade): é a que acha endereço de loja onde o
    //    texto solto falha. Ver o comentário de geocodeStreetStructured.
    const rua = extrairLogradouro(texto);
    if (rua && cid) {
      await ritmoDoNominatim();
      const trechos = await geocodeStreetStructured(rua, cid, null);
      const bom = trechos.find((t) => !isPointInSea(t.lat, t.lng));
      if (bom) return { lat: bom.lat, lng: bom.lng, origem: "loja: rua estruturada" };
    }

    // 2. Endereço inteiro em texto livre.
    if (texto) {
      await ritmoDoNominatim();
      const r = await geocodeAddress(sufixo ? `${texto}, ${sufixo}` : texto, null);
      if (r && !isPointInSea(r.lat, r.lng)) return { lat: r.lat, lng: r.lng, origem: "loja: endereço" };
    }

    // 3. Só a cidade. Pior que o endereço e melhor que abrir em outro estado:
    //    o lojista vê o próprio bairro na tela e entende onde arrastar o pino.
    if (cid) {
      await ritmoDoNominatim();
      const r = await geocodeAddress([cid, estado, "Brasil"].filter(Boolean).join(", "), null);
      if (r && !isPointInSea(r.lat, r.lng)) return { lat: r.lat, lng: r.lng, origem: "loja: cidade" };
    }
    return null;
  }).catch((e: any) => {
    console.warn(`[Geocodificação] ponto da loja "${texto.slice(0, 50)}" falhou: ${e?.message}`);
    return null;
  });

  if (!achado) return null;

  await gravarNoCache({
    chave,
    lat: achado.lat,
    lng: achado.lng,
    origem: achado.origem,
    bairro: "",
    cidade: cid,
  });
  return achado;
}

/** Uma linha do cache. Falhar aqui nunca derruba a geocodificação em si. */
async function gravarNoCache(g: { chave: string; lat: number; lng: number; origem: string; bairro: string; cidade: string }) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GeocodeCache" ("chave","lat","lng","origem","bairro","cidade")
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("chave") DO UPDATE SET "lat"=EXCLUDED."lat","lng"=EXCLUDED."lng","origem"=EXCLUDED."origem","ultimoUso"=NOW()`,
      g.chave, g.lat, g.lng, g.origem, g.bairro, g.cidade,
    );
  } catch (e: any) {
    console.warn("[Geocodificação] gravação do cache falhou:", e?.message);
  }
}
