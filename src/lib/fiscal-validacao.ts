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

/**
 * Confere os dois dígitos verificadores do CNPJ.
 *
 * Aceita também o CNPJ ALFANUMÉRICO (vigente desde julho/2026): 12 posições
 * de letras/números + 2 dígitos verificadores numéricos. No cálculo do DV,
 * cada caractere vale seu código ASCII menos 48 (regra da Receita/SERPRO) —
 * para dígitos isso dá o próprio número, então a conta continua valendo para
 * o CNPJ tradicional.
 */
export function cnpjValido(entrada: unknown): boolean {
  const c = String(entrada ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (c.length !== 14) return false;
  // Os dois DVs são SEMPRE numéricos, mesmo no formato alfanumérico.
  if (!/^\d{2}$/.test(c.slice(12))) return false;
  // Base inteiramente repetida passa na conta do DV mas não existe como CNPJ.
  if (/^(.)\1{13}$/.test(c)) return false;

  const valor = (ch: string): number => ch.charCodeAt(0) - 48;

  const digito = (base: string): number => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += valor(base[i]) * peso--;
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

/**
 * CPF ou CNPJ, o que o tamanho indicar. Usado no destinatário da NFC-e.
 *
 * Tira só a máscara, NÃO as letras: o CNPJ alfanumérico está no schema da
 * NF-e/NFC-e desde 01/07/2026 (NT 2026.004). Com `somenteDigitos`, um CNPJ
 * "12ABC34501DE35" virava "123450135" — 9 caracteres, "documento inválido" —
 * e o cliente empresa ficava sem nota. CPF continua só com dígitos: letra em
 * CPF é erro de digitação, e `cpfValido` recusa.
 */
export function documentoValido(entrada: unknown): boolean {
  const c = String(entrada ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (c.length === 11) return /^\d{11}$/.test(c) && cpfValido(c);
  if (c.length === 14) return cnpjValido(c);
  return false;
}

/**
 * Chave de acesso da NF-e/NFC-e: 44 posições.
 *
 * Desde a NT 2026.004 a chave pode ter LETRAS (ela carrega o CNPJ do
 * emitente, e o CNPJ agora pode ser alfanumérico). E a Focus devolve a chave
 * com o prefixo "NFe" ("NFe4119..."), que não faz parte dela — gravar com o
 * prefixo dá 47 caracteres, e a consulta pública da SEFAZ não encontra.
 *
 * Devolve a chave limpa (maiúsculas, sem prefixo, sem espaço) ou null.
 */
export function chaveDeAcessoLimpa(entrada: unknown): string | null {
  const c = String(entrada ?? "").trim().replace(/^NFe/i, "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^[0-9A-Z]{44}$/.test(c) ? c : null;
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
  const v = String(entrada ?? "").trim();
  // Vazio NÃO é CST: o padStart de antes transformava "" (e null) em "00",
  // que está na tabela — produto sem CST passava na validação e a nota ia
  // sem situação tributária para a SEFAZ recusar.
  if (!/^\d{1,2}$/.test(v)) return false;
  return CST_ICMS_VALIDOS.includes(v.padStart(2, "0"));
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
  regimeTributario?: number | string | null; // CRT: 1 Simples, 2 Simples excesso, 3 Normal, 4 MEI
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
  // Quem EMITE NFC-e obrigatoriamente tem Inscrição Estadual — "ISENTO" vale
  // para destinatário, nunca para o emitente. Aceitar aqui mandava a IE vazia
  // no XML (o replace tira as letras) e a SEFAZ rejeitava toda nota.
  const ieDoEmitente = String(d.inscricaoEstadual ?? "").trim().toUpperCase();
  if (ieDoEmitente === "ISENTO" || ieDoEmitente === "ISENTA") {
    faltas.push({
      campo: "inscricaoEstadual",
      valor: ieDoEmitente,
      mensagem:
        "Quem emite NFC-e precisa de Inscrição Estadual ativa — \"ISENTO\" não vale para o emitente. " +
        "Solicite a inscrição na SEFAZ do seu estado antes de emitir.",
    });
  } else {
    exigir(
      inscricaoEstadualValida(d.inscricaoEstadual, d.uf),
      "inscricaoEstadual",
      d.inscricaoEstadual,
      "Inscrição Estadual inválida para a UF informada. Confira no cartão CNPJ / SEFAZ do estado."
    );
  }
  exigir(Boolean(d.razaoSocial?.trim()), "razaoSocial", d.razaoSocial, "Razão social é obrigatória — é o nome que consta no CNPJ.");

  const crt = Number(d.regimeTributario);
  exigir(
    [1, 2, 3, 4].includes(crt),
    "regimeTributario",
    d.regimeTributario,
    "Informe o regime: 1 Simples Nacional, 2 Simples com excesso de sublimite, 3 Regime Normal, 4 MEI."
  );
  // MEI (CRT 4) emite NFC-e desde a NT 2024.001 (produção em 02/09/2024). Ele
  // era recusado aqui só porque a lista parava no 3 — o microempreendedor
  // configurava tudo e ouvia "regime inválido". As restrições do MEI são por
  // ITEM (CFOP 5102 e CSOSN 102/300) e moram em `pendenciasDoProduto`.
  //
  // Regime Normal exige, por item, o grupo completo de ICMS (CST + base +
  // alíquota + valor), FCP onde a UF cobra, cBenef nas UFs que exigem código
  // de benefício (o RJ é uma delas) e, com a reforma, IBS/CBS — nada disso o
  // FireHub coleta nem envia ainda. Deixar configurar CRT 3 gerava nota com
  // situação tributária incompleta: rejeição em TODA emissão, sem tela para
  // corrigir. Fica bloqueado com o motivo por extenso.
  if (crt === 3) {
    faltas.push({
      campo: "regimeTributario",
      valor: "3",
      mensagem:
        "Regime Normal (CRT 3) ainda não é suportado pelo FireHub: a nota desse regime precisa, " +
        "item a item, de base e alíquota de ICMS, FCP, código de benefício fiscal (cBenef) e " +
        "IBS/CBS, que o sistema ainda não coleta. Hoje a emissão atende Simples Nacional (CRT 1 e 2) " +
        "e MEI (CRT 4). Fale com o suporte se sua loja é do Regime Normal.",
    });
  }

  exigir(Boolean(d.logradouro?.trim()), "logradouro", d.logradouro, "Endereço do emitente é obrigatório no XML.");
  exigir(Boolean(d.numero?.trim()), "numero", d.numero, 'Número do endereço é obrigatório. Sem número, escreva "S/N".');
  exigir(Boolean(d.bairro?.trim()), "bairro", d.bairro, "Bairro é obrigatório no XML.");
  exigir(Boolean(d.municipio?.trim()), "municipio", d.municipio, "Município é obrigatório.");
  exigir(codigoIbgeValido(d.codigoMunicipio), "codigoMunicipio", d.codigoMunicipio, "Código IBGE do município: 7 dígitos. É diferente do CEP.");
  exigir(/^[A-Z]{2}$/.test(String(d.uf ?? "").toUpperCase()), "uf", d.uf, "UF com duas letras (ex.: RJ).");
  exigir(cepValido(d.cep), "cep", d.cep, "CEP com 8 dígitos.");

  exigir(Number(d.serie) >= 1, "serie", d.serie, "Série da NFC-e (normalmente 1). A SEFAZ exige série declarada.");
  // Nota emitida pelo contribuinte (procEmi 0) com emitente CNPJ: série de 0
  // a 889 (MOC 7.0, Anexo I: B26-10, rejeição 244, e C02-30, rejeição 503);
  // a 890–919 é da nota avulsa do fisco. A mesma régua do emissor próprio
  // (lib/nfce/pendencias → SERIE_MAXIMA).
  exigir(
    !(Number(d.serie) > 889),
    "serie",
    d.serie,
    "Série da NFC-e de 1 a 889: a SEFAZ recusa série acima de 889 na nota emitida pela loja (rejeições 244 e 503)."
  );
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
    return faltas;
  }

  exigir(csosnValido(p.csosn), "csosn", p.csosn, "CSOSN (3 dígitos) é obrigatório no Simples Nacional. Restaurante costuma usar 102.");
  if (!csosnValido(p.csosn) || !cfopValido(p.cfop)) return faltas;

  const csosn = String(p.csosn).trim();
  const cfop = somenteDigitos(p.cfop);

  // ── MEI (CRT 4): a NFC-e só aceita CFOP 5102 e CSOSN 102 ou 300 ──────────
  // NT 2024.001, regras N12a-80/N12a-81 (rejeição 782) e I08 (rejeição 337):
  // "Se NFC-e (mod=65) aceitar somente o CSOSN 102 e 300" e "aceitar somente o
  // CFOP 5102". Uma bebida com CSOSN 500 (ST) no cadastro de um MEI derruba a
  // nota inteira na SEFAZ — melhor dizer aqui, item por item.
  if (regime === 4) {
    exigir(
      csosn === "102" || csosn === "300",
      "csosn",
      p.csosn,
      "MEI só pode usar CSOSN 102 ou 300 na NFC-e (a SEFAZ rejeita outros com o código 782)."
    );
    exigir(
      cfop === "5102",
      "cfop",
      p.cfop,
      "MEI só pode usar o CFOP 5102 na NFC-e (a SEFAZ rejeita outros com o código 337)."
    );
    return faltas;
  }

  // ── CSOSN que exige campos que o FireHub não envia ───────────────────────
  // 101 pede a alíquota e o valor do crédito do Simples (pCredSN/vCredICMSSN);
  // 201/202/203 pedem o grupo de ICMS-ST (MVA, base e valor retido). A nota
  // sairia com o grupo incompleto e voltaria rejeitada — e restaurante no
  // Simples, na venda ao consumidor, usa 102 (ou 500 na bebida com ST).
  if (["101", "201", "202", "203"].includes(csosn)) {
    faltas.push({
      campo: "csosn",
      valor: csosn,
      mensagem:
        `CSOSN ${csosn} exige dados de crédito do Simples ou de substituição tributária que o FireHub ` +
        "ainda não envia. Na venda ao consumidor, use 102 (ou 500 para produto que já veio com ST).",
    });
    return faltas;
  }

  // ── CSOSN 500 exige o CEST ───────────────────────────────────────────────
  // Ajuste SINIEF 19/16, cl. 4ª, VIII: a NFC-e "deverá conter" o CEST, de
  // preenchimento obrigatório no documento que acobertar operação com as
  // mercadorias listadas em convênio (Conv. ICMS 142/18) — e o CSOSN 500 diz
  // justamente que o ICMS da mercadoria já foi cobrado por substituição
  // tributária. Na NF-e a SEFAZ recusa sem ele (MOC 7.0, N23-10, rejeição
  // 806); na NFC-e a obrigação é do Ajuste. O lote de NCM já recusava a linha
  // (lib/nfce/ncm-sugerido → problemaDaCombinacao); faltava o produto avulso e
  // a emissão. CEST presente mas torto já é a pendência "cest" de formato.
  //
  // GTIN (cEAN) NÃO é conferido: o cadastro não tem o campo, e a nota vai com
  // "SEM GTIN" (NT 2017.001). Quem vende produto com código de barras terá de
  // informar o GTIN (Ajuste 19/16, cl. 4ª, VI) quando o cadastro ganhar o campo.
  if (csosn === "500" && somenteDigitos(p.cest).length === 0) {
    faltas.push({
      campo: "cest",
      valor: null,
      mensagem:
        "CSOSN 500 (substituição tributária) exige o CEST: produto com ICMS já cobrado por ST é mercadoria listada no " +
        "Convênio ICMS 142/18, e a nota tem de trazer o CEST dele (Ajuste SINIEF 19/16, cl. 4ª, VIII). " +
        "Refrigerante, água e cerveja têm CEST 03.xxx.xx — confira na tabela do convênio.",
    });
  }

  // ── CFOP compatível com o CSOSN na NFC-e ─────────────────────────────────
  // Regras N12a-40/N12a-44 (rejeição 386): CSOSN 102, 103, 300, 400 e 900 só
  // com CFOP 5101, 5102, 5103, 5104, 5115 ou 5910; CSOSN 500 (ICMS já cobrado
  // por ST) só com 5405, 5656, 5667 ou 5910. A combinação errada é o engano
  // clássico do refrigerante: CSOSN 500 com CFOP 5102.
  //
  // O 5910 (remessa em bonificação, doação ou brinde) entrou nas duas listas
  // e na de CFOP aceitos em NFC-e (I08-150, rejeição 725) pela NT 2026.002
  // v1.10a (regras I08-150, N12a-40 e N12a-44), em produção desde
  // 03/08/2026. Antes disso a SEFAZ o recusava, e esta tabela também.
  const CFOP_POR_CSOSN: Record<string, string[]> = {
    "102": ["5101", "5102", "5103", "5104", "5115", "5910"],
    "103": ["5101", "5102", "5103", "5104", "5115", "5910"],
    "300": ["5101", "5102", "5103", "5104", "5115", "5910"],
    "400": ["5101", "5102", "5103", "5104", "5115", "5910"],
    "900": ["5101", "5102", "5103", "5104", "5115", "5910"],
    "500": ["5405", "5656", "5667", "5910"],
  };
  const permitidos = CFOP_POR_CSOSN[csosn];
  if (permitidos && !permitidos.includes(cfop)) {
    faltas.push({
      campo: "cfop",
      valor: cfop,
      mensagem:
        `Com CSOSN ${csosn}, a NFC-e só aceita CFOP ${permitidos.join(", ")} ` +
        `(a SEFAZ rejeita com o código 386).` +
        (csosn === "500"
          ? " Produto com ICMS já cobrado por ST (bebida, por exemplo) vai com 5405."
          : " Produção do próprio estabelecimento vai com 5101; revenda, com 5102."),
    });
  }

  return faltas;
}
