/**
 * /src/lib/nfce/danfe.ts
 *
 * O CUPOM FISCAL do emissor próprio: o DANFE NFC-e (Documento Auxiliar da Nota
 * Fiscal de Consumidor Eletrônica), lido do XML que a SEFAZ autorizou (nfeProc
 * = NFe + protNFe) ou da nota ASSINADA em contingência off-line — e desenhado
 * de dois jeitos:
 *   - `danfeHtml`: a página (tela do caixa, impressão pelo navegador, link do
 *     cliente), autocontida, com o QR Code em SVG;
 *   - `danfeEmTexto`: as linhas para a bobina térmica (Assistente de impressão,
 *     ESC/POS), já quebradas na largura (32 colunas no 58 mm, 48 no 80 mm), e o
 *     conteúdo do QR à parte — o Assistente só põe negrito, QR e corte.
 *
 * ── Fontes ──────────────────────────────────────────────────────────────────
 *  - "Manual": Manual de Padrões Técnicos do DANFE NFC-e e QR Code, versão 6.0
 *    (março/2025). Divisões I a IX (itens 3.1.1 a 3.1.9), figuras 1B (QR
 *    centralizado) e 6 (contingência), exemplos 2 e 3 (item 3.2), papel e
 *    margens (3.3), tamanho do QR (3.4), correção de erro nível M (4.5.2).
 *  - Ajuste SINIEF 19/16 (NFC-e), cláusula 10ª: §1º (o DANFE só representa a
 *    operação DEPOIS da autorização, ou em contingência), §2º (papel de 56 mm
 *    no mínimo; QR Code; número do protocolo, salvo contingência), §3º (com a
 *    concordância do consumidor: envio eletrônico ou DANFE resumido — redação
 *    do Ajuste SINIEF 20/23); cláusula 11ª, §3º (uma via do DANFE de
 *    contingência fica no estabelecimento até a autorização).
 *  - IN SEFA 11/2014 (Pará), art. 7º (resumido só com a concordância do
 *    adquirente) e art. 8º ("expressamente vedada" a impressão resumida na
 *    entrega em domicílio e em contingência).
 *  - Lei 12.741/2012 (valor aproximado dos tributos) — Manual 3.1.9.1.
 *
 * ── Decisões ────────────────────────────────────────────────────────────────
 *  1. SEMPRE o DANFE completo (com a divisão II, os itens). O resumido depende
 *     de a UF permitir E de o consumidor pedir (Manual, item 2; Ajuste 19/16,
 *     cl. 10ª §3º II), e no PA é proibido na entrega e na contingência (IN SEFA
 *     11/2014, art. 8º) — justamente dois casos do dia a dia do FireHub. O
 *     completo é o que vale em toda UF e em toda situação.
 *  2. Só o que está no XML, mais o retorno da autorização (protocolo, data,
 *     xMsg) — Manual, item 2. O que não está no XML (o aviso de tributos não
 *     informados) sai DEPOIS da divisão IX, como o Manual manda para
 *     "informações que não estejam no arquivo XML" (3.1.9).
 *  3. Nota sem autorização não vira DANFE: `dadosDoDanfe` recusa a NFe normal
 *     (tpEmis 1) sem protocolo 100/120/150, o protocolo de outra chave, a
 *     denegada/rejeitada e o XML mexido depois de autorizado (digVal ≠
 *     DigestValue). A única nota sem protocolo que vira DANFE é a de
 *     contingência off-line (tpEmis 9) — Ajuste 19/16, cl. 10ª §1º.
 *     O 120 ("Autorizado o uso da NF-e, com alerta" — NT 2026.002 v1.10a,
 *     item 2, produção em 05/10/2026) é nota AUTORIZADA: o alerta (hoje, o
 *     CNPJ do destinatário irregular, regra 5E17-65) vem no protNFe em até
 *     cinco pares cMsg/xMsg, e cada xMsg sai na divisão VIII (Manual 3.1.8).
 *  4. Contingência pendente: "EMITIDA EM CONTINGÊNCIA / Pendente de
 *     autorização" em destaque nos DOIS lugares (abaixo da divisão I, entre
 *     linhas; e abaixo da divisão VII), protocolo suprimido (Manual 3.1.8 e
 *     3.1.7). A nota de contingência que a SEFAZ JÁ autorizou (tpEmis 9 com
 *     protNFe) sai com o protocolo e sem "Pendente" — imprimir "pendente" numa
 *     nota autorizada seria mentir no papel. Toda nota tpEmis 9 (pendente ou
 *     já autorizada) imprime "Contingência desde dd/mm/aaaa hh:mm:ss", do
 *     dhCont, na divisão VIII: "a data, hora com minutos e segundos do seu
 *     início, devendo ser impressa no DANFE-NFC-e" (Portaria SEEC-DF
 *     387/2019, art. 6º, §1º, I, "b").
 *  5. Horários (dhEmi, dhRecbto) convertidos para o fuso da UF do emitente —
 *     "deverá ser impressa sempre convertida para o horário local" (3.1.7).
 *  6. Tributos (Lei 12.741): vTotTrib do ICMSTot; na falta, a soma dos
 *     vTotTrib dos itens; na falta dos dois, NENHUM número inventado — sai
 *     "não informados" (e a causa fica em `avisos`).
 *  7. Na bobina, texto em ASCII (sem acento): é o que toda térmica imprime
 *     igual, e o que mantém a conta das colunas certa — o mesmo critério do
 *     `cleanAscii` do Assistente.
 *
 * PURO: sem banco, sem rede, sem disco. O cofre e a fila moram em
 * danfe-do-pedido.ts e impressao-do-danfe.ts.
 */
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { chaveValida, lerChave } from "./chave";
import { URL_DA_CONSULTA_PELA_CHAVE } from "./qrcode";
import { elementos, filho, lerXml, primeiro, textoDoFilho } from "./xml";
import { FUSO_DA_UF } from "./xml-da-nota";

/** Erro de leitura do XML para o DANFE (nota não autorizada, XML de outra coisa...). */
export class ErroDoDanfe extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDoDanfe";
  }
}

/**
 * Os textos que o Manual manda imprimir ao pé da letra. Um lugar só: o HTML, a
 * bobina e o teste usam os mesmos.
 */
export const TEXTOS_DO_DANFE = {
  /** Divisão I (3.1.1). */
  titulo: "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica",
  /** Divisão IV (3.1.4). */
  consulte: "Consulte pela Chave de Acesso em",
  /** Divisão VI (3.1.6). */
  naoIdentificado: "CONSUMIDOR NÃO IDENTIFICADO",
  /** Divisão VII (3.1.7). */
  protocolo: "Protocolo de autorização:",
  dataDeAutorizacao: "Data de autorização:",
  /** Divisão VIII (3.1.8): contingência, em duas linhas. */
  contingencia: "EMITIDA EM CONTINGÊNCIA",
  pendente: "Pendente de autorização",
  /** Divisão VIII, nota tpEmis 9: + dhCont (Portaria SEEC-DF 387/2019, art. 6º, §1º, I, "b"). */
  contingenciaDesde: "Contingência desde",
  /** Divisão VIII (3.1.8): homologação, centralizado e em caixa alta. */
  homologacao: "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL",
  /** 2ª via da contingência, ao lado da data de emissão (3.1.8). */
  viaDoEstabelecimento: "Via do Estabelecimento",
  /** 1ª via da contingência (exemplo 3 do item 3.2). */
  viaDoConsumidor: "Via do Consumidor",
  /** Divisão IX (3.1.9.1 e figuras 1A/1B). */
  tributos: "Tributos Totais Incidentes (Lei Federal 12.741/2012):",
  /** Depois da divisão IX: não está no XML (decisão 6). */
  tributosNaoInformados: "Tributos aproximados (Lei Federal 12.741/2012): não informados nesta NFC-e.",
} as const;

/** Quem fica com o papel: na contingência sai uma via de cada (Ajuste 19/16, cl. 11ª §3º). */
export type ViaDoDanfe = "consumidor" | "estabelecimento";

export type ItemDoDanfe = {
  /** nItem. */
  numero: number;
  /** cProd — "código do produto adotado pelo estabelecimento" (3.1.2). */
  codigo: string;
  /** xProd. */
  descricao: string;
  /** qCom, formatado ("4", "0,35"). */
  quantidade: string;
  /** uCom. */
  unidade: string;
  /** vUnCom, formatado (2 a 4 casas). */
  valorUnitario: string;
  /** vProd, formatado. */
  valorTotal: string;
  valorTotalEmCentavos: number;
};

export type PagamentoDoDanfe = {
  /** tPag. */
  codigo: string;
  /** O nome da forma (tabela do YA02) ou o xPag, na forma 99. */
  descricao: string;
  valor: string;
  valorEmCentavos: number;
};

export type DadosDoDanfe = {
  chave: string;
  /** A chave em 11 blocos de 4 (3.1.4). */
  chaveEmBlocos: string[];
  numero: number;
  serie: number;
  /** nNF com 9 dígitos e série com 3, como nos modelos do Manual ("000000001", "001"). */
  numeroFormatado: string;
  serieFormatada: string;
  /** dhEmi no fuso da UF do emitente: "29/09/2026 12:00:00". */
  emitidaEm: string;
  /** dhEmi como veio no XML. */
  dhEmi: string;
  fuso: string;
  ambiente: 1 | 2;
  homologacao: boolean;
  /** tpEmis. */
  tipoDeEmissao: number;
  /** Emitida em contingência off-line (tpEmis 9), autorizada depois ou não. */
  emitidaEmContingencia: boolean;
  /** Contingência ainda sem protocolo: as mensagens de contingência saem e o protocolo não. */
  pendenteDeAutorizacao: boolean;
  /**
   * dhCont no fuso da loja ("29/09/2026 12:00:00") — vai ao papel como
   * "Contingência desde ..." — e xJust (fica para quem consulta).
   */
  contingencia: { entradaEm: string | null; justificativa: string | null } | null;
  emitente: {
    /** "CNPJ: 64.568.087/0001-80" (ou "CPF: ..."). */
    documento: string;
    cnpj: string | null;
    cpf: string | null;
    razaoSocial: string;
    nomeFantasia: string | null;
    /** Endereço completo sem o país (3.1.1). */
    endereco: string;
    uf: string;
  };
  itens: ItemDoDanfe[];
  totais: {
    /** Itens DISTINTOS (linhas det), não a soma das quantidades (3.1.3). */
    quantidadeDeItens: number;
    /** Valor total R$ (vProd). */
    valorTotal: string;
    valorTotalEmCentavos: number;
    /** Desconto R$ (vDesc) — null quando não há. */
    desconto: string | null;
    descontoEmCentavos: number;
    /** Acréscimos (vFrete + vSeg + vOutro) — null quando não há. */
    acrescimos: { rotulo: string; valor: string; valorEmCentavos: number } | null;
    /** Valor a Pagar R$ (vNF). */
    valorAPagar: string;
    valorAPagarEmCentavos: number;
  };
  pagamentos: PagamentoDoDanfe[];
  /** vTroco — null quando não há. */
  troco: string | null;
  trocoEmCentavos: number;
  /** urlChave (ZX03). `daTabela` = o XML não trouxe e o endereço veio da tabela da UF. */
  consulta: { url: string; daTabela: boolean };
  consumidor: {
    identificado: boolean;
    /** "CONSUMIDOR CPF: 529.982.247-25" ou "CONSUMIDOR NÃO IDENTIFICADO". */
    titulo: string;
    tipo: "CPF" | "CNPJ" | "ESTRANGEIRO" | null;
    documento: string | null;
    nome: string | null;
    endereco: string | null;
  };
  protocolo: { numero: string; autorizadaEm: string; dhRecbto: string; cStat: string } | null;
  /**
   * infAdFisco e cada xMsg do retorno da autorização (divisão VIII) — no 120,
   * o alerta da SEFAZ (NT 2026.002: até cinco pares cMsg/xMsg no infProt).
   */
  mensagensFiscais: string[];
  /** infCpl (divisão IX). */
  informacoesComplementares: string | null;
  tributos: {
    valor: string | null;
    valorEmCentavos: number | null;
    fonte: "vTotTrib" | "vTotTrib dos itens" | null;
    /** A linha que vai ao papel (dentro da divisão IX com valor; depois dela sem). Null = infCpl já fala dos tributos. */
    texto: string | null;
  };
  /** O conteúdo do QR Code — o qrCode do infNFeSupl, sem tirar nem pôr. */
  qrCode: string;
  /** O que não impede o DANFE mas quem imprime deve saber. */
  avisos: string[];
};

// ─── Leitura do XML ──────────────────────────────────────────────────────────

const texto = (pai: Node | null, nome: string): string => (pai ? textoDoFilho(pai, nome) ?? "" : "");

/** Valor do XML (TDec_1302, "15.60") em centavos inteiros. */
function centavos(v: string): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ErroDoDanfe(`Valor inválido no XML: "${s}".`);
  return Math.round(n * 100);
}

const milhar = (inteiro: string) => inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Centavos → "1.234,56": vírgula nas casas decimais e ponto no milhar, como o
 * Manual pede para os valores (3.1.2 e 3.1.3).
 */
export function reais(emCentavos: number): string {
  const negativo = emCentavos < 0;
  const abs = Math.abs(Math.round(emCentavos));
  return `${negativo ? "-" : ""}${milhar(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, "0")}`;
}

/** qCom ("4.0000", "0.3500") → "4", "0,35". */
function quantidadeBr(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const [inteiro, fracao = ""] = n.toFixed(4).split(".");
  const casas = fracao.replace(/0+$/, "");
  return milhar(inteiro) + (casas ? `,${casas}` : "");
}

/**
 * vUnCom → "3,90" ou "7,2433". O unitário pode ter até 10 casas no XML (o
 * rateio do combo, em xml-da-nota.ts); no papel vão de 2 a 4 — o total da
 * linha, que é o que o cliente paga, sai exato ao lado.
 */
function valorUnitarioBr(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const [inteiro, fracao = ""] = n.toFixed(4).split(".");
  const casas = fracao.replace(/0+$/, "").padEnd(2, "0");
  return `${milhar(inteiro)},${casas}`;
}

/** Data/hora do XML (com offset) no fuso da loja: "29/09/2026 12:00:00". */
export function dataHoraLocal(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso || "";
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}:${p("second")}`;
}

/** 99.999.999/9999-99 (3.1.1) — vale para o CNPJ alfanumérico também. */
export function cnpjFormatado(v: string): string {
  const c = String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (c.length !== 14) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/** 999.999.999-99 (3.1.1). */
export function cpfFormatado(v: string): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const cepFormatado = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 5)}-${v.slice(5)}` : v);

/** Endereço numa linha, sem o país (3.1.1): "Rua X, 10, Casa 2, Bairro, Cidade - UF, CEP 00000-000". */
function enderecoEmLinha(ender: Element | null): string {
  if (!ender) return "";
  const rua = [texto(ender, "xLgr"), texto(ender, "nro")].filter(Boolean).join(", ");
  const cidade = [texto(ender, "xMun"), texto(ender, "UF")].filter(Boolean).join(" - ");
  const cep = texto(ender, "CEP");
  return [rua, texto(ender, "xCpl"), texto(ender, "xBairro"), cidade, cep ? `CEP ${cepFormatado(cep)}` : ""]
    .filter(Boolean)
    .join(", ");
}

/**
 * O nome de cada meio de pagamento (tPag, YA02): MOC 7.0 Anexo I (01 a 19, 90
 * e 99 — NT 2016.002 e NT 2020.006) e o 20 (Pix estático), que o próprio
 * FireHub emite (lib/fiscal-emissao.ts). Código fora da tabela sai como
 * "Outros (NN)" em vez de sumir.
 */
export const FORMAS_DE_PAGAMENTO: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de Crédito",
  "04": "Cartão de Débito",
  "05": "Crédito Loja",
  "10": "Vale Alimentação",
  "11": "Vale Refeição",
  "12": "Vale Presente",
  "13": "Vale Combustível",
  "15": "Boleto Bancário",
  "16": "Depósito Bancário",
  "17": "PIX",
  "18": "Transferência bancária, Carteira Digital",
  "19": "Programa de fidelidade, Cashback, Crédito Virtual",
  "20": "PIX",
  "90": "Sem pagamento",
  "99": "Outros",
};

/**
 * Os cStat de nota autorizada: 100 (autorizado), 150 (autorizado fora de
 * prazo) e 120 ("Autorizado o uso da NF-e, com alerta" — NT 2026.002 v1.10a,
 * item 2.1, em produção desde 05/10/2026; o alerta sai na divisão VIII).
 */
const AUTORIZADA = new Set(["100", "120", "150"]);

/**
 * Lê o XML (nfeProc autorizado, ou a NFe assinada em contingência) e devolve
 * tudo o que o DANFE mostra. Lança `ErroDoDanfe` quando o XML não pode virar
 * DANFE (ver decisão 3 no topo).
 */
export function dadosDoDanfe(xml: string): DadosDoDanfe {
  let doc: Document;
  try {
    doc = lerXml(String(xml ?? ""));
  } catch (e: any) {
    throw new ErroDoDanfe(`O XML da nota não pôde ser lido (${String(e?.message ?? e).replace(/^XML inválido:\s*/, "")}).`);
  }
  const nfe = primeiro(doc, "NFe");
  const infNFe = nfe ? filho(nfe, "infNFe") : null;
  if (!nfe || !infNFe) throw new ErroDoDanfe("O XML não tem a NFC-e (<NFe><infNFe>).");
  const avisos: string[] = [];

  // ── Identificação ────────────────────────────────────────────────────────
  const chave = (infNFe.getAttribute("Id") ?? "").replace(/^NFe/, "").toUpperCase();
  if (!chaveValida(chave)) throw new ErroDoDanfe(`Chave de acesso inválida no XML: "${chave}".`);
  const ide = filho(infNFe, "ide");
  if (texto(ide, "mod") !== "65") throw new ErroDoDanfe(`O XML é do modelo ${texto(ide, "mod") || "?"}, não de NFC-e (65).`);
  const numero = Number(texto(ide, "nNF"));
  const serie = Number(texto(ide, "serie"));
  const tipoDeEmissao = Number(texto(ide, "tpEmis") || "1");
  const partes = lerChave(chave);
  if (partes.numero !== numero || partes.serie !== serie || partes.tipoDeEmissao !== tipoDeEmissao) {
    throw new ErroDoDanfe("Número, série ou tipo de emissão do XML não batem com a chave de acesso.");
  }
  const ambiente: 1 | 2 = texto(ide, "tpAmb") === "1" ? 1 : 2;
  const dhEmi = texto(ide, "dhEmi");

  // ── Emitente ─────────────────────────────────────────────────────────────
  const emit = filho(infNFe, "emit");
  const enderEmit = emit ? filho(emit, "enderEmit") : null;
  const uf = (texto(enderEmit, "UF") || "").toUpperCase();
  const fuso = FUSO_DA_UF[uf] ?? "America/Sao_Paulo";
  const cnpjEmit = texto(emit, "CNPJ") || null;
  const cpfEmit = texto(emit, "CPF") || null;
  const razaoSocial = texto(emit, "xNome");
  const fantasia = texto(emit, "xFant");

  // ── Autorização ──────────────────────────────────────────────────────────
  const infProt = (() => {
    const prot = primeiro(doc, "protNFe");
    return prot ? filho(prot, "infProt") : null;
  })();
  const cStat = texto(infProt, "cStat");
  if (infProt && !AUTORIZADA.has(cStat)) {
    throw new ErroDoDanfe(
      `A SEFAZ não autorizou esta NFC-e ([${cStat || "?"}] ${texto(infProt, "xMotivo")}): nota sem autorização de uso não tem DANFE.`
    );
  }
  if (infProt && texto(infProt, "chNFe").toUpperCase() !== chave) {
    throw new ErroDoDanfe("O protocolo de autorização do XML é de outra chave de acesso.");
  }
  const autorizada = Boolean(infProt);
  if (!autorizada && tipoDeEmissao !== 9) {
    throw new ErroDoDanfe(
      "NFC-e sem protocolo de autorização: o DANFE só representa a venda depois da autorização, " +
        "ou em contingência off-line (Ajuste SINIEF 19/16, cl. 10ª, §1º)."
    );
  }
  // O protocolo guarda o digest da nota que a SEFAZ recebeu. Diferente do da
  // assinatura = o XML foi mexido depois de autorizado: o DANFE mostraria uma
  // nota que não é a autorizada.
  const digVal = texto(infProt, "digVal");
  const digestDaAssinatura = primeiro(nfe, "DigestValue")?.textContent?.trim() ?? "";
  if (autorizada && digVal && digestDaAssinatura && digVal !== digestDaAssinatura) {
    throw new ErroDoDanfe("O XML não é o que a SEFAZ autorizou (o digest do protocolo não confere com o da assinatura).");
  }
  const protocolo = autorizada
    ? {
        numero: texto(infProt, "nProt"),
        dhRecbto: texto(infProt, "dhRecbto"),
        autorizadaEm: dataHoraLocal(texto(infProt, "dhRecbto"), fuso),
        cStat,
      }
    : null;
  const pendenteDeAutorizacao = !autorizada && tipoDeEmissao === 9;

  // ── Destinatário (divisão VI) ────────────────────────────────────────────
  const dest = filho(infNFe, "dest");
  const cpfDest = texto(dest, "CPF");
  const cnpjDest = texto(dest, "CNPJ");
  const temEstrangeiro = Boolean(dest && filho(dest, "idEstrangeiro"));
  const idEstrangeiro = texto(dest, "idEstrangeiro");
  const nomeDest = texto(dest, "xNome") || null;
  const enderecoDest = enderecoEmLinha(dest ? filho(dest, "enderDest") : null) || null;
  let consumidor: DadosDoDanfe["consumidor"];
  if (cnpjDest) {
    consumidor = { identificado: true, titulo: `CONSUMIDOR CNPJ: ${cnpjFormatado(cnpjDest)}`, tipo: "CNPJ", documento: cnpjDest, nome: nomeDest, endereco: enderecoDest };
  } else if (cpfDest) {
    consumidor = { identificado: true, titulo: `CONSUMIDOR CPF: ${cpfFormatado(cpfDest)}`, tipo: "CPF", documento: cpfDest, nome: nomeDest, endereco: enderecoDest };
  } else if (temEstrangeiro) {
    consumidor = {
      identificado: true,
      titulo: idEstrangeiro ? `CONSUMIDOR Id. Estrangeiro: ${idEstrangeiro}` : "CONSUMIDOR ESTRANGEIRO",
      tipo: "ESTRANGEIRO",
      documento: idEstrangeiro || null,
      nome: nomeDest,
      endereco: enderecoDest,
    };
  } else if (nomeDest || enderecoDest) {
    // O schema exige documento no <dest>; se um dia vier só o nome, ele é
    // identificação e sai (3.1.6: nome e endereço podem ir nesta divisão).
    consumidor = { identificado: true, titulo: "CONSUMIDOR", tipo: null, documento: null, nome: nomeDest, endereco: enderecoDest };
  } else {
    consumidor = { identificado: false, titulo: TEXTOS_DO_DANFE.naoIdentificado, tipo: null, documento: null, nome: null, endereco: null };
  }

  // ── Itens (divisão II) ───────────────────────────────────────────────────
  let tributosDosItens = 0;
  let itensComTributo = 0;
  const itens: ItemDoDanfe[] = elementos(infNFe, "det").map((det, i) => {
    const prod = filho(det, "prod");
    const imposto = filho(det, "imposto");
    const vTotTribItem = texto(imposto, "vTotTrib");
    if (vTotTribItem) {
      tributosDosItens += centavos(vTotTribItem);
      itensComTributo++;
    }
    const vProd = centavos(texto(prod, "vProd"));
    return {
      numero: Number(det.getAttribute("nItem") ?? i + 1),
      codigo: texto(prod, "cProd"),
      descricao: texto(prod, "xProd"),
      quantidade: quantidadeBr(texto(prod, "qCom")),
      unidade: texto(prod, "uCom"),
      valorUnitario: valorUnitarioBr(texto(prod, "vUnCom")),
      valorTotal: reais(vProd),
      valorTotalEmCentavos: vProd,
    };
  });
  if (itens.length === 0) throw new ErroDoDanfe("NFC-e sem itens.");

  // ── Totais (divisão III) ─────────────────────────────────────────────────
  const icmsTot = primeiro(infNFe, "ICMSTot");
  const vProd = centavos(texto(icmsTot, "vProd"));
  const vDesc = centavos(texto(icmsTot, "vDesc"));
  const partesDoAcrescimo: Array<[string, number]> = [
    ["Frete", centavos(texto(icmsTot, "vFrete"))],
    ["Seguro", centavos(texto(icmsTot, "vSeg"))],
    ["Outras despesas", centavos(texto(icmsTot, "vOutro"))],
  ];
  const comValor = partesDoAcrescimo.filter(([, v]) => v > 0);
  const vAcrescimo = comValor.reduce((s, [, v]) => s + v, 0);
  const vNF = centavos(texto(icmsTot, "vNF"));

  // ── Pagamento ────────────────────────────────────────────────────────────
  const pag = filho(infNFe, "pag");
  const pagamentos: PagamentoDoDanfe[] = (pag ? elementos(pag, "detPag") : []).map((d) => {
    const codigo = texto(d, "tPag").padStart(2, "0");
    const xPag = texto(d, "xPag");
    const valorEmCentavos = centavos(texto(d, "vPag"));
    const descricao = codigo === "99" && xPag ? xPag : FORMAS_DE_PAGAMENTO[codigo] ?? `Outros (${codigo})`;
    return { codigo, descricao, valor: reais(valorEmCentavos), valorEmCentavos };
  });
  const vTroco = centavos(texto(pag, "vTroco"));

  // ── Informações adicionais e retorno da SEFAZ (divisões VIII e IX) ──────
  const infAdic = filho(infNFe, "infAdic");
  const infAdFisco = texto(infAdic, "infAdFisco");
  const infCpl = texto(infAdic, "infCpl");
  // TODOS os xMsg do infProt, não só o primeiro: o schema admite até cinco
  // pares cMsg/xMsg (PR13 a PR15), e a autorização com alerta (cStat 120,
  // NT 2026.002) devolve um par por alerta.
  const xMsgs = infProt ? elementos(infProt, "xMsg").map((e) => (e.textContent ?? "").trim()).filter(Boolean) : [];
  const mensagensFiscais = [infAdFisco, ...xMsgs].filter(Boolean);

  // ── Tributos (Lei 12.741) ────────────────────────────────────────────────
  const vTotTrib = texto(icmsTot, "vTotTrib");
  let tributos: DadosDoDanfe["tributos"];
  if (vTotTrib) {
    const v = centavos(vTotTrib);
    tributos = { valor: reais(v), valorEmCentavos: v, fonte: "vTotTrib", texto: `${TEXTOS_DO_DANFE.tributos} R$ ${reais(v)}` };
  } else if (itensComTributo > 0) {
    tributos = {
      valor: reais(tributosDosItens),
      valorEmCentavos: tributosDosItens,
      fonte: "vTotTrib dos itens",
      texto: `${TEXTOS_DO_DANFE.tributos} R$ ${reais(tributosDosItens)}`,
    };
    if (itensComTributo < itens.length) avisos.push(`vTotTrib só em ${itensComTributo} de ${itens.length} itens: o total de tributos é parcial.`);
  } else {
    // Nada de número inventado. Se o infCpl já fala dos tributos, ele (que
    // sai na divisão IX) é a informação; senão o papel diz que não há.
    const infCplFala = /12\.?741|tribut/i.test(infCpl);
    tributos = { valor: null, valorEmCentavos: null, fonte: null, texto: infCplFala ? null : TEXTOS_DO_DANFE.tributosNaoInformados };
    avisos.push("O XML não traz vTotTrib (nem no total nem nos itens): tributos da Lei 12.741/2012 não informados.");
  }

  // ── QR Code e consulta (divisões IV e V) ────────────────────────────────
  const supl = filho(nfe, "infNFeSupl");
  const qrCode = texto(supl, "qrCode");
  if (!qrCode) throw new ErroDoDanfe("O XML não tem o QR Code (infNFeSupl/qrCode), obrigatório no DANFE NFC-e.");
  let urlChave = texto(supl, "urlChave");
  let urlDaTabela = false;
  if (!urlChave) {
    const tabela = URL_DA_CONSULTA_PELA_CHAVE[uf];
    urlChave = tabela ? (ambiente === 1 ? tabela.producao : tabela.homologacao) : "";
    urlDaTabela = Boolean(urlChave);
    avisos.push(
      urlChave
        ? `O XML não traz a urlChave: usado o endereço de consulta da tabela da UF ${uf}.`
        : `O XML não traz a urlChave e não há endereço de consulta cadastrado para a UF ${uf}.`
    );
  }

  const dhCont = texto(ide, "dhCont");
  const xJust = texto(ide, "xJust");

  return {
    chave,
    chaveEmBlocos: chave.match(/.{4}/g) ?? [chave],
    numero,
    serie,
    numeroFormatado: String(numero).padStart(9, "0"),
    serieFormatada: String(serie).padStart(3, "0"),
    emitidaEm: dataHoraLocal(dhEmi, fuso),
    dhEmi,
    fuso,
    ambiente,
    homologacao: ambiente === 2,
    tipoDeEmissao,
    emitidaEmContingencia: tipoDeEmissao === 9,
    pendenteDeAutorizacao,
    contingencia: tipoDeEmissao === 9 ? { entradaEm: dhCont ? dataHoraLocal(dhCont, fuso) : null, justificativa: xJust || null } : null,
    emitente: {
      documento: cnpjEmit ? `CNPJ: ${cnpjFormatado(cnpjEmit)}` : cpfEmit ? `CPF: ${cpfFormatado(cpfEmit)}` : "",
      cnpj: cnpjEmit,
      cpf: cpfEmit,
      razaoSocial,
      nomeFantasia: fantasia && fantasia.toUpperCase() !== razaoSocial.toUpperCase() ? fantasia : null,
      endereco: enderecoEmLinha(enderEmit),
      uf,
    },
    itens,
    totais: {
      quantidadeDeItens: itens.length,
      valorTotal: reais(vProd),
      valorTotalEmCentavos: vProd,
      desconto: vDesc > 0 ? reais(vDesc) : null,
      descontoEmCentavos: vDesc,
      acrescimos:
        vAcrescimo > 0
          ? { rotulo: comValor.length === 1 ? comValor[0][0] : "Acréscimos", valor: reais(vAcrescimo), valorEmCentavos: vAcrescimo }
          : null,
      valorAPagar: reais(vNF),
      valorAPagarEmCentavos: vNF,
    },
    pagamentos,
    troco: vTroco > 0 ? reais(vTroco) : null,
    trocoEmCentavos: vTroco,
    consulta: { url: urlChave, daTabela: urlDaTabela },
    consumidor,
    protocolo,
    mensagensFiscais,
    informacoesComplementares: infCpl || null,
    tributos,
    qrCode,
    avisos,
  };
}

/** Quantas vias vão ao papel: uma; duas na contingência ainda pendente (Ajuste 19/16, cl. 11ª §3º). */
export function viasDoDanfe(dados: Pick<DadosDoDanfe, "pendenteDeAutorizacao">): Array<ViaDoDanfe | null> {
  return dados.pendenteDeAutorizacao ? ["consumidor", "estabelecimento"] : [null];
}

const rotuloDaVia = (via: ViaDoDanfe | null | undefined): string | null =>
  via === "estabelecimento" ? TEXTOS_DO_DANFE.viaDoEstabelecimento : via === "consumidor" ? TEXTOS_DO_DANFE.viaDoConsumidor : null;

// ─── QR Code ─────────────────────────────────────────────────────────────────

/**
 * A matriz do QR, nível M (Manual 4.5.2). A segmentação é a da biblioteca
 * (números em modo numérico, o resto em byte): é um QR padrão ISO/IEC 18004,
 * e o conteúdo vai exatamente como está no XML.
 */
function matrizDoQr(conteudo: string) {
  return QRCode.create(conteudo, { errorCorrectionLevel: "M" }).modules;
}

/**
 * Tamanho do módulo (pontos da impressora) para o QR impresso pelo comando
 * GS ( k da térmica. O Manual pede no mínimo 22 mm de conteúdo (3.4); a
 * térmica tem 8 pontos por mm (203 dpi) e a linha tem `colunas` × 12 pontos
 * (Fonte A, a do preâmbulo do Assistente).
 *
 * A impressora escolhe a versão do QR sozinha — talvez tudo em modo byte, o
 * pior caso. Então: o mínimo de 22 mm é garantido com a MENOR versão possível
 * (se a impressora for esperta, o QR não fica pequeno demais), e o "cabe na
 * bobina" com a MAIOR (se ela for simples, o QR não estoura a largura). Alvo
 * de ~28 mm, que o celular lê sem aproximar.
 */
export function moduloDoQr(conteudo: string, colunas: number): number {
  const menor = matrizDoQr(conteudo).size;
  // UTF-8, como o Manual pede para o QR da NFC-e (4.5.3).
  const maior = QRCode.create([{ data: Buffer.from(conteudo, "utf8"), mode: "byte" }], { errorCorrectionLevel: "M" }).modules.size;
  const PONTOS_POR_MM = 8;
  const largura = Math.max(24, Math.min(64, Math.floor(colunas))) * 12;
  const margem = 3 * PONTOS_POR_MM; // a "margem segura" de 3 mm, de cada lado
  const cabe = Math.max(1, Math.floor((largura - 2 * margem) / maior));
  const minimo = Math.ceil((22 * PONTOS_POR_MM) / menor);
  const alvo = Math.ceil((28 * PONTOS_POR_MM) / menor);
  return Math.max(1, Math.min(cabe, 16, Math.max(minimo, alvo)));
}

/**
 * O QR em SVG, desenhado da matriz (sem canvas, sem arquivo): um retângulo
 * por trecho escuro de cada linha, com a zona de silêncio de 4 módulos.
 */
export function qrEmSvg(conteudo: string): string {
  const m = matrizDoQr(conteudo);
  const n = m.size;
  const margem = 4;
  const total = n + margem * 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!m.get(y, x)) {
        x++;
        continue;
      }
      let trecho = 1;
      while (x + trecho < n && m.get(y, x + trecho)) trecho++;
      d += `M${x + margem} ${y + margem}h${trecho}v1h-${trecho}z`;
      x += trecho;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="QR Code da consulta da NFC-e"><rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path fill="#000" d="${d}"/></svg>`
  );
}

// ─── Texto para a bobina (ESC/POS) ───────────────────────────────────────────

export type LinhaDoDanfe = { texto: string; negrito?: boolean; alto?: boolean };
/** Uma linha de texto, ou o lugar do QR Code. */
export type PecaDoDanfe = LinhaDoDanfe | { qr: true };

export type DanfeEmTexto = {
  colunas: number;
  via: ViaDoDanfe | null;
  /** O cupom inteiro, de cima a baixo; `{ qr: true }` marca onde o QR entra. */
  linhas: PecaDoDanfe[];
  /**
   * O que o Assistente passa ao QR: o conteúdo do XML e o módulo (pontos). O
   * QR sai SEMPRE — pelo comando da impressora (GS ( k) ou, no perfil
   * "legacy", como imagem (GS v 0) desenhada pelo próprio Assistente. Não
   * existe DANFE sem QR (Ajuste SINIEF 19/16, cl. 10ª, §2º, II).
   */
  qr: { conteudo: string; modulo: number };
};

/** Diacríticos combinantes (U+0300–U+036F), montados por código — sem caractere invisível no fonte. */
const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
const ORDINAIS = new RegExp("[" + String.fromCharCode(0xba, 0xaa, 0xb0) + "]", "g");
const TRACOS = new RegExp("[" + String.fromCharCode(0x2010) + "-" + String.fromCharCode(0x2015) + String.fromCharCode(0x2212) + "]", "g");
const ASPAS_SIMPLES = new RegExp("[" + String.fromCharCode(0x2018, 0x2019) + "]", "g");
const ASPAS_DUPLAS = new RegExp("[" + String.fromCharCode(0x201c, 0x201d) + "]", "g");
const FORA_DO_ASCII = new RegExp("[^" + String.fromCharCode(0x20) + "-" + String.fromCharCode(0x7e) + "]", "g");
/** "Não quebre aqui": junta palavras que têm de ficar na mesma linha (data e hora, "Série 001"). */
const JUNTO = String.fromCharCode(1);

/** O texto como a térmica imprime: ASCII, sem acento, espaços simples. */
export function paraOPapel(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(ORDINAIS, ".")
    .replace(TRACOS, "-")
    .replace(ASPAS_SIMPLES, "'")
    .replace(ASPAS_DUPLAS, '"')
    .split(JUNTO)
    .map((parte) => parte.replace(FORA_DO_ASCII, " ").replace(/\s+/g, " "))
    .join(JUNTO)
    .trim();
}

/**
 * Onde cortar uma "palavra" maior que a linha: depois da última barra (ou
 * ponto, hífen, barra vertical) que caiba — o endereço de consulta da SEFAZ
 * sai "www.fazenda.df.gov.br/nfce/" + "consulta", e não "…/nfce/consu" + "lta".
 * Sem ponto bom (o código do produto, um número), corta na largura.
 */
function pontoDeCorte(palavra: string, w: number): number {
  const trecho = palavra.slice(0, w);
  const i = Math.max(trecho.lastIndexOf("/"), trecho.lastIndexOf("|"), trecho.lastIndexOf("-"), trecho.lastIndexOf("."));
  return i >= Math.floor(w / 3) ? i + 1 : w;
}

/**
 * Quebra por palavra na largura. Palavra maior que a linha é cortada (ver
 * `pontoDeCorte`). O marcador JUNTO vira espaço DEPOIS da quebra, então o que
 * ele une nunca é separado.
 */
function quebrar(textoLimpo: string, largura: number): string[] {
  const w = Math.max(4, largura);
  const linhas: string[] = [];
  let atual = "";
  for (let palavra of textoLimpo.split(" ").filter(Boolean)) {
    while (palavra.length > w) {
      if (atual) {
        linhas.push(atual);
        atual = "";
      }
      const corte = pontoDeCorte(palavra, w);
      linhas.push(palavra.slice(0, corte));
      palavra = palavra.slice(corte);
    }
    if (!palavra) continue;
    const candidato = atual ? `${atual} ${palavra}` : palavra;
    if (candidato.length > w) {
      linhas.push(atual);
      atual = palavra;
    } else atual = candidato;
  }
  if (atual) linhas.push(atual);
  return linhas.map((l) => l.split(JUNTO).join(" "));
}

const juntos = (...partes: string[]) => partes.filter(Boolean).join(JUNTO);

/** A chave em linhas de blocos inteiros: 11 numa linha se couber; senão 6 + 5; senão 4 + 4 + 3. */
function chaveEmLinhas(blocos: string[], colunas: number): string[] {
  const linha = (bs: string[]) => bs.join(" ");
  if (linha(blocos).length <= colunas) return [linha(blocos)];
  if (linha(blocos.slice(0, 6)).length <= colunas) return [linha(blocos.slice(0, 6)), linha(blocos.slice(6))];
  return [linha(blocos.slice(0, 4)), linha(blocos.slice(4, 8)), linha(blocos.slice(8))];
}

/**
 * O DANFE em linhas para a bobina térmica, na ordem do modelo com QR
 * centralizado (Manual, figura 1B): I cabeçalho, II itens, III totais, IV
 * consulta pela chave, VI consumidor, VII identificação e protocolo, VIII
 * mensagem fiscal, V QR Code, IX contribuinte — e, depois do IX, o que não
 * está no XML.
 *
 * Toda linha tem no máximo `colunas` caracteres (48 no 80 mm, 32 no 58 mm) —
 * a impressora nunca quebra sozinha. Centralizar é feito aqui, com espaços,
 * como no Assistente: a geometria é uma só em qualquer marca de impressora.
 */
export function danfeEmTexto(dados: DadosDoDanfe, colunas: number, opcoes: { via?: ViaDoDanfe | null } = {}): DanfeEmTexto {
  const w = Math.max(24, Math.min(64, Math.floor(Number(colunas) || 48)));
  const via = opcoes.via ?? null;
  type Fmt = { negrito?: boolean; alto?: boolean };
  const fmt = (f: Fmt): Fmt => ({ ...(f.negrito ? { negrito: true } : {}), ...(f.alto ? { alto: true } : {}) });
  const centralizar = (l: string) => " ".repeat(Math.max(0, Math.floor((w - l.length) / 2))) + l;

  const montar = (destino: PecaDoDanfe[]) => ({
    esquerda(t: string, f: Fmt = {}) {
      for (const l of quebrar(paraOPapel(t), w)) destino.push({ texto: l, ...fmt(f) });
    },
    centro(t: string, f: Fmt = {}) {
      for (const l of quebrar(paraOPapel(t), w)) destino.push({ texto: centralizar(l), ...fmt(f) });
    },
    /**
     * Rótulo à esquerda e valor à direita; o rótulo longo quebra e o valor
     * fica na última linha. `recuo` empurra o rótulo (a linha de valores do
     * item fica sob a descrição, como nos modelos do Manual).
     */
    par(rotulo: string, valor: string, f: Fmt = {}, recuo = 0) {
      const v = paraOPapel(valor);
      const margem = " ".repeat(recuo);
      const partes = quebrar(paraOPapel(rotulo), Math.max(4, w - recuo - v.length - 1)).map((l) => margem + l);
      const ultima = partes.pop() ?? margem;
      for (const p of partes) destino.push({ texto: p, ...fmt(f) });
      destino.push({ texto: ultima + " ".repeat(Math.max(1, w - ultima.length - v.length)) + v, ...fmt(f) });
    },
    /** Linha divisória — uma só: logo depois de outra (a faixa da contingência), não repete. */
    traco(c = "-") {
      const ultima = destino[destino.length - 1];
      if (ultima && "texto" in ultima && /^(-+|=+)$/.test(ultima.texto) && ultima.texto.length === w) return;
      destino.push({ texto: c.repeat(w) });
    },
  });

  const linhas: PecaDoDanfe[] = [];
  const p = montar(linhas);
  const d = dados;
  // Na bobina, "SEM VALOR FISCAL" nunca fica partido entre duas linhas.
  const T = { ...TEXTOS_DO_DANFE, homologacao: TEXTOS_DO_DANFE.homologacao.replace("SEM VALOR FISCAL", juntos("SEM", "VALOR", "FISCAL")) };

  // I — Cabeçalho
  if (d.emitente.nomeFantasia) p.centro(d.emitente.nomeFantasia.toUpperCase(), { negrito: true, alto: true });
  p.centro(d.emitente.documento);
  p.centro(d.emitente.razaoSocial, { negrito: true });
  p.centro(d.emitente.endereco);
  p.centro(T.titulo);
  // Contingência: abaixo do cabeçalho, centralizada, entre linhas (3.1.8).
  if (d.pendenteDeAutorizacao) {
    p.traco("=");
    p.centro(T.contingencia, { negrito: true, alto: true });
    p.centro(T.pendente);
    p.traco("=");
  }
  // Homologação: obrigatória na divisão VIII; repetida aqui em cima para
  // ninguém confundir o cupom de teste com um de verdade.
  if (d.homologacao) {
    if (!d.pendenteDeAutorizacao) p.traco("=");
    p.centro(T.homologacao, { negrito: true });
    p.traco("=");
  }

  // II — Detalhe dos produtos (Código, Descrição, Qtde, UN, Vl Unit, Vl Total)
  p.traco();
  p.esquerda("Codigo Descricao", { negrito: true });
  p.par("Qtde UN x Vl Unit", "Vl Total", { negrito: true });
  p.traco();
  for (const it of d.itens) {
    p.esquerda(`${it.codigo} ${it.descricao}`);
    p.par(`${juntos(it.quantidade, it.unidade)} x ${it.valorUnitario}`, it.valorTotal, {}, 2);
  }

  // III — Totais
  p.traco();
  const t = d.totais;
  const temAjuste = Boolean(t.desconto || t.acrescimos);
  p.par("Qtde. total de itens", String(t.quantidadeDeItens));
  p.par("Valor total R$", t.valorTotal, { negrito: !temAjuste });
  if (t.desconto) p.par("Desconto R$", t.desconto);
  if (t.acrescimos) p.par(`${t.acrescimos.rotulo} R$`, t.acrescimos.valor);
  // "Valor a Pagar" só quando há desconto ou acréscimo (3.1.3).
  if (temAjuste) p.par("Valor a Pagar R$", t.valorAPagar, { negrito: true });
  p.par("FORMA PAGAMENTO", "VALOR PAGO R$", { negrito: true });
  for (const pg of d.pagamentos) p.par(pg.descricao, pg.valor);
  if (d.troco) p.par("Troco R$", d.troco);

  // IV — Consulta pela chave de acesso
  p.traco();
  p.centro(T.consulte, { negrito: true });
  p.centro(d.consulta.url);
  for (const l of chaveEmLinhas(d.chaveEmBlocos, w)) linhas.push({ texto: centralizar(l) });

  // VI — Consumidor
  p.traco();
  if (d.consumidor.identificado) {
    p.centro(d.consumidor.titulo, { negrito: true });
    if (d.consumidor.nome) p.centro(d.consumidor.nome);
    if (d.consumidor.endereco) p.centro(d.consumidor.endereco);
  } else {
    p.centro(T.naoIdentificado, { negrito: true });
  }

  // VII — Identificação da NFC-e e protocolo
  p.traco();
  p.centro(`${juntos("NFC-e", "nº", d.numeroFormatado)} ${juntos("Série", d.serieFormatada)} ${juntos(...d.emitidaEm.split(" "))}`, { negrito: true });
  const rotuloVia = rotuloDaVia(via);
  if (rotuloVia) p.centro(juntos(...rotuloVia.split(" ")), { negrito: true });
  if (d.protocolo) {
    p.centro(`${T.protocolo} ${d.protocolo.numero}`);
    p.centro(`${T.dataDeAutorizacao} ${juntos(...d.protocolo.autorizadaEm.split(" "))}`);
  }

  // VIII — Mensagem fiscal
  if (d.pendenteDeAutorizacao) {
    p.centro(T.contingencia, { negrito: true, alto: true });
    p.centro(T.pendente);
  }
  // Toda nota de contingência (pendente ou já autorizada): desde quando.
  if (d.contingencia?.entradaEm) p.centro(`${T.contingenciaDesde} ${juntos(...d.contingencia.entradaEm.split(" "))}`);
  if (d.homologacao) p.centro(T.homologacao, { negrito: true });
  for (const m of d.mensagensFiscais) p.centro(m);

  // V — QR Code
  linhas.push({ qr: true });

  // IX — Mensagem de interesse do contribuinte
  if (d.tributos.valor) p.centro(d.tributos.texto ?? "");
  if (d.informacoesComplementares) p.centro(d.informacoesComplementares);
  // Depois do IX: o que não está no XML (3.1.9).
  if (!d.tributos.valor && d.tributos.texto) p.centro(d.tributos.texto);

  return {
    colunas: w,
    via,
    linhas,
    qr: { conteudo: d.qrCode, modulo: moduloDoQr(d.qrCode, w) },
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * O CSS é FIXO (as duas larguras escolhidas pela classe do body) para caber
 * num hash de CSP: a página não roda nada que não esteja aqui.
 *
 * Impressão: `@page { margin: 0 }` e a largura na caixa do cupom — 72 mm na
 * bobina de 80 mm e 48 mm na de 58 mm, centralizada. Assim sobra margem de 4 e
 * 5 mm de cada lado (o Manual pede no mínimo 2 mm, item 3.3) e o texto fica
 * dentro da área que a térmica imprime. O `size` do @page fica de fora de
 * propósito: "80mm auto" é CSS inválido (o navegador ignora) e "80mm" sozinho
 * vira uma página QUADRADA de 80 × 80 mm; o comprimento do rolo é do driver.
 */
const CSS_DO_DANFE = [
  "@page{margin:0}",
  "*{box-sizing:border-box}",
  "html{background:#e7e5e0;color-scheme:light;-webkit-text-size-adjust:100%;text-size-adjust:100%}",
  "@media (prefers-color-scheme:dark){html{background:#1d1d1b}}",
  'body{margin:0;padding:20px 16px 32px;color:#111;font-family:"Courier New",Courier,"Liberation Mono","DejaVu Sans Mono",monospace;font-size:13px;line-height:1.38}',
  ".barra{display:flex;justify-content:flex-end;margin:0 auto 12px}",
  ".l80 .barra{max-width:390px}.l58 .barra{max-width:310px}",
  '.barra button{font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer}',
  ".barra button:focus-visible{outline:3px solid #7aa7ff;outline-offset:2px}",
  // overflow-wrap: nada passa da largura do papel — palavra sem espaço maior
  // que a linha (um código de produto, a URL) quebra onde precisar.
  ".danfe{background:#fff;margin:0 auto;padding:18px 16px 22px;box-shadow:0 1px 2px rgba(0,0,0,.10),0 10px 30px rgba(0,0,0,.12);overflow-wrap:anywhere}",
  ".l80 .danfe{max-width:390px}.l58 .danfe{max-width:310px;font-size:12px}",
  "section{padding:7px 0;border-top:1px dashed #555}",
  "header{padding-bottom:7px}",
  ".c{text-align:center}.b{font-weight:700}",
  ".fantasia{font-size:1.25em;font-weight:700;letter-spacing:.02em}",
  ".faixa{margin:4px 0 8px;padding:6px 4px;text-align:center;border-top:3px double #111;border-bottom:3px double #111}",
  ".faixa strong{display:block;font-size:1.12em}",
  ".linha{display:flex;justify-content:space-between;align-items:baseline;gap:.6em}",
  ".linha>span:last-child{text-align:right;white-space:nowrap}",
  ".cab{font-weight:700}",
  ".itens{list-style:none;margin:4px 0 0;padding:0}",
  ".itens li{padding:3px 0}",
  ".itens .cod{color:#444}",
  ".itens .linha{padding-left:1.5em}",
  ".chave{word-spacing:.2em}",
  ".nw{white-space:nowrap}",
  ".destaque{font-weight:700;font-size:1.12em}",
  ".qr{display:flex;justify-content:center;padding:10px 0 8px;border-top:0}",
  ".qr a{display:block;line-height:0}",
  ".qr svg{display:block;width:36mm;height:36mm}",
  ".l58 .qr svg{width:31mm;height:31mm}",
  ".fora{border-top:0;padding-top:2px;font-size:.92em}",
  ".danfe+.danfe{margin-top:24px}",
  "@media print{",
  "html,body{background:#fff}",
  "body{padding:0;font-size:9pt;line-height:1.25}",
  ".barra{display:none}",
  ".danfe{box-shadow:none;padding:2mm 0 5mm}",
  ".danfe+.danfe{margin-top:0;break-before:page}",
  // 58 mm: 7,5 pt dá 30 caracteres nos 48 mm (a metade da chave, 29, cabe).
  ".l80 .danfe{width:72mm;max-width:none}",
  ".l58 .danfe{width:48mm;max-width:none;font-size:7.5pt}",
  ".chave{word-spacing:0}",
  "a{color:inherit;text-decoration:none}",
  "}",
].join("");

/** O botão Imprimir e a impressão ao abrir (?imprimir=1). Fixo, para caber no hash da CSP. */
const SCRIPT_DO_DANFE =
  '(function(){var b=document.getElementById("imprimir");if(b)b.addEventListener("click",function(){window.print()});' +
  'if(document.body.getAttribute("data-imprimir")==="1")window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})})();';

const hashCsp = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

/**
 * A Content-Security-Policy da página do DANFE: nada de fora, só o CSS e o
 * script DESTE arquivo (por hash), e nenhum formulário. Quem serve o HTML
 * (rota da loja e link do cliente) manda este cabeçalho.
 */
export const CSP_DO_DANFE = [
  "default-src 'none'",
  `style-src ${hashCsp(CSS_DO_DANFE)}`,
  `script-src ${hashCsp(SCRIPT_DO_DANFE)}`,
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export type OpcoesDoHtml = {
  /** Bobina: 80 mm (padrão) ou 58 mm. */
  largura?: 58 | 80;
  /** Uma via só, com o rótulo dela (contingência: "Via do Consumidor" / "Via do Estabelecimento"). */
  via?: ViaDoDanfe | null;
  /**
   * Várias vias na mesma página, com quebra de página entre elas — a rota da
   * loja manda `viasDoDanfe(dados)`: na contingência pendente, as duas saem
   * no mesmo clique de Imprimir. Vence `via`.
   */
  vias?: Array<ViaDoDanfe | null>;
  /** Abre a janela de impressão sozinho (?imprimir=1 na rota da loja). */
  imprimirAoAbrir?: boolean;
};

/**
 * O DANFE em HTML autocontido: CSS e script embutidos, QR em SVG, sem nada
 * externo — abre igual na tela do caixa, no navegador que imprime na térmica
 * e no celular do cliente.
 */
export function danfeHtml(dados: DadosDoDanfe, opcoes: OpcoesDoHtml = {}): string {
  const largura = opcoes.largura === 58 ? 58 : 80;
  const vias = opcoes.vias?.length ? opcoes.vias : [opcoes.via ?? null];
  const d = dados;
  const nome = d.emitente.nomeFantasia || d.emitente.razaoSocial;
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">` +
    `<title>${esc(`DANFE NFC-e nº ${d.numeroFormatado} · ${nome}`)}</title>` +
    `<style>${CSS_DO_DANFE}</style></head>` +
    `<body class="l${largura}"${opcoes.imprimirAoAbrir ? ' data-imprimir="1"' : ""}>` +
    `<div class="barra"><button id="imprimir" type="button">Imprimir</button></div>` +
    vias.map((via) => corpoDoDanfe(d, via)).join("") +
    `<script>${SCRIPT_DO_DANFE}</script></body></html>`
  );
}

/**
 * Página curta no lugar do DANFE (link inválido, nota cancelada, DANFE
 * indisponível) — o mesmo CSS e a mesma CSP da página do cupom.
 */
export function avisoDoDanfeHtml(titulo: string, linhas: string[]): string {
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">` +
    `<title>${esc(titulo)}</title><style>${CSS_DO_DANFE}</style></head>` +
    `<body class="l80"><main class="danfe c" aria-label="${esc(titulo)}">` +
    `<header><div class="fantasia">${esc(titulo)}</div></header>` +
    `<section>${linhas.map((l) => `<div>${esc(l)}</div>`).join("")}</section>` +
    `</main></body></html>`
  );
}

/** Uma via do DANFE: o <main> com as divisões na ordem da figura 1B do Manual. */
function corpoDoDanfe(d: DadosDoDanfe, via: ViaDoDanfe | null): string {
  const T = TEXTOS_DO_DANFE;
  const par = (rotulo: string, valor: string, classe = "") =>
    `<div class="linha${classe ? ` ${classe}` : ""}"><span>${esc(rotulo)}</span><span>${esc(valor)}</span></div>`;
  const div = (conteudo: string, classe = "") => `<div${classe ? ` class="${classe}"` : ""}>${conteudo}</div>`;

  const partes: string[] = [];

  // I — Cabeçalho
  partes.push(
    `<header class="c" data-div="I">` +
      (d.emitente.nomeFantasia ? div(esc(d.emitente.nomeFantasia), "fantasia") : "") +
      div(`${esc(d.emitente.documento)} <strong>${esc(d.emitente.razaoSocial)}</strong>`) +
      div(esc(d.emitente.endereco)) +
      div(esc(T.titulo)) +
      `</header>`
  );
  if (d.pendenteDeAutorizacao) {
    partes.push(`<div class="faixa" data-aviso="contingencia"><strong>${esc(T.contingencia)}</strong>${esc(T.pendente)}</div>`);
  }
  if (d.homologacao) partes.push(`<div class="faixa" data-aviso="homologacao"><strong>${esc(T.homologacao)}</strong></div>`);

  // II — Itens
  const itens = d.itens
    .map(
      (it) =>
        `<li>${div(`<span class="cod">${esc(it.codigo)}</span> ${esc(it.descricao)}`)}` +
        par(`${it.quantidade} ${it.unidade} x ${it.valorUnitario}`, it.valorTotal) +
        `</li>`
    )
    .join("");
  partes.push(
    `<section data-div="II">` +
      div("Código Descrição", "cab") +
      par("Qtde UN x Vl Unit", "Vl Total", "cab") +
      `<ol class="itens">${itens}</ol></section>`
  );

  // III — Totais
  const t = d.totais;
  const temAjuste = Boolean(t.desconto || t.acrescimos);
  partes.push(
    `<section data-div="III">` +
      par("Qtde. total de itens", String(t.quantidadeDeItens)) +
      par("Valor total R$", t.valorTotal, temAjuste ? "" : "b") +
      (t.desconto ? par("Desconto R$", t.desconto) : "") +
      (t.acrescimos ? par(`${t.acrescimos.rotulo} R$`, t.acrescimos.valor) : "") +
      (temAjuste ? par("Valor a Pagar R$", t.valorAPagar, "b") : "") +
      par("FORMA PAGAMENTO", "VALOR PAGO R$", "cab") +
      d.pagamentos.map((pg) => par(pg.descricao, pg.valor)).join("") +
      (d.troco ? par("Troco R$", d.troco) : "") +
      `</section>`
  );

  // IV — Consulta pela chave
  partes.push(
    `<section class="c" data-div="IV">` +
      div(esc(T.consulte), "b") +
      // Ponto de quebra depois de cada "/": na bobina estreita a URL quebra
      // em "…gov.br/" + "nfce/consulta", não no meio de uma palavra.
      div(d.consulta.url.split("/").map(esc).join("/<wbr>")) +
      // Duas metades que não quebram por dentro: numa linha se couber,
      // senão 6 + 5 blocos — nunca um bloco sozinho na linha de baixo.
      div(`<span class="nw">${esc(d.chaveEmBlocos.slice(0, 6).join(" "))}</span> <span class="nw">${esc(d.chaveEmBlocos.slice(6).join(" "))}</span>`, "chave") +
      `</section>`
  );

  // VI — Consumidor
  const c = d.consumidor;
  partes.push(
    `<section class="c" data-div="VI">` +
      (c.identificado
        ? div(esc(c.titulo), "b") + (c.nome ? div(esc(c.nome)) : "") + (c.endereco ? div(esc(c.endereco)) : "")
        : div(esc(T.naoIdentificado), "b")) +
      `</section>`
  );

  // VII — Identificação e protocolo
  const rotuloVia = rotuloDaVia(via);
  partes.push(
    `<section class="c" data-div="VII">` +
      div(
        `<strong class="nw">NFC-e nº ${esc(d.numeroFormatado)}</strong> <strong class="nw">Série ${esc(d.serieFormatada)}</strong> ` +
          `<span class="nw">${esc(d.emitidaEm)}</span>`
      ) +
      (rotuloVia ? div(esc(rotuloVia), "b") : "") +
      (d.protocolo
        ? div(`<strong>${esc(T.protocolo)}</strong> ${esc(d.protocolo.numero)}`) +
          div(`<strong>${esc(T.dataDeAutorizacao)}</strong> <span class="nw">${esc(d.protocolo.autorizadaEm)}</span>`)
        : "") +
      `</section>`
  );

  // VIII — Mensagem fiscal (sem borda: continua a VII, como na figura 6)
  const fiscais =
    (d.pendenteDeAutorizacao ? div(esc(T.contingencia), "destaque") + div(esc(T.pendente)) : "") +
    (d.contingencia?.entradaEm ? div(`${esc(T.contingenciaDesde)} <span class="nw">${esc(d.contingencia.entradaEm)}</span>`) : "") +
    (d.homologacao ? div(esc(T.homologacao), "b") : "") +
    d.mensagensFiscais.map((m) => div(esc(m))).join("");
  if (fiscais) partes.push(`<section class="c fora" data-div="VIII">${fiscais}</section>`);

  // V — QR Code (na tela, tocar abre a consulta da SEFAZ; no papel é só o QR)
  partes.push(`<section class="qr" data-div="V"><a href="${esc(d.qrCode)}" rel="noopener noreferrer">${qrEmSvg(d.qrCode)}</a></section>`);

  // IX — Contribuinte (tributos com valor e infCpl)
  const ix = (d.tributos.valor ? div(esc(d.tributos.texto)) : "") + (d.informacoesComplementares ? div(esc(d.informacoesComplementares)) : "");
  if (ix) partes.push(`<section class="c fora" data-div="IX">${ix}</section>`);
  // Depois do IX: o que não está no XML (3.1.9).
  if (!d.tributos.valor && d.tributos.texto) partes.push(`<section class="c fora" data-extra="tributos">${div(esc(d.tributos.texto))}</section>`);

  const rotulo = rotuloVia ? `DANFE NFC-e — ${rotuloVia}` : "DANFE NFC-e";
  return `<main class="danfe" aria-label="${esc(rotulo)}"${via ? ` data-via="${via}"` : ""}>${partes.join("")}</main>`;
}
