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
  const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const cidadeDaLoja = semAcento(storeCity || "");
  const ehCidadeOuEstado = (p: string) => {
    const n = semAcento(p);
    if (!n) return true;
    if (cidadeDaLoja && (n === cidadeDaLoja || n.startsWith(cidadeDaLoja + " ") || n.endsWith(" " + cidadeDaLoja))) return true;
    // "01310-100" vira "01310" e "100" na quebra por hífen; número não é bairro.
    if (/^[0-9 ]+$/.test(n)) return true;
    if (/^(rj|sp|mg|es|br|brasil|rio de janeiro|sao paulo|minas gerais|espirito santo)$/.test(n)) return true;
    return /\bcep\b/.test(n) || /^\d{5}-?\d{3}$/.test(n);
  };

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
      if (candidate.length > 2 && candidate.toLowerCase() !== "asil" && !/brasil|rio das ostras|cabo frio|macae|macaé|rj/i.test(candidate) && !ehCidadeOuEstado(candidate)) {
        neighborhood = candidate;
      }
    }
  }

  // 3. Se ainda não achou e o endereço tem partes divididas por "-" ou ","
  if (!neighborhood) {
    const parts = fullAddress.split(/\s*-\s*|\s*,\s*/);
    if (parts.length >= 2) {
      const filteredParts = parts.filter(p => !/rio das ostras|cabo frio|unamar|macaé|macae|rj|brasil|asil/i.test(p.trim()) && !ehCidadeOuEstado(p.trim()));
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
  if (x === y || x.includes(y) || y.includes(x)) return true;
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
};

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
  const pertoDaLoja = (lat: number, lng: number) =>
    calculateHaversineKm(lat, lng, defaultCenter.lat, defaultCenter.lng) <= RAIO_MAX_DA_LOJA_KM;

  // O ritmo vale para TODA chamada, não só entre endereços: um endereço
  // difícil dispara até 5 tentativas em sequência, e eram elas que
  // estouravam o limite mesmo com o lote devagar.
  let ultimaChamadaNominatim = 0;
  // Depois de um 429, insistir só queima o limitador de 1,1 s em chamadas que
  // vão falhar igual (até 5 por endereço). Trégua de 60 s: nesse tempo o
  // Photon responde pela rua E pelo bairro.
  let nominatimEmTreguaAte = 0;

  const fetchNominatim = async (query: string) => {
    if (Date.now() < nominatimEmTreguaAte) return null;
    try {
      const espera = ultimaChamadaNominatim + 1100 - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      ultimaChamadaNominatim = Date.now();
      // Duas formas de perguntar: texto solto (q=) ou campos estruturados
      // (street=/city=/…, marcados com __params=1). A estruturada acerta
      // rua onde o texto solto falha, porque o Nominatim não precisa
      // adivinhar o que é rua, o que é bairro e o que é cidade.
      const ehEstruturada = query.includes("__params=1");
      const url = ehEstruturada
        ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&${query.replace("&__params=1", "")}`
        : `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
      const res = await fetch(
        url,
        { headers: { "User-Agent": "FireHub-Roteirizacao/2.0" }, signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) {
        // 429 é o Nominatim limitando o IP — acontece de verdade (26/08/2026
        // numa loja; na certificação de 11/09 depois de ~170 buscas). Antes
        // morria em silêncio; agora fica no console e o Photon assume até o
        // centróide do bairro (ver obterCentroide).
        console.warn(`[Geocodificação] Nominatim respondeu ${res.status} para "${query.slice(0, 80)}"`);
        if (res.status === 429 || res.status >= 500) nominatimEmTreguaAte = Date.now() + 60_000;
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
          return { lat, lng, bairro: String(bairro) };
        }
      }
    } catch (e: any) {
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
      const espera = ultimaChamadaNominatim + 1100 - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      ultimaChamadaNominatim = Date.now();
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=default&lat=${defaultCenter.lat}&lon=${defaultCenter.lng}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        const f = data?.features?.[0];
        if (f?.geometry?.coordinates?.length === 2) {
          const lat = f.geometry.coordinates[1];
          const lng = f.geometry.coordinates[0];
          if (!isPointInSea(lat, lng) && pertoDaLoja(lat, lng)) return { lat, lng, bairro: String(f.properties?.district || f.properties?.locality || ""), nome: String(f.properties?.name || f.properties?.street || "") };
        }
      }
    } catch {}
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
  const normalizaBairro = (t: string) =>
    (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/^(bairro|jardim|jd|residencial|res|parque|pq|vila|vl)\s+/, "").trim();
  const bairroConfere = (res: { bairro?: string } | null, esperado: string) => {
    if (!res || !esperado || !res.bairro) return true;
    const a = normalizaBairro(res.bairro);
    const b = normalizaBairro(esperado);
    if (!a || !b) return true;
    return a === b || a.includes(b) || b.includes(a);
  };

  /**
   * O bairro como LUGAR no Photon (place:suburb / neighbourhood / quarter),
   * com viés para a loja. É a segunda fonte do centróide: no dia em que o
   * Nominatim limita o IP da loja, é isto que mantém a regra "não achou a
   * rua, fica no bairro" em vez de jogar o pino na loja.
   */
  const fetchPhotonBairro = async (bairro: string) => {
    try {
      const espera = ultimaChamadaNominatim + 1100 - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      ultimaChamadaNominatim = Date.now();
      const url =
        `https://photon.komoot.io/api/?q=${encodeURIComponent(`${bairro}, ${storeCity}`)}&limit=5&lang=default` +
        `&lat=${defaultCenter.lat}&lon=${defaultCenter.lng}` +
        `&osm_tag=place:suburb&osm_tag=place:neighbourhood&osm_tag=place:quarter&osm_tag=place:city_district&osm_tag=place:village&osm_tag=boundary:administrative`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      const alvo = normalizaBairro(bairro);
      for (const f of data?.features || []) {
        const nome = normalizaBairro(String(f?.properties?.name || ""));
        const par = f?.geometry?.coordinates || [];
        const lng = Number(par[0]);
        const lat = Number(par[1]);
        if (!nome || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        // Tem que ser o bairro pedido (ou conter o nome), em terra e perto da loja.
        if (!(nome === alvo || nome.includes(alvo) || alvo.includes(nome))) continue;
        if (isPointInSea(lat, lng) || !pertoDaLoja(lat, lng)) continue;
        return { lat, lng, bairro: String(f.properties.name) };
      }
    } catch {}
    return null;
  };

  const centroidesDoBairro: Record<string, Promise<{ lat: number; lng: number } | null>> = {};

  const obterCentroide = async (
    bairro: string,
    doDicionario?: { lat: number; lng: number }
  ): Promise<{ lat: number; lng: number } | undefined> => {
    const chave = bairro.toLowerCase().trim();
    if (!chave) return doDicionario;
    if (!(chave in centroidesDoBairro)) {
      // Nominatim primeiro; falhou (429, fora do ar, bairro ausente), o Photon
      // procura o MESMO bairro como lugar.
      centroidesDoBairro[chave] = (async () => {
        const n = await fetchNominatim(`${bairro}, ${sufixoDaCidade}`);
        if (n) return n;
        return fetchPhotonBairro(bairro);
      })();
    }
    const achado = await centroidesDoBairro[chave];
    return achado || doDicionario;
  };


  const geocodificarItem = async (item: ItemGeocodificavel): Promise<{ coords: Ponto; origem: string }> => {
    let coords: { lat: number; lng: number } | null = null;
    let origem = "";
    const bCentroid = await obterCentroide(item.neighborhood, item.dictFallback);

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
      if (res0 && bairroConfere(res0, item.neighborhood) && (!bCentroid || calculateHaversineKm(res0.lat, res0.lng, bCentroid.lat, bCentroid.lng) <= 2.8)) {
        coords = res0; origem = "rua (busca estruturada)";
      }
    }

    // 1. Tentativa 1: Rua + Número + Bairro + Cidade (Ponto exato no bairro certo)
    if (!coords && item.streetName && item.houseNumber && item.neighborhood) {
      const query1 = `${item.streetName}, ${item.houseNumber}, ${item.neighborhood}, ${sufixoDaCidade}`;
      const res1 = await fetchNominatim(query1);
      if (res1 && bairroConfere(res1, item.neighborhood)) {
        // Se temos o centróide do bairro de referência, valida se a rua retornada não é em outro bairro homônimo
        if (!bCentroid || calculateHaversineKm(res1.lat, res1.lng, bCentroid.lat, bCentroid.lng) <= 2.8) {
          coords = res1; origem = "rua + número + bairro";
        }
      }
    }

    // 2. Tentativa 2: Rua + Bairro + Cidade (SEM número predial, mas estritamente dentro do bairro correto)
    if (!coords && item.streetName && item.neighborhood) {
      const query2 = `${item.streetName}, ${item.neighborhood}, ${sufixoDaCidade}`;
      const res2 = await fetchNominatim(query2);
      if (res2 && bairroConfere(res2, item.neighborhood)) {
        if (!bCentroid || calculateHaversineKm(res2.lat, res2.lng, bCentroid.lat, bCentroid.lng) <= 2.8) {
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
      if (res3 && bairroConfere(res3, item.neighborhood)) {
        if (!bCentroid || calculateHaversineKm(res3.lat, res3.lng, bCentroid.lat, bCentroid.lng) <= 2.8) {
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

    // 4. Tentativa 4: Bairro isolado no Nominatim (se a rua não existir na base cartográfica)
    if (!coords && item.neighborhood) {
      const query4 = `${item.neighborhood}, ${sufixoDaCidade}`;
      coords = await fetchNominatim(query4);
      if (coords) origem = "bairro (OSM)";
    }

    // 5. Fallback: centróide do bairro (OSM na frente, dicionário atrás).
    if (!coords && (bCentroid || item.dictFallback)) {
      coords = bCentroid || item.dictFallback!;
      origem = bCentroid ? "centróide do bairro" : "dicionário de bairros";
    }

    // 6. Fallback 6: Centro da Cidade com Jitter
    if (!coords) {
      coords = {
        lat: defaultCenter.lat + ((item.idx % 5) - 2) * 0.002,
        lng: defaultCenter.lng + (Math.floor(item.idx / 5) - 2) * 0.002,
      };
      origem = "loja (endereço não localizado)";
    }

    // Garante 100% que o ponto final não cai no oceano!
    if (isPointInSea(coords.lat, coords.lng)) {
      coords = item.dictFallback || defaultCenter;
      origem += " → caiu no mar → " + (item.dictFallback ? "dicionário" : "loja");
    }

    return { coords, origem };
  };

  return { geocodificarItem, fetchNominatim, fetchPhoton, obterCentroide, bairroConfere };
}
