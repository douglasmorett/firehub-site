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
import { buscarNoGoogle, chaveDoGoogle, type ResultadoDoGoogle } from "@/lib/geocodificacao-google";
import {
  criarGeocodificador,
  parseAddressDetails,
  cleanAddressForGeocoding,
  estadoPeloEndereco,
  dicionarioDeBairro,
  isPointInSea,
  type Ponto,
} from "@/lib/geocodificacao";
import {
  geocodeAddress,
  geocodeStreetStructured,
  extrairLogradouro,
  buscaLivreNoMapa,
  buscaDeRuaNoMapa,
  resumoDaConsulta,
  type GeocodificadorDaTaxa,
  type RespostaDoMapa,
  type ResultadoDoMapa,
  type TrechoDeRua,
} from "@/lib/geocoding";

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
  // A resposta inteira da busca do caminho da taxa (lista de trechos, bairro,
  // município) — a roteirização só precisa de lat/lng e não lê esta coluna.
  await prisma.$executeRawUnsafe(`ALTER TABLE "GeocodeCache" ADD COLUMN IF NOT EXISTS "resposta" TEXT`);
  tabelaPronta = true;
}

// ── A FILA DO MAPA: UMA CHAMADA POR VEZ, UM RELÓGIO SÓ ───────────────────────
//
// O Nominatim aceita 1 chamada por segundo POR IP, e o IP aqui é o do servidor
// inteiro. Duas lojas roteirizando ao mesmo tempo, sem esta fila, derrubariam o
// limite para todas as outras.
//
// A fila anda por CHAMADA, não por endereço. Até 25/09/2026 a roteirização e o
// cron de distâncias punham o endereço INTEIRO como um item: uma cascata de até
// 8 buscas (~8 s quando a rua não está no OSM, o caso da Divinos). A cotação de
// frete, que tem 8,5 s de mapa em ROTA, esperava o item acabar e estourava o
// prazo: "O mapa não respondeu a tempo" para um endereço que o mapa acha na 2ª
// busca. E o ritmo era de cada um: a busca da taxa e a da roteirização saíam
// com 1 ms de intervalo, furando o 1 req/s.
//
// Agora:
//   - cada chamada HTTP entra sozinha, e o espaço de 1,1 s entre DUAS
//     QUAISQUER é contado aqui, num relógio só (a roteirização passa o seu
//     `vez` para lib/geocodificacao.ts);
//   - a cotação (cliente esperando a taxa) passa na frente do lote
//     (roteirização, cron, ponto da loja, sonda);
//   - cada DONO (o IP do cardápio público, a loja) tem um teto de buscas em voo
//     e por minuto: 40 GETs de um IP com ruas inventadas enchiam a fila de 25 e
//     derrubavam a cotação de todas as lojas do processo.

type Prioridade = "cotacao" | "lote";

export type OpcoesDaFila = {
  /** "cotacao" passa na frente do "lote" (padrão). */
  prioridade?: Prioridade;
  /** Quem pediu ("ip:…", "loja:…"): limita as buscas em voo e por minuto de cada um. */
  donos?: string[];
};

/** Por que a fila recusou: cheia, dono no limite, ou a vez cairia depois do prazo. */
export class RecusaDaFila extends Error {
  constructor(message: string, readonly tipo: "cheia" | "limite" | "prazo") {
    super(message);
  }
}

type Vez = {
  executar: () => Promise<unknown>;
  resolver: (v: unknown) => void;
  rejeitar: (e: unknown) => void;
  /** Epoch ms, relido na hora da vez: o voo compartilhado estica o prazo (ver resolverNaTaxa). */
  prazo: () => number | undefined;
};

const filas: Record<Prioridade, Vez[]> = { cotacao: [], lote: [] };
/** Quantas chamadas podem esperar em cada fila — o teto do lote não trava a cotação, e vice-versa. */
const TETO_DA_FILA = 25;

/**
 * Teto de cada dono. `emVoo`: esperando ou rodando ao mesmo tempo. `porMinuto`:
 * chamadas ao mapa numa janela DESLIZANTE de 60 s — orçamento de BUSCA, não de
 * requisição: cotação que sai do cache não gasta nada daqui. Uma cotação de
 * endereço novo gasta de 1 a 5 buscas (a rua com outro número, de 1 a 2: a
 * rua, o bairro e o centro dele já estão no cache); 20 por minuto é um cliente
 * corrigindo o endereço várias vezes — ou alguns atrás do mesmo IP de
 * operadora —, não um laço. A loja inteira fica em 40: a fila anda ~54 por
 * minuto, e uma loja-alvo não pode tomar a vez de todas as outras.
 */
const LIMITES_DO_DONO: Record<string, { emVoo: number; porMinuto: number }> = {
  ip: { emVoo: 2, porMinuto: 20 },
  loja: { emVoo: 4, porMinuto: 40 },
};
/** Para o teste conferir os tetos sem repetir os números. */
export const TETOS_DO_DONO = LIMITES_DO_DONO;
const emVooDoDono = new Map<string, number>();
const chamadasDoDono = new Map<string, number[]>();

let despachando = false;
let ultimaChamadaNominatim = 0;
let intervaloDoNominatimMs = 1100;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function limiteDoDono(dono: string) {
  return LIMITES_DO_DONO[dono.split(":")[0]] ?? null;
}

/** A próxima chamada que ainda vale: cotação antes do lote; a que perdeu o prazo sai recusada. */
function tirarAProxima(): Vez | null {
  for (const prioridade of ["cotacao", "lote"] as const) {
    const fila = filas[prioridade];
    while (fila.length > 0) {
      const vez = fila.shift()!;
      const prazo = vez.prazo();
      // Quem tem pressa não quer a resposta depois do prazo: gastar o limite
      // do IP numa resposta que ninguém vai ler é o pior dos dois.
      if (prazo != null && Date.now() > prazo - 500) {
        vez.rejeitar(new RecusaDaFila("prazo esgotado na fila", "prazo"));
        continue;
      }
      return vez;
    }
  }
  return null;
}

async function despachar() {
  if (despachando) return;
  despachando = true;
  try {
    while (filas.cotacao.length > 0 || filas.lote.length > 0) {
      // Espera o ritmo ANTES de escolher: a cotação que chega durante a espera
      // passa na frente do lote que já estava na fila.
      const espera = ultimaChamadaNominatim + intervaloDoNominatimMs - Date.now();
      if (espera > 0) {
        await dormir(espera);
        continue;
      }
      const vez = tirarAProxima();
      if (!vez) continue;
      ultimaChamadaNominatim = Date.now();
      // Uma de cada vez, até o fim: a política do Nominatim é de um cliente
      // sem paralelismo, e a resposta lenta de um é o intervalo do seguinte.
      try {
        vez.resolver(await vez.executar());
      } catch (e) {
        vez.rejeitar(e);
      }
    }
  } finally {
    despachando = false;
  }
}

/**
 * Uma chamada ao mapa, na vez dela. `prazo` (epoch ms, ou função que o relê):
 * se a vez chega tarde demais, a chamada nem sai. `opcoes.prioridade` põe a
 * cotação na frente; `opcoes.donos` aplica o teto de cada dono.
 *
 * Recusa (RecusaDaFila) quando a fila daquela prioridade está cheia, quando um
 * dono passou do teto ou quando o prazo acabou esperando.
 */
export function naFila<T>(
  fn: () => Promise<T>,
  prazo?: number | (() => number | undefined),
  opcoes?: OpcoesDaFila,
): Promise<T> {
  const prioridade: Prioridade = opcoes?.prioridade ?? "lote";
  const donos = [...new Set(opcoes?.donos ?? [])];
  if (filas[prioridade].length >= TETO_DA_FILA) {
    return Promise.reject(new RecusaDaFila("fila de geocodificação cheia", "cheia"));
  }
  const agora = Date.now();
  for (const dono of donos) {
    const limite = limiteDoDono(dono);
    if (!limite) continue;
    if ((emVooDoDono.get(dono) ?? 0) >= limite.emVoo) {
      return Promise.reject(new RecusaDaFila(`limite de buscas em voo (${dono.split(":")[0]})`, "limite"));
    }
    const recentes = (chamadasDoDono.get(dono) ?? []).filter((t) => agora - t < 60_000);
    chamadasDoDono.set(dono, recentes);
    if (recentes.length >= limite.porMinuto) {
      return Promise.reject(new RecusaDaFila(`limite de buscas por minuto (${dono.split(":")[0]})`, "limite"));
    }
  }
  for (const dono of donos) {
    if (!limiteDoDono(dono)) continue;
    emVooDoDono.set(dono, (emVooDoDono.get(dono) ?? 0) + 1);
    chamadasDoDono.get(dono)!.push(agora);
  }
  // O Map de donos não pode crescer para sempre (IP novo a cada requisição).
  if (chamadasDoDono.size > 5000) {
    for (const [dono, lista] of chamadasDoDono) {
      if (!lista.some((t) => agora - t < 60_000) && !emVooDoDono.get(dono)) chamadasDoDono.delete(dono);
    }
  }
  const lerPrazo = typeof prazo === "function" ? prazo : () => prazo;
  return new Promise<T>((resolver, rejeitar) => {
    filas[prioridade].push({ executar: fn, resolver: resolver as (v: unknown) => void, rejeitar, prazo: lerPrazo });
    void despachar();
  }).finally(() => {
    for (const dono of donos) {
      if (!limiteDoDono(dono)) continue;
      const n = (emVooDoDono.get(dono) ?? 1) - 1;
      if (n > 0) emVooDoDono.set(dono, n);
      else emVooDoDono.delete(dono);
    }
  });
}

/** Para o /api/health: quantas chamadas esperam a vez, sem ir à rede. */
export function estadoDaFilaDoMapa() {
  return {
    cotacoesEsperando: filas.cotacao.length,
    loteEsperando: filas.lote.length,
    ultimaChamada: ultimaChamadaNominatim ? new Date(ultimaChamadaNominatim).toISOString() : null,
  };
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

  // Cada CHAMADA da cascata entra na fila única, com prioridade de lote: a
  // cotação de frete de qualquer loja passa na frente entre uma chamada e a
  // outra deste endereço. Se a fila recusar alguma (cheia, prazo), o endereço
  // sai do lote — o ponto dele seria de um degrau pior da cascata, e o
  // navegador resolve sozinho, como fazia quando a fila recusava o item todo.
  let recusadaNesteItem = false;
  const geo = criarGeocodificador({
    storeCity: cidade,
    estado,
    centroDaLoja: loja.centro,
    vez: (chamada) =>
      naFila(chamada, prazo, { prioridade: "lote" }).catch((e) => {
        if (e instanceof RecusaDaFila) recusadaNesteItem = true;
        throw e;
      }),
  });

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
      recusadaNesteItem = false;
      const { coords, origem } = await geo.geocodificarItem({ idx: i, neighborhood, streetName, houseNumber, cleanedStreet, dictFallback });
      if (recusadaNesteItem) {
        console.warn(`[Geocodificação] endereço ${resumoDaConsulta(p.endereco)} ficou para o navegador: a fila recusou uma das buscas`);
        continue;
      }
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
      // O endereço do cliente não vai para o log (LGPD): o resumo correlaciona.
      console.warn(`[Geocodificação] endereço ${resumoDaConsulta(p.endereco)}: ${e?.message}`);
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

  // Cada busca na fila única, uma por vez (prioridade de lote).
  const achado = await (async () => {
    // 1. Busca estruturada (rua + cidade): é a que acha endereço de loja onde o
    //    texto solto falha. Ver o comentário de geocodeStreetStructured.
    const rua = extrairLogradouro(texto);
    if (rua && cid) {
      const trechos = await naFila(() => geocodeStreetStructured(rua, cid, null));
      const bom = trechos.find((t) => !isPointInSea(t.lat, t.lng));
      if (bom) return { lat: bom.lat, lng: bom.lng, origem: "loja: rua estruturada" };
    }

    // 2. Endereço inteiro em texto livre.
    if (texto) {
      const r = await naFila(() => geocodeAddress(sufixo ? `${texto}, ${sufixo}` : texto, null));
      if (r && !isPointInSea(r.lat, r.lng)) return { lat: r.lat, lng: r.lng, origem: "loja: endereço" };
    }

    // 3. Só a cidade. Pior que o endereço e melhor que abrir em outro estado:
    //    o lojista vê o próprio bairro na tela e entende onde arrastar o pino.
    if (cid) {
      const r = await naFila(() => geocodeAddress([cid, estado, "Brasil"].filter(Boolean).join(", "), null));
      if (r && !isPointInSea(r.lat, r.lng)) return { lat: r.lat, lng: r.lng, origem: "loja: cidade" };
    }
    return null;
  })().catch((e: any) => {
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

// ── O CAMINHO DA TAXA ────────────────────────────────────────────────────────
//
// A cotação de frete (site, robô, balcão) geocodificava direto no Nominatim:
// sem cache, sem fila, até 5 buscas seguidas de 4,5 s cada. O mesmo endereço
// repetido virava buscas repetidas — o que a política do Nominatim proíbe
// ("Results must be cached on your side") e é o caminho mais curto para o IP
// do servidor ser bloqueado e TODAS as lojas caírem em "não localizado".
//
// Aqui cada busca do caminho da taxa passa, nesta ordem, por:
//   1. a memória do processo (inclusive o "não existe no mapa", por 30 min);
//   2. o GeocodeCache do banco — o mesmo da roteirização, com chaves próprias
//      ("taxa|...") e a resposta inteira na coluna "resposta" (90 dias);
//   3. a fila única de 1 req/s deste processo (a mesma da roteirização), na
//      frente do lote, e no teto do dono quando há um (o IP do cardápio).
// E respeita o prazo da cotação: busca que não cabe no tempo não sai — e
// volta como FALHA, não como "o mapa não conhece".

const VALIDADE_NO_BANCO_DIAS = 90;
/** Na memória, o que o mapa achou vale 1 dia; o que ele NÃO achou, 30 min. */
const VALIDADE_NA_MEMORIA_MS = 24 * 60 * 60_000;
const VALIDADE_DO_NAO_ACHOU_MS = 30 * 60_000;
const TETO_DA_MEMORIA_DA_TAXA = 3000;
const PRAZO_DO_BANCO_MS = 2000;
const PRAZO_DA_BUSCA_MS = 4500;

const memoriaDaTaxa = new Map<string, { valor: unknown; exp: number }>();
/**
 * A busca em voo de cada chave. O prazo é o MAIOR entre quem espera: a
 * cotação automática do checkout (6 s) abre o voo e o POST do mesmo endereço
 * (20 s) chega depois. Com o prazo do primeiro, a fila recusava a busca
 * quando ele acabava e o segundo recebia "não localizado" tendo 17 s de sobra.
 */
type VooDaTaxa = { promessa: Promise<RespostaDoMapa<unknown>>; prazo: number };
const emVooDaTaxa = new Map<string, VooDaTaxa>();
let bancoDaTaxaForaAte = 0;

function lembrarNaTaxa(chave: string, valor: unknown, validadeMs: number) {
  memoriaDaTaxa.delete(chave);
  memoriaDaTaxa.set(chave, { valor, exp: Date.now() + validadeMs });
  if (memoriaDaTaxa.size > TETO_DA_MEMORIA_DA_TAXA) {
    const maisVelha = memoriaDaTaxa.keys().next().value;
    if (maisVelha !== undefined) memoriaDaTaxa.delete(maisVelha);
  }
}

/**
 * Onde a resposta fica guardada entre processos. Trocável de propósito: o
 * teste põe um de memória no lugar do banco.
 */
export type ArmazemDaTaxa = {
  /** A resposta guardada (JSON), ou null. */
  ler(chave: string): Promise<string | null>;
  gravar(g: { chave: string; lat: number; lng: number; origem: string; bairro: string; cidade: string; resposta: string }): Promise<void>;
};

const armazemNoBanco: ArmazemDaTaxa = {
  async ler(chave) {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<{ resposta: string | null }[]>(
      `SELECT "resposta" FROM "GeocodeCache"
        WHERE "chave" = $1 AND "resposta" IS NOT NULL
          AND "criadoEm" > NOW() - ($2::int * INTERVAL '1 day')
        LIMIT 1`,
      chave,
      VALIDADE_NO_BANCO_DIAS,
    );
    if (!linhas[0]?.resposta) return null;
    prisma
      .$executeRawUnsafe(`UPDATE "GeocodeCache" SET "usos" = "usos" + 1, "ultimoUso" = NOW() WHERE "chave" = $1`, chave)
      .catch(() => undefined);
    return linhas[0].resposta;
  },
  async gravar(g) {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GeocodeCache" ("chave","lat","lng","origem","bairro","cidade","resposta")
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT ("chave") DO UPDATE SET "lat"=EXCLUDED."lat","lng"=EXCLUDED."lng","origem"=EXCLUDED."origem",
         "bairro"=EXCLUDED."bairro","cidade"=EXCLUDED."cidade","resposta"=EXCLUDED."resposta",
         "criadoEm"=NOW(),"ultimoUso"=NOW()`,
      g.chave, g.lat, g.lng, g.origem, g.bairro, g.cidade, g.resposta,
    );
  },
};

export const armazemDaTaxa: ArmazemDaTaxa = { ...armazemNoBanco };

/** Banco lento não segura a cotação; banco fora não é consultado por 60 s. */
async function doBancoDaTaxa<T>(fn: () => Promise<T>, seFalhar: T): Promise<T> {
  if (Date.now() < bancoDaTaxaForaAte) return seFalhar;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, rejeita) => {
        timer = setTimeout(() => rejeita(new Error("banco demorou")), PRAZO_DO_BANCO_MS);
      }),
    ]);
  } catch (e: any) {
    bancoDaTaxaForaAte = Date.now() + 60_000;
    console.warn("[Geocodificação da taxa] cache no banco falhou — só memória por 60 s:", String(e?.message || e).slice(0, 120));
    return seFalhar;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** O que vier primeiro: a promessa ou o prazo (aí vale `seEstourar`). */
function ateOPrazo<T>(p: Promise<T>, prazo: number, seEstourar: T): Promise<T> {
  const resta = prazo - Date.now();
  if (resta <= 0) return Promise.resolve(seEstourar);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => seEstourar),
    new Promise<T>((r) => {
      timer = setTimeout(() => r(seEstourar), resta);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** A região da loja a ~11 km: a caixa de busca muda o que o mapa devolve. */
function regiao(centro: Ponto | null): string {
  return centro && Number.isFinite(centro.lat) && Number.isFinite(centro.lng)
    ? `${centro.lat.toFixed(1)},${centro.lng.toFixed(1)}`
    : "-";
}

/** A recusa da fila, dita como a busca que não aconteceu. */
function motivoDaRecusa(e: any): string {
  if (e instanceof RecusaDaFila) return e.tipo === "prazo" ? "prazo esgotado na fila" : e.tipo === "limite" ? `limite: ${e.message}` : e.message;
  return String(e?.message || e);
}

/** Falha que pode passar se perguntar de novo com mais tempo. */
const falhaDeTempo = (motivo: string) => /prazo|sem resposta/.test(motivo);

/**
 * Uma busca do caminho da taxa: memória, banco, e só então a fila.
 *
 * Devolve a resposta do mapa (`ok`, inclusive "não achou nada") ou a FALHA
 * com o motivo — fila cheia, prazo, 429, 5xx, rede, limite do dono. Até
 * 25/09/2026 as duas coisas voltavam como "vazio": "não deu para perguntar"
 * virava "o mapa não conhece", a cotação dizia "Endereço não localizado" e
 * descia para o centro do bairro como se a casa não existisse.
 */
async function resolverNaTaxa<T>(
  args: {
    chave: string;
    prazo: number;
    buscar: (timeoutMs: number) => Promise<RespostaDoMapa<T>>;
    /** O que vai nas colunas do cache; null = o mapa não achou nada (não vai ao banco). */
    paraGravar: (v: T) => { lat: number; lng: number; bairro: string; cidade: string } | null;
    origem: string;
    donos?: string[];
  },
  jaTentouDeNovo = false,
): Promise<RespostaDoMapa<T>> {
  const { chave, prazo } = args;
  const lembrado = memoriaDaTaxa.get(chave);
  if (lembrado && lembrado.exp > Date.now()) {
    lembrarNaTaxa(chave, lembrado.valor, lembrado.exp - Date.now());
    return { ok: true, valor: lembrado.valor as T };
  }

  // Duas cotações do mesmo endereço ao mesmo tempo (o checkout recalcula
  // enquanto o cliente digita) esperam a MESMA busca — com o prazo de quem
  // pode esperar mais.
  let voo = emVooDaTaxa.get(chave);
  if (voo) {
    voo.prazo = Math.max(voo.prazo, prazo);
  } else {
    const novo: VooDaTaxa = { prazo, promessa: Promise.resolve({ ok: false, motivo: "" }) };
    novo.promessa = (async (): Promise<RespostaDoMapa<unknown>> => {
      try {
        const guardada = await doBancoDaTaxa(() => armazemDaTaxa.ler(chave), null);
        if (guardada) {
          try {
            const valor = JSON.parse(guardada) as T;
            lembrarNaTaxa(chave, valor, VALIDADE_NA_MEMORIA_MS);
            return { ok: true, valor };
          } catch {
            // Linha ilegível: pergunta de novo, e a gravação conserta.
          }
        }
        if (novo.prazo - Date.now() < 800) return { ok: false, motivo: "prazo" };
        let r: RespostaDoMapa<T>;
        try {
          r = await naFila(
            async () => {
              const resta = novo.prazo - Date.now();
              if (resta < 500) return { ok: false, motivo: "prazo" } as RespostaDoMapa<T>;
              return args.buscar(Math.min(PRAZO_DA_BUSCA_MS, resta));
            },
            () => novo.prazo,
            { prioridade: "cotacao", donos: args.donos },
          );
        } catch (e: any) {
          // Fila cheia, dono no limite ou prazo: não é "não existe", é "não deu agora".
          const motivo = motivoDaRecusa(e);
          if (!falhaDeTempo(motivo)) console.warn(`[Geocodificação da taxa] busca recusada: ${motivo}`);
          return { ok: false, motivo };
        }
        if (!r.ok) return r;
        const valor = r.valor;
        const colunas = args.paraGravar(valor);
        if (colunas) {
          lembrarNaTaxa(chave, valor, VALIDADE_NA_MEMORIA_MS);
          void doBancoDaTaxa(
            () => armazemDaTaxa.gravar({ chave, ...colunas, origem: args.origem, resposta: JSON.stringify(valor) }),
            undefined,
          );
        } else {
          lembrarNaTaxa(chave, valor, VALIDADE_DO_NAO_ACHOU_MS);
        }
        return r;
      } finally {
        // Aqui dentro, e não num .finally() pendurado: quem acorda com a
        // resposta e pergunta de novo não pode cair neste voo já pousado.
        if (emVooDaTaxa.get(chave) === novo) emVooDaTaxa.delete(chave);
      }
    })();
    emVooDaTaxa.set(chave, novo);
    voo = novo;
  }
  const r = (await ateOPrazo(voo.promessa, prazo, { ok: false, motivo: "prazo" } as RespostaDoMapa<unknown>)) as RespostaDoMapa<T>;
  // O voo foi aberto por quem tinha menos tempo e a busca saiu com o prazo
  // curto dele: quem ainda tem tempo pergunta de novo, uma vez.
  if (!r.ok && !jaTentouDeNovo && falhaDeTempo(r.motivo) && prazo - Date.now() >= 1500) {
    return resolverNaTaxa(args, true);
  }
  return r;
}

/**
 * O geocodificador do caminho da taxa: cache (memória + GeocodeCache), fila
 * de 1 req/s compartilhada com a roteirização e o prazo de quem pergunta.
 * É o que lib/area-de-entrega.ts passa para `verifyStoreDeliveryAddress`.
 *
 * `donos` (o IP do cardápio público, a loja): as buscas que VÃO À REDE contam
 * no teto de cada um (ver LIMITES_DO_DONO). Cache não conta.
 */
// ── O GOOGLE NA TAXA: CACHE E TETO DO DIA ─────────────────────────────────
//
// Cada consulta ao Google custa (acima de 10 mil por mês). O robô recota o
// endereço a cada mensagem da conversa: sem cache, o MESMO endereço seria pago
// várias vezes — e o "não achei" também, por isso ele é guardado. O teto do
// dia (GOOGLE_GEOCODING_TETO_DIA, padrão 1.000) é o freio de mão: passado
// ele, a cascata segue só com o mapa aberto até o dia virar.

const memoriaDoGoogle = new Map<string, { valor: ResultadoDoGoogle | null; em: number }>();
const VALIDADE_DO_GOOGLE_NA_MEMORIA_MS = 6 * 60 * 60 * 1000;
const TETO_DA_MEMORIA_DO_GOOGLE = 5000;
let contagemDoGoogle = { dia: "", n: 0, avisou: false };

function tetoDoGoogleNoDia(): number {
  const n = Number(process.env.GOOGLE_GEOCODING_TETO_DIA);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

function lembrarDoGoogle(chave: string, valor: ResultadoDoGoogle | null) {
  if (memoriaDoGoogle.size >= TETO_DA_MEMORIA_DO_GOOGLE) {
    const maisAntiga = memoriaDoGoogle.keys().next().value;
    if (maisAntiga !== undefined) memoriaDoGoogle.delete(maisAntiga);
  }
  memoriaDoGoogle.set(chave, { valor, em: Date.now() });
}

async function googleNaTaxa(
  consulta: string,
  cidade: string,
  centro: Ponto | null,
  prazo: number,
): Promise<RespostaDoMapa<ResultadoDoGoogle | null>> {
  if (!chaveDoGoogle()) return { ok: true, valor: null };
  const chave = `taxa|google|${chaveDeCache(consulta, cidade)}`.slice(0, 400);

  const lembrada = memoriaDoGoogle.get(chave);
  if (lembrada && Date.now() - lembrada.em < VALIDADE_DO_GOOGLE_NA_MEMORIA_MS) return { ok: true, valor: lembrada.valor };
  const guardada = await doBancoDaTaxa(() => armazemDaTaxa.ler(chave), null);
  if (guardada) {
    try {
      const v = JSON.parse(guardada);
      const valor = v && typeof v === "object" && !v.nada ? (v as ResultadoDoGoogle) : null;
      lembrarDoGoogle(chave, valor);
      return { ok: true, valor };
    } catch {
      // Linha estragada: pergunta de novo.
    }
  }

  const hoje = new Date().toISOString().slice(0, 10);
  if (contagemDoGoogle.dia !== hoje) contagemDoGoogle = { dia: hoje, n: 0, avisou: false };
  if (contagemDoGoogle.n >= tetoDoGoogleNoDia()) {
    if (!contagemDoGoogle.avisou) {
      contagemDoGoogle.avisou = true;
      console.warn(`[Google] teto do dia atingido (${tetoDoGoogleNoDia()} consultas) — até amanhã a taxa segue só com o mapa aberto`);
    }
    return { ok: true, valor: null };
  }
  const resta = prazo - Date.now();
  if (resta < 800) return { ok: false, motivo: "prazo" };

  contagemDoGoogle.n++;
  const r = await buscarNoGoogle(consulta, cidade, centro, Math.min(4000, resta));
  if (!r.ok) {
    // Sem o endereço no log (LGPD): o resumo correlaciona sem expor.
    console.warn(`[Google] endereço ${resumoDaConsulta(consulta)}: ${r.motivo}`);
    return r;
  }
  lembrarDoGoogle(chave, r.valor);
  const v = r.valor;
  doBancoDaTaxa(
    () =>
      armazemDaTaxa.gravar({
        chave,
        lat: v?.lat ?? 0,
        lng: v?.lng ?? 0,
        origem: "google",
        bairro: v?.bairro || "",
        cidade: v?.cidades?.[0] || cidade,
        resposta: JSON.stringify(v ?? { nada: true }),
      }),
    undefined,
  ).catch(() => undefined);
  return r;
}

/** Para o /api/health: o Google está ligado, e quanto do teto de hoje já foi. */
export function estadoDoGoogle() {
  const hoje = new Date().toISOString().slice(0, 10);
  return {
    ligado: !!chaveDoGoogle(),
    consultasHoje: contagemDoGoogle.dia === hoje ? contagemDoGoogle.n : 0,
    tetoDoDia: tetoDoGoogleNoDia(),
    naMemoria: memoriaDoGoogle.size,
  };
}

export function geocodificadorDaTaxaPara(donos?: string[]): GeocodificadorDaTaxa {
  return {
    google(consulta, cidade, centro, prazo) {
      return googleNaTaxa(consulta, cidade, centro, prazo);
    },
    livre(consulta, centro, prazo) {
      return resolverNaTaxa<ResultadoDoMapa | null>({
        chave: `taxa|livre|${regiao(centro)}|${chaveDeCache(consulta, "")}`.slice(0, 400),
        prazo,
        buscar: (timeoutMs) => buscaLivreNoMapa(consulta, centro, { timeoutMs }),
        paraGravar: (v) => (v ? { lat: v.lat, lng: v.lng, bairro: v.bairro || "", cidade: v.cidades?.[0] || "" } : null),
        origem: "taxa: busca livre",
        donos,
      });
    },
    estruturada(rua, cidade, centro, prazo) {
      return resolverNaTaxa<TrechoDeRua[]>({
        chave: `taxa|rua|${regiao(centro)}|${chaveDeCache(rua, cidade)}`.slice(0, 400),
        prazo,
        buscar: (timeoutMs) => buscaDeRuaNoMapa(rua, cidade, centro, { timeoutMs }),
        paraGravar: (v) =>
          v.length > 0 ? { lat: v[0].lat, lng: v[0].lng, bairro: v[0].suburb || "", cidade: v[0].cidades?.[0] || cidade } : null,
        origem: "taxa: rua estruturada",
        donos,
      });
    },
  };
}

/** O de quem não tem dono (robô, pedido, balcão): sem teto próprio, só a fila. */
export const geocodificadorDaTaxa: GeocodificadorDaTaxa = geocodificadorDaTaxaPara();

/** Zera memória, voos, disjuntor do banco, o ritmo e os tetos dos donos. SÓ PARA TESTE. */
export function reiniciarGeocodificacaoParaTeste(opcoes?: { intervaloDoNominatimMs?: number }) {
  memoriaDoGoogle.clear();
  contagemDoGoogle = { dia: "", n: 0, avisou: false };
  memoriaDaTaxa.clear();
  emVooDaTaxa.clear();
  emVooDoDono.clear();
  chamadasDoDono.clear();
  bancoDaTaxaForaAte = 0;
  ultimaChamadaNominatim = 0;
  intervaloDoNominatimMs = opcoes?.intervaloDoNominatimMs ?? 1100;
  ultimaSondaDoNominatim = null;
}

type ResultadoDaSonda = { ok: boolean; ms: number; motivo?: string };
let ultimaSondaDoNominatim: { em: number; valor: ResultadoDaSonda } | null = null;
let sondaDoNominatimEmVoo: Promise<ResultadoDaSonda> | null = null;

/**
 * Pergunta de verdade ao Nominatim (só o /api/health?sondar=1), pela fila e no
 * ritmo de todo mundo, no máximo uma vez por minuto.
 *
 * Uma sonda por vez: o resultado só era guardado DEPOIS de a sonda terminar, e
 * 30 GETs simultâneos disparavam 30 sondas — 25 enchiam a fila e a cotação de
 * frete do mesmo instante voltava "não localizado" em 4 ms. Quem chega com uma
 * sonda em voo espera a mesma. E ela entra como lote: cotação passa na frente.
 */
export function sondarNominatim(): Promise<ResultadoDaSonda> {
  if (ultimaSondaDoNominatim && Date.now() - ultimaSondaDoNominatim.em < 60_000) return Promise.resolve(ultimaSondaDoNominatim.valor);
  if (sondaDoNominatimEmVoo) return sondaDoNominatimEmVoo;
  const voo = (async (): Promise<ResultadoDaSonda> => {
    const inicio = Date.now();
    const prazo = inicio + 8000;
    let valor: ResultadoDaSonda;
    try {
      const r = await naFila(
        () => buscaLivreNoMapa("Cabo Frio, Rio de Janeiro, Brasil", null, { timeoutMs: Math.max(500, prazo - Date.now()) }),
        prazo,
      );
      valor = r.ok && r.valor
        ? { ok: true, ms: Date.now() - inicio }
        : { ok: false, ms: Date.now() - inicio, motivo: r.ok ? "sem resultado" : r.motivo };
    } catch (e: any) {
      valor = { ok: false, ms: Date.now() - inicio, motivo: motivoDaRecusa(e) };
    }
    ultimaSondaDoNominatim = { em: Date.now(), valor };
    return valor;
  })();
  sondaDoNominatimEmVoo = voo;
  voo
    .finally(() => {
      if (sondaDoNominatimEmVoo === voo) sondaDoNominatimEmVoo = null;
    })
    .catch(() => undefined);
  return voo;
}
