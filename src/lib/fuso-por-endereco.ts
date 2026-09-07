/**
 * src/lib/fuso-por-endereco.ts
 *
 * O fuso horário da loja vem do ENDEREÇO cadastrado, não de uma escolha solta.
 *
 * O FireHub atende o país inteiro, e o Brasil tem quatro fusos: Brasília
 * (UTC-3, a maioria), Manaus/Cuiabá/Campo Grande/Porto Velho/Boa Vista (UTC-4),
 * Rio Branco (UTC-5) e Fernando de Noronha (UTC-2). Horário de funcionamento,
 * "hoje", promoção do dia, hora do pedido agendado na comanda, tudo depende de
 * saber em que relógio a loja vive. Deixar isso num seletor que ninguém mexe
 * (todas as 37 lojas estavam em America/Sao_Paulo em 06/09/2026, inclusive as
 * que nunca escolheram nada) é esperar que uma loja de Manaus descubra sozinha
 * que o sistema fecha o delivery dela uma hora antes.
 *
 * Regra: se a cidade ou o endereço dizem o estado, o fuso é o do estado e o
 * seletor obedece. Só quando o endereço não diz nada o lojista escolhe à mão.
 *
 * Puro (sem prisma), para servir ao servidor e ao formulário da loja.
 */

export type FusoDoBrasil = { fuso: string; rotulo: string };

/** As opções do seletor — os fusos que o Brasil realmente usa (sem horário de verão desde 2019). */
export const FUSOS_DO_BRASIL: FusoDoBrasil[] = [
  { fuso: "America/Sao_Paulo", rotulo: "Brasília / Rio de Janeiro / São Paulo (GMT-3)" },
  { fuso: "America/Bahia", rotulo: "Bahia (GMT-3)" },
  { fuso: "America/Fortaleza", rotulo: "Ceará / Maranhão / Piauí / RN / Paraíba (GMT-3)" },
  { fuso: "America/Recife", rotulo: "Pernambuco (GMT-3)" },
  { fuso: "America/Belem", rotulo: "Pará / Amapá (GMT-3)" },
  { fuso: "America/Manaus", rotulo: "Amazonas / Manaus (GMT-4)" },
  { fuso: "America/Cuiaba", rotulo: "Mato Grosso / Cuiabá (GMT-4)" },
  { fuso: "America/Campo_Grande", rotulo: "Mato Grosso do Sul / Campo Grande (GMT-4)" },
  { fuso: "America/Porto_Velho", rotulo: "Rondônia / Porto Velho (GMT-4)" },
  { fuso: "America/Boa_Vista", rotulo: "Roraima / Boa Vista (GMT-4)" },
  { fuso: "America/Rio_Branco", rotulo: "Acre / Rio Branco (GMT-5)" },
  { fuso: "America/Noronha", rotulo: "Fernando de Noronha (GMT-2)" },
];

export function rotuloDoFuso(fuso: string | null | undefined): string {
  return FUSOS_DO_BRASIL.find((f) => f.fuso === fuso)?.rotulo || String(fuso || "");
}

const UF_PARA_FUSO: Record<string, string> = {
  AC: "America/Rio_Branco",
  AM: "America/Manaus",
  RR: "America/Boa_Vista",
  RO: "America/Porto_Velho",
  MT: "America/Cuiaba",
  MS: "America/Campo_Grande",
  BA: "America/Bahia",
  CE: "America/Fortaleza", MA: "America/Fortaleza", PI: "America/Fortaleza", RN: "America/Fortaleza", PB: "America/Fortaleza",
  PE: "America/Recife",
  PA: "America/Belem", AP: "America/Belem",
  // O resto do país vive no relógio de Brasília.
  AL: "America/Sao_Paulo", SE: "America/Sao_Paulo", TO: "America/Sao_Paulo", GO: "America/Sao_Paulo", DF: "America/Sao_Paulo",
  MG: "America/Sao_Paulo", ES: "America/Sao_Paulo", RJ: "America/Sao_Paulo", SP: "America/Sao_Paulo",
  PR: "America/Sao_Paulo", SC: "America/Sao_Paulo", RS: "America/Sao_Paulo",
};

/** Nome por extenso → UF. Os compostos vêm ANTES dos simples ("Mato Grosso do Sul" antes de "Mato Grosso"). */
const NOME_DE_ESTADO: Array<[string, string]> = [
  ["MATO GROSSO DO SUL", "MS"], ["MATO GROSSO", "MT"], ["AMAZONAS", "AM"], ["RONDONIA", "RO"], ["RORAIMA", "RR"], ["ACRE", "AC"],
  ["RIO GRANDE DO NORTE", "RN"], ["RIO GRANDE DO SUL", "RS"], ["RIO DE JANEIRO", "RJ"], ["SAO PAULO", "SP"], ["MINAS GERAIS", "MG"],
  ["ESPIRITO SANTO", "ES"], ["SANTA CATARINA", "SC"], ["PARANA", "PR"], ["BAHIA", "BA"], ["CEARA", "CE"], ["PERNAMBUCO", "PE"],
  ["PARAIBA", "PB"], ["MARANHAO", "MA"], ["PIAUI", "PI"], ["ALAGOAS", "AL"], ["SERGIPE", "SE"], ["GOIAS", "GO"],
  ["DISTRITO FEDERAL", "DF"], ["TOCANTINS", "TO"], ["AMAPA", "AP"], ["PARA", "PA"],
];

/**
 * Cidades dos estados FORA do relógio de Brasília — para quando o cadastro
 * traz só a cidade ("MANAUS"), como faz a tela de cadastro. Só vale no campo
 * cidade: "Avenida Amazonas" é nome de rua em meio país.
 */
const CIDADE_PARA_FUSO: Record<string, string> = {
  // Amazonas (Eirunepé e o oeste do estado seguem o Acre)
  MANAUS: "America/Manaus", PARINTINS: "America/Manaus", ITACOATIARA: "America/Manaus", MANACAPURU: "America/Manaus",
  COARI: "America/Manaus", TEFE: "America/Manaus", TABATINGA: "America/Manaus", MAUES: "America/Manaus", HUMAITA: "America/Manaus",
  EIRUNEPE: "America/Rio_Branco",
  // Acre
  "RIO BRANCO": "America/Rio_Branco", "CRUZEIRO DO SUL": "America/Rio_Branco", "SENA MADUREIRA": "America/Rio_Branco",
  TARAUACA: "America/Rio_Branco", FEIJO: "America/Rio_Branco",
  // Roraima
  "BOA VISTA": "America/Boa_Vista", RORAINOPOLIS: "America/Boa_Vista", CARACARAI: "America/Boa_Vista",
  // Rondônia
  "PORTO VELHO": "America/Porto_Velho", "JI-PARANA": "America/Porto_Velho", "JI PARANA": "America/Porto_Velho",
  ARIQUEMES: "America/Porto_Velho", VILHENA: "America/Porto_Velho", CACOAL: "America/Porto_Velho", JARU: "America/Porto_Velho",
  "ROLIM DE MOURA": "America/Porto_Velho", "GUAJARA-MIRIM": "America/Porto_Velho", "GUAJARA MIRIM": "America/Porto_Velho",
  // Mato Grosso
  CUIABA: "America/Cuiaba", "VARZEA GRANDE": "America/Cuiaba", RONDONOPOLIS: "America/Cuiaba", SINOP: "America/Cuiaba",
  "TANGARA DA SERRA": "America/Cuiaba", CACERES: "America/Cuiaba", SORRISO: "America/Cuiaba", "LUCAS DO RIO VERDE": "America/Cuiaba",
  "BARRA DO GARCAS": "America/Cuiaba", "PRIMAVERA DO LESTE": "America/Cuiaba", "ALTA FLORESTA": "America/Cuiaba",
  // Mato Grosso do Sul
  "CAMPO GRANDE": "America/Campo_Grande", DOURADOS: "America/Campo_Grande", "TRES LAGOAS": "America/Campo_Grande",
  CORUMBA: "America/Campo_Grande", "PONTA PORA": "America/Campo_Grande", NAVIRAI: "America/Campo_Grande",
  "NOVA ANDRADINA": "America/Campo_Grande", AQUIDAUANA: "America/Campo_Grande",
  // Pernambuco, mas duas horas de diferença
  "FERNANDO DE NORONHA": "America/Noronha",
};

const UFS = Object.keys(UF_PARA_FUSO).join("|");
/** UF como sigla isolada: "Macaé - RJ", "Manaus/AM", "Franca, SP", "RJ" sozinho. */
const RE_UF = new RegExp(`(?:^|[\\s,\\-\\/(])(${UFS})(?=$|[\\s,.)\\-\\/])`);

function normalizar(texto: unknown): string {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type FusoPeloEndereco = {
  fuso: string;
  /** Sigla do estado reconhecido, quando houver. */
  uf?: string;
  /** Por que chegou nesse fuso — texto curto para a tela. */
  origem: string;
};

/**
 * O fuso que o endereço da loja determina, ou null se o endereço não diz o
 * estado (e aí o seletor manual vale).
 *
 * Ordem: UF na cidade → UF no endereço → nome do estado (depois de vírgula,
 * hífen ou barra, para "Rua Amazonas" não virar Manaus) → cidade conhecida
 * fora do fuso de Brasília.
 */
export function fusoPorEndereco(loja: { city?: string | null; storeAddress?: string | null }): FusoPeloEndereco | null {
  const cidade = normalizar(loja.city);
  const endereco = normalizar(loja.storeAddress);

  for (const [campo, texto] of [["cidade", cidade], ["endereço", endereco]] as const) {
    const m = texto.match(RE_UF);
    if (m) {
      const uf = m[1];
      return { fuso: UF_PARA_FUSO[uf], uf, origem: `UF ${uf} na ${campo}` };
    }
  }

  for (const [campo, texto] of [["cidade", cidade], ["endereço", endereco]] as const) {
    for (const [nome, uf] of NOME_DE_ESTADO) {
      // Depois de um separador ou no começo do campo: "Ananindeua - Pará",
      // "Macaé, Rio de Janeiro, Brasil". No meio de uma rua, não conta.
      const re = new RegExp(`(?:^|[,\\-\\/]\\s*)${nome}(?=$|[\\s,.\\-\\/)])`);
      if (re.test(texto)) return { fuso: UF_PARA_FUSO[uf], uf, origem: `${campo} diz ${nome.charAt(0)}${nome.slice(1).toLowerCase()}` };
    }
  }

  if (cidade) {
    // A cidade pode vir com sufixo ("MANAUS - CENTRO"): compara o começo.
    for (const [nome, fuso] of Object.entries(CIDADE_PARA_FUSO)) {
      if (cidade === nome || cidade.startsWith(nome + " ") || cidade.startsWith(nome + ",") || cidade.startsWith(nome + " -")) {
        return { fuso, origem: `cidade ${nome.charAt(0)}${nome.slice(1).toLowerCase()}` };
      }
    }
  }

  return null;
}
