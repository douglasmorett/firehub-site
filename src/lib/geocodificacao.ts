/**
 * Geocodificação da roteirização — a parte que não depende de React.
 *
 * Nasceu dentro do RoteirizacaoModal e foi extraída em 11/09/2026 para poder
 * ser TESTADA fora do navegador (scripts contra o Nominatim/Photon reais com
 * endereços de várias cidades). O texto das funções veio do modal como
 * estava; o que mudou está comentado.
 *
 * Regra que o dono pediu (10/09/2026): primeiro o nome do bairro, depois a
 * rua dentro do bairro; não achou a rua, o pino fica no bairro — nunca numa
 * rua homônima de outro lugar.
 *
 * Duas coisas aqui eram de Rio das Ostras e valiam para o Brasil inteiro sem
 * querer: a checagem de "mar" (só conhece a costa de lá) e o dicionário de
 * bairros (um "Centro" de Salvador caía nas coordenadas do Centro de Rio das
 * Ostras). As duas agora só opinam perto de onde foram medidas.
 */

export type Ponto = { lat: number; lng: number };

/** Um ponto vindo do geocodificador, com o bairro que o mapa diz que ele está. */
export type ResultadoGeo = Ponto & { bairro?: string };

export type ItemGeocodificavel = {
  idx: number;
  neighborhood: string;
  streetName: string;
  houseNumber: string;
  cleanedStreet: string;
  dictFallback?: Ponto;
  /**
   * O CEP do endereço (8 dígitos), quando há. Resultado do mapa com o CEP do
   * MESMO setor (os 5 primeiros dígitos) dispensa a régua dos 2,8 km do centro
   * do bairro — ver `cepConfere` em criarGeocodificador.
   */
  cep?: string | null;
};

/**
 * Nenhum resultado vale se estiver mais longe da loja do que isto. Entrega a
 * 30 km não existe; o que existe é rua homônima em outra cidade do mesmo
 * estado, ou o centro de um município enorme (São Paulo tem 50 km de ponta
 * a ponta). Rejeitado, o pino cai no bairro; sem bairro, na loja.
 */
export const RAIO_MAX_DA_LOJA_KM = 30;

/** O dicionário de bairros de Rio das Ostras só serve para loja de lá. */
export const RAIO_DO_DICIONARIO_KM = 40;

// Haversine Distance Calculation (in KM)
export const calculateHaversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of Earth in KM
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ── LINHA DE COSTA DE RIO DAS OSTRAS ─────────────────────────────────────
// Antes isto era uma linha VERTICAL fixa: `lng > -41.915 → mar`. O litoral,
// porém, é inclinado no sentido nordeste–sudoeste, e essa reta cortava fora
// toda a zona norte da cidade. Conferido contra o OpenStreetMap, caíam como
// "oceano" bairros que são terra firme:
//
//   Residencial Praia Âncora  -22.4815, -41.9130
//   Av. das Flores (ped. #68) -22.4822, -41.9082
//   Enseada das Gaivotas      -22.4947, -41.9093
//   Terra Firme               -22.4994, -41.9132
//   Mar do Norte              -22.4484, -41.8663
//
// Como todo ponto reprovado aqui é descartado e reposicionado para oeste, a
// cidade inteira ao norte vinha parar no lugar errado do mapa.
//
// Agora a fronteira acompanha a latitude, interpolada entre âncoras tiradas
// de bairros reais (com folga a leste, porque o erro caro é chamar terra de
// mar — esta checagem é rede de segurança contra pin no oceano, não deve
// mandar em endereço legítimo).
export const LIMITE_LESTE_POR_LATITUDE: [number, number][] = [
  [-22.43, -41.845],
  [-22.46, -41.875],
  [-22.48, -41.898],
  [-22.50, -41.900],
  [-22.52, -41.908],
  [-22.53, -41.928],
  [-22.54, -41.955],
  [-22.55, -41.975],
  [-22.57, -41.995],
];

export const limiteLesteDaCosta = (lat: number): number => {
  const pts = LIMITE_LESTE_POR_LATITUDE;
  // latitudes são negativas e a lista vai do norte para o sul
  if (lat >= pts[0][0]) return pts[0][1];
  if (lat <= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [latA, lngA] = pts[i];
    const [latB, lngB] = pts[i + 1];
    if (lat <= latA && lat >= latB) {
      const t = (latA - lat) / (latA - latB);
      return lngA + t * (lngB - lngA);
    }
  }
  return pts[pts.length - 1][1];
};

// A tabela acima só descreve a costa de Rio das Ostras (lat -22,43 a -22,57).
// Fora dessa faixa ela era aplicada do mesmo jeito, com o valor da ponta:
// tudo a leste de -41,995 virava "mar" — Vitória (-40,3), Salvador (-38,5),
// Recife (-34,9), Fortaleza (-38,5)... o Nordeste e o Espírito Santo inteiros
// teriam TODO resultado descartado e o pino jogado para Rio das Ostras. E não
// era só hipótese: a Pastel da Paulista fica em Macaé (-22,39, -41,79), logo
// ao norte da primeira âncora — a régua aplicava -41,845 e chamava de mar o
// centro de Macaé, a loja inclusive; o último recurso mandava o pino para
// Rio das Ostras, a 30 km. Fora da faixa a checagem não opina; ali quem
// segura ponto absurdo é a distância até a loja (RAIO_MAX_DA_LOJA_KM).
export const isPointInSea = (lat: number, lng: number): boolean => {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return true;
  const pts = LIMITE_LESTE_POR_LATITUDE;
  if (lat > pts[0][0] || lat < pts[pts.length - 1][0]) return false;
  return lng > limiteLesteDaCosta(lat);
};

/**
 * UF da loja, lida do endereço cadastrado ("... São Gonçalo - Rio de
 * Janeiro"). Sem pista, devolve null e as buscas vão sem estado (Nominatim
 * aceita cidade + país) — mandar "RJ" para uma loja de Goiânia é pior que não
 * mandar nada. Olha primeiro a cauda do endereço, onde a UF costuma estar,
 * para "Rua São Paulo, 10 - Centro, Niterói - RJ" não virar SP.
 */
export const estadoPeloEndereco = (storeAddress?: string | null): string | null => {
  const t = (storeAddress || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!t) return null;
  const cauda = t.slice(-40);
  const ufs: [RegExp, string][] = [
    [/\brio de janeiro\b|\brj\b/, "RJ"],
    [/\bsao paulo\b|\bsp\b/, "SP"],
    [/\bminas gerais\b|\bmg\b/, "MG"],
    [/\bespirito santo\b|\bes\b/, "ES"],
    [/\bbahia\b|\bba\b/, "BA"],
    [/\bpernambuco\b|\bpe\b/, "PE"],
    [/\bceara\b|\bce\b/, "CE"],
    [/\bparana\b|\bpr\b/, "PR"],
    [/\bsanta catarina\b|\bsc\b/, "SC"],
    [/\brio grande do sul\b|\brs\b/, "RS"],
    [/\bgoias\b|\bgo\b/, "GO"],
    [/\bdistrito federal\b|\bdf\b/, "DF"],
    [/\bmato grosso do sul\b|\bms\b/, "MS"],
    [/\bmato grosso\b|\bmt\b/, "MT"],
    [/\bamazonas\b|\bam\b/, "AM"],
    [/\bpara\b|\bpa\b/, "PA"],
    [/\bmaranhao\b|\bma\b/, "MA"],
    [/\bpiaui\b|\bpi\b/, "PI"],
    [/\brio grande do norte\b|\brn\b/, "RN"],
    [/\bparaiba\b|\bpb\b/, "PB"],
    [/\balagoas\b|\bal\b/, "AL"],
    [/\bsergipe\b|\bse\b/, "SE"],
    [/\btocantins\b|\bto\b/, "TO"],
    [/\brondonia\b|\bro\b/, "RO"],
    [/\bacre\b|\bac\b/, "AC"],
    [/\broraima\b|\brr\b/, "RR"],
    [/\bamapa\b|\bap\b/, "AP"],
  ];
  for (const [re, uf] of ufs) if (re.test(cauda)) return uf;
  return null;
};

const semAcento = (t: string) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** As 27 siglas. "es", "pa", "se"… sozinhas num pedaço do endereço são o estado, nunca o bairro. */
const UFS = "ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to";
const ESTADOS =
  "acre|alagoas|amapa|amazonas|bahia|ceara|distrito federal|espirito santo|goias|maranhao|mato grosso do sul|mato grosso|" +
  "minas gerais|para|paraiba|parana|pernambuco|piaui|rio de janeiro|rio grande do norte|rio grande do sul|rondonia|roraima|" +
  "santa catarina|sao paulo|sergipe|tocantins";
const RE_ESTADO = new RegExp(`^(?:${UFS}|${ESTADOS}|br|brasil)$`);
/** "Brasília/DF", "Cabo Frio / RJ": o jeito da Wabiz escrever a cidade. */
const RE_CIDADE_BARRA_UF = new RegExp(`^[a-z0-9 .'-]+\\s*/\\s*(?:${UFS})$`);
const RE_UF_NO_FIM = new RegExp(`\\s(?:${UFS})$`);

/**
 * A cidade sem a UF colada: o cadastro da NIK diz "BRASILIA DF", outros dizem
 * "Cabo Frio - RJ" ou "Cabo Frio/RJ". Comparada assim, "Brasília" e
 * "Brasília/DF" do endereço são a cidade, não o bairro.
 */
export const nucleoDaCidade = (cidade: string): string =>
  semAcento(cidade).replace(/[\/,]/g, " ").replace(/\s+-\s+/g, " ").replace(/\s+/g, " ").trim().replace(RE_UF_NO_FIM, "").trim();

/**
 * O pedaço do endereço é a cidade, o estado, o CEP ou um número — nunca o bairro.
 *
 * NIK Esfihas (16/10/2026): a Wabiz escreve "… - SOBRADINHO 2 - Brasília/DF -
 * CEP 73062892". O filtro conhecia só "Brasília" igual à cidade da loja (que
 * no cadastro é "BRASILIA DF") e só cinco estados do Sudeste: "Brasília/DF"
 * virou o BAIRRO, e o mapa achou o "Instituto de Arquitetos de Brasília", na
 * Asa Sul, a 20 km. No 99Food ("… - Sobradinho, Brasília - DF") o bairro
 * virava "DF".
 */
export const ehCidadeOuEstado = (parte: string, storeCity: string): boolean => {
  const n = semAcento(parte);
  if (!n) return true;
  // "01310-100" vira "01310" e "100" na quebra por hífen; número não é bairro.
  if (/^[0-9 ]+$/.test(n)) return true;
  if (RE_ESTADO.test(n)) return true;
  if (RE_CIDADE_BARRA_UF.test(n)) return true;
  if (/\bcep\b/.test(n) || /^\d{5}-?\d{3}$/.test(n)) return true;
  const cidade = nucleoDaCidade(storeCity || "");
  if (!cidade) return false;
  const semUf = n.replace(RE_UF_NO_FIM, "").trim();
  return semUf === cidade || n.startsWith(cidade + " ") || n.endsWith(" " + cidade);
};

/**
 * O nome do bairro comparável: sem acento, sem o prefixo ("Jardim", "Vila",
 * "Setor"…), com o número romano em algarismo e sem zero à esquerda. O OSM
 * escreve "Sobradinho II"; a Wabiz, "SOBRADINHO 2"; o cliente, "Quadra 02".
 * O que vem entre parênteses sai: os Correios escrevem "Serra Azul
 * (Sobradinho)", e o OSM, "Condomínio Serra Azul".
 */
export const nomeDeBairroComparavel = (t: string): string => {
  const romanos: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return semAcento(t)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(bairro|jardim|jd|residencial|res|parque|pq|vila|vl|setor|st)\s+/, "")
    .split(" ")
    .map((p) => romanos[p] ?? (/^\d+$/.test(p) ? String(Number(p)) : p))
    .join(" ");
};

/**
 * Os nomes com que um bairro escrito pode aparecer no mapa: o nome sem os
 * parênteses e o que está dentro deles. "Setor Oeste (Sobradinho II)" (Correios)
 * vale como "Setor Oeste" OU como a região "Sobradinho II" — o OSM do DF nem
 * sempre tem o setor, mas tem a região. "Serra Azul (Sobradinho)" vale como o
 * "Condomínio Serra Azul".
 */
export const variantesDoBairro = (t: string): string[] => {
  const dentro = [...String(t || "").matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  return [...new Set([nomeDeBairroComparavel(t), ...dentro.map(nomeDeBairroComparavel)].filter(Boolean))];
};

// Helper para extrair e destacar o Bairro e formatar endereço completo
export const parseAddressDetails = (rawAddr: string, storeCity: string) => {
  if (!rawAddr || typeof rawAddr !== "string") {
    return { neighborhood: "", fullAddress: "Endereço a confirmar", streetName: "", houseNumber: "" };
  }

  const fullAddress = rawAddr.trim();
  let neighborhood = "";

  // A cidade da loja nunca é bairro. O filtro dos passos 2 e 3 só conhecia
  // as cidades da região de Rio das Ostras: em São Gonçalo, o endereço
  // "Tv. Dom Bosco, 13 - ... - Alcantara - São Gonçalo" virava bairro
  // "São Gonçalo", e a rua era validada contra o centro da CIDADE — a
  // quilômetros da casa. Era o pedido 17 da Lucas Pimenta (10/09/2026),
  // com o pino "num endereço nada a ver".
  // Ver `ehCidadeOuEstado` (acima): "Brasília/DF", "DF" e a cidade com a UF colada.
  const ehCidadeOuEstadoDaLoja = (p: string) => ehCidadeOuEstado(p, storeCity);

  // Lista Completa de Bairros Conhecidos da Região (Prioridade MÁXIMA de identificação)
  const knownNeighborhoods = [
    "Floresta das Gaivotas", "Enseada das Gaivotas", "Praiamar", "Praia Âncora", "Praia Ancora",
    "Residencial Praia Âncora", "Residencial Praia Ancora", "Village Rio das Ostras", "Bosque D'Areia",
    "Bosque da Praia", "Reduto da Paz", "Colinas", "Chácara Mariléa", "Chacara Marilea", "Chacara Marileia",
    // "Mariléia" com É+I é como MUITO cliente escreve — e não batia com
    // nenhuma grafia da lista, então o bairro não era reconhecido.
    "Chácara Mariléia", "Jardim Mariléia",
    "Jardim Mariléa", "Jardim Marilea", "Jardim Marileia", "Novo Rio das Ostras", "Extensão Novo Rio das Ostras",
    "Extensao Novo Rio das Ostras", "Recanto Rio das Ostras", "Bairro Operário", "Bairro Operario",
    "Parque São Jorge", "Parque Sao Jorge", "Extensão do Bosque", "Extensao do Bosque",
    "Jardim Bela Vista", "Cidade Beira Mar", "Cidade Praiana", "Costa Azul", "Costazul",
    "Serra Mar", "Serramar", "Extensão Serramar", "Extensao Serramar", "Verdes Mares", "Ouro Verde",
    "Terra Firme", "Nova Esperança", "Nova Esperanca", "Jardim Esperança", "Jardim Esperanca",
    "Casas Velhas", "Rocha Leão", "Rocha Leao", "Balneário Remanso", "Balneario Remanso",
    "Boca da Barra", "Boca do Mato", "Jardim Atlântico", "Jardim Atlantico", "Nova Aliança", "Nova Alianca",
    "São Cristóvão", "São Cristovao", "Sao Cristovao", "Cantinho do Mar", "Gelson Apicelo",
    "Jardim Campomar", "Campomar", "Viverde", "Cláudio Ribeiro", "Claudio Ribeiro",
    "Jardim Miramar", "Palmital", "Mar do Norte", "Cantagalo", "Mariléa", "Marilea", "Centro",
    "Remanso", "Âncora", "Ancora", "Zabulão", "Zambulao", "Extremoz", "Recreio",
    "Operários", "Operarios", "Unamar", "Tamoios", "Peró", "Atlântica", "Atlantica", "Recanto"
  ];

  // 1. Procurar primeiro se o endereço cita explicitamente algum bairro conhecido.
  //
  // A lista é de Rio das Ostras e região — e tem nomes que existem em toda
  // cidade do Brasil ("Centro", "Recreio", "Colinas", "São Cristóvão"). Fora
  // da região ela só atrapalha: em Porto Alegre, "Centro Histórico" virava
  // "Centro" porque "Centro" está na lista (certificação de 11/09/2026).
  // Então só entra para loja da região, e do nome mais longo para o mais
  // curto, para "Extensão Serramar" não perder para "Serramar".
  const lojaDaRegiao = /rio das ostras|casimiro de abreu|cabo frio/i.test(
    (storeCity || "").normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );
  const listaDaRegiao = lojaDaRegiao ? [...knownNeighborhoods].sort((a, b) => b.length - a.length) : [];
  for (const bName of listaDaRegiao) {
    const reg = new RegExp(`\\b${bName.replace("'", "\\'")}\\b`, "i");
    if (reg.test(fullAddress)) {
      neighborhood = bName;
      break;
    }
  }

  // 2. Se não achou na lista conhecida, procurar por "Bairro: XXX" ou "Bairro XXX" (Evitando 'Brasil')
  if (!neighborhood) {
    const bairroMatch = fullAddress.match(/(?:bairro|b\.:?)\s*([^-,]+)/i);
    if (bairroMatch && bairroMatch[1]) {
      const candidate = bairroMatch[1].trim();
      if (candidate.length > 2 && candidate.toLowerCase() !== "asil" && !/brasil|rio das ostras|cabo frio|macae|macaé|rj/i.test(candidate) && !ehCidadeOuEstadoDaLoja(candidate)) {
        neighborhood = candidate;
      }
    }
  }

  // 3. Se ainda não achou e o endereço tem partes divididas por "-" ou ","
  if (!neighborhood) {
    const parts = fullAddress.split(/\s*-\s*|\s*,\s*/);
    if (parts.length >= 2) {
      const filteredParts = parts.filter(p => !/rio das ostras|cabo frio|unamar|macaé|macae|rj|brasil|asil/i.test(p.trim()) && !ehCidadeOuEstadoDaLoja(p.trim()));
      if (filteredParts.length >= 2) {
        const lastPart = filteredParts[filteredParts.length - 1].trim();
        if (!/comp|complemento|casa|apto|bloco|sobrado|ponto|muro|portão|ref/i.test(lastPart) && lastPart.length < 35 && lastPart.toLowerCase() !== "asil") {
          neighborhood = lastPart;
        }
      }
    }
  }

  // 4. Extrair Nome da Rua Limpo e Número Predial
  let streetName = "";
  let houseNumber = "";

  // Pega a primeira parte antes de traço ou vírgula
  let firstSegment = fullAddress.split(/\s*-\s*/)[0].trim();
  
  // Normalizar prefixos de vias
  firstSegment = firstSegment
    .replace(/\bR\.\s*/gi, "Rua ")
    .replace(/\bAv\.\s*/gi, "Avenida ")
    .replace(/\bTv\.\s*/gi, "Travessa ")
    .replace(/\bTrav\.\s*/gi, "Travessa ")
    .replace(/\bEst\.\s*/gi, "Estrada ")
    .replace(/\bAl\.\s*/gi, "Alameda ")
    .replace(/\bPq\.\s*/gi, "Parque ")
    .replace(/\bRod\.\s*/gi, "Rodovia ")
    .replace(/\bRes\.\s*/gi, "Residencial ");

  // Extrair número predial se existir
  const numMatch = firstSegment.match(/\b(?:n[ºo]?\s*|,\s*)(\d+)\b/i) || firstSegment.match(/\s+(\d+)$/);
  if (numMatch && numMatch[1]) {
    houseNumber = numMatch[1];
  }

  // Limpar streetName retirando número, lote, quadra, apto, referências
  streetName = firstSegment
    .replace(/\b(?:n[ºo]?\s*|,\s*)\d+\b/gi, "")
    .replace(/\blote\s*\d+\w*/gi, "")
    .replace(/\bquadra\s*\d+\w*/gi, "")
    .replace(/\bqd\s*\d+\w*/gi, "")
    .replace(/\blt\s*\d+\w*/gi, "")
    .replace(/\bcasa\s*\d+\w*/gi, "")
    .replace(/\bapto\s*\d+\w*/gi, "")
    .replace(/\bapt\s*\d+\w*/gi, "")
    .replace(/\bbloco\s*\w+/gi, "")
    .replace(/[\.,\s\-]+$/, "")
    .trim();

  // O bairro sai LIMPO de complemento. "Jardim Mariléia (301)" — com o
  // número do apartamento grudado — não bate com dicionário, com o
  // Nominatim nem com nada: o pedido caía no centro da cidade por causa de
  // um parêntese. Complemento não é bairro.
  neighborhood = neighborhood
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\b(?:apto?|apartamento|casa|bloco|fundos|sobrado)\b.*$/i, "")
    .replace(/[\.,\s\-]+$/, "")
    .trim();

  return {
    neighborhood,
    fullAddress,
    streetName,
    houseNumber
  };
};


// Dicionário Completo de Bairros de Rio das Ostras e Região com Coordenadas de Alta Precisão (RIGOROSAMENTE EM TERRA FIRME)
export const NEIGHBORHOOD_COORDS_MAP: Record<string, { lat: number; lng: number }> = {
  costazul: { lat: -22.5205, lng: -41.9175 },
  "costa azul": { lat: -22.5205, lng: -41.9175 },
  recreio: { lat: -22.5115, lng: -41.9160 },
  praiamar: { lat: -22.4980, lng: -41.9060 },
  "praia ancora": { lat: -22.4815, lng: -41.9130 },
  "praia âncora": { lat: -22.4815, lng: -41.9130 },
  "residencial praia ancora": { lat: -22.4815, lng: -41.9130 },
  "residencial praia âncora": { lat: -22.4815, lng: -41.9130 },
  // "Residencial Âncora" é como o bairro chega nos pedidos. Sem estas duas
  // chaves, a busca caía no fallback que remove o prefixo "residencial" e
  // acertava a entrada genérica `ancora`, 4,4 km a oeste — foi o que jogou
  // o pedido #68 (Av. das Flores, 314) para o outro lado da cidade.
  "residencial ancora": { lat: -22.4815, lng: -41.9130 },
  "residencial âncora": { lat: -22.4815, lng: -41.9130 },
  "village rio das ostras": { lat: -22.5040, lng: -41.9120 },
  marilea: { lat: -22.5130, lng: -41.9340 },
  mariléa: { lat: -22.5130, lng: -41.9340 },
  "jardim marilea": { lat: -22.5130, lng: -41.9340 },
  "jardim mariléa": { lat: -22.5130, lng: -41.9340 },
  "jardim marileia": { lat: -22.5130, lng: -41.9340 },
  "marilea chacara": { lat: -22.5080, lng: -41.9310 },
  "mariléa chácara": { lat: -22.5080, lng: -41.9310 },
  "chacara marilea": { lat: -22.5080, lng: -41.9310 },
  "chácara mariléa": { lat: -22.5080, lng: -41.9310 },
  "chacara marileia": { lat: -22.5080, lng: -41.9310 },
  "nova cidade": { lat: -22.5210, lng: -41.9480 },
  "ouro verde": { lat: -22.5170, lng: -41.9240 },
  "jardim bela vista": { lat: -22.5140, lng: -41.9270 },
  "parque sao jorge": { lat: -22.5220, lng: -41.9360 },
  "parque são jorge": { lat: -22.5220, lng: -41.9360 },
  "sao cristovao": { lat: -22.5160, lng: -41.9420 },
  "são cristóvão": { lat: -22.5160, lng: -41.9420 },
  "sao cristóvão": { lat: -22.5160, lng: -41.9420 },
  "são cristovao": { lat: -22.5160, lng: -41.9420 },
  "cantinho do mar": { lat: -22.5310, lng: -41.9560 },
  "nova alianca": { lat: -22.5300, lng: -41.9530 },
  "nova aliança": { lat: -22.5300, lng: -41.9530 },
  "extensao do bosque": { lat: -22.5280, lng: -41.9480 },
  "extensão do bosque": { lat: -22.5280, lng: -41.9480 },
  "extensao novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  "extensão novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  "novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  ancora: { lat: -22.4815, lng: -41.9130 },
  âncora: { lat: -22.4815, lng: -41.9130 },
  "cidade praiana": { lat: -22.5360, lng: -41.9660 },
  centro: { lat: -22.5245, lng: -41.9455 },
  recanto: { lat: -22.5320, lng: -41.9560 },
  "recanto rio das ostras": { lat: -22.5320, lng: -41.9560 },
  atlantica: { lat: -22.5030, lng: -41.9240 },
  atlântica: { lat: -22.5030, lng: -41.9240 },
  "jardim atlantico": { lat: -22.5030, lng: -41.9240 },
  "jardim atlântico": { lat: -22.5030, lng: -41.9240 },
  "terra firme": { lat: -22.5120, lng: -41.9200 },
  "enseada das gaivotas": { lat: -22.5020, lng: -41.9200 },
  "floresta das gaivotas": { lat: -22.5065, lng: -41.9210 },
  operarios: { lat: -22.5230, lng: -41.9380 },
  operários: { lat: -22.5230, lng: -41.9380 },
  "bairro operario": { lat: -22.5230, lng: -41.9380 },
  "bairro operário": { lat: -22.5230, lng: -41.9380 },
  "verdes mares": { lat: -22.5380, lng: -41.9520 },
  "serra mar": { lat: -22.5290, lng: -41.9620 },
  serramar: { lat: -22.5290, lng: -41.9620 },
  "extensao serramar": { lat: -22.5280, lng: -41.9600 },
  "extensão serramar": { lat: -22.5280, lng: -41.9600 },
  "cidade beira mar": { lat: -22.5350, lng: -41.9630 },
  "jardim campomar": { lat: -22.5320, lng: -41.9600 },
  campomar: { lat: -22.5320, lng: -41.9600 },
  "gelson apicelo": { lat: -22.5150, lng: -41.9380 },
  "boca da barra": { lat: -22.5280, lng: -41.9320 },
  viverde: { lat: -22.5180, lng: -41.9520 },
  "jardim miramar": { lat: -22.5340, lng: -41.9540 },
  palmital: { lat: -22.5250, lng: -41.9670 },
  "bosque da praia": { lat: -22.5020, lng: -41.9120 },
  "bosque d'areia": { lat: -22.5020, lng: -41.9120 },
  "reduto da paz": { lat: -22.5080, lng: -41.9150 },
  "claudio ribeiro": { lat: -22.5190, lng: -41.9550 },
  "cláudio ribeiro": { lat: -22.5190, lng: -41.9550 },
  "mar do norte": { lat: -22.4580, lng: -41.8750 },
  cantagalo: { lat: -22.4700, lng: -41.9600 },
  "rocha leao": { lat: -22.4600, lng: -42.0200 },
  "rocha leão": { lat: -22.4600, lng: -42.0200 },
  unamar: { lat: -22.5700, lng: -41.9950 },
  tamoios: { lat: -22.5700, lng: -41.9950 },
};


/**
 * O dicionário acima só vale para loja de Rio das Ostras e região. Sem esta
 * trava, o bairro "Centro" de QUALQUER cidade ganhava as coordenadas do Centro
 * de Rio das Ostras — como pino provisório e como último recurso.
 */
export const dicionarioDeBairro = (neighborhood: string, centroDaLoja: Ponto): Ponto | undefined => {
  const chave = (neighborhood || "").toLowerCase().trim();
  if (!chave) return undefined;
  const achado =
    NEIGHBORHOOD_COORDS_MAP[chave] ||
    NEIGHBORHOOD_COORDS_MAP[chave.replace(/^jardim\s+/i, "")] ||
    NEIGHBORHOOD_COORDS_MAP[chave.replace(/^bairro\s+/i, "")] ||
    NEIGHBORHOOD_COORDS_MAP[chave.replace(/^residencial\s+/i, "")];
  if (!achado) return undefined;
  if (!centroDaLoja || calculateHaversineKm(achado.lat, achado.lng, centroDaLoja.lat, centroDaLoja.lng) > RAIO_DO_DICIONARIO_KM) return undefined;
  return achado;
};

// Limpa Complementos / Referências mantendo rua, número e bairro intactos (idêntico ao Google Maps)
export const cleanAddressForGeocoding = (rawAddress: string) => {
  if (!rawAddress) return "";
  let clean = rawAddress.replace(/\s*-\s*null\s*$/gi, "").replace(/\s*-\s*undefined\s*$/gi, "").trim();
  clean = clean.replace(/[\.,\s\-]+$/, "");

  const parts = clean.split(/[-–—,]/).map(p => p.trim()).filter(Boolean);
  const cleanParts: string[] = [];

  for (const part of parts) {
    if (
      /^(ref|referencia|referência|ponto de ref|ponto de referencia|ponto de referência|comp|complemento|ao lado|proximo|próximo|prox|apto|apt|ap|bloco|bl|qd|lote|lt|fundos|frente|casa\s*\d+)/i.test(part) ||
      /^(ref|referencia|referência|comp|complemento)\s*:/i.test(part) ||
      /^ao lado d/i.test(part) ||
      /^pr[óo]ximo/i.test(part)
    ) {
      continue;
    }

    let fixedPart = part.replace(/\bn[ºo]?\s*(\d+)\b/gi, "$1");
    fixedPart = fixedPart
      .replace(/\bR\.\s*/gi, "Rua ")
      .replace(/\bAv\.\s*/gi, "Avenida ")
      .replace(/\bRes\.\s*/gi, "Residencial ")
      .replace(/\bTv\.\s*/gi, "Travessa ")
      .replace(/\bEst\.\s*/gi, "Estrada ")
      .replace(/\bPq\.\s*/gi, "Parque ");

    if (fixedPart.trim() && !/brasil|rj/i.test(fixedPart.trim())) {
      cleanParts.push(fixedPart.trim());
    }
  }

  return cleanParts.join(", ");
};


/**
 * O Photon é fuzzy de propósito (é ele que acha "Cacheoira" → "Cachoeira"),
 * mas fuzzy demais devolve OUTRA rua: "Avenida Goiás 500, Setor Central,
 * Goiânia" voltou como "Avenida Doutor Irani Alves Ferreira" (certificação
 * de 11/09/2026). Dois nomes só passam se compartilham metade dos pares de
 * letras (coeficiente de Dice em bigramas), depois de tirar acento, tipo de
 * via e pontuação. Sem nome de um dos lados, não há o que julgar: passa.
 */
export const nomeDeRuaParecido = (a: string, b: string): boolean => {
  const limpa = (t: string) =>
    (t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/^(rua|r|avenida|av|travessa|tv|trav|estrada|est|alameda|al|rodovia|rod|praca|pca|largo|beco|via|servidao) /, "")
      .replace(/ +/g, " ")
      .trim();
  const x = limpa(a);
  const y = limpa(b);
  if (!x || !y) return true;
  if (x === y) return true;
  // ── O NÚMERO E A LETRA DO CONJUNTO SÃO O NOME ──────────────────────────
  // "Quadra 15 Conjunto C" e "Quadra 3 Conjunto G" dividem quase todos os
  // pares de letras — e são quarteirões a 3 km um do outro. O Photon devolveu
  // exatamente isso para o #60 da NIK (Sobradinho, 17/10/2026), e "Rua 5" ×
  // "Rua 15" é a mesma armadilha. Com número dos DOIS lados, os números têm de
  // ser os mesmos; com conjunto dos dois lados, o mesmo conjunto. ("Rua
  // Cinco" × "Rua 5" segue a regra de sempre: só um lado tem número.)
  const numeros = (t: string) => (t.match(/\d+/g) || []).map((n) => n.replace(/^0+(?=\d)/, "")).sort().join(",");
  if (/\d/.test(x) && /\d/.test(y) && numeros(x) !== numeros(y)) return false;
  const conjunto = (t: string) => t.replace(/\b([a-z]) (\d)/g, "$1$2").match(/\b(?:conjunto|conj|cj) ([a-z]{1,2}\d{0,2}|\d{1,3})\b/)?.[1] ?? null;
  const cx = conjunto(x);
  const cy = conjunto(y);
  if (cx && cy && cx !== cy) return false;
  // ── UM NOME DENTRO DO OUTRO ────────────────────────────────────────────
  // "getulio" × "getulio vargas" é a mesma rua escrita pela metade. Mas
  // "marina" × "marina do canal palmer" não: era a "Rua Marina" do cliente do
  // Divinos (Cabo Frio, 0,2 km da loja) e o mapa achou a Rua Marina do Canal
  // Palmer a 2,9 km — a taxa saía R$ 15 em vez de R$ 5, em três pedidos
  // (04, 05 e 09/10/2026). Uma palavra só dentro de um nome com várias a mais
  // é outra rua; o resto segue para a comparação por pares de letras.
  if (x.includes(y) || y.includes(x)) {
    const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
    const palavras = (t: string) => t.split(" ").filter(Boolean).length;
    if (palavras(curto) >= 2 || palavras(longo) - palavras(curto) <= 1) return true;
  }
  const bigramas = (t: string) => {
    const s = t.replace(/ /g, "");
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const bx = bigramas(x);
  const by = bigramas(y);
  if (bx.length === 0 || by.length === 0) return x === y;
  const sobra = new Map<string, number>();
  for (const g of by) sobra.set(g, (sobra.get(g) || 0) + 1);
  let comuns = 0;
  for (const g of bx) {
    const n = sobra.get(g) || 0;
    if (n > 0) { comuns++; sobra.set(g, n - 1); }
  }
  return (2 * comuns) / (bx.length + by.length) >= 0.5;
};

export type OpcoesGeocodificador = {
  storeCity: string;
  /** UF da loja ou null (busca sem estado). Ver estadoPeloEndereco. */
  estado: string | null;
  /** Coordenada da loja: âncora do raio, do viés do Photon e do último recurso. */
  centroDaLoja: Ponto;
  /**
   * Quem dá a vez de CADA chamada ao mapa (Nominatim e Photon). No servidor é
   * a fila única do processo (lib/geocodificacao-servidor.ts), com um relógio
   * só para a roteirização, o cron e a cotação de frete: com o relógio próprio
   * daqui, a busca da taxa e a da roteirização saíam coladas (1 ms entre as
   * duas) e furavam o 1 req/s do IP do servidor. Sem isto (navegador), vale o
   * relógio local de 1,1 s.
   */
  vez?: <T>(chamada: () => Promise<T>) => Promise<T>;
  /**
   * Até onde um resultado vale (km da loja). Sem isto, 30 km — a régua antiga,
   * que deixou passar a Asa Sul (20 km) num pedido da NIK, que entrega a 7.
   * Quem conhece a área da loja passa o raio dela (lib/ponto-do-pedido.ts,
   * `areaDaLoja`): resultado além dele é descartado e a cascata segue para o
   * degrau seguinte — o bairro e, sem bairro, "não localizado".
   */
  raioMaxKm?: number;
};

/** O que a cascata conseguiu: a casa/rua, só o bairro, ou nada (o ponto é a loja). */
export type NivelDoPonto = "rua" | "bairro" | "nenhum";

/**
 * Um geocodificador por abertura do mapa: carrega o limitador de 1 chamada por
 * segundo (política do Nominatim) e o cache de centróides de bairro.
 * `geocodificarItem` devolve o ponto e de qual degrau da cascata ele veio —
 * é o que os testes e o console usam para dizer "caiu no bairro".
 */
export function criarGeocodificador(opts: OpcoesGeocodificador) {
  const { storeCity, estado } = opts;
  const defaultCenter = opts.centroDaLoja;
  const sufixoDaCidade = estado ? `${storeCity}, ${estado}, Brasil` : `${storeCity}, Brasil`;
  const raioMaxKm = Number.isFinite(opts.raioMaxKm) && (opts.raioMaxKm as number) > 0 ? (opts.raioMaxKm as number) : RAIO_MAX_DA_LOJA_KM;
  const pertoDaLoja = (lat: number, lng: number) =>
    calculateHaversineKm(lat, lng, defaultCenter.lat, defaultCenter.lng) <= raioMaxKm;

  // O ritmo vale para TODA chamada, não só entre endereços: um endereço
  // difícil dispara até 5 tentativas em sequência, e eram elas que
  // estouravam o limite mesmo com o lote devagar.
  let ultimaChamadaNominatim = 0;
  // Depois de um 429, insistir só queima o limitador de 1,1 s em chamadas que
  // vão falhar igual (até 5 por endereço). Trégua de 60 s: nesse tempo o
  // Photon responde pela rua E pelo bairro.
  let nominatimEmTreguaAte = 0;
  // Quantas buscas NÃO aconteceram (429, 5xx, tempo, fila recusou, trégua).
  // "Não achei" com o mapa falhando no meio não é "não existe": quem chama não
  // guarda esse resultado nem marca o pedido como incerto — pergunta de novo.
  let falhasDoMapa = 0;

  /** A chamada na vez dela: pela fila do servidor, quando há uma, ou pelo relógio local. */
  const naVez = async <T,>(chamada: () => Promise<T>): Promise<T> => {
    if (opts.vez) return opts.vez(chamada);
    const espera = ultimaChamadaNominatim + 1100 - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamadaNominatim = Date.now();
    return chamada();
  };

  const fetchNominatim = async (query: string) => {
    if (Date.now() < nominatimEmTreguaAte) {
      falhasDoMapa++;
      return null;
    }
    try {
      // Duas formas de perguntar: texto solto (q=) ou campos estruturados
      // (street=/city=/…, marcados com __params=1). A estruturada acerta
      // rua onde o texto solto falha, porque o Nominatim não precisa
      // adivinhar o que é rua, o que é bairro e o que é cidade.
      const ehEstruturada = query.includes("__params=1");
      // `namedetails`: os OUTROS nomes da rua (alt_name, old_name…). A "Rua
      // Adonias Lucas Martins" de Macaé é a "Rua Cinco" do cliente (alt_name);
      // a Travessa Liberdade da Divinos é a Rua Beira Alta. Sem eles, a regra
      // "a rua achada tem de ser a escrita" recusaria a rua certa.
      const url = ehEstruturada
        ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&namedetails=1&${query.replace("&__params=1", "")}`
        : `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1&namedetails=1`;
      const res = await naVez(() => fetch(
        url,
        { headers: { "User-Agent": "FireHub-Roteirizacao/2.0" }, signal: AbortSignal.timeout(5000) }
      ));
      if (!res.ok) {
        // 429 é o Nominatim limitando o IP — acontece de verdade (26/08/2026
        // numa loja; na certificação de 11/09 depois de ~170 buscas). Antes
        // morria em silêncio; agora fica no console e o Photon assume até o
        // centróide do bairro (ver obterCentroide).
        console.warn(`[Geocodificação] Nominatim respondeu ${res.status} para "${query.slice(0, 80)}"`);
        if (res.status === 429 || res.status >= 500) nominatimEmTreguaAte = Date.now() + 60_000;
        falhasDoMapa++;
        return null;
      }
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        // FILTRO ANTI-MAR: Se o Nominatim retornar uma coordenada no oceano, ignora!
        if (!isPointInSea(lat, lng) && pertoDaLoja(lat, lng)) {
          // O bairro que o OSM diz que aquele ponto está. É o que deixa
          // conferir o NOME do bairro, e não só a distância.
          const a = data[0].address || {};
          const bairro = a.suburb || a.neighbourhood || a.city_district || a.quarter || a.residential || a.village || "";
          // Todos os níveis de bairro do ponto, do menor ao maior. No DF o
          // `suburb` é a vila ("Vila Dnocs") e o bairro dos Correios é a
          // região administrativa ("Sobradinho", que o OSM põe em `town`):
          // conferir só o primeiro recusava a rua certa (NIK, 14/10/2026).
          // `city` fica de fora: é o município, não bairro.
          const bairros = [a.neighbourhood, a.residential, a.quarter, a.suburb, a.city_district, a.borough, a.village, a.town]
            .filter((v: unknown) => typeof v === "string" && v.trim()) as string[];
          // O que o ponto É (rua, área, comércio…) e o nome dele: é o que
          // separa o BAIRRO de uma rua ou de um prédio que só tem o nome
          // parecido (ver `ehOBairro`).
          const d = data[0];
          const classe = String(d.class ?? d.category ?? "");
          const nome = String(d.name ?? "");
          const rua = String(a.road || a.pedestrian || a.footway || (classe === "highway" ? nome : "") || "");
          // Todos os nomes da RUA achada: o do endereço e, quando o próprio
          // resultado é a rua, os apelidos dela no OSM ("A;B" vira dois).
          const outrosNomes =
            classe === "highway" && d.namedetails && typeof d.namedetails === "object"
              ? Object.entries(d.namedetails as Record<string, unknown>)
                  .filter(([k]) => /^(name|alt_name|old_name|official_name|short_name|loc_name|reg_name|nat_name)(:pt)?$/.test(k))
                  .flatMap(([, v]) => String(v || "").split(";"))
              : [];
          const ruas = [...new Set([rua, ...outrosNomes].map((n) => n.trim()).filter(Boolean))];
          return {
            lat, lng, bairro: String(bairro), bairros,
            classe, tipo: String(d.type ?? ""), tipoDeEndereco: String(d.addresstype ?? ""), nome, rua, ruas,
            cep: String(a.postcode ?? "").replace(/\D/g, ""),
          };
        }
      }
    } catch (e: any) {
      falhasDoMapa++;
      console.warn(`[Geocodificação] Nominatim falhou para "${query.slice(0, 80)}": ${e?.name === "TimeoutError" ? "tempo esgotado" : e?.message}`);
    }
    return null;
  };

  // ── PHOTON: o geocodificador que perdoa erro de digitação ───────────
  //
  // O Nominatim exige a grafia exata: "Rua Cacheoira de Macacu" (digitada
  // errada pelo cliente) não acha "Cachoeira de Macacu" nunca. O Photon
  // (photon.komoot.io, gratuito, mesma base OSM) faz busca FUZZY — é o que
  // dá ao mapa a tolerância do Google que a "motinha" usa. Entra depois
  // das tentativas exatas e antes de desistir para o bairro, com a mesma
  // validação anti-homônimo. O `lat/lon` de viés puxa os resultados para
  // perto da loja.
  const fetchPhoton = async (query: string) => {
    try {
      const res = await naVez(() => fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=default&lat=${defaultCenter.lat}&lon=${defaultCenter.lng}`,
        { signal: AbortSignal.timeout(5000) }
      ));
      if (res.ok) {
        const data = await res.json();
        const f = data?.features?.[0];
        if (f?.geometry?.coordinates?.length === 2) {
          const lat = f.geometry.coordinates[1];
          const lng = f.geometry.coordinates[0];
          if (!isPointInSea(lat, lng) && pertoDaLoja(lat, lng)) return { lat, lng, bairro: String(f.properties?.district || f.properties?.locality || ""), nome: String(f.properties?.name || f.properties?.street || "") };
        }
      } else {
        falhasDoMapa++;
      }
    } catch {
      falhasDoMapa++;
    }
    return null;
  };

  // ── CENTRÓIDE DO BAIRRO ────────────────────────────────────────────
  // O centróide não serve só de chute inicial: ele é o VALIDADOR. Um
  // resultado do Nominatim a mais de 2,8 km dele é descartado (regra
  // anti-homônimo: "Avenida das Flores" existe no Praia Âncora E no
  // Village). Com centróide errado, o sistema rejeitava justamente a
  // resposta certa e caía no ponto errado.
  //
  // Auditoria contra o OpenStreetMap: 19 dos 42 bairros do dicionário
  // divergiam mais de 1 km (Verdes Mares 6,07 km; Bosque da Praia 5,02;
  // Âncora 4,44). Por isso o centróide passa a vir do próprio OSM — a
  // mesma fonte da busca, então validador e resultado ficam coerentes.
  // O dicionário continua como rede de segurança para quando o serviço
  // não responde (fora do ar, sem internet, IP bloqueado).
  // Guarda a PROMESSA, não o resultado: quatro pedidos do mesmo bairro no
  // mesmo lote pediriam o centróide quatro vezes em paralelo, porque
  // nenhum teria preenchido o cache ainda quando os outros consultam.
  // ── PRIMEIRO O NOME DO BAIRRO, DEPOIS A RUA ──────────────────────
  // Regra pedida pelo dono (10/09/2026): conferir o bairro antes da rua.
  // O geocodificador devolve em que bairro o ponto está; se o pedido diz
  // "Alcantara" e o ponto está em "Centro", a rua é homônima de outro
  // lugar e não serve — mesmo que passe na régua de distância, que num
  // município grande (São Gonçalo tem 250 km²) é folgada demais. Sem
  // bairro no resultado, a distância ao centróide continua decidindo.
  const normalizaBairro = nomeDeBairroComparavel;
  const bairroConfere = (res: { bairro?: string; bairros?: string[] } | null, esperado: string) => {
    if (!res || !esperado || !res.bairro) return true;
    const bs = variantesDoBairro(esperado);
    if (bs.length === 0) return true;
    const confere = (nome: string) => {
      const a = normalizaBairro(nome);
      return !a || bs.some((b) => a === b || a.includes(b) || b.includes(a));
    };
    return confere(res.bairro) || (res.bairros || []).some(confere);
  };

  // ── O CENTRO DO BAIRRO TEM DE SER O BAIRRO ─────────────────────────────
  //
  // A busca "<bairro>, <cidade>" devolve o que o mapa acha com aquele nome —
  // e nem sempre é o bairro. Com o bairro lido errado ("Brasília/DF", NIK,
  // 16/10/2026) voltou o "Instituto de Arquitetos de Brasília", um terreno
  // comercial na Asa Sul; com bairro que o OSM não conhece volta a RUA de
  // mesmo nome em outro bairro (Deeds, "Milton Gavetti"). Esse ponto virava o
  // centro do bairro, o validador das ruas (2,8 km) e, por fim, o pino.
  // Agora só vale um LUGAR (bairro, conjunto, região, loteamento) com o NOME
  // escrito — o mesmo cuidado que `buscarBairro` (lib/geocoding.ts) já tinha.
  const nomeBate = (nome: string, esperado: string) => {
    const a = normalizaBairro(nome);
    if (!a) return false;
    return variantesDoBairro(esperado).some((b) => a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `));
  };
  const TIPOS_DE_BAIRRO = new Set([
    "suburb", "neighbourhood", "quarter", "city_district", "borough", "residential", "town", "village",
    "hamlet", "isolated_dwelling", "locality", "district", "city_block", "allotments",
  ]);
  const ehOBairro = (
    res: { classe?: string; tipo?: string; tipoDeEndereco?: string; nome?: string; bairro?: string; bairros?: string[] } | null,
    esperado: string,
  ) => {
    if (!res) return false;
    const ehArea =
      res.classe === "place" ||
      res.classe === "boundary" ||
      (res.classe === "landuse" && res.tipo === "residential") ||
      TIPOS_DE_BAIRRO.has(String(res.tipoDeEndereco || ""));
    if (!ehArea) return false;
    return nomeBate(res.nome || "", esperado) || [res.bairro || "", ...(res.bairros || [])].some((n) => nomeBate(n, esperado));
  };

  /**
   * O bairro como LUGAR no Photon (place:suburb / neighbourhood / quarter),
   * com viés para a loja. É a segunda fonte do centróide: no dia em que o
   * Nominatim limita o IP da loja, é isto que mantém a regra "não achou a
   * rua, fica no bairro" em vez de jogar o pino na loja.
   */
  const fetchPhotonBairro = async (bairro: string) => {
    try {
      const url =
        `https://photon.komoot.io/api/?q=${encodeURIComponent(`${bairro}, ${storeCity}`)}&limit=5&lang=default` +
        `&lat=${defaultCenter.lat}&lon=${defaultCenter.lng}` +
        `&osm_tag=place:suburb&osm_tag=place:neighbourhood&osm_tag=place:quarter&osm_tag=place:city_district&osm_tag=place:village&osm_tag=boundary:administrative`;
      const res = await naVez(() => fetch(url, { signal: AbortSignal.timeout(5000) }));
      if (!res.ok) {
        falhasDoMapa++;
        return null;
      }
      const data = await res.json();
      for (const f of data?.features || []) {
        const nome = String(f?.properties?.name || "");
        const par = f?.geometry?.coordinates || [];
        const lng = Number(par[0]);
        const lat = Number(par[1]);
        if (!normalizaBairro(nome) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        // Tem que ser o bairro pedido (ou conter o nome), em terra e perto da loja.
        if (!nomeBate(nome, bairro)) continue;
        if (isPointInSea(lat, lng) || !pertoDaLoja(lat, lng)) continue;
        return { lat, lng, bairro: nome };
      }
    } catch {
      falhasDoMapa++;
    }
    return null;
  };

  type Centroide = { lat: number; lng: number; de: "osm" | "photon" | "dicionario" };
  const centroidesDoBairro: Record<string, Promise<Centroide | null>> = {};

  const obterCentroide = async (
    bairro: string,
    doDicionario?: { lat: number; lng: number }
  ): Promise<Centroide | undefined> => {
    // O dicionário de Rio das Ostras também passa pela régua da loja.
    const dicionario: Centroide | undefined =
      doDicionario && pertoDaLoja(doDicionario.lat, doDicionario.lng) ? { ...doDicionario, de: "dicionario" } : undefined;
    const chave = bairro.toLowerCase().trim();
    if (!chave) return dicionario;
    if (!(chave in centroidesDoBairro)) {
      // Nominatim primeiro; falhou (429, fora do ar, bairro ausente, ou o que
      // voltou não é o bairro), o Photon procura o MESMO bairro como lugar.
      const falhasAntes = falhasDoMapa;
      const promessa = (async (): Promise<Centroide | null> => {
        const n = await fetchNominatim(`${bairro}, ${sufixoDaCidade}`);
        if (n && ehOBairro(n, bairro)) return { lat: n.lat, lng: n.lng, de: "osm" };
        const p = await fetchPhotonBairro(bairro);
        return p ? { lat: p.lat, lng: p.lng, de: "photon" } : null;
      })();
      centroidesDoBairro[chave] = promessa;
      // "Não achei" com o mapa falhando não fica guardado: o próximo endereço
      // do mesmo bairro pergunta de novo.
      promessa.then((c) => {
        if (!c && falhasDoMapa > falhasAntes && centroidesDoBairro[chave] === promessa) delete centroidesDoBairro[chave];
      }).catch(() => undefined);
    }
    const achado = await centroidesDoBairro[chave];
    return achado || dicionario;
  };


  const geocodificarItem = async (
    item: ItemGeocodificavel,
  ): Promise<{ coords: Ponto; origem: string; nivel: NivelDoPonto; mapaFalhou: boolean }> => {
    let coords: { lat: number; lng: number } | null = null;
    let origem = "";
    let nivel: NivelDoPonto = "rua";
    const falhasAntes = falhasDoMapa;
    const bCentroid = await obterCentroide(item.neighborhood, item.dictFallback);

    // ── A RUA ACHADA TEM DE SER A RUA ESCRITA ─────────────────────────────
    // A distância ao centro do bairro (2,8 km) não basta: a NIK pediu
    // "Avenida central conjunto 02" e a busca solta devolveu a Avenida
    // Paranoá, a 14 km (sem centro de bairro para conferir); "QMS 16" voltou
    // "QMS 39A", outra quadra do mesmo setor. Rua de nome diferente do escrito
    // não é a rua — o pedido desce para o centro do bairro, marcado como
    // aproximado, em vez de fingir que achou a porta. Vale qualquer nome da
    // rua no OSM (alt_name/old_name: "Rua Cinco" = Rua Adonias Lucas Martins,
    // Macaé). Resultado sem nome de rua (um prédio, um lugar) só vale com o
    // bairro para garantir.
    const ruaConfere = (res: { rua?: string; ruas?: string[] } | null) => {
      if (!res) return false;
      if (!item.streetName) return true;
      const nomes = res.ruas && res.ruas.length > 0 ? res.ruas : res.rua ? [res.rua] : [];
      if (nomes.length > 0) return nomes.some((n) => nomeDeRuaParecido(n, item.streetName));
      return !!bCentroid;
    };

    // ── O CEP DO MESMO SETOR VALE MAIS QUE A RÉGUA DO CENTRO DO BAIRRO ─────
    // O "bairro" dos Correios em Brasília é a região inteira: "Sobradinho" tem
    // 5 km de ponta a ponta e o centro dele, no OSM, fica do lado leste. A
    // Quadra 3 Conjunto G, achada certinha pelo mapa (OSM: CEP 73030-035), está
    // a 2,95 km desse centro — a régua dos 2,8 km a recusava, e o pino ia para
    // a Quadra 15 pelo Photon (#60 da NIK, 17/10/2026). Quando o ponto achado
    // tem no OSM o CEP do mesmo setor do endereço (os 5 primeiros dígitos), a
    // rua homônima de outro lugar está descartada: a régua dos 2,8 km não vale.
    // Só soma: CEP diferente ou ausente no OSM segue a régua de sempre.
    const cepDoItem = String(item.cep ?? "").replace(/\D/g, "");
    const cepConfere = (res: { cep?: string } | null) =>
      !!res && cepDoItem.length === 8 && String(res.cep || "").length === 8 && res.cep!.slice(0, 5) === cepDoItem.slice(0, 5);
    const pertoDoCentro = (res: { lat: number; lng: number; cep?: string }) =>
      !bCentroid || calculateHaversineKm(res.lat, res.lng, bCentroid.lat, bCentroid.lng) <= 2.8 || cepConfere(res);

    // ── REGRA DE OURO: PRIMEIRO O BAIRRO, DEPOIS A RUA NO BAIRRO (Anti-Homônimos) ──
    // Em cidades como Rio das Ostras, existem várias "Rua Três", "Rua A", etc. em bairros distintos.
    // Por isso, a busca OBRIGATORIAMENTE ancora no BAIRRO e valida proximidade (< 2.5km do centróide do bairro).

    // 0. Busca ESTRUTURADA (street=/city=): o Nominatim resolve muito
    // melhor quando cada campo vai no lugar certo do que adivinhando a
    // gramática de um texto solto — é a diferença entre achar a "Rua
    // da Fonte" e cair no centróide do bairro. A validação pelo
    // centróide continua valendo: rua homônima de outro bairro é
    // descartada igual.
    if (item.streetName) {
      const ruaComNumero = item.houseNumber ? `${item.houseNumber} ${item.streetName}` : item.streetName;
      const res0 = await fetchNominatim(
        `street=${encodeURIComponent(ruaComNumero)}&city=${encodeURIComponent(storeCity)}${estado ? `&state=${estado}` : ""}&country=Brasil&countrycodes=br&__params=1`
      );
      if (res0 && bairroConfere(res0, item.neighborhood) && ruaConfere(res0) && pertoDoCentro(res0)) {
        coords = res0; origem = "rua (busca estruturada)";
      }
    }

    // 1. Tentativa 1: Rua + Número + Bairro + Cidade (Ponto exato no bairro certo)
    if (!coords && item.streetName && item.houseNumber && item.neighborhood) {
      const query1 = `${item.streetName}, ${item.houseNumber}, ${item.neighborhood}, ${sufixoDaCidade}`;
      const res1 = await fetchNominatim(query1);
      if (res1 && bairroConfere(res1, item.neighborhood) && ruaConfere(res1)) {
        // Se temos o centróide do bairro de referência, valida se a rua retornada não é em outro bairro homônimo
        if (pertoDoCentro(res1)) {
          coords = res1; origem = "rua + número + bairro";
        }
      }
    }

    // 2. Tentativa 2: Rua + Bairro + Cidade (SEM número predial, mas estritamente dentro do bairro correto)
    if (!coords && item.streetName && item.neighborhood) {
      const query2 = `${item.streetName}, ${item.neighborhood}, ${sufixoDaCidade}`;
      const res2 = await fetchNominatim(query2);
      if (res2 && bairroConfere(res2, item.neighborhood) && ruaConfere(res2)) {
        if (pertoDoCentro(res2)) {
          coords = res2; origem = "rua + bairro";
        }
      }
    }

    // 3. Tentativa 3: Endereço Limpo Completo com Bairro
    if (!coords && item.cleanedStreet && item.neighborhood) {
      const query3 = item.cleanedStreet.toLowerCase().includes(item.neighborhood.toLowerCase())
        ? `${item.cleanedStreet}, ${sufixoDaCidade}`
        : `${item.cleanedStreet}, ${item.neighborhood}, ${sufixoDaCidade}`;
      const res3 = await fetchNominatim(query3);
      if (res3 && bairroConfere(res3, item.neighborhood) && ruaConfere(res3)) {
        if (pertoDoCentro(res3)) {
          coords = res3; origem = "endereço limpo";
        }
      }
    }

    // 3.5. PHOTON (busca fuzzy): pega a rua digitada com erro
    // ("cacheoira" → "Cachoeira") que as tentativas exatas perderam.
    // Validação dupla: perto do centróide do bairro quando ele existe,
    // e nunca a mais de 15 km da loja — resultado solto de outra
    // cidade não entra.
    if (!coords && item.streetName) {
      const resF = await fetchPhoton(
        `${item.streetName}${item.houseNumber ? ` ${item.houseNumber}` : ""}, ${item.neighborhood || ""}, ${storeCity}`
      );
      if (resF && bairroConfere(resF, item.neighborhood) && nomeDeRuaParecido(resF.nome, item.streetName)) {
        const pertoDoBairro = !bCentroid || calculateHaversineKm(resF.lat, resF.lng, bCentroid.lat, bCentroid.lng) <= 2.8;
        const pertoDaLoja = calculateHaversineKm(resF.lat, resF.lng, defaultCenter.lat, defaultCenter.lng) <= 15;
        if (pertoDoBairro && pertoDaLoja) {
          coords = resF; origem = "rua (Photon, grafia aproximada)";
        }
      }
    }

    // 4 e 5. A rua não está no mapa: o CENTRO DO BAIRRO — o que
    // `obterCentroide` confirmou ser o bairro escrito (OSM na frente, Photon e
    // o dicionário de Rio das Ostras atrás). Era aqui que a busca do bairro
    // sozinho aceitava qualquer coisa: "Brasília/DF" → Asa Sul (NIK, 16/10).
    if (!coords && bCentroid) {
      coords = { lat: bCentroid.lat, lng: bCentroid.lng };
      origem = bCentroid.de === "osm" ? "bairro (OSM)" : bCentroid.de === "photon" ? "centróide do bairro" : "dicionário de bairros";
      nivel = "bairro";
    }

    // 6. Nada: o ponto da loja, marcado. Quem desenha ou mede NÃO usa este
    // ponto — a roteirização lista o pedido como "localização incerta" e o
    // cron deixa a distância em branco (`nivel` "nenhum").
    if (!coords) {
      coords = {
        lat: defaultCenter.lat + ((item.idx % 5) - 2) * 0.002,
        lng: defaultCenter.lng + (Math.floor(item.idx / 5) - 2) * 0.002,
      };
      origem = "loja (endereço não localizado)";
      nivel = "nenhum";
    }

    // Garante 100% que o ponto final não cai no oceano!
    if (isPointInSea(coords.lat, coords.lng)) {
      const dicionario = item.dictFallback && pertoDaLoja(item.dictFallback.lat, item.dictFallback.lng) ? item.dictFallback : null;
      coords = dicionario || defaultCenter;
      origem += " → caiu no mar → " + (dicionario ? "dicionário" : "loja");
      nivel = dicionario ? "bairro" : "nenhum";
    }

    return { coords, origem, nivel, mapaFalhou: falhasDoMapa > falhasAntes };
  };

  return { geocodificarItem, fetchNominatim, fetchPhoton, obterCentroide, bairroConfere };
}
