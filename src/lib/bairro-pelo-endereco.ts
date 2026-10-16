/**
 * O bairro CADASTRADO da loja que o texto livre do endereço indica — para a
 * loja que cobra por bairro (deliveryZoneType = NEIGHBORHOOD).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O pedido de app (iFood, 99Food, Wabiz...) chega com o endereço num texto só,
 * cada canal no seu formato, e nenhum deles diz qual bairro DA LOJA é aquele:
 *
 *   iFood   "Q 3, 0 - Ref: Na Loja Dog Do Bartô - Sobradinho - Brasília"
 *   iFood   "St Mansões Sobradinho Qd 51A Mód G, 6 - Comp: ... - Sobradinho II - Br"
 *   Wabiz   "Quadra 12, conjunto B, casa 06 - Sobradinho 1 - QUADRA 12 - Brasília/DF - CEP 73010122"
 *   Wabiz   "SES quadra 13, 20 - Empresa Rezgatte - DNOKS - Brasília/DF - CEP 73040134"
 *   99Food  "ar 7, cj 5 LT 18 - Sobradinho II, Sobradinho - DF, Casa cinza na esquina"
 *
 * A NIK (Sobradinho/DF, 15/10/2026) paga o motoboy pela tabela dela também no
 * app ("Quadra 1".."Quadra 8", "Quadra 9 a Quadra 17", "Sobradinho 2",
 * "Setor de Mansões", "Dnoks"...). Sem saber o bairro, o acerto caía na taxa
 * que o app cobrou do cliente (R$ 6,99) no lugar dos R$ 5/6/7/9 da tabela, e a
 * roteirização mostrava "Bairro: Brasília/DF".
 *
 * Sem mapa e sem banco: roda no servidor (acerto) e no navegador (rótulo).
 *
 * ── Como casa ───────────────────────────────────────────────────────────────
 *
 * Cada bairro cadastrado vira uma ou mais REGRAS, a partir do nome e dos
 * apelidos opcionais (`aliases` na zona, ex.: ["AR 1 a AR 24", "Dnocs"]):
 *
 *   NUMERADA  "Quadra 5", "Quadra 9 a Quadra 17", "AR 1 a AR 24": sigla curta
 *             (ou quadra/qd/q) + número, ou faixa de números. No texto, casa
 *             "Q 3", "Q. 6", "Qd 15", "QUADRA 12", "Quadra 08", "Ar 7".
 *   NOME      o resto: "Setor de Mansões", "Sobradinho 2", "Dnoks". Compara
 *             as palavras que importam, em sequência, dentro de um pedaço do
 *             endereço: sem acento e caixa; sem "de/da/do", "setor", "st",
 *             "sh", "condomínio"; "II" = 2. "St Mansões Sobradinho" casa
 *             "Setor de Mansões"; "Sobradinho II" casa "Sobradinho 2";
 *             "ALTO BOA VISTA" casa "Alto da Boa Vista". Nome com " e "
 *             ("Serra Azul e Contagem") vale por cada parte. Cidade e UF
 *             sozinhas ("DF" em "Grande Colorado e DF", "Brasília") não casam
 *             nada; nome só de número ("425") só casa um pedaço que É ele.
 *
 * O endereço é quebrado no " - ". O primeiro pedaço é a rua (o que o cliente
 * escreveu); "Ref:" é sempre descartado (é perto de quê, não onde); "Comp:"
 * fica por último. A ordem de preferência:
 *
 *   1. nome na rua                ("Condomínio Morada dos Nobres Quadra 11")
 *   2. nome nos outros pedaços    ("... - DNOKS - Brasília/DF", "- Sobradinho II -")
 *   3. numerada na rua            ("Q. 9 Conjunto E, AR 17" → a 1ª: Quadra 9)
 *   4. numerada nos outros        ("Edifício Mirante da Serra - QUADRA 17")
 *   5. nome, depois numerada, no complemento ("Comp: Quadra 2 Conjunto A")
 *
 * O nome vence o número porque é o mais específico: "SES quadra 13 - DNOKS" é
 * Dnoks, não a Quadra 13; "Cond. Jardim Europa Qd. 2 - GRANDE COLORADO" é o
 * Grande Colorado. Dentro do mesmo pedaço, o nome mais longo vence.
 *
 * Não achou = null. Nunca chuta.
 *
 * Teste: scripts/teste-bairro-pelo-endereco.ts.
 */

export type ZonaComApelidos = { name: string; aliases?: string[] };

export type BairroAchado = {
  /** O nome do bairro cadastrado, exatamente como está na zona. */
  name: string;
  /** Casou pelo nome/apelido por extenso ou por sigla + número. */
  como: "NOME" | "NUMERO";
  /** O pedaço do endereço que decidiu. */
  trecho: string;
};

const UFS = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr",
  "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
]);

/** Palavras que não distinguem lugar nenhum: some dos dois lados antes de comparar. */
const PALAVRAS_GENERICAS = new Set([
  "de", "da", "do", "das", "dos", "d",
  "setor", "st", "sh", "condominio", "cond", "cd", "residencial", "res", "bairro",
]);

/** Cidade e país: não são bairro, nem sozinhos nem como parte do nome da zona. */
const CIDADE_OU_PAIS = new Set(["brasil", "brazil", "brasilia"]);

/** Os jeitos de escrever "quadra" na frente do número. */
const SIGLAS_DE_QUADRA = new Set(["quadra", "quadras", "qd", "qda", "qdr", "q"]);

const ROMANOS: Record<string, string> = { ii: "2", iii: "3", iv: "4" };

/** Sem acento, minúsculo, só letras e números, letra e número separados ("qr05" → "qr 05"). */
function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ºª°]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function palavras(texto: unknown): string[] {
  const n = normalizar(texto);
  if (!n) return [];
  return n.split(" ").map((p) => ROMANOS[p] ?? p);
}

const ehNumero = (p: string) => /^\d+$/.test(p);

/** As palavras que distinguem o lugar: sem as genéricas. */
function significativas(lista: string[]): string[] {
  return lista.filter((p) => !PALAVRAS_GENERICAS.has(p));
}

type Regra =
  | { tipo: "NUMERO"; zona: string; sigla: string; de: number; ate: number }
  | { tipo: "NOME"; zona: string; seq: string[]; soNumero: boolean };

/** A sigla canônica: todo jeito de escrever quadra vira "quadra". */
const siglaCanonica = (s: string) => (SIGLAS_DE_QUADRA.has(s) ? "quadra" : s);

/**
 * "Quadra 9 a Quadra 17", "AR 1 a AR 24", "Qd 5", "Quadra 18". Sigla longa
 * que não é quadra ("Sobradinho 2") é NOME, não numerada.
 */
function regraNumerada(texto: string, zona: string): Regra | null {
  const n = palavras(texto).join(" ");
  const m = n.match(/^([a-z]+) (\d+)(?: (?:a|ate|ao|e) (?:([a-z]+) )?(\d+))?$/);
  if (!m) return null;
  const sigla = siglaCanonica(m[1]);
  if (sigla !== "quadra" && m[1].length > 4) return null;
  if (m[3] && siglaCanonica(m[3]) !== sigla) return null;
  const de = Number(m[2]);
  const ate = m[4] ? Number(m[4]) : de;
  return { tipo: "NUMERO", zona, sigla, de: Math.min(de, ate), ate: Math.max(de, ate) };
}

function regraDeNome(texto: string, zona: string, cidades: Set<string>): Regra | null {
  const seq = significativas(palavras(texto)).filter((p) => !UFS.has(p) && !CIDADE_OU_PAIS.has(p) && !cidades.has(p));
  if (!seq.length) return null;
  return { tipo: "NOME", zona, seq, soNumero: seq.every(ehNumero) };
}

/** Os apelidos gravados na zona: lista de textos (ou um texto com vírgulas). */
export function lerApelidos(z: any): string[] {
  const bruto = z?.aliases;
  const lista = Array.isArray(bruto) ? bruto : typeof bruto === "string" ? bruto.split(/[,;\n]/) : [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const a of lista) {
    if (typeof a !== "string") continue;
    const t = a.replace(/\s+/g, " ").trim().slice(0, 60);
    const chave = normalizar(t);
    if (!t || !chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(t);
    if (saida.length >= 30) break;
  }
  return saida;
}

function listaDeZonas(zonas: unknown): any[] {
  if (Array.isArray(zonas)) return zonas;
  if (typeof zonas === "string") {
    try {
      const lido = JSON.parse(zonas);
      return Array.isArray(lido) ? lido : [];
    } catch {
      return [];
    }
  }
  return [];
}

const kmDaZona = (z: any) => Number(z?.km ?? z?.radius ?? z?.maxKm ?? z?.distance ?? 0) || 0;

/**
 * Os bairros cadastrados (nome + apelidos), ou [] quando a loja não cobra
 * por bairro.
 *
 * Sem o tipo, decide pelo cadastro: zona com km é faixa, zona com `pontos` é
 * área desenhada — havendo qualquer uma, a lista NÃO é de bairros (o "nome"
 * de uma faixa não é lugar). Com o tipo, só NEIGHBORHOOD (ou cadastro antigo
 * sem tipo) responde.
 */
export function zonasDeBairro(zonas: unknown, tipo?: string | null): ZonaComApelidos[] {
  const t = String(tipo || "").toUpperCase();
  if (t && t !== "NEIGHBORHOOD") return [];
  const lista = listaDeZonas(zonas).filter((z) => z && typeof z === "object");
  if (lista.some((z) => kmDaZona(z) > 0 || z.pontos != null)) return [];
  return lista
    .map((z) => ({ name: String(z.name ?? z.nome ?? "").replace(/\s+/g, " ").trim(), aliases: lerApelidos(z) }))
    .filter((z) => z.name);
}

function montarRegras(zonas: ZonaComApelidos[], cidades: Set<string>): Regra[] {
  const regras: Regra[] = [];
  for (const z of zonas) {
    // O nome com " e " vale por cada parte; o apelido vale como foi escrito.
    const doNome = z.name.split(/\s+e\s+/i);
    for (const texto of [...doNome, ...(z.aliases || [])]) {
      const r = regraNumerada(texto, z.name) ?? regraDeNome(texto, z.name, cidades);
      if (r) regras.push(r);
    }
  }
  return regras;
}

/** A sequência `seq` aparece, contígua, em `lista`? Devolve a posição ou -1. */
function posicaoDaSequencia(lista: string[], seq: string[]): number {
  outer: for (let i = 0; i + seq.length <= lista.length; i++) {
    for (let j = 0; j < seq.length; j++) if (lista[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

type Pedaco = { texto: string; tipo: "RUA" | "OUTRO" | "COMP" };

const REF_RE = /^\s*(ref(er[eê]ncia)?|ponto de refer[eê]ncia|obs(erva[cç][aã]o)?)\b\s*[:.]?/i;
const COMP_RE = /^\s*comp(lemento)?\b\s*[:.]?/i;

function pedacosDoEndereco(texto: string): Pedaco[] {
  // Só o parêntese FECHADO sai ("Âncora (Apartamento 201)"): o aberto sem
  // fechar engolia o resto — "sobradinho, 16 - (Qd 5 cj C cs 16 - QUADRA 5 -
  // Brasília/DF" perdia a QUADRA 5 (Wabiz da NIK).
  const t = String(texto || "").replace(/\([^()]*\)/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const partes = t.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  const saida: Pedaco[] = [];
  partes.forEach((p, i) => {
    if (REF_RE.test(p)) return;
    if (COMP_RE.test(p)) { saida.push({ texto: p.replace(COMP_RE, ""), tipo: "COMP" }); return; }
    saida.push({ texto: p, tipo: i === 0 ? "RUA" : "OUTRO" });
  });
  return saida;
}

/** O melhor nome dentro de um pedaço: o mais longo (mais palavras). */
function nomeNoPedaco(pedaco: string, regras: Regra[]): Regra | null {
  // A vírgula separa coisas diferentes ("Sobradinho II, Sobradinho"): a
  // sequência do nome não atravessa vírgula.
  const trechos = pedaco.split(",").map((c) => significativas(palavras(c))).filter((c) => c.length);
  let melhor: (Regra & { tipo: "NOME" }) | null = null;
  for (const r of regras) {
    if (r.tipo !== "NOME") continue;
    const casa = trechos.some((c) =>
      r.soNumero ? c.length === r.seq.length && posicaoDaSequencia(c, r.seq) === 0 : posicaoDaSequencia(c, r.seq) >= 0,
    );
    if (casa && (!melhor || r.seq.length > melhor.seq.length)) melhor = r;
  }
  return melhor;
}

/** A PRIMEIRA sigla + número do pedaço que algum bairro cobre. */
function numeroNoPedaco(pedaco: string, regras: Regra[]): Regra | null {
  const numeradas = regras.filter((r): r is Regra & { tipo: "NUMERO" } => r.tipo === "NUMERO");
  if (!numeradas.length) return null;
  const lista = palavras(pedaco);
  for (let i = 0; i + 1 < lista.length; i++) {
    const sigla = siglaCanonica(lista[i]);
    // "Quadra nº 5" já perdeu o "nº" na normalização; "Q. 6" virou "q 6".
    const num = lista[i + 1];
    if (!ehNumero(num)) continue;
    const n = Number(num);
    const achada = numeradas.find((r) => r.sigla === sigla && n >= r.de && n <= r.ate);
    if (achada) return achada;
  }
  return null;
}

/**
 * O bairro cadastrado que o endereço indica, ou null.
 *
 * `zonas` é o `deliveryZones` da loja (cru, como vem do banco) ou a lista já
 * lida por `zonasDeBairro`. `cidades`: a cidade da loja, para nunca valer
 * como bairro.
 */
export function bairroPeloEndereco(
  endereco: string | null | undefined,
  zonas: unknown,
  opcoes: { tipo?: string | null; cidades?: (string | null | undefined)[] } = {},
): BairroAchado | null {
  const lista = zonasDeBairro(zonas, opcoes.tipo);
  if (!lista.length) return null;
  const pedacos = pedacosDoEndereco(String(endereco || ""));
  if (!pedacos.length) return null;

  const cidades = new Set<string>();
  for (const c of opcoes.cidades || []) for (const p of palavras(c)) if (!ehNumero(p)) cidades.add(p);
  const regras = montarRegras(lista, cidades);
  if (!regras.length) return null;

  const rua = pedacos.filter((p) => p.tipo === "RUA");
  // Os outros pedaços do fim para o começo: o bairro fica logo antes da cidade.
  const outros = pedacos.filter((p) => p.tipo === "OUTRO").reverse();
  const comp = pedacos.filter((p) => p.tipo === "COMP");

  const tentativas: [Pedaco[], (t: string, r: Regra[]) => Regra | null][] = [
    [rua, nomeNoPedaco],
    [outros, nomeNoPedaco],
    [rua, numeroNoPedaco],
    [outros, numeroNoPedaco],
    [comp, nomeNoPedaco],
    [comp, numeroNoPedaco],
  ];
  for (const [onde, como] of tentativas) {
    for (const p of onde) {
      const r = como(p.texto, regras);
      if (r) return { name: r.zona, como: r.tipo, trecho: p.texto };
    }
  }
  return null;
}
