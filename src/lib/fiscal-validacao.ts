/**
 * /src/lib/fiscal-validacao.ts
 *
 * Validação dos dados fiscais, com as regras que a SEFAZ realmente aplica.
 *
 * Existe porque o módulo fiscal aceitava qualquer coisa: NCM vazio virava
 * "2106.90.90" em silêncio e o produto passava a exibir situação "Regular";
 * CNPJ, IE, CFOP e CEST não eram conferidos em camada nenhuma. O lojista
 * chegava na hora de emitir achando que estava tudo certo e levava rejeição da
 * SEFAZ item por item — que é o pior momento possível para descobrir, porque a
 * fila está esperando o cupom.
 *
 * A ideia aqui é falhar cedo e falar claro: dizer QUAL campo está errado, POR
 * QUE, e o que a SEFAZ espera no lugar.
 */

export type Problema = {
  campo: string;
  valor: string | null;
  mensagem: string;
};

const somenteDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

// ─── CNPJ / CPF ──────────────────────────────────────────────────────────────

/** Confere os dois dígitos verificadores do CNPJ. */
export function cnpjValido(entrada: unknown): boolean {
  const c = somenteDigitos(entrada);
  if (c.length !== 14) return false;
  // Todos os dígitos iguais passam na conta do DV mas não existem como CNPJ.
  if (/^(\d)\1{13}$/.test(c)) return false;

  const digito = (base: string): number => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return digito(c.slice(0, 12)) === Number(c[12]) && digito(c.slice(0, 13)) === Number(c[13]);
}

/** Confere os dois dígitos verificadores do CPF. */
export function cpfValido(entrada: unknown): boolean {
  const c = somenteDigitos(entrada);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const digito = (base: string, pesoInicial: number): number => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(c.slice(0, 9), 10) === Number(c[9]) && digito(c.slice(0, 10), 11) === Number(c[10]);
}

/** CPF ou CNPJ, o que o tamanho indicar. Usado no destinatário da NFC-e. */
export function documentoValido(entrada: unknown): boolean {
  const c = somenteDigitos(entrada);
  if (c.length === 11) return cpfValido(c);
  if (c.length === 14) return cnpjValido(c);
  return false;
}

// ─── Códigos fiscais ─────────────────────────────────────────────────────────

/**
 * NCM: 8 dígitos, obrigatório em todo item da nota.
 *
 * Aceita com ou sem os pontos ("1604.20.90" e "16042090"), porque é assim que o
 * lojista copia da tabela da Receita — mas o XML vai sempre só com os dígitos.
 */
export function ncmValido(entrada: unknown): boolean {
  return somenteDigitos(entrada).length === 8;
}

/** CFOP: 4 dígitos. Venda presencial no estado é 5102; fora do estado, 6102. */
export function cfopValido(entrada: unknown): boolean {
  const c = somenteDigitos(entrada);
  if (c.length !== 4) return false;
  // O primeiro dígito é a natureza: 1/2/3 é entrada, 5/6/7 é saída.
  // Nota de venda é sempre saída — entrada aqui é erro de digitação.
  return ["5", "6", "7"].includes(c[0]);
}

/** CEST: 7 dígitos. Só é exigido em produto sujeito a substituição tributária. */
export function cestValido(entrada: unknown): boolean {
  const c = somenteDigitos(entrada);
  return c.length === 0 || c.length === 7;
}

/**
 * CSOSN (Simples Nacional) — 3 dígitos, da tabela oficial.
 * Restaurante no Simples normalmente usa 102 (sem permissão de crédito).
 */
const CSOSN_VALIDOS = ["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"];
export function csosnValido(entrada: unknown): boolean {
  return CSOSN_VALIDOS.includes(String(entrada ?? "").trim());
}

/** CST de ICMS (Regime Normal) — 2 dígitos da tabela B. */
const CST_ICMS_VALIDOS = ["00", "10", "20", "30", "40", "41", "50", "51", "60", "70", "90"];
export function cstIcmsValido(entrada: unknown): boolean {
  return CST_ICMS_VALIDOS.includes(String(entrada ?? "").trim().padStart(2, "0"));
}

/** Origem da mercadoria: 0 a 8 (0 = nacional, que é o caso de quase tudo). */
export function origemValida(entrada: unknown): boolean {
  const n = Number(entrada);
  return Number.isInteger(n) && n >= 0 && n <= 8;
}

/** Código IBGE do município: 7 dígitos. Vai no endereço do emitente. */
export function codigoIbgeValido(entrada: unknown): boolean {
  return somenteDigitos(entrada).length === 7;
}

/** CEP: 8 dígitos. */
export function cepValido(entrada: unknown): boolean {
  return somenteDigitos(entrada).length === 8;
}

// ─── Inscrição Estadual ──────────────────────────────────────────────────────

/**
 * Quantidade de dígitos da IE por estado.
 *
 * Cada estado tem seu próprio algoritmo de dígito verificador, e implementar os
 * 27 aqui seria trocar um erro por outro: uma conta errada REJEITA uma inscrição
 * boa, e o lojista fica sem conseguir cadastrar. Conferimos o tamanho — que pega
 * o engano comum de digitar a menos ou colar o CNPJ no lugar — e deixamos a
 * validação completa para a SEFAZ, que é quem tem a tabela real.
 *
 * "ISENTO" é aceito: é o que vai no XML de quem não tem inscrição.
 */
const DIGITOS_DA_IE: Record<string, number[]> = {
  AC: [13], AL: [9], AM: [9], AP: [9], BA: [8, 9], CE: [9], DF: [13],
  ES: [9], GO: [9], MA: [9], MG: [13], MS: [9], MT: [11], PA: [9],
  PB: [9], PE: [9, 14], PI: [9], PR: [10], RJ: [8], RN: [9, 10],
  RO: [14], RR: [9], RS: [10], SC: [9], SE: [9], SP: [12], TO: [9, 11],
};

export function inscricaoEstadualValida(entrada: unknown, uf: unknown): boolean {
  const valor = String(entrada ?? "").trim().toUpperCase();
  if (valor === "ISENTO" || valor === "ISENTA") return true;

  const digitos = somenteDigitos(valor);
  if (digitos.length === 0) return false;

  const tamanhos = DIGITOS_DA_IE[String(uf ?? "").trim().toUpperCase()];
  if (!tamanhos) return digitos.length >= 8 && digitos.length <= 14; // UF desconhecida: só faixa
  return tamanhos.includes(digitos.length);
}

// ─── Conferência de conjunto ────────────────────────────────────────────────

export type DadosDoEmitente = {
  cnpj?: string | null;
  inscricaoEstadual?: string | null;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  regimeTributario?: number | string | null; // CRT: 1 Simples, 2 Simples excesso, 3 Normal
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  codigoMunicipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  serie?: number | string | null;
  ambiente?: number | string | null; // 1 produção, 2 homologação
  cscId?: string | null;
  csc?: string | null;
  temCertificado?: boolean;
};

/**
 * O que ainda falta para esta loja conseguir emitir NFC-e.
 *
 * Devolve a lista de pendências em vez de um "válido/inválido": a tela precisa
 * dizer ao lojista exatamente o que buscar, porque cada item vem de um lugar
 * diferente (o CSC sai do portal da SEFAZ, o certificado A1 de uma
 * certificadora, o código IBGE da tabela do município).
 */
export function pendenciasDoEmitente(d: DadosDoEmitente): Problema[] {
  const faltas: Problema[] = [];
  const exigir = (ok: boolean, campo: string, valor: unknown, mensagem: string) => {
    if (!ok) faltas.push({ campo, valor: valor == null ? null : String(valor), mensagem });
  };

  exigir(cnpjValido(d.cnpj), "cnpj", d.cnpj, "CNPJ inválido ou não preenchido. São 14 dígitos e os dois últimos são conferidos.");
  exigir(
    inscricaoEstadualValida(d.inscricaoEstadual, d.uf),
    "inscricaoEstadual",
    d.inscricaoEstadual,
    'Inscrição Estadual inválida para a UF informada. Se a loja não tem inscrição, escreva "ISENTO".'
  );
  exigir(Boolean(d.razaoSocial?.trim()), "razaoSocial", d.razaoSocial, "Razão social é obrigatória — é o nome que consta no CNPJ.");

  const crt = Number(d.regimeTributario);
  exigir([1, 2, 3].includes(crt), "regimeTributario", d.regimeTributario, "Informe o regime: 1 Simples Nacional, 2 Simples com excesso de sublimite, 3 Regime Normal.");

  exigir(Boolean(d.logradouro?.trim()), "logradouro", d.logradouro, "Endereço do emitente é obrigatório no XML.");
  exigir(Boolean(d.numero?.trim()), "numero", d.numero, 'Número do endereço é obrigatório. Sem número, escreva "S/N".');
  exigir(Boolean(d.bairro?.trim()), "bairro", d.bairro, "Bairro é obrigatório no XML.");
  exigir(Boolean(d.municipio?.trim()), "municipio", d.municipio, "Município é obrigatório.");
  exigir(codigoIbgeValido(d.codigoMunicipio), "codigoMunicipio", d.codigoMunicipio, "Código IBGE do município: 7 dígitos. É diferente do CEP.");
  exigir(/^[A-Z]{2}$/.test(String(d.uf ?? "").toUpperCase()), "uf", d.uf, "UF com duas letras (ex.: RJ).");
  exigir(cepValido(d.cep), "cep", d.cep, "CEP com 8 dígitos.");

  exigir(Number(d.serie) >= 1, "serie", d.serie, "Série da NFC-e (normalmente 1). A SEFAZ exige série declarada.");
  exigir([1, 2].includes(Number(d.ambiente)), "ambiente", d.ambiente, "Ambiente: 2 para homologação (teste), 1 para produção (vale de verdade).");

  exigir(Boolean(d.cscId?.trim()), "cscId", d.cscId, "ID do CSC (idToken), obtido no portal da SEFAZ do seu estado.");
  exigir(Boolean(d.csc?.trim()), "csc", d.csc, "Código de Segurança do Contribuinte (CSC), obtido no portal da SEFAZ. É o que assina o QR Code da NFC-e.");
  exigir(Boolean(d.temCertificado), "certificado", null, "Certificado digital A1 (.pfx) e senha. Sem ele nada é assinado e nada é transmitido.");

  return faltas;
}

export type DadosFiscaisDoProduto = {
  nome?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  csosn?: string | null;
  cst?: string | null;
  origem?: number | string | null;
  unidadeComercial?: string | null;
};

/** O que falta neste produto para ele poder virar item de nota. */
export function pendenciasDoProduto(p: DadosFiscaisDoProduto, regime: number): Problema[] {
  const faltas: Problema[] = [];
  const exigir = (ok: boolean, campo: string, valor: unknown, mensagem: string) => {
    if (!ok) faltas.push({ campo, valor: valor == null ? null : String(valor), mensagem });
  };

  exigir(ncmValido(p.ncm), "ncm", p.ncm, "NCM com 8 dígitos. Consulte a tabela da Receita para o seu produto — não existe NCM genérico válido.");
  exigir(cfopValido(p.cfop), "cfop", p.cfop, "CFOP com 4 dígitos começando em 5, 6 ou 7. Venda presencial dentro do estado é 5102.");
  exigir(cestValido(p.cest), "cest", p.cest, "CEST tem 7 dígitos. Deixe vazio se o produto não é de substituição tributária.");
  exigir(Boolean(p.unidadeComercial?.trim()), "unidadeComercial", p.unidadeComercial, 'Unidade comercial (ex.: "UN", "KG"). Vai no XML como unidade de venda.');
  exigir(origemValida(p.origem), "origem", p.origem, "Origem da mercadoria de 0 a 8. Produto feito no Brasil é 0.");

  // Simples Nacional usa CSOSN; Regime Normal usa CST. Cobrar os dois é errado.
  if (regime === 3) {
    exigir(cstIcmsValido(p.cst), "cst", p.cst, "CST de ICMS (2 dígitos) é obrigatório no Regime Normal.");
  } else {
    exigir(csosnValido(p.csosn), "csosn", p.csosn, "CSOSN (3 dígitos) é obrigatório no Simples Nacional. Restaurante costuma usar 102.");
  }

  return faltas;
}
