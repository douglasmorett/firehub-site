/**
 * O bairro escrito no texto do endereço — sem mapa e sem banco.
 *
 * Saiu de lib/relatorios/areas-de-entrega.ts em 02/10/2026, sem mudar uma
 * linha da regra, para a comanda impressa (lib/endereco-impresso.ts) usar a
 * MESMA régua do relatório. Lá ela vinha presa a um arquivo que importa a
 * geocodificação inteira, e a impressão roda também no navegador do painel:
 * levar o relatório junto só para achar o bairro pesaria em toda tela da loja.
 * O relatório reexporta `bairroDoEndereco` de lá — quem já importava de lá
 * continua igual.
 */

/** Sem acento, minúsculo, espaços simples — igual a normalizarTexto (lib/area-de-entrega.ts). */
function semAcento(texto: unknown): string {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const UFS = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr",
  "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
]);

/** Parte que é complemento ou referência, nunca bairro ("Comp: Casa 2", "Ref: portão azul"). */
const COMPLEMENTO_RE = /^(comp(lemento)?|ref(er[eê]ncia)?|obs(erva[cç][aã]o)?|ponto de refer[eê]ncia)\b\s*[:.]?/i;

/** Pedaço separado por vírgula que é pedaço da casa, não do bairro ("casa 3", "apto 201", "LT 12"). */
export const PEDACO_DA_CASA_RE = /^(casa|ap|apt|apto|apartamento|bloco|bl|lote|lt|sala|loja|fundos|sobrado|port[aã]o|s\/?n|sn|km)\b/i;

function ehCep(parte: string): boolean {
  const n = semAcento(parte);
  return /\bcep\b/.test(n) || /^\d{5}-?\d{3}$/.test(n);
}

function ehNumero(parte: string): boolean {
  return /^[\d\s./-]*\d[\d\s./-]*[a-z]?$/i.test(parte.trim()) || /^s\/?n$/i.test(parte.trim()) || /^sem n[uú]mero$/i.test(parte.trim());
}

function ehUf(parte: string): boolean {
  return UFS.has(semAcento(parte));
}

/**
 * A parte é a cidade (ou "cidade/UF", "UF", "Brasil")? `cidades` são as que
 * se sabe: a da loja e a que o formato do canal põe no fim.
 */
function ehCidadeOuPais(parte: string, cidades: string[]): boolean {
  const n = semAcento(parte);
  if (!n) return true;
  if (n === "brasil" || n === "brazil") return true;
  if (ehUf(n)) return true;
  // "Brasília/DF", "Rio das Ostras/RJ" — o jeito da Wabiz escrever a cidade.
  if (/^[^/]{2,}\/\s*[a-z]{2}$/.test(n)) return true;
  return cidades.some((c) => n === c || n.startsWith(`${c}/`));
}

function limparParte(parte: string): string {
  return parte
    .replace(/^\s*(bairro|b\.)\s*:?\s*/i, "")
    .replace(/[|•]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:\-]+|[\s.,;:\-]+$/g, "")
    .trim();
}

/** Tem cara de bairro: tem letra e não é longo demais para ser nome de lugar. */
function pareceBairro(parte: string): boolean {
  if (!/[a-zà-ú]/i.test(parte)) return false;
  if (parte.length < 2 || parte.length > 40) return false;
  return parte.split(" ").length <= 6;
}

/**
 * O bairro escrito no endereço, sem mapa: o texto livre de cada canal.
 *
 * Os formatos que chegam (medidos em produção em 24/09/2026):
 *   iFood   "Q 11 Cl, 10 - Comp: Apto 102 - Ref: Academia - Sobradinho - Brasília"
 *   Brendi  "Rua Caravelas, 59 - Sobrado - Trindade - São Gonçalo"
 *   JotaJá  "Rua da Fonte, 512, Portão marrom, Nova Cidade - Rio das Ostras - Brasil - Rio das Ostras"
 *   Wabiz   "Quadra 16 conjunto G, Sn - Casa 10 - QUADRA 16 - Brasília/DF - CEP 73050167"
 *   99Food  "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco"
 *   Site    "Rua das Casuarinas, 20 - Âncora (Apartamento 201)"
 *   Robô    "Rua Paranaíba, 470, Operário, Rio das Ostras"
 *
 * A regra: quebra no " - ", joga fora complemento, referência, CEP, cidade,
 * UF e número; o bairro é a ÚLTIMA parte que sobra depois da rua (todos os
 * canais põem o bairro logo antes da cidade). Parte com vírgula ("Liberdade,
 * Rio das Ostras", da 99) vale pelo primeiro pedaço. Nada depois da rua? Tenta
 * os pedaços da própria rua separados por vírgula (o robô e a JotaJá escrevem
 * "rua, número, bairro").
 *
 * `ultimaParteEhCidade`: no iFood, na Brendi e na JotaJá a última parte é
 * SEMPRE a cidade do cliente — que pode não ser a da loja (Hakim Unamar
 * entrega em Cabo Frio), e aí só o formato diz que aquilo não é bairro.
 *
 * Não acha bairro = null. Nunca chuta a rua como bairro.
 */
export function bairroDoEndereco(
  texto: string | null | undefined,
  opcoes: { cidades?: (string | null | undefined)[]; ultimaParteEhCidade?: boolean } = {},
): string | null {
  let t = String(texto || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // O complemento do site vem entre parênteses: "Âncora (Apartamento 201)".
  t = t.replace(/\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  // Rodovia escrita com o hífen espaçado ("DF - 425", "BR - 101") não é duas partes.
  t = t.replace(/\b([a-z]{2})\s+-\s+(\d{2,3})\b/gi, (m, uf: string, n: string) => (UFS.has(uf.toLowerCase()) || uf.toLowerCase() === "br" ? `${uf}-${n}` : m));

  const cidades = (opcoes.cidades || []).map((c) => semAcento(String(c || ""))).filter(Boolean);
  const partes = t.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);

  if (opcoes.ultimaParteEhCidade && partes.length >= 2) {
    const cidadeDoCliente = semAcento(partes[partes.length - 1]);
    if (cidadeDoCliente) cidades.push(cidadeDoCliente);
    partes.pop();
  }

  const descartavel = (p: string) => COMPLEMENTO_RE.test(p) || ehCep(p) || ehNumero(p) || ehCidadeOuPais(p, cidades);

  // O primeiro pedaço útil de uma parte com vírgula ("Liberdade, Rio das Ostras").
  const daParte = (p: string): string | null => {
    for (const pedaco of p.split(",").map(limparParte)) {
      if (!pedaco || descartavel(pedaco) || PEDACO_DA_CASA_RE.test(pedaco)) continue;
      return pareceBairro(pedaco) ? pedaco : null;
    }
    return null;
  };

  const candidatos = partes.slice(1)
    .filter((p) => !descartavel(p) && !descartavel(p.split(",")[0].trim()))
    .map(daParte)
    .filter((p): p is string => Boolean(p));
  if (candidatos.length) return candidatos[candidatos.length - 1];

  // Nada depois da rua: "Rua Paranaíba, 470, Operário, Rio das Ostras".
  const pedacos = (partes[0] || "").split(",").map(limparParte).filter(Boolean);
  for (let i = pedacos.length - 1; i >= 1; i--) {
    const p = pedacos[i];
    if (descartavel(p) || PEDACO_DA_CASA_RE.test(p)) continue;
    if (pareceBairro(p)) return p;
    break;
  }
  return null;
}
