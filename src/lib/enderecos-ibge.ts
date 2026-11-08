/**
 * A BASE DE ENDEREÇOS DO IBGE (CNEFE 2022) — a parte pura: sem banco e sem rede.
 *
 * O CNEFE (Cadastro Nacional de Endereços para Fins Estatísticos, Censo 2022)
 * tem cada endereço do município com a coordenada da casa (~92% com
 * NV_GEO_COORD = 1). É de graça, baixado por município do FTP do IBGE, e tem as
 * ruas que o OpenStreetMap não tem — Divinos Burger (Cabo Frio): Rua Isabela,
 * Rua Moacir dos Santos Moreira, Andorinhas, Rui dos Anjos Cruz.
 *
 * Aqui: como o nome da rua vira chave de comparação, como a rua escrita pelo
 * cliente casa com a do IBGE, qual trecho da rua vale (o do bairro escrito) e
 * qual número fica mais perto. O bairro do ponto: o polígono da malha de
 * bairros do Censo 2022 quando o município tem bairro oficial; senão a
 * localidade do próprio CNEFE (DSC_LOCALIDADE — em Cabo Frio, que não tem
 * bairro na malha, é o nome que o morador usa: "Monte Alegre", sem "Vila").
 *
 * Quem lê o banco é lib/enderecos-ibge-servidor.ts.
 */

export type Ponto = { lat: number; lng: number };

/** Uma rua do IBGE num bairro: os números com o ponto de cada um. */
export type RuaDoIbge = {
  /** Tipo do logradouro, normalizado: "rua", "travessa", "beco"... */
  tipo: string;
  /** O nome sem o tipo, como o IBGE escreve (com o título: "Ministro Gama Filho"). */
  nome: string;
  /** Chave do nome (ver `chaveDoNome`). */
  chave: string;
  /** Chave do nome SEM o título ("Gama Filho"), quando há título. */
  chaveSemTitulo?: string | null;
  /** O bairro (localidade do CNEFE) deste trecho. */
  bairro: string;
  /** Números (0 = sem número) e os pontos, na mesma ordem. */
  numeros: number[];
  lats: number[];
  lngs: number[];
};

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
export function normalizar(t: string): string {
  return semAcento(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const TIPOS: Record<string, string> = {
  rua: "rua", r: "rua", avenida: "avenida", av: "avenida", ave: "avenida", travessa: "travessa", tv: "travessa", trav: "travessa",
  tr: "travessa", beco: "beco", bc: "beco", estrada: "estrada", est: "estrada", estr: "estrada", alameda: "alameda", al: "alameda",
  rodovia: "rodovia", rod: "rodovia", praca: "praca", pca: "praca", pc: "praca", largo: "largo", lg: "largo", servidao: "servidao",
  serv: "servidao", via: "via", viela: "viela", ladeira: "ladeira", ld: "ladeira", caminho: "caminho", passagem: "passagem",
  vila: "vila", condominio: "condominio", loteamento: "loteamento", acesso: "acesso", ramal: "ramal", rodoanel: "rodoanel",
};

const TIPO_REPETIDO = new Set(["rua", "travessa", "avenida", "estrada", "beco"]);

const TITULOS = new Set(
  ("doutor dr doutora dra professor prof professora profa presidente pres coronel cel general gen governador gov prefeito " +
    "vereador deputado senador ministro padre pe frei dom marechal mal almirante capitao cap tenente ten sargento sgt " +
    "engenheiro eng desembargador comendador soldado major brigadeiro maestro monsenhor irma irmao madre visconde " +
    "barao conde duque princesa principe imperador rei rainha papa santo santa sao sto sta nossa senhora")
    .split(" "),
);
const ABREV_DE_TITULO: Record<string, string> = {
  dr: "doutor", dra: "doutora", prof: "professor", profa: "professora", pres: "presidente", cel: "coronel", gen: "general",
  gov: "governador", pe: "padre", mal: "marechal", cap: "capitao", ten: "tenente", sgt: "sargento", eng: "engenheiro",
  sto: "santo", sta: "santa",
};
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e", "d"]);

// "Doze de Maio" e "12 de Maio" são a mesma rua (as duas grafias estão no CNEFE de Cabo Frio).
const UNIDADES: Record<string, number> = {
  um: 1, uma: 1, primeiro: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const DEZENAS: Record<string, number> = { vinte: 20, trinta: 30 };

/** A chave do nome de uma rua: sem acento, sem "de/da/do", título abreviado por extenso, número por extenso em algarismo. */
export function chaveDoNome(nome: string): string {
  const p = normalizar(nome).split(" ").map((x) => ABREV_DE_TITULO[x] || x);
  const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    const w = p[i];
    if (DEZENAS[w] !== undefined) {
      // "vinte e cinco" → 25
      const u = p[i + 1] === "e" ? UNIDADES[p[i + 2]] : undefined;
      if (u !== undefined && u < 10) { out.push(String(DEZENAS[w] + u)); i += 2; } else out.push(String(DEZENAS[w]));
      continue;
    }
    out.push(UNIDADES[w] !== undefined ? String(UNIDADES[w]) : /^\d+$/.test(w) ? String(Number(w)) : w);
  }
  return out.filter((x) => x && !LIGACOES.has(x)).join(" ");
}

/** A chave sem os títulos do começo ("doutor cardoso fonseca" → "cardoso fonseca"). Null se não tinha título. */
export function semTitulo(chave: string): string | null {
  const p = chave.split(" ");
  let i = 0;
  while (i < p.length - 1 && TITULOS.has(p[i])) i++;
  return i > 0 ? p.slice(i).join(" ") : null;
}

/**
 * O logradouro escrito pelo cliente em tipo + chave. "Rua travessa Monte
 * Horebe" (tipo repetido) fica com o tipo de dentro. Sem tipo, `tipo` é null.
 */
export function separarLogradouro(texto: string): { tipo: string | null; chave: string; chaveSemTitulo: string | null } {
  let p = normalizar(texto).split(" ").filter(Boolean);
  let tipo: string | null = null;
  if (p.length > 1 && TIPOS[p[0]]) {
    tipo = TIPOS[p[0]];
    p = p.slice(1);
    // O segundo tipo só sai quando é tipo repetido ("Rua travessa X"): em
    // "Avenida Caminho de Búzios" o "Caminho" é o nome.
    if (p.length > 1 && TIPO_REPETIDO.has(TIPOS[p[0]] || "")) {
      tipo = TIPOS[p[0]];
      p = p.slice(1);
    }
  }
  const chave = chaveDoNome(p.join(" "));
  return { tipo, chave, chaveSemTitulo: semTitulo(chave) };
}

/** Quantas letras trocar, pôr ou tirar para `a` virar `b` (até `teto`; acima devolve teto + 1). */
export function distanciaDeEdicao(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const at = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      at[j] = Math.min(ant[j] + 1, at[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      menor = Math.min(menor, at[j]);
    }
    if (menor > teto) return teto + 1;
    ant = at;
  }
  return ant[b.length];
}

/**
 * Quanto a chave escrita casa com a do IBGE: 3 = igual, 2 = uma letra errada
 * (duas em nome longo) ou plural, 1 = uma dentro da outra com no máximo uma
 * palavra a mais, 0 = outra rua.
 *
 * "Marina" × "Marina do Canal Palmer" é 0: uma palavra dentro de um nome com
 * várias a mais é outra rua (Divinos, 04/10/2026 — 2,9 km de erro). Número dos
 * dois lados tem de ser o mesmo ("Rua 5" × "Rua 15").
 */
export function casamentoDoNome(escrita: string, doIbge: string): number {
  const a = escrita.trim();
  const b = doIbge.trim();
  if (!a || !b) return 0;
  if (a === b) return 3;
  const nums = (t: string) => (t.match(/\d+/g) || []).map((n) => String(Number(n))).sort().join(",");
  if (/\d/.test(a) && /\d/.test(b) && nums(a) !== nums(b)) return 0;
  const ja = a.replace(/\s/g, "");
  const jb = b.replace(/\s/g, "");
  if (ja === jb) return 3;
  const menor = Math.min(ja.length, jb.length);
  if (menor >= 5) {
    const teto = menor >= 12 ? 2 : 1;
    if (distanciaDeEdicao(ja, jb, teto) <= teto) return 2;
  }
  // Um nome dentro do outro. O cliente abrevia ("Getúlio" para Getúlio
  // Vargas): vale o escrito MAIS CURTO que o do IBGE, com no máximo uma palavra
  // a menos. O contrário — o IBGE com uma palavra só dentro do que o cliente
  // escreveu ("Agenor Medeiros" × Rua Medeiros, 2,9 km) — é outra rua; só vale
  // com duas palavras ou mais em comum.
  const pa = a.split(" ");
  const pb = b.split(" ");
  const [curto, longo] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  const dentro = curto.every((w) => longo.includes(w));
  if (!dentro || curto.join("").length < 4) return 0;
  if (curto.length >= 2) return 1;
  return curto === pa && longo.length - curto.length <= 1 ? 1 : 0;
}

/** Bairro sem prefixo ("Vila", "Jardim", "Parque"...) para comparar. */
const PREFIXO = /^(bairro|vila|vl|jardim|jd|parque|pq|residencial|res|conjunto|conj|cj|loteamento|lot|condominio|cond|nucleo|setor)\s+/;
const ROMANOS: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
function nomeDeBairro(t: string): string {
  return normalizar(t)
    .split(" ")
    .map((p) => ROMANOS[p] || p)
    .join(" ")
    .replace(PREFIXO, "")
    .trim();
}

/** O bairro escrito é este do IBGE? Igual, um dentro do outro, ou uma letra de diferença (sem o prefixo). */
export function mesmoBairro(escrito: string | null | undefined, doIbge: string | null | undefined): boolean {
  const a = nomeDeBairro(String(escrito || ""));
  const b = nomeDeBairro(String(doIbge || ""));
  if (!a || !b) return false;
  if (a === b) return true;
  if (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `)) return Math.min(a.length, b.length) >= 4;
  const ja = a.replace(/\s/g, "");
  const jb = b.replace(/\s/g, "");
  if (ja === jb) return true;
  const menor = Math.min(ja.length, jb.length);
  if (menor < 6) return false;
  const teto = menor >= 12 ? 2 : 1;
  return distanciaDeEdicao(ja, jb, teto) <= teto;
}

export function distanciaKm(a: Ponto, b: Ponto): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** O ponto da rua que fica no meio dela (o endereço mais perto da mediana — sempre um ponto que existe). */
export function meioDaRua(rua: Pick<RuaDoIbge, "lats" | "lngs">): Ponto {
  const c = { lat: mediana(rua.lats), lng: mediana(rua.lngs) };
  let melhor = 0;
  let d = Infinity;
  for (let i = 0; i < rua.lats.length; i++) {
    const x = (rua.lats[i] - c.lat) ** 2 + (rua.lngs[i] - c.lng) ** 2;
    if (x < d) { d = x; melhor = i; }
  }
  return { lat: rua.lats[melhor], lng: rua.lngs[melhor] };
}

export type PontoDoNumero = Ponto & {
  /** "casa" = o número existe; "vizinho" = número perto (±30); "entre" = entre dois números; "rua" = o meio da rua. */
  precisao: "casa" | "vizinho" | "entre" | "rua";
  /** O número do IBGE usado (casa/vizinho). */
  numero?: number;
};

/** Até quanto o número vizinho ainda é "a casa" (mesmo lado ou não). */
export const NUMERO_VIZINHO = 30;
/** O maior buraco entre dois números para ainda interpolar entre eles. */
export const MAIOR_BURACO_ENTRE_NUMEROS = 400;

/**
 * O ponto do número na rua. Número que existe → a mediana dos pontos dele
 * (prédio com vários apartamentos); senão o vizinho mais perto até ±30 (o do
 * mesmo lado primeiro); senão entre os dois números que cercam o pedido; senão
 * o meio da rua.
 */
export function pontoDoNumero(rua: Pick<RuaDoIbge, "numeros" | "lats" | "lngs">, numero: number | null): PontoDoNumero {
  const meio = (): PontoDoNumero => ({ ...meioDaRua(rua), precisao: "rua" });
  if (!numero || numero <= 0) return meio();
  const iguais: number[] = [];
  for (let i = 0; i < rua.numeros.length; i++) if (rua.numeros[i] === numero) iguais.push(i);
  if (iguais.length > 0) {
    return { lat: mediana(iguais.map((i) => rua.lats[i])), lng: mediana(iguais.map((i) => rua.lngs[i])), precisao: "casa", numero };
  }
  let melhor = -1;
  let custo = Infinity;
  let abaixo = -1;
  let acima = -1;
  for (let i = 0; i < rua.numeros.length; i++) {
    const n = rua.numeros[i];
    if (n <= 0) continue;
    const d = Math.abs(n - numero) + (n % 2 === numero % 2 ? 0 : 0.5);
    if (d < custo) { custo = d; melhor = i; }
    if (n < numero && (abaixo < 0 || n > rua.numeros[abaixo])) abaixo = i;
    if (n > numero && (acima < 0 || n < rua.numeros[acima])) acima = i;
  }
  if (melhor >= 0 && Math.abs(rua.numeros[melhor] - numero) <= NUMERO_VIZINHO) {
    return { lat: rua.lats[melhor], lng: rua.lngs[melhor], precisao: "vizinho", numero: rua.numeros[melhor] };
  }
  if (abaixo >= 0 && acima >= 0) {
    const na = rua.numeros[abaixo];
    const nb = rua.numeros[acima];
    const pa = { lat: rua.lats[abaixo], lng: rua.lngs[abaixo] };
    const pb = { lat: rua.lats[acima], lng: rua.lngs[acima] };
    // Dois números longe um do outro no mapa (a rua dá volta, ou são trechos
    // diferentes) não são uma reta: aí não se interpola.
    if (nb - na <= MAIOR_BURACO_ENTRE_NUMEROS && distanciaKm(pa, pb) <= 1.2) {
      const f = (numero - na) / (nb - na);
      return { lat: pa.lat + (pb.lat - pa.lat) * f, lng: pa.lng + (pb.lng - pa.lng) * f, precisao: "entre" };
    }
  }
  return meio();
}

/**
 * Dois trechos da mesma rua com endereços a até esta distância são a MESMA rua
 * (ela cruza o limite de dois bairros, ou o recenseador anotou outra
 * localidade num pedaço dela). Mais longe que isso é homônima.
 */
export const TRECHOS_DA_MESMA_RUA_KM = 0.5;
/** A rua achada fora do bairro escrito só vale até esta distância do centro dele (a mesma régua do mapa: PERTO_DO_BAIRRO_KM). */
export const PERTO_DO_BAIRRO_KM = 2.8;

export type AchadoNoIbge = Ponto & {
  rua: RuaDoIbge;
  precisao: PontoDoNumero["precisao"];
  /** Como o nome casou (3 igual, 2 uma letra, 1 um dentro do outro). */
  casamento: number;
  /**
   * "bairro" = o trecho do bairro escrito; "unica" = a rua só existe num lugar
   * da cidade; "perto" = a rua existe em vários lugares e só um fica perto do
   * bairro escrito (o IBGE chama o pedaço de outro nome).
   */
  porque: "bairro" | "unica" | "perto";
  /** O bairro do ponto achado (o do trecho em que o número caiu). */
  bairro: string;
};

/** "Rua sem saída", "Rua sem denominação", "Rua projetada": há uma em cada canto da cidade. */
export const NOME_GENERICO = /^(sem saida|sem denominacao|sem nome|projetada|particular|s n|sn|principal|beco|travessa|rua)$/;

export type ReguaDoIbge = {
  /** O centro do bairro do IBGE com este nome (null = o IBGE não tem esse bairro). */
  centroDoBairro?: (bairro: string) => Ponto | null;
  /** A loja e até onde uma rua única (sem o bairro para conferir) ainda é plausível. */
  loja?: Ponto | null;
  limiteKm?: number;
};

/**
 * A rua do cliente no IBGE.
 *
 * Só aceita o que não dá margem a homônima:
 *   - a rua (nome e tipo, quando o cliente disse o tipo) no BAIRRO escrito; ou
 *   - a rua num lugar só da cidade — perto do bairro escrito (2,8 km do centro
 *     dele) ou, sem bairro que o IBGE conheça, perto da loja (`limiteKm`).
 * A mesma rua em lugares diferentes e nenhum no bairro escrito é homônima: não
 * se escolhe — devolve null e a cascata do mapa segue. A rua única do outro
 * lado do município (Rua Bom Pastor de Unamar, 25 km, para quem escreveu Porto
 * do Carro) é rua nova que o Censo não pegou: null também.
 *
 * `candidatas` = os trechos que o banco devolveu para as chaves procuradas
 * (e as parecidas). Entre os nomes, vale o melhor casamento; entre os tipos,
 * o escrito (Rua Paraná ≠ Beco Paraná). Nome curto ("Beco 1", "Rua A") só no
 * bairro escrito: há um em cada bairro.
 */
export function acharNoIbge(
  escrita: { logradouros: string[]; numero: number | null; bairro: string | null },
  candidatas: RuaDoIbge[],
  regua: ReguaDoIbge = {},
): AchadoNoIbge | null {
  for (const logradouro of escrita.logradouros) {
    const alvo = separarLogradouro(logradouro);
    if (!alvo.chave || NOME_GENERICO.test(alvo.chave)) continue;
    const curta = alvo.chave.replace(/\s/g, "").length < 4;
    const pontuadas = candidatas
      .filter((r) => !NOME_GENERICO.test(r.chave))
      .map((r) => {
        const notas = [casamentoDoNome(alvo.chave, r.chave)];
        if (r.chaveSemTitulo) notas.push(casamentoDoNome(alvo.chave, r.chaveSemTitulo));
        if (alvo.chaveSemTitulo) notas.push(casamentoDoNome(alvo.chaveSemTitulo, r.chave));
        return { r, nota: Math.max(...notas) };
      })
      .filter((x) => x.nota > 0 && (!curta || x.nota === 3));
    if (pontuadas.length === 0) continue;
    // Só o melhor casamento de nome conta: com a rua de nome igual, a de uma
    // letra de diferença é OUTRA rua.
    const melhorNota = Math.max(...pontuadas.map((x) => x.nota));
    const mesmoNome = pontuadas.filter((x) => x.nota === melhorNota).map((x) => x.r);
    // O tipo escrito decide entre Rua e Beco do mesmo nome; sem trecho do tipo
    // escrito, o tipo pode ter sido escrito errado ("Rua" para a travessa,
    // "Estrada" para a Avenida Nelore).
    const preferirTipo = (lista: RuaDoIbge[]) => {
      const t = alvo.tipo || "rua";
      const doTipo = lista.filter((r) => r.tipo === t);
      return doTipo.length > 0 ? doTipo : lista;
    };
    const centro = escrita.bairro && regua.centroDoBairro ? regua.centroDoBairro(escrita.bairro) : null;
    let porque: AchadoNoIbge["porque"];
    let junto: RuaDoIbge[];
    let noBairro = escrita.bairro ? mesmoNome.filter((r) => mesmoBairro(escrita.bairro, r.bairro)) : [];
    let tipoDiferente = false;
    if (noBairro.length > 0) {
      porque = "bairro";
      noBairro = preferirTipo(noBairro);
      // O lugar (rua contínua) do maior trecho no bairro, com os pedaços dela nos bairros vizinhos.
      const tipoDoBairro = noBairro[0].tipo;
      const maior = [...noBairro].sort((x, y) => y.numeros.length - x.numeros.length)[0];
      junto = lugaresDaRua(mesmoNome.filter((r) => r.tipo === tipoDoBairro)).find((g) => g.includes(maior))!;
    } else {
      if (curta) continue;
      let trechos = mesmoNome;
      if (alvo.tipo) {
        const doTipo = trechos.filter((r) => r.tipo === alvo.tipo);
        if (doTipo.length > 0) trechos = doTipo;
        else tipoDiferente = true;
      } else trechos = preferirTipo(trechos);
      // Homônima fora da área da loja não conta (Rua Tucano de Unamar, 25 km).
      let grupos = lugaresDaRua(trechos);
      if (regua.loja && regua.limiteKm) {
        const naArea = grupos.filter((g) => g.some((t) => t.lats.some((la, i) => distanciaKm({ lat: la, lng: t.lngs[i] }, regua.loja!) <= regua.limiteKm!)));
        if (naArea.length > 0) grupos = naArea;
      }
      if (grupos.length === 1) {
        porque = "unica";
        junto = grupos[0];
      } else {
        // A rua em vários lugares, nenhum com o nome do bairro escrito: vale o
        // lugar que fica no bairro (perto do centro dele) quando é UM só — a
        // régua do mapa para a homônima (trechoMaisPerto). Sem centro, nada.
        // Dois lugares perto: vale o mais perto quando o outro fica pelo
        // menos o dobro mais longe (Rua Marina do Monte Alegre × Rua da Marina
        // da Praia do Siqueira, para quem escreveu Boca do Mato).
        if (!centro) continue;
        const km = (g: RuaDoIbge[]) => Math.min(...g.flatMap((t) => t.lats.map((la, i) => distanciaKm({ lat: la, lng: t.lngs[i] }, centro))));
        const ordem = grupos.map((g) => ({ g, km: km(g) })).sort((x, y) => x.km - y.km);
        if (ordem[0].km > PERTO_DO_BAIRRO_KM || ordem[1].km < 2 * Math.max(ordem[0].km, 0.3)) continue;
        porque = "perto";
        junto = ordem[0].g;
      }
    }
    let rua = juntar(junto);
    let p = pontoDoNumero(rua, escrita.numero);
    // A rua que atravessa bairros às vezes tem o mesmo número nos dois
    // pedaços: o do bairro escrito vem primeiro, e o resto da rua só quando o
    // número não está nele.
    if (porque === "bairro") {
      const doBairro = juntar(noBairro);
      const pb = pontoDoNumero(doBairro, escrita.numero);
      if (pb.precisao === "casa" || pb.precisao === "vizinho" || !(p.precisao === "casa" || p.precisao === "vizinho")) {
        p = pb;
        rua = doBairro;
      }
    } else if (centro) {
      // Fora do bairro escrito: perto do centro dele (mais perto ainda quando
      // nem o tipo bate — o "Beco Brasília" da Gamboa não é a Rua Brasília do
      // Jardim Excelsior, a 2 km).
      if (distanciaKm(p, centro) > (tipoDiferente ? PERTO_DO_BAIRRO_KM / 2 : PERTO_DO_BAIRRO_KM)) continue;
    } else if (regua.loja && regua.limiteKm && distanciaKm(p, regua.loja) > regua.limiteKm) continue;
    return { lat: p.lat, lng: p.lng, rua, precisao: p.precisao, casamento: melhorNota, porque, bairro: bairroMaisPerto(junto, p) };
  }
  return null;
}

/**
 * Os trechos agrupados em LUGARES: dois trechos são o mesmo lugar quando algum
 * endereço de um fica a até 0,5 km de algum do outro (encadeado — a avenida
 * longa que passa por cinco bairros é um lugar só).
 */
export function lugaresDaRua(trechos: RuaDoIbge[]): RuaDoIbge[][] {
  const pai = trechos.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  const amostra = (t: RuaDoIbge) => {
    const passo = Math.max(1, Math.floor(t.lats.length / 60));
    const out: Ponto[] = [];
    for (let i = 0; i < t.lats.length; i += passo) out.push({ lat: t.lats[i], lng: t.lngs[i] });
    return out;
  };
  const pts = trechos.map(amostra);
  for (let i = 0; i < trechos.length; i++) {
    for (let j = i + 1; j < trechos.length; j++) {
      if (raiz(i) === raiz(j)) continue;
      let perto = false;
      for (const a of pts[i]) {
        for (const b of pts[j]) if (distanciaKm(a, b) <= TRECHOS_DA_MESMA_RUA_KM) { perto = true; break; }
        if (perto) break;
      }
      if (perto) pai[raiz(i)] = raiz(j);
    }
  }
  const mapa = new Map<number, RuaDoIbge[]>();
  trechos.forEach((t, i) => { const r = raiz(i); (mapa.get(r) || mapa.set(r, []).get(r)!).push(t); });
  return [...mapa.values()];
}

/** Vários trechos numa rua só (os números e os pontos juntos). */
export function juntar(trechos: RuaDoIbge[]): RuaDoIbge {
  if (trechos.length === 1) return trechos[0];
  const maior = [...trechos].sort((a, b) => b.numeros.length - a.numeros.length)[0];
  return {
    ...maior,
    numeros: trechos.flatMap((t) => t.numeros),
    lats: trechos.flatMap((t) => t.lats),
    lngs: trechos.flatMap((t) => t.lngs),
  };
}

/** O bairro do endereço do IBGE mais perto do ponto, entre os trechos. */
export function bairroMaisPerto(trechos: RuaDoIbge[], p: Ponto): string {
  let melhor = trechos[0]?.bairro || "";
  let d = Infinity;
  for (const t of trechos) {
    for (let i = 0; i < t.lats.length; i++) {
      const x = (t.lats[i] - p.lat) ** 2 + (t.lngs[i] - p.lng) ** 2;
      if (x < d) { d = x; melhor = t.bairro; }
    }
  }
  return melhor;
}

/**
 * Até onde o endereço do IBGE mais perto do GPS ainda diz o bairro do cliente.
 * O GPS preciso erra ~20–50 m; a quadra do lado ainda é o mesmo bairro.
 */
export const BAIRRO_PELO_PONTO_KM = 0.2;

/**
 * O bairro do ponto pelo endereço do IBGE mais perto (a localidade do CNEFE
 * dele), quando há um a até `maxKm`. Divinos (Cabo Frio, pedido 29 de
 * 07/11/2026): o GPS em -22.8577, -42.0305 é o Monte Alegre para o IBGE (Rua
 * Monte Alegre nº 90 a ~150 m), e o mapa aberto chama tudo ali de "Gamboa".
 */
export function bairroDoEnderecoMaisPerto(
  p: Ponto,
  trechos: Pick<RuaDoIbge, "bairro" | "lats" | "lngs">[],
  maxKm = BAIRRO_PELO_PONTO_KM,
): { bairro: string; km: number } | null {
  // Corte barato em graus antes da conta (1° ≈ 111 km; folga para a longitude).
  const grau = maxKm / 90;
  let melhor: { bairro: string; km: number } | null = null;
  for (const t of trechos) {
    for (let i = 0; i < t.lats.length; i++) {
      if (Math.abs(t.lats[i] - p.lat) > grau || Math.abs(t.lngs[i] - p.lng) > grau) continue;
      const km = distanciaKm(p, { lat: t.lats[i], lng: t.lngs[i] });
      if (km <= maxKm && (!melhor || km < melhor.km)) melhor = { bairro: t.bairro, km };
    }
  }
  return melhor;
}

// ── O BAIRRO PELO POLÍGONO (malha de bairros do Censo 2022) ────────────────

/** Um bairro da malha: anéis [lng, lat] (o 1º é o contorno; os de sentido contrário são buracos — par/ímpar resolve os dois). */
export type BairroDaMalha = { nome: string; bbox: [number, number, number, number]; aneis: [number, number][][] };

/** O ponto está dentro do polígono? (regra par/ímpar: buraco e ilha certos sem saber o sentido do anel) */
export function dentroDoPoligono(p: Ponto, aneis: [number, number][][]): boolean {
  let dentro = false;
  for (const anel of aneis) {
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i];
      const [xj, yj] = anel[j];
      if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
  }
  return dentro;
}

/** O nome do bairro da malha onde o ponto cai (null = fora de todos). */
export function bairroDoPonto(p: Ponto, bairros: BairroDaMalha[]): string | null {
  for (const b of bairros) {
    const [x0, y0, x1, y1] = b.bbox;
    if (p.lng < x0 || p.lng > x1 || p.lat < y0 || p.lat > y1) continue;
    if (dentroDoPoligono(p, b.aneis)) return b.nome;
  }
  return null;
}

/** Simplifica um anel (Douglas-Peucker), tolerância em graus (~0,0001 ≈ 11 m). */
export function simplificar(anel: [number, number][], tol: number): [number, number][] {
  if (anel.length <= 4) return anel;
  const manter = new Uint8Array(anel.length);
  manter[0] = manter[anel.length - 1] = 1;
  const pilha: [number, number][] = [[0, anel.length - 1]];
  while (pilha.length) {
    const [a, b] = pilha.pop()!;
    let maior = 0;
    let idx = -1;
    const [ax, ay] = anel[a];
    const [bx, by] = anel[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = anel[i];
      let d: number;
      if (L === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maior) { maior = d; idx = i; }
    }
    if (idx >= 0 && maior > tol) {
      manter[idx] = 1;
      pilha.push([a, idx], [idx, b]);
    }
  }
  const out = anel.filter((_, i) => manter[i]);
  return out.length >= 4 ? out : anel;
}

/** "JARDIM ESPERANCA" → "Jardim Esperanca" (o CNEFE vem sem acento e em maiúsculas). */
export function nomeExibido(t: string): string {
  const minusculas = new Set(["de", "da", "do", "das", "dos", "e"]);
  return String(t || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : /^(i{1,3}|iv|v|vi{1,3}|ix|x)$/.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

const NAO_E_NUMERO_DA_CASA = /\b(casa|cs|lote|lt|quadra|qd|q|apto?|apartamento|bloco|bl|km|sala|loja|andar|kitnet|kit)\s*$/;

/**
 * O número da casa no texto: no fim do pedaço da rua ("Rua Diamante 53") ou
 * num pedaço logo depois ("…, 53", "…, nº 53"). Número de "casa 2", "lote 5",
 * "qd 3" não é o da rua; número no meio do nome ("Rua 12 de Maio") também não.
 */
export function numeroDaCasa(texto: string): number | null {
  const partes = String(texto || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+[-–]\s+|[,;]/)
    .map((s) => normalizar(s))
    .filter(Boolean);
  for (let i = 0; i < Math.min(partes.length, 3); i++) {
    const p = partes[i];
    const m = i === 0 ? p.match(/^(.*[a-z].*?)\s+(?:n|no|nr|num|numero)?\s*(\d{1,5})$/) : p.match(/^()(?:n|no|nr|num|numero)?\s*(\d{1,5})\b/);
    if (!m) continue;
    if (NAO_E_NUMERO_DA_CASA.test(m[1])) continue;
    const n = Number(m[2]);
    if (n > 0) return n;
  }
  return null;
}

/**
 * A rua sem o tipo escrito ("Diamante, 19 - Monte Alegre", "Maria José 10,
 * boca do mato"): o primeiro pedaço do texto, sem o número do fim. Vazio se
 * não sobra nome (só número, ou menos de 4 letras).
 */
export function primeiroPedaco(texto: string): string {
  const p = String(texto || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+[-–]\s+|[,;]/)[0]
    .replace(/\s+(n[º°o.]*\s*)?\d+\s*$/i, "")
    .trim();
  return p.replace(/[^a-zA-ZÀ-ÿ]/g, "").length >= 4 ? p : "";
}

// O CNEFE vem em maiúsculas e sem acento ("JARDIM PERO"). O acento volta pelo
// que o próprio cliente escreveu ("jardim peró") e, sem isso, pelas palavras
// mais comuns em nome de rua e bairro.
const ACENTOS: Record<string, string> = {
  sao: "São", joao: "João", jose: "José", conceicao: "Conceição", esperanca: "Esperança", pero: "Peró", jacare: "Jacaré",
  cristovao: "Cristóvão", caicara: "Caiçara", california: "Califórnia", parana: "Paraná", paraiba: "Paraíba", amazonas: "Amazonas",
  brasilia: "Brasília", goias: "Goiás", ceara: "Ceará", piaui: "Piauí", maranhao: "Maranhão", para: "Pará", sebastiao: "Sebastião",
  antonio: "Antônio", fatima: "Fátima", gloria: "Glória", vitoria: "Vitória", jardim: "Jardim", buzios: "Búzios",
  praca: "Praça", alvorada: "Alvorada", uniao: "União", independencia: "Independência", republica: "República", america: "América",
  inacio: "Inácio", lucia: "Lúcia", luis: "Luís", mario: "Mário", julio: "Júlio", cesar: "César", vinicius: "Vinícius",
  getulio: "Getúlio", tiradentes: "Tiradentes", oceanica: "Oceânica", atlantica: "Atlântica", atlantico: "Atlântico", sitio: "Sítio",
  chacara: "Chácara", agua: "Água", aguas: "Águas", tamoios: "Tamoios", canaa: "Canaã", rosario: "Rosário", nazare: "Nazaré",
  belem: "Belém", sumare: "Sumaré",
};

/** "JARDIM PERO" → "Jardim Peró": título, e o acento do texto do cliente ou do dicionário. */
export function nomeComAcento(doIbge: string, textoDoCliente?: string | null): string {
  const doCliente = new Map<string, string>();
  for (const w of String(textoDoCliente || "").split(/[^A-Za-zÀ-ÿ]+/)) {
    if (!w || w === semAcento(w)) continue;
    doCliente.set(semAcento(w).toLowerCase(), w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return nomeExibido(doIbge)
    .split(" ")
    .map((p) => {
      const k = semAcento(p).toLowerCase();
      const c = doCliente.get(k) || ACENTOS[k];
      if (!c) return p;
      return p.charAt(0) === p.charAt(0).toLowerCase() ? c.toLowerCase() : c;
    })
    .join(" ");
}
