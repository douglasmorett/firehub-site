/**
 * /src/lib/bairro-dos-correios.ts
 *
 * O bairro com o nome que a cidade usa, não o do OpenStreetMap.
 *
 * ── O defeito ───────────────────────────────────────────────────────────────
 *
 * Divinos Burger (Cabo Frio, 03/10/2026): o OSM chama de "Vila Monte Alegre",
 * "Vila Boca do Mato", "Vila Jardim Esperança" o que os Correios e todo cliente
 * chamam de Monte Alegre, Boca do Mato, Jardim Esperança. O robô recebia o
 * endereço que o mapa achou em texto cru ("Rua do Ouro, Vila Monte Alegre,
 * Cabo Frio, Região Geográfica…, Região Sudeste, 28922-000, Brasil") e o
 * endereço da loja gravado do mesmo jeito, e escrevia "Vila Monte Alegre" no
 * resumo e no pedido — o cliente que mandou só "rua do ouro 18" recebia um
 * bairro que não reconhece, e o lojista via o mapa "errado".
 *
 * A COMPARAÇÃO já ignorava o prefixo (`nomeDeBairro` em lib/geocoding.ts);
 * o que faltava era o nome ESCRITO.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * Pergunta aos Correios (ViaCEP, busca por rua) qual é o bairro daquela rua
 * naquela cidade. Só troca quando a rua tem UM bairro lá e ele é o MESMO do
 * mapa tirando o prefixo ("Vila", "Jardim"…). Bairro diferente, rua em vários
 * bairros, Correios fora do ar: o texto fica como veio. Também tira do texto os
 * pedaços que só confundem quem lê ("Região Geográfica…", "Região Sudeste",
 * "Brasil").
 */

const UF_DO_ESTADO: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

const PREFIXO = /^(bairro|vila|vl|jardim|jd|parque|pq|residencial|res|conjunto|conj|loteamento|lot|nucleo|setor)\s+/;
const COMECO_DE_RUA = /^(rua|r|avenida|av|travessa|tv|estrada|estr|alameda|al|praca|beco|rodovia|rod|via|largo|servidao|ladeira|viela|caminho|passagem)\b/;

function normal(t: string): string {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * "Vila Monte Alegre" e "Monte Alegre" são o mesmo bairro; "Monte Alegre" e
 * "Monte Alto", não. O prefixo a mais sai de UM lado só: "Jardim Esperança" e
 * "Vila Esperança" podem ser dois bairros da mesma cidade.
 */
export function mesmoBairroSemPrefixo(a: string, b: string): boolean {
  const x = normal(a);
  const y = normal(b);
  if (!x || !y) return false;
  return x === y || x.replace(PREFIXO, "") === y || y.replace(PREFIXO, "") === x;
}

export type PartesDoTextoDoMapa = { pedacos: string[]; rua: number; bairro: number; cidade: string; uf: string | null };

/**
 * Lê o display_name do Nominatim: onde está a rua, o bairro (o pedaço logo
 * depois da rua, se não for a cidade) e a UF. Sem rua reconhecível, `rua` = -1.
 */
export function lerTextoDoMapa(texto: string, cidadeDaLoja?: string | null): PartesDoTextoDoMapa {
  const pedacos = String(texto || "").split(",").map((p) => p.trim()).filter(Boolean)
    .filter((p) => !/^regi[aã]o\b/i.test(p) && !/^brasil$/i.test(p));
  const rua = pedacos.findIndex((p) => COMECO_DE_RUA.test(normal(p)));
  let uf: string | null = null;
  for (const p of pedacos) {
    const n = normal(p);
    if (UF_DO_ESTADO[n]) uf = UF_DO_ESTADO[n];
    else if (/^[a-z]{2}$/.test(n) && Object.values(UF_DO_ESTADO).includes(n.toUpperCase())) uf = n.toUpperCase();
  }
  const cidadeN = normal(cidadeDaLoja || "");
  let bairro = -1;
  if (rua >= 0 && rua + 1 < pedacos.length) {
    const candidato = pedacos[rua + 1];
    const n = normal(candidato);
    const ehCidade = !!cidadeN && n === cidadeN;
    if (!ehCidade && !/^\d/.test(n) && !UF_DO_ESTADO[n]) bairro = rua + 1;
  }
  // A cidade: o pedaço depois do bairro (o endereço pode ser na cidade
  // vizinha); sem ele, a da loja.
  const depois = bairro >= 0 ? pedacos[bairro + 1] : undefined;
  const cidade = (depois && !/^\d/.test(depois) ? depois : "") || cidadeDaLoja || "";
  return { pedacos, rua, bairro, cidade, uf };
}

const cache = new Map<string, { bairro: string | null; em: number }>();
const VALIDADE_MS = 24 * 60 * 60_000;

/**
 * O bairro da rua para os Correios — só quando a rua tem um bairro só naquela
 * cidade. null em qualquer dúvida (inclusive ViaCEP fora do ar).
 */
export async function bairroDaRuaNosCorreios(
  rua: string,
  cidade: string,
  uf: string,
  opcoes: { fetch?: typeof fetch; prazoMs?: number } = {},
): Promise<string | null> {
  const ruaLimpa = String(rua || "").trim();
  const cidadeLimpa = String(cidade || "").trim();
  if (ruaLimpa.length < 3 || !cidadeLimpa || !/^[A-Z]{2}$/.test(uf || "")) return null;
  const chave = `${uf}|${normal(cidadeLimpa)}|${normal(ruaLimpa)}`;
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.bairro;

  const f = opcoes.fetch ?? fetch;
  let bairro: string | null = null;
  try {
    const url = `https://viacep.com.br/ws/${uf}/${encodeURIComponent(cidadeLimpa)}/${encodeURIComponent(ruaLimpa)}/json/`;
    // Navegador antigo não tem AbortSignal.timeout: aí vai sem prazo.
    const signal = typeof (AbortSignal as any)?.timeout === "function"
      ? ((AbortSignal as any).timeout(opcoes.prazoMs ?? 2500) as AbortSignal)
      : undefined;
    const r = await f(url, { signal });
    if (!r.ok) return null;
    const lista = await r.json().catch(() => null);
    if (!Array.isArray(lista)) return null;
    const alvo = normal(ruaLimpa);
    const daRua = lista.filter((e: any) => normal(e?.logradouro) === alvo && String(e?.bairro || "").trim());
    const bairros = [...new Set(daRua.map((e: any) => String(e.bairro).trim()))];
    bairro = bairros.length === 1 ? bairros[0] : null;
  } catch {
    return null; // falha de rede não fica no cache
  }
  cache.set(chave, { bairro, em: Date.now() });
  return bairro;
}

/** UF a partir do nome do estado ("Rio de Janeiro"), da sigla ("RJ") ou do ISO ("BR-RJ"). */
export function ufDoEstado(estado: string | null | undefined): string | null {
  const t = String(estado || "").trim();
  const iso = t.match(/^BR-([A-Z]{2})$/i);
  if (iso) return iso[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(t) && Object.values(UF_DO_ESTADO).includes(t.toUpperCase())) return t.toUpperCase();
  return UF_DO_ESTADO[normal(t)] ?? null;
}

/**
 * Só o bairro: o dos Correios quando é o mesmo do mapa com um prefixo a menos,
 * senão o do mapa. Serve ao navegador (o ViaCEP aceita chamada direta, como o
 * campo de CEP do checkout — lib/cep.ts) e ao servidor. Nunca lança.
 */
export async function bairroComNomeDosCorreios(
  bairroDoMapa: string,
  rua: string,
  cidade: string,
  estadoOuUf: string | null | undefined,
  opcoes: { fetch?: typeof fetch; prazoMs?: number } = {},
): Promise<string> {
  const uf = ufDoEstado(estadoOuUf);
  if (!bairroDoMapa || !rua || !cidade || !uf) return bairroDoMapa;
  try {
    const dosCorreios = await bairroDaRuaNosCorreios(rua, cidade, uf, opcoes);
    return dosCorreios && dosCorreios !== bairroDoMapa && mesmoBairroSemPrefixo(bairroDoMapa, dosCorreios)
      ? dosCorreios
      : bairroDoMapa;
  } catch {
    return bairroDoMapa;
  }
}

/**
 * O texto do endereço que o mapa achou, como a cidade escreve: bairro dos
 * Correios quando é o mesmo do mapa sem o prefixo, e sem "Região…"/"Brasil".
 * Nunca lança; na dúvida devolve o texto só sem os pedaços de região.
 */
export async function enderecoDoMapaComBairroDosCorreios(
  texto: string | null | undefined,
  cidadeDaLoja?: string | null,
  opcoes: { fetch?: typeof fetch; prazoMs?: number; ufDaLoja?: string | null } = {},
): Promise<string> {
  const original = String(texto || "").trim();
  if (!original) return original;
  try {
    const partes = lerTextoDoMapa(original, cidadeDaLoja);
    const pedacos = [...partes.pedacos];
    const uf = partes.uf || opcoes.ufDaLoja || null;
    if (partes.rua >= 0 && partes.bairro >= 0 && uf) {
      const doMapa = pedacos[partes.bairro];
      const dosCorreios = await bairroDaRuaNosCorreios(pedacos[partes.rua], partes.cidade, uf, opcoes);
      if (dosCorreios && dosCorreios !== doMapa && mesmoBairroSemPrefixo(doMapa, dosCorreios)) {
        pedacos[partes.bairro] = dosCorreios;
      }
    }
    return pedacos.join(", ");
  } catch {
    return original;
  }
}
