/**
 * /src/lib/nfce/emissor.ts
 *
 * A fachada do emissor PRÓPRIO de NFC-e: transmite direto à SEFAZ, sem
 * provedor, e devolve o MESMO formato de resultado que as funções da Focus em
 * lib/fiscal-emissao.ts (ResultadoDaEmissao, ResultadoDoCancelamento,
 * ResultadoDaInutilizacao) — quem hoje consome a Focus (fiscal-automatico,
 * rotas api/store/fiscal/*) pode trocar de caminho sem mudar a leitura.
 *
 *   corpo (montarCorpoDaNfce) → XML (xml-da-nota) → assinatura (assinatura)
 *     → QR Code (qrcode) → enviNFe/SOAP/mTLS (sefaz) → protNFe → nfeProc
 *
 * ── RECUSA DA NOTA × RECUSA DO LOTE ─────────────────────────────────────────
 *
 * O retEnviNFe tem dois níveis: o do LOTE (cStat do retEnviNFe) e o da NOTA
 * (protNFe). Só é "rejeitada" — nota com erro de conteúdo, número reservado
 * para a nota corrigida — a recusa que vem no protNFe DESTA chave, ou a
 * recusa do lote que é do conteúdo/schema da nota (215, 225 e as demais
 * regras de validação). O resto não fala da nota (MOC 7.0, Anexo I, 4.3 e
 * tabela 4.4):
 *  - falha do SISTEMA da SEFAZ — 108/109 (paralisado), 999 (erro não
 *    catalogado), 656 (consumo indevido: o autorizador recusa TUDO por até
 *    1 h, MOC 4.3.1), 286/296 (LCR indisponível): transitória, vale
 *    contingência off-line;
 *  - CERTIFICADO do transmissor ou da assinatura (213, 280–285, 290–295):
 *    configuração (pendência "certificado"), sem queimar número.
 * Na transmissão da CONTINGÊNCIA só a recusa com protNFe desta chave derruba
 * o cupom (`recusaDaNota`) — quem decide é lib/nfce/emissao-da-loja.
 *
 * ── CONTINGÊNCIA OFF-LINE (tpEmis = 9) ──────────────────────────────────────
 *
 * Manual de Padrões — Contingência Off-line NFC-e, versão 2.0:
 *  - só quando a autorização em tempo real é impossível: aqui, falha de
 *    transporte (timeout, conexão, HTTP 5xx), falha do sistema da SEFAZ (acima)
 *    ou a loja bloqueada por consumo indevido (`contingenciaDireta`);
 *  - a nota sai com tpEmis=9, dhCont e xJust, QR Code OFFLINE, e o DANFE
 *    impresso com "EMITIDA EM CONTINGÊNCIA";
 *  - "É vedada a reutilização, em contingência, de número de NFC-e transmitida
 *    com tipo de emissão Normal" (item 4; Ajuste SINIEF 19/16, cl. 11ª § 2º I).
 *    Se o pedido PODE ter chegado à SEFAZ (o corpo saiu e a resposta não veio,
 *    ou a SEFAZ respondeu 999), a contingência usa OUTRO número
 *    (`numeroDeContingencia`, ou `reservarNumeroDeContingencia` — chamado só
 *    neste caso) e devolve o número tentado para ser conferido depois
 *    (autorizada → cancelar por substituição; não autorizada → inutilizar). Se
 *    caiu antes de sair (DNS, conexão recusada, handshake) ou o lote foi
 *    recusado sem ser processado (108/109/656/286), "a numeração pode ser
 *    mantida";
 *  - transmitir até o fim do primeiro dia útil seguinte, com a MESMA chave
 *    (mesmo cNF) — `transmitirContingencia` manda o XML guardado, sem mexer;
 *  - RECUSADA na transmissão, a nota é gerada de novo "com a mesma numeração e
 *    série, sanando a irregularidade", SEM alterar a data de emissão (Ajuste
 *    SINIEF 19/16, cl. 11ª § 1º III): `refazerContingencia` remonta com os
 *    MESMOS dhEmi, dhCont, xJust e cNF — a mesma chave — e transmite.
 */
import type {
  CorpoDaNfce,
  NotaEmitida,
  ResultadoDaEmissao,
  ResultadoDaInutilizacao,
  ResultadoDoCancelamento,
} from "../fiscal-emissao";
import type { Problema } from "../fiscal-validacao";
import {
  assinarTextoRsaSha1,
  assinarXml,
  carregarCertificado,
  digestValueDoXml,
  ErroDoCertificado,
  verificarAssinatura,
  type CertificadoCarregado,
} from "./assinatura";
import { chaveValida, lerChave } from "./chave";
import { qrCodeV2Offline, qrCodeV2Online, qrCodeV3Offline, qrCodeV3Online, urlsDaUf, diaDoDhEmi } from "./qrcode";
import {
  FalhaDeTransporte,
  FalhaSoap,
  chamarServico,
  lerRetConsReciNFe,
  lerRetConsSitNFe,
  lerRetConsStatServ,
  lerRetEnvEvento,
  lerRetEnviNFe,
  lerRetInutNFe,
  montarConsReciNFe,
  montarConsSitNFe,
  montarConsStatServ,
  montarEnviNFe,
  montarEventoDeCancelamento,
  montarInutilizacao,
  montarNfeProc,
  montarProcEventoNFe,
  montarProcInutNFe,
  transporteHttps,
  type Ambiente,
  type MensagemDaSefaz,
  type ProtocoloDaNota,
  type Transporte,
} from "./sefaz";
import { FUSO_DA_UF, VERSAO_DO_EMISSOR, dataHoraNoFuso, inserirInfNFeSupl, montarXmlDaNfce, type ContextoDaNota, type ResponsavelTecnico } from "./xml-da-nota";
import { lerXml, primeiro } from "./xml";

export type ConfiguracaoDoQrCode = { versao: 2; idCsc: string; csc: string } | { versao: 3 };

/** O que a nota de contingência RECUSADA tinha e a corrigida mantém (ver `refazerContingencia`). */
export type ContingenciaARefazer = {
  chave: string;
  dhEmi: string;
  dhCont: string;
  xJust: string;
  codigoNumerico: string;
};

export type ContextoDoEmissor = {
  /** O A1 da loja: o .pfx e a senha (decifrados por quem chama), ou já carregado. */
  certificado: { pfx: Buffer | Uint8Array; senha: string } | CertificadoCarregado;
  uf: string;
  ambiente: Ambiente;
  serie: number;
  /** O número desta nota (quem chama reserva a sequência). */
  numero: number;
  /** Próximo número livre, usado SÓ se a contingência não puder reaproveitar `numero`. */
  numeroDeContingencia?: number | null;
  /**
   * Reserva o número da contingência só na hora em que ele é preciso: o
   * pedido pode ter chegado à SEFAZ e o número tentado não pode ir para a
   * contingência. Reservar antes, a cada nota, queimaria um número por
   * emissão — e cada número queimado vira inutilização obrigatória no mês
   * seguinte. Vale quando `numeroDeContingencia` não veio.
   */
  reservarNumeroDeContingencia?: () => Promise<number>;
  /**
   * Chamado com a nota JÁ ASSINADA, antes de ela sair para a SEFAZ. Quem
   * integra guarda ali o XML e a chave: se o processo cair no meio da
   * transmissão, só a consulta pela chave diz se ela foi autorizada — e o
   * nfeProc só se monta com ESTE XML (o cNF é sorteado e a assinatura é do
   * XML exato; não se refaz depois). Se lançar, nada é transmitido.
   */
  aoAssinar?: (nota: NotaAssinada) => Promise<void> | void;
  /** A UF pode não admitir contingência off-line; aí desligue (padrão: ligada). */
  contingenciaOffline?: boolean;
  /**
   * Não tente a SEFAZ: vá direto para a contingência off-line, com este
   * motivo (vira o xJust). É o caminho da loja bloqueada por consumo indevido
   * (656): chamar de novo durante o bloqueio só o prolonga (MOC 7.0, 4.3).
   */
  contingenciaDireta?: string | null;
  /**
   * A nota de contingência RECUSADA na transmissão, a gerar de novo corrigida
   * (Ajuste SINIEF 19/16, cl. 11ª § 1º III): mesmo número e série (os do
   * contexto), MESMOS dhEmi, dhCont, xJust e cNF — a mesma chave. Sem
   * resposta da SEFAZ, a corrigida fica valendo como contingência.
   */
  refazerContingencia?: ContingenciaARefazer | null;
  qrCode: ConfiguracaoDoQrCode;
  emitente?: ContextoDaNota["emitente"];
  responsavelTecnico?: ResponsavelTecnico | null;
  codigoDoMunicipio?: ContextoDaNota["codigoDoMunicipio"];
  verProc?: string;
  /** Tempo para a SEFAZ responder a autorização antes de ir para a contingência. */
  timeoutMs?: number;
  /** Injetáveis (testes). */
  transporte?: Transporte;
  agora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
};

/** Autorizada com alerta (cStat 120, NT 2026.002 item 2): o que a SEFAZ avisou, para a nota guardar. */
export type AlertaDaSefaz = { cStat: string; xMotivo: string; mensagens: MensagemDaSefaz[] };

/** O resultado de sempre, mais o que só o emissor próprio tem. */
export type ExtrasDaSefaz = {
  /**
   * Autorizada: o nfeProc (NFe + protNFe) — o XML que se guarda por 5 anos.
   * Contingência: a NFe ASSINADA, que tem de ser guardada para `transmitirContingencia`.
   * Consulta que achou a nota cancelada: o nfeProc dela (a nota existiu).
   */
  xml?: string;
  /** Contingência depois de um envio sem resposta: o número tentado, a conferir (cancelar ou inutilizar). */
  numeroTentado?: { numero: number; chave: string } | null;
  /** cNF da nota — na retransmissão de contingência, é o mesmo. */
  codigoNumerico?: string;
  /** Lote assíncrono (103): o recibo (nRec). A conferência consulta o recibo antes da chave. */
  recibo?: string | null;
  /**
   * O cStat da SEFAZ. Na falha é o da recusa (o de sempre); na contingência, o
   * que levou a ela (656, 108...). Quem integra lê daqui o 656.
   */
  statusSefaz?: string;
  /** A recusa veio no protNFe DESTA chave: a nota foi analisada e recusada. Só ela derruba um cupom de contingência. */
  recusaDaNota?: boolean;
  /** 539: a chave que a SEFAZ diz já ocupar este número ("[chNFe: ...]" do xMotivo). */
  chaveDuplicada?: string | null;
  /**
   * A nota PODE estar na SEFAZ (o corpo saiu e a resposta não veio, o lote
   * está em processamento, a resposta veio ilegível): o envio fica para ser
   * conferido pela chave. Falso quando nada saiu ou o lote foi recusado sem
   * ser processado — aí o número segue livre, sem conferência.
   */
  talvezNaSefaz?: boolean;
  /** Autorizada com alerta (cStat 120): a mensagem da SEFAZ. */
  alertaSefaz?: AlertaDaSefaz | null;
  /** Consulta que achou a nota CANCELADA: o evento que a SEFAZ devolveu (o procEventoNFe, quando veio). */
  cancelamento?: { tpEvento: string | null; protocolo: string | null; em: string | null; xml: string | null } | null;
  /** O protocolo da AUTORIZAÇÃO, quando a consulta achou a nota cancelada (é o nProt dela). */
  protocoloDaAutorizacao?: string | null;
};
export type ResultadoDaEmissaoSefaz = ResultadoDaEmissao & ExtrasDaSefaz;

type Falha = Extract<ResultadoDaEmissao, { ok: false }> & ExtrasDaSefaz;

/** "Autorizado o uso": 100, 150 (fora de prazo) e 120 (com alerta — NT 2026.002, item 2; produção a partir de 05/10/2026). */
const AUTORIZADA = new Set(["100", "120", "150"]);
const DENEGADA = new Set(["110", "301", "302", "303"]);
const CANCELADA = new Set(["101", "151", "155"]);
/** SEFAZ fora: vale contingência (MOC: 108 = paralisado momentaneamente, 109 = sem previsão). */
const SEFAZ_PARALISADA = new Set(["108", "109"]);
/**
 * Falha do SISTEMA da SEFAZ, não da nota: 999 (erro não catalogado), 656
 * (consumo indevido — MOC 4.3), 286 e 296 (erro no acesso à LCR do
 * certificado). Transitória.
 */
const FALHA_DO_SISTEMA = new Set(["999", "656", "286", "296"]);
/** 999: a SEFAZ quebrou no meio — a nota pode ter sido gravada. As outras recusam o lote antes de processar. */
const SISTEMA_QUE_PODE_TER_GRAVADO = new Set(["999"]);
/**
 * Certificado do transmissor (280–285) ou da assinatura (290–295), e o
 * certificado de outro CNPJ (213): configuração da loja, não conteúdo da nota
 * — MOC 7.0 Anexo I, tabela 4.4.2.
 */
const DO_CERTIFICADO = new Set(["213", "280", "281", "282", "283", "284", "285", "290", "291", "292", "293", "294", "295"]);
/** Inutilização que a SEFAZ já tem (256: faixa já inutilizada; 563: pedido igual já existe; 206: número já inutilizado). */
export const JA_INUTILIZADA = new Set(["256", "563", "206"]);

/** O que um cStat que NÃO autorizou quer dizer para quem emite (ver o cabeçalho). */
export type NaturezaDaRecusa = "paralisada" | "sistema" | "certificado" | "conteudo";
export function naturezaDaRecusa(cStat: string | null | undefined): NaturezaDaRecusa {
  const c = String(cStat ?? "");
  if (SEFAZ_PARALISADA.has(c)) return "paralisada";
  if (FALHA_DO_SISTEMA.has(c)) return "sistema";
  if (DO_CERTIFICADO.has(c)) return "certificado";
  return "conteudo";
}

/**
 * A chave que o 539 informa no xMotivo ("Rejeição: Duplicidade de NF-e com
 * diferença na Chave de Acesso [chNFe: 5326...][nRec: ...]" — MOC 7.0, regra
 * 2B08-10). É por ela que se sabe se o número está com uma nota NOSSA.
 */
export function chaveDoMotivo(xMotivo: string | null | undefined): string | null {
  const m = /chNFe\s*:?\s*([0-9]{6}[0-9A-Z]{12}[0-9]{26})/i.exec(String(xMotivo ?? ""));
  return m && chaveValida(m[1]) ? m[1] : null;
}

/**
 * O que fazer, em português, nas rejeições que só o emissor próprio encontra
 * (na Focus, quem tratava era ela) e nas de conteúdo. Textos das rejeições:
 * MOC 7.0 Anexo I, tabela de códigos de erro.
 */
export const O_QUE_FAZER: Record<string, string> = {
  "204": "A SEFAZ já tem esta nota (duplicidade). Consulte a situação — NÃO emita de novo.",
  "539": "Já existe nota com este número e outra chave. O número está queimado: emita com o próximo número.",
  "213": "O certificado digital é de outro CNPJ. Use o A1 da própria loja.",
  "280": "Certificado digital inválido para a SEFAZ (não é ICP-Brasil, vencido ou revogado).",
  "297": "A assinatura não conferiu: o XML foi alterado depois de assinado.",
  "225": "Falha de schema no XML — defeito do emissor. Avise o suporte com a chave.",
  "215": "Falha de schema no XML — defeito do emissor. Avise o suporte com a chave.",
  "395": "Endereço do QR Code diferente do da UF.",
  "462": "O identificador do CSC não existe na SEFAZ. Confira o id do CSC cadastrado no portal da SEFAZ.",
  "463": "O CSC foi revogado. Gere um CSC novo no portal da SEFAZ e cadastre aqui.",
  "464": "O hash do QR Code não confere: o CSC cadastrado não é o do id informado.",
  "656": "A SEFAZ bloqueou o CNPJ por consumo indevido (até 1 hora). O FireHub não chama a SEFAZ por esta loja até o bloqueio passar; as vendas saem em contingência.",
  "703": "O relógio do servidor está adiantado em relação à SEFAZ.",
  "704": "A nota ficou atrasada mais de 5 minutos em relação à SEFAZ. Emita de novo.",
  "717": "Desde 03/08/2026 a NFC-e só aceita presença 1, 4 ou 5 (NT 2026.002).",
  "787": "Nota de entrega precisa do CPF ou CNPJ do cliente.",
  "788": "Nota de entrega precisa do endereço completo do cliente.",
  "391": "Pagamento com cartão ou Pix precisa do grupo de cartão.",
  "434": "Faltou o indicador de intermediador.",
  "438": "Venda por marketplace precisa do CNPJ e do identificador do intermediador.",
  "865": "As formas de pagamento somam menos que o total da nota.",
  "866": "O pagamento passou do total e o troco não foi informado.",
  "972": "A SEFAZ desta UF exige o responsável técnico (infRespTec) — configure o CNPJ e contato do FireHub.",
};

const hojeNoFuso = (agora: Date, uf: string) => dataHoraNoFuso(agora, FUSO_DA_UF[uf] ?? "America/Sao_Paulo");

function falha(motivo: Falha["motivo"], mensagem: string, extra: Partial<Falha> = {}): Falha {
  return { ok: false, motivo, mensagem, ...extra };
}

/** Pendência de certificado no formato da tela (a mesma de `prepararCertificado`). */
const pendenciaDoCertificado = (mensagem: string, valor: string | null = null): Problema[] => [{ campo: "certificado", valor, mensagem }];

/** Carrega e confere o certificado: validade e CNPJ-base do emitente (rejeições 280 e 213 antes de sair). */
function prepararCertificado(
  ctx: Pick<ContextoDoEmissor, "certificado">,
  cnpjEmitente: string | null,
  agora: Date
): { ok: true; cert: CertificadoCarregado } | { ok: false; falha: Falha } {
  let cert: CertificadoCarregado;
  try {
    cert = "chavePrivadaPem" in ctx.certificado ? ctx.certificado : carregarCertificado(ctx.certificado.pfx, ctx.certificado.senha);
  } catch (e: any) {
    const msg = e instanceof ErroDoCertificado ? e.message : `Não consegui ler o certificado digital: ${e?.message ?? e}`;
    return { ok: false, falha: falha("nao_configurado", msg, { pendencias: pendenciaDoCertificado(msg) }) };
  }
  if (cert.validoAte.getTime() < agora.getTime()) {
    const msg = `O certificado digital venceu em ${cert.validoAte.toISOString().slice(0, 10)}. Renove o A1 para voltar a emitir.`;
    return { ok: false, falha: falha("nao_configurado", msg, { pendencias: pendenciaDoCertificado(msg) }) };
  }
  if (cert.validoDe.getTime() > agora.getTime()) {
    const msg = "O certificado digital ainda não está valendo (data de início no futuro).";
    return { ok: false, falha: falha("nao_configurado", msg, { pendencias: pendenciaDoCertificado(msg) }) };
  }
  const cnpj = String(cnpjEmitente ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (cnpj && cert.cnpj && cert.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    const msg = `O certificado digital é do CNPJ ${cert.cnpj}, e a nota é do CNPJ ${cnpj} (a SEFAZ rejeitaria com 213).`;
    return { ok: false, falha: falha("nao_configurado", msg, { pendencias: pendenciaDoCertificado(msg, cert.cnpj) }) };
  }
  return { ok: true, cert };
}

export type NotaAssinada = {
  xml: string;
  chave: string;
  codigoNumerico: string;
  dhEmi: string;
  qrCode: string;
  numero: number;
  tipoDeEmissao: 1 | 9;
};

/**
 * Monta, assina e põe o QR Code. Não transmite. Exportada para o teste e para
 * a contingência (que usa o mesmo caminho com tpEmis 9).
 */
export function prepararNotaAssinada(
  corpo: CorpoDaNfce | Record<string, unknown>,
  ctx: Omit<ContextoDoEmissor, "certificado" | "numero"> & { numero: number; codigoNumerico?: string },
  cert: CertificadoCarregado,
  opcoes: { tipoDeEmissao: 1 | 9; agora: Date; contingencia?: { entradaEm: Date; justificativa: string } }
): { ok: true; nota: NotaAssinada } | { ok: false; mensagem: string; pendencias: Problema[] } {
  const montada = montarXmlDaNfce(corpo as Record<string, unknown>, {
    uf: ctx.uf,
    ambiente: ctx.ambiente,
    serie: ctx.serie,
    numero: ctx.numero,
    tipoDeEmissao: opcoes.tipoDeEmissao,
    contingencia: opcoes.contingencia ?? null,
    codigoNumerico: ctx.codigoNumerico,
    dataDeEmissao: opcoes.agora,
    verProc: ctx.verProc,
    emitente: ctx.emitente,
    responsavelTecnico: ctx.responsavelTecnico,
    codigoDoMunicipio: ctx.codigoDoMunicipio,
  });
  if (!montada.ok) return montada;

  const assinado = assinarXml(montada.xml, "infNFe", cert);
  const urls = urlsDaUf(ctx.uf, ctx.ambiente);
  const offline = opcoes.tipoDeEmissao === 9;
  let qrCode: string;
  if (ctx.qrCode.versao === 3) {
    qrCode = offline
      ? qrCodeV3Offline({
          urlBase: urls.qrCode,
          chave: montada.chave,
          ambiente: ctx.ambiente,
          dia: diaDoDhEmi(montada.dhEmi),
          valorTotalEmCentavos: montada.totalEmCentavos,
          destinatario: montada.destinatario,
          assinar: (texto) => assinarTextoRsaSha1(texto, cert.chavePrivadaPem),
        })
      : qrCodeV3Online({ urlBase: urls.qrCode, chave: montada.chave, ambiente: ctx.ambiente });
  } else {
    qrCode = offline
      ? qrCodeV2Offline({
          urlBase: urls.qrCode,
          chave: montada.chave,
          ambiente: ctx.ambiente,
          dia: diaDoDhEmi(montada.dhEmi),
          valorTotalEmCentavos: montada.totalEmCentavos,
          digestValue: digestValueDoXml(assinado),
          idCsc: ctx.qrCode.idCsc,
          csc: ctx.qrCode.csc,
        })
      : qrCodeV2Online({ urlBase: urls.qrCode, chave: montada.chave, ambiente: ctx.ambiente, idCsc: ctx.qrCode.idCsc, csc: ctx.qrCode.csc });
  }
  return {
    ok: true,
    nota: {
      xml: inserirInfNFeSupl(assinado, qrCode, urls.urlChave),
      chave: montada.chave,
      codigoNumerico: montada.codigoNumerico,
      dhEmi: montada.dhEmi,
      qrCode,
      numero: ctx.numero,
      tipoDeEmissao: opcoes.tipoDeEmissao,
    },
  };
}

const idLote = (agora: Date) => String(agora.getTime()).slice(-15);
const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** O alerta de uma autorização (cStat 120 ou mensagem cMsg/xMsg junto da autorização). */
function alertaDoProtocolo(prot: ProtocoloDaNota): AlertaDaSefaz | null {
  if (prot.cStat !== "120" && prot.mensagens.length === 0) return null;
  return { cStat: prot.cStat, xMotivo: prot.xMotivo, mensagens: prot.mensagens };
}

function notaAutorizada(nota: Pick<NotaAssinada, "chave" | "dhEmi" | "qrCode" | "codigoNumerico">, prot: ProtocoloDaNota, xmlNFe: string, ambiente: Ambiente): ResultadoDaEmissaoSefaz {
  const partes = lerChave(nota.chave);
  const emitida: NotaEmitida = {
    chaveDeAcesso: nota.chave,
    numero: partes.numero,
    serie: partes.serie,
    protocolo: prot.protocolo ?? "",
    emitidaEm: nota.dhEmi,
    // O emissor próprio não publica o XML nem gera DANFE em URL: o XML vai em `xml`.
    urlDoXml: null,
    urlDoDanfe: null,
    urlDoQrCode: nota.qrCode,
    ambiente,
  };
  return { ok: true, ...emitida, xml: montarNfeProc(xmlNFe, prot.xml), codigoNumerico: nota.codigoNumerico, alertaSefaz: alertaDoProtocolo(prot) };
}

function traduzirRecusa(cStat: string, xMotivo: string, detalhe: string, extra: Partial<Falha> = {}): Falha {
  const denegada = DENEGADA.has(cStat);
  const oQueFazer = O_QUE_FAZER[cStat];
  return falha(
    "rejeitada",
    (denegada ? "A SEFAZ DENEGOU o uso desta nota (irregularidade cadastral): " : "A SEFAZ recusou esta nota: ") +
      `[${cStat}] ${xMotivo}` +
      (oQueFazer ? ` — ${oQueFazer}` : ""),
    { statusSefaz: cStat, detalheDaRejeicao: detalhe.slice(0, 600), ...(cStat === "539" ? { chaveDuplicada: chaveDoMotivo(xMotivo) } : {}), ...extra }
  );
}

/** Certificado recusado pela SEFAZ (28x/29x/213): configuração da loja, sem queimar número. */
function recusaDoCertificado(cStat: string, xMotivo: string, detalhe: string): Falha {
  const msg =
    `A SEFAZ recusou o CERTIFICADO digital da loja: [${cStat}] ${xMotivo}` +
    (O_QUE_FAZER[cStat] ? ` — ${O_QUE_FAZER[cStat]}` : " — confira se o A1 é ICP-Brasil, está dentro da validade e não foi revogado.") +
    " Nenhum número foi gasto.";
  return falha("nao_configurado", msg, { statusSefaz: cStat, detalheDaRejeicao: detalhe.slice(0, 600), pendencias: pendenciaDoCertificado(msg) });
}

type Tentativa =
  | { tipo: "resultado"; resultado: ResultadoDaEmissaoSefaz }
  /**
   * A nota não foi autorizada nem recusada pelo conteúdo: transporte, SEFAZ
   * paralisada ou falha do sistema dela. `enviado` = pode ter sido gravada lá.
   */
  | { tipo: "sem_resposta"; enviado: boolean; motivo: string; statusSefaz?: string };

type Conexao = Pick<ContextoDoEmissor, "uf" | "ambiente" | "timeoutMs" | "esperar">;

/**
 * O que um cStat SEM protNFe desta chave quer dizer (o lote recusado, ou o
 * protNFe de uma falha de sistema): ver o cabeçalho.
 */
function recusaSemProtocolo(cStat: string, xMotivo: string, corpo: string): Tentativa {
  const natureza = naturezaDaRecusa(cStat);
  if (natureza === "paralisada") return { tipo: "sem_resposta", enviado: false, motivo: `SEFAZ paralisada: [${cStat}] ${xMotivo}`, statusSefaz: cStat };
  if (natureza === "sistema") {
    return {
      tipo: "sem_resposta",
      enviado: SISTEMA_QUE_PODE_TER_GRAVADO.has(cStat),
      motivo: `A SEFAZ não processou a nota: [${cStat}] ${xMotivo}`,
      statusSefaz: cStat,
    };
  }
  if (natureza === "certificado") return { tipo: "resultado", resultado: recusaDoCertificado(cStat, xMotivo, corpo) };
  // Recusa do LOTE que é do conteúdo/schema da nota (215, 225...): a nota não
  // entrou na SEFAZ, o número segue livre para a corrigida.
  return { tipo: "resultado", resultado: traduzirRecusa(cStat, xMotivo, corpo, { recusaDaNota: false, talvezNaSefaz: false }) };
}

/** A resposta de UM protNFe para a nota (a da autorização, a do recibo). */
async function interpretarProtocolo(
  nota: Pick<NotaAssinada, "xml" | "chave" | "dhEmi" | "qrCode" | "codigoNumerico">,
  prot: ProtocoloDaNota,
  corpo: string,
  ctx: Conexao,
  transporte: Transporte
): Promise<Tentativa> {
  if (prot.chave && prot.chave !== nota.chave) {
    return {
      tipo: "resultado",
      resultado: falha("erro_de_comunicacao", "A SEFAZ devolveu o protocolo de OUTRA chave. Consulte a nota antes de qualquer coisa.", {
        detalheDaRejeicao: corpo.slice(0, 600),
        talvezNaSefaz: true,
      }),
    };
  }
  if (AUTORIZADA.has(prot.cStat)) return { tipo: "resultado", resultado: notaAutorizada(nota, prot, nota.xml, ctx.ambiente) };
  if (prot.cStat === "204") return { tipo: "resultado", resultado: await duplicidade(nota, ctx, transporte, corpo) };
  const natureza = naturezaDaRecusa(prot.cStat);
  if (natureza !== "conteudo") return recusaSemProtocolo(prot.cStat, prot.xMotivo, corpo);
  return { tipo: "resultado", resultado: traduzirRecusa(prot.cStat, prot.xMotivo, corpo, { recusaDaNota: true, talvezNaSefaz: false }) };
}

/**
 * 204 — duplicidade da MESMA chave: uma tentativa anterior chegou. Busca o
 * protocolo. Sem resposta da consulta, a nota ESTÁ na SEFAZ (é o que o 204
 * diz): "processando", nunca recusa — recusar aqui mandava emitir de novo, e
 * saíam duas notas autorizadas para a mesma venda.
 */
async function duplicidade(nota: Pick<NotaAssinada, "xml" | "chave" | "dhEmi" | "qrCode" | "codigoNumerico">, ctx: Conexao, transporte: Transporte, corpo: string): Promise<ResultadoDaEmissaoSefaz> {
  const consulta = await consultarSituacao(nota.chave, ctx, transporte);
  if (consulta && AUTORIZADA.has(consulta.cStat) && consulta.protocolo && AUTORIZADA.has(consulta.protocolo.cStat)) {
    return notaAutorizada(nota, consulta.protocolo, nota.xml, ctx.ambiente);
  }
  return falha(
    "processando",
    `A SEFAZ já tem esta nota (duplicidade, 204), e a consulta da chave ${nota.chave} não confirmou a autorização agora. ` +
      "A consulta automática confere — NÃO emita de novo.",
    { statusSefaz: consulta?.cStat === "656" ? "656" : "204", detalheDaRejeicao: corpo.slice(0, 600), talvezNaSefaz: true }
  );
}

/**
 * Manda uma nota JÁ ASSINADA e traduz a resposta. Usada na emissão normal e
 * na transmissão da contingência (mesma nota, mesma chave).
 */
async function transmitirNota(
  nota: Pick<NotaAssinada, "xml" | "chave" | "dhEmi" | "qrCode" | "codigoNumerico">,
  ctx: Conexao,
  transporte: Transporte,
  agora: Date
): Promise<Tentativa> {
  let ret: ReturnType<typeof lerRetEnviNFe>;
  let corpoDaResposta = "";
  try {
    const r = await chamarServico({
      uf: ctx.uf,
      ambiente: ctx.ambiente,
      servico: "autorizacao",
      mensagem: montarEnviNFe(nota.xml, idLote(agora)),
      transporte,
      timeoutMs: ctx.timeoutMs ?? 20_000,
    });
    corpoDaResposta = r.corpo;
    ret = lerRetEnviNFe(r.resposta);
  } catch (e: any) {
    if (e instanceof FalhaDeTransporte) {
      if (/^HTTP40[13]$/.test(e.codigo ?? "")) {
        return { tipo: "resultado", resultado: falha("nao_configurado", e.message, { pendencias: pendenciaDoCertificado(e.message) }) };
      }
      return { tipo: "sem_resposta", enviado: e.enviado, motivo: e.message };
    }
    return {
      tipo: "resultado",
      resultado: falha("erro_de_comunicacao", `Resposta da SEFAZ ilegível. A nota pode ou não ter sido autorizada — consulte antes de reemitir.`, {
        detalheDaRejeicao: String(e instanceof FalhaSoap ? e.message : e?.message ?? e).slice(0, 600),
        talvezNaSefaz: true,
      }),
    };
  }

  // Lote assíncrono (103): não deveria acontecer na NFC-e, mas se a SEFAZ
  // mandar recibo, consulta o recibo algumas vezes. O recibo volta junto em
  // qualquer caso: é por ELE que a conferência pergunta primeiro (a chave de
  // um lote ainda na fila dá 217, e 217 ali não quer dizer "não chegou").
  if (ret.cStat === "103" && ret.recibo) {
    const recibo = ret.recibo;
    const esperar = ctx.esperar ?? esperarPadrao;
    let ultimo: string = ret.cStat;
    for (let i = 0; i < 3; i++) {
      await esperar(2_000);
      try {
        const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "retAutorizacao", mensagem: montarConsReciNFe(ctx.ambiente, recibo), transporte });
        const lote = lerRetConsReciNFe(r.resposta);
        ultimo = lote.cStat;
        if (lote.cStat === "105") continue;
        const prot = lote.protocolos.find((p) => p.chave === nota.chave) ?? null;
        if (lote.cStat === "104" && prot) {
          const t = await interpretarProtocolo(nota, prot, r.corpo, ctx, transporte);
          if (t.tipo === "resultado") return { tipo: "resultado", resultado: { ...t.resultado, recibo } };
          return t;
        }
        // 106 (lote não localizado), 656 na consulta do recibo...: a nota
        // está na SEFAZ (o 103 disse) e o destino dela não se sabe ainda.
        break;
      } catch {
        // tenta de novo
      }
    }
    return {
      tipo: "resultado",
      resultado: falha("processando", "A SEFAZ recebeu a nota mas ainda não terminou de processá-la. A consulta automática confere pelo recibo — NÃO emita de novo.", {
        statusSefaz: ultimo === "656" ? "656" : ultimo === "103" ? "103" : "105",
        recibo,
        talvezNaSefaz: true,
      }),
    };
  }
  if (ret.cStat === "103" || ret.cStat === "105") {
    return {
      tipo: "resultado",
      resultado: falha("processando", "A SEFAZ recebeu a nota mas ainda não terminou de processá-la. Consulte a situação em instantes — NÃO emita de novo.", {
        statusSefaz: ret.cStat,
        recibo: ret.recibo ?? null,
        talvezNaSefaz: true,
      }),
    };
  }

  const prot = ret.protocolo;
  if (prot) return interpretarProtocolo(nota, prot, corpoDaResposta, ctx, transporte);
  if (ret.cStat === "204") return { tipo: "resultado", resultado: await duplicidade(nota, ctx, transporte, corpoDaResposta) };
  if (ret.cStat === "104") {
    return {
      tipo: "resultado",
      resultado: falha("erro_de_comunicacao", "A SEFAZ disse que processou o lote e não devolveu o protocolo da nota. Consulte antes de reemitir.", {
        detalheDaRejeicao: corpoDaResposta.slice(0, 600),
        talvezNaSefaz: true,
      }),
    };
  }
  // Recusa do LOTE: a nota nem foi analisada.
  return recusaSemProtocolo(ret.cStat, ret.xMotivo, corpoDaResposta);
}

/** A situação crua de uma chave (consSitNFe), ou null sem resposta. */
async function consultarSituacao(chave: string, ctx: Pick<ContextoDoEmissor, "uf" | "ambiente">, transporte: Transporte): Promise<ReturnType<typeof lerRetConsSitNFe> | null> {
  try {
    const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "consulta", mensagem: montarConsSitNFe(ctx.ambiente, chave), transporte, timeoutMs: 15_000 });
    return lerRetConsSitNFe(r.resposta);
  } catch {
    return null;
  }
}

/** A nota off-line (tpEmis 9) pronta, no formato de resultado. */
function comoContingencia(n: NotaAssinada, ctx: Pick<ContextoDoEmissor, "ambiente">, extra: { aviso: string; numeroTentado?: { numero: number; chave: string } | null; statusSefaz?: string }): ResultadoDaEmissaoSefaz {
  const partes = lerChave(n.chave);
  return {
    ok: true,
    chaveDeAcesso: n.chave,
    numero: partes.numero,
    serie: partes.serie,
    protocolo: "",
    emitidaEm: n.dhEmi,
    urlDoXml: null,
    urlDoDanfe: null,
    urlDoQrCode: n.qrCode,
    ambiente: ctx.ambiente,
    emContingencia: true,
    aviso: extra.aviso,
    xml: n.xml,
    codigoNumerico: n.codigoNumerico,
    numeroTentado: extra.numeroTentado ?? null,
    ...(extra.statusSefaz ? { statusSefaz: extra.statusSefaz } : {}),
  };
}

const AVISO_DA_CONTINGENCIA =
  "Nota emitida em CONTINGÊNCIA OFF-LINE (a SEFAZ não respondeu). O cupom vale para o cliente e o DANFE deve ser " +
  "impresso com \"EMITIDA EM CONTINGÊNCIA\", mas a nota ainda NÃO está autorizada: transmita até o fim do próximo " +
  "dia útil. Se a SEFAZ recusar, a nota precisa ser corrigida com o mesmo número.";

/**
 * Emite a NFC-e direto na SEFAZ.
 *
 * `corpo` é o que `montarCorpoDaNfce` devolveu (montagem.corpo). Devolve o
 * formato de `emitirNfce` (Focus) + `xml`. Nunca finge: sem resposta e sem
 * contingência possível, diz que não sabe e manda consultar.
 */
export async function emitirNfceNaSefaz(corpo: CorpoDaNfce | Record<string, unknown>, ctx: ContextoDoEmissor): Promise<ResultadoDaEmissaoSefaz> {
  const agora = (ctx.agora ?? (() => new Date()))();
  const c = prepararCertificado(ctx, String((corpo as any).cnpj_emitente ?? ""), agora);
  if (!c.ok) return c.falha;
  const cert = c.cert;
  const transporte = ctx.transporte ?? transporteHttps(cert);

  // ── A contingência RECUSADA, gerada de novo ─────────────────────────────
  if (ctx.refazerContingencia) return refazerContingencia(corpo, ctx, cert, transporte, agora);

  const preparada = prepararNotaAssinada(corpo, ctx, cert, { tipoDeEmissao: 1, agora });
  if (!preparada.ok) return falha("dados_incompletos", preparada.mensagem, { pendencias: preparada.pendencias });
  const nota = preparada.nota;

  let tentativa: Tentativa;
  if (ctx.contingenciaDireta) {
    // Loja bloqueada (656): nada vai à SEFAZ — o número não foi "tentado". Sem
    // `statusSefaz`: a SEFAZ não respondeu nada agora, e o bloqueio não se renova.
    tentativa = { tipo: "sem_resposta", enviado: false, motivo: ctx.contingenciaDireta };
  } else {
    // Antes de sair: quem integra guarda a nota assinada (ver `aoAssinar`).
    if (ctx.aoAssinar) await ctx.aoAssinar(nota);
    tentativa = await transmitirNota(nota, ctx, transporte, agora);
  }
  if (tentativa.tipo === "resultado") return tentativa.resultado;

  // ── Sem resposta: contingência off-line ─────────────────────────────────
  const tentado = { numero: nota.numero, chave: nota.chave };
  if (ctx.contingenciaOffline === false) {
    return falha(
      "erro_de_comunicacao",
      `${tentativa.motivo} A nota NÃO foi autorizada e a contingência off-line está desligada para esta loja. ` +
        (tentativa.enviado ? `Consulte a chave ${nota.chave} antes de reemitir.` : "Tente de novo."),
      { detalheDaRejeicao: tentativa.motivo, talvezNaSefaz: tentativa.enviado, ...(tentativa.statusSefaz ? { statusSefaz: tentativa.statusSefaz } : {}) }
    );
  }
  let numeroOffline = nota.numero;
  if (tentativa.enviado) {
    let reserva = ctx.numeroDeContingencia ?? null;
    // Só aqui o número extra é preciso — é aqui que ele é reservado.
    if ((!reserva || reserva === nota.numero) && ctx.reservarNumeroDeContingencia) {
      try {
        reserva = await ctx.reservarNumeroDeContingencia();
      } catch (e: any) {
        return falha(
          "erro_de_comunicacao",
          `${tentativa.motivo} O pedido pode ter chegado à SEFAZ e não consegui reservar outro número para a contingência ` +
            `(${String(e?.message ?? e).slice(0, 200)}). Consulte a chave ${nota.chave} antes de reemitir.`,
          { detalheDaRejeicao: tentativa.motivo, talvezNaSefaz: true, ...(tentativa.statusSefaz ? { statusSefaz: tentativa.statusSefaz } : {}) }
        );
      }
    }
    if (!reserva || reserva === nota.numero) {
      return falha(
        "erro_de_comunicacao",
        `${tentativa.motivo} O pedido pode ter chegado à SEFAZ, então o número ${nota.numero} não pode ir para a contingência ` +
          `(Manual de contingência 2.0, item 4) e não foi informado outro número. Consulte a chave ${nota.chave} antes de reemitir.`,
        { detalheDaRejeicao: tentativa.motivo, talvezNaSefaz: true, ...(tentativa.statusSefaz ? { statusSefaz: tentativa.statusSefaz } : {}) }
      );
    }
    numeroOffline = reserva;
  }
  // A hora de AGORA (a tentativa online pode ter esperado o timeout inteiro):
  // a nota off-line é emitida neste momento, que é também a entrada em contingência.
  const agoraOffline = (ctx.agora ?? (() => new Date()))();
  const offline = prepararNotaAssinada(corpo, { ...ctx, numero: numeroOffline }, cert, {
    tipoDeEmissao: 9,
    agora: agoraOffline,
    contingencia: {
      entradaEm: agoraOffline,
      justificativa: ctx.contingenciaDireta ? ctx.contingenciaDireta : `SEFAZ sem resposta na autorizacao: ${tentativa.motivo}`,
    },
  });
  if (!offline.ok) return falha("dados_incompletos", offline.mensagem, { pendencias: offline.pendencias });
  return comoContingencia(offline.nota, ctx, {
    aviso: AVISO_DA_CONTINGENCIA + (tentativa.enviado ? ` O número ${nota.numero} (chave ${nota.chave}) ficou pendente: consulte e cancele ou inutilize.` : ""),
    numeroTentado: tentativa.enviado ? tentado : null,
    statusSefaz: tentativa.statusSefaz,
  });
}

/**
 * A nota de contingência RECUSADA, gerada de novo: "com a mesma numeração e
 * série, sanando a irregularidade desde que não se altere [...] a data de
 * emissão ou de saída" (Ajuste SINIEF 19/16, cl. 11ª § 1º III, a). O corpo é
 * o do pedido AGORA (corrigido); dhEmi, dhCont, xJust e cNF são os do cupom
 * que o cliente levou — a chave é a mesma. Autorizada, é a nota; recusada de
 * novo, volta a ser recusa; sem resposta, a corrigida vale como contingência
 * (o cron transmite).
 */
async function refazerContingencia(
  corpo: CorpoDaNfce | Record<string, unknown>,
  ctx: ContextoDoEmissor,
  cert: CertificadoCarregado,
  transporte: Transporte,
  agora: Date
): Promise<ResultadoDaEmissaoSefaz> {
  const r = ctx.refazerContingencia!;
  const dhEmi = new Date(r.dhEmi);
  const dhCont = new Date(r.dhCont);
  if (!Number.isFinite(dhEmi.getTime()) || !Number.isFinite(dhCont.getTime())) {
    return falha("dados_incompletos", "A nota de contingência guardada não tem dhEmi/dhCont legíveis — não dá para gerá-la de novo com a mesma data.");
  }
  const preparada = prepararNotaAssinada(corpo, { ...ctx, codigoNumerico: r.codigoNumerico }, cert, {
    tipoDeEmissao: 9,
    agora: dhEmi,
    contingencia: { entradaEm: dhCont, justificativa: r.xJust },
  });
  if (!preparada.ok) return falha("dados_incompletos", preparada.mensagem, { pendencias: preparada.pendencias });
  const nota = preparada.nota;
  if (nota.chave !== r.chave || nota.dhEmi !== r.dhEmi) {
    return falha(
      "dados_incompletos",
      `A nota corrigida não fecha com o cupom de contingência (chave ${r.chave}): mudou o CNPJ, a série ou a data. ` +
        "Ela tem de sair com a mesma numeração, série e data de emissão (Ajuste SINIEF 19/16, cl. 11ª). Fale com o suporte.",
      { detalheDaRejeicao: `esperada ${r.chave} ${r.dhEmi}; montada ${nota.chave} ${nota.dhEmi}` }
    );
  }
  const aviso =
    "A NFC-e de contingência recusada foi gerada de novo, corrigida, com o MESMO número, série e data de emissão " +
    "(Ajuste SINIEF 19/16, cl. 11ª § 1º III). Reimprima o DANFE e guarde-o no lugar do cupom anterior.";
  if (ctx.contingenciaDireta) return comoContingencia(nota, ctx, { aviso: `${aviso} A SEFAZ está bloqueada agora: a nota será transmitida depois.` });
  if (ctx.aoAssinar) await ctx.aoAssinar(nota);
  const t = await transmitirNota(nota, ctx, transporte, agora);
  if (t.tipo === "sem_resposta") {
    return comoContingencia(nota, ctx, { aviso: `${aviso} A SEFAZ não respondeu: a nota será transmitida depois.`, statusSefaz: t.statusSefaz });
  }
  const res = t.resultado;
  // Autorizada, recusada de novo ou certificado: é o resultado. "Processando"
  // (204 sem consulta, lote na fila): a nota corrigida está na SEFAZ — o cupom
  // vale e o cron confere/transmite de novo com a mesma chave.
  if (res.ok || res.motivo !== "processando") return res;
  return comoContingencia(nota, ctx, { aviso: `${aviso} A SEFAZ recebeu a nota e ainda não confirmou: a situação é conferida depois.`, statusSefaz: res.statusSefaz });
}

/**
 * Transmite uma nota emitida em contingência (o `xml` que `emitirNfceNaSefaz`
 * devolveu), SEM alterá-la: a chave e o cNF são os mesmos (Manual de
 * contingência 2.0, item 2). Confere a assinatura antes de mandar.
 */
export async function transmitirContingencia(
  xmlAssinado: string,
  ctx: Pick<ContextoDoEmissor, "certificado" | "uf" | "ambiente" | "timeoutMs" | "transporte" | "agora" | "esperar">
): Promise<ResultadoDaEmissaoSefaz> {
  const agora = (ctx.agora ?? (() => new Date()))();
  const doc = lerXml(xmlAssinado);
  const infNFe = primeiro(doc, "infNFe");
  const chave = (infNFe?.getAttribute("Id") ?? "").replace(/^NFe/, "");
  if (!chaveValida(chave)) return falha("dados_incompletos", "XML de contingência sem chave válida.");
  if (lerChave(chave).tipoDeEmissao !== 9) return falha("dados_incompletos", "Esta nota não foi emitida em contingência (tpEmis ≠ 9).");
  const verificacao = verificarAssinatura(xmlAssinado);
  if (!verificacao.ok) return falha("dados_incompletos", `A nota guardada não confere com a assinatura (${verificacao.erros.join("; ")}). Não transmito XML alterado.`);

  const cnpj = primeiro(primeiro(doc, "emit") ?? doc, "CNPJ")?.textContent ?? null;
  const c = prepararCertificado(ctx, cnpj, agora);
  if (!c.ok) return c.falha;
  const transporte = ctx.transporte ?? transporteHttps(c.cert);
  const nota = {
    xml: xmlAssinado,
    chave,
    dhEmi: primeiro(doc, "dhEmi")?.textContent ?? "",
    qrCode: primeiro(doc, "qrCode")?.textContent ?? "",
    codigoNumerico: lerChave(chave).codigoNumerico,
  };
  const t = await transmitirNota(nota, ctx, transporte, agora);
  if (t.tipo === "resultado") return t.resultado;
  return falha("erro_de_comunicacao", `${t.motivo} A nota de contingência continua pendente — tente de novo mais tarde.`, {
    detalheDaRejeicao: t.motivo,
    talvezNaSefaz: t.enviado,
    ...(t.statusSefaz ? { statusSefaz: t.statusSefaz } : {}),
  });
}

/** Os dados que a contingência guardada tem e a nota corrigida mantém (ver `refazerContingencia`). */
export function contingenciaDoXml(xml: string): (ContingenciaARefazer & { numero: number; serie: number; ambiente: Ambiente | null }) | null {
  try {
    const doc = lerXml(xml);
    const chave = (primeiro(doc, "infNFe")?.getAttribute("Id") ?? "").replace(/^NFe/, "");
    if (!chaveValida(chave) || lerChave(chave).tipoDeEmissao !== 9) return null;
    const ide = primeiro(doc, "ide") ?? doc;
    const texto = (nome: string) => (primeiro(ide, nome)?.textContent ?? "").trim();
    const tpAmb = Number(texto("tpAmb"));
    const dados = { dhEmi: texto("dhEmi"), dhCont: texto("dhCont"), xJust: texto("xJust") };
    if (!dados.dhEmi || !dados.dhCont || dados.xJust.length < 15) return null;
    const partes = lerChave(chave);
    return {
      chave,
      ...dados,
      codigoNumerico: partes.codigoNumerico,
      numero: partes.numero,
      serie: partes.serie,
      ambiente: tpAmb === 1 ? 1 : tpAmb === 2 ? 2 : null,
    };
  } catch {
    return null;
  }
}

/**
 * A situação de uma NFC-e na SEFAZ (consSitNFe). Com o `xmlAssinado` da
 * própria nota, devolve também o nfeProc — é assim que se recupera o XML de
 * uma nota que ficou "sem resposta".
 *
 * CANCELADA: a falha "rejeitada" traz o evento que a SEFAZ devolveu
 * (`cancelamento`, com o procEventoNFe) e, com o XML assinado, o nfeProc da
 * nota — a cancelada existiu, e o contador recebe as duas.
 */
export async function consultarNaSefaz(
  chave: string,
  ctx: Pick<ContextoDoEmissor, "certificado" | "uf" | "ambiente" | "transporte" | "agora"> & { xmlAssinado?: string | null }
): Promise<ResultadoDaEmissaoSefaz> {
  const agora = (ctx.agora ?? (() => new Date()))();
  if (!chaveValida(chave)) return falha("dados_incompletos", `Chave de acesso inválida: "${chave}".`);
  const c = prepararCertificado(ctx, null, agora);
  if (!c.ok) return c.falha;
  const transporte = ctx.transporte ?? transporteHttps(c.cert);
  let ret: ReturnType<typeof lerRetConsSitNFe>;
  try {
    const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "consulta", mensagem: montarConsSitNFe(ctx.ambiente, chave), transporte, timeoutMs: 20_000 });
    ret = lerRetConsSitNFe(r.resposta);
  } catch (e: any) {
    return falha("erro_de_comunicacao", "Não consegui consultar a situação da nota na SEFAZ. Tente de novo.", { detalheDaRejeicao: String(e?.message ?? e).slice(0, 300) });
  }
  const xml = ctx.xmlAssinado ?? null;
  const doc = xml ? lerXml(xml) : null;
  const nota = {
    chave,
    dhEmi: (doc && primeiro(doc, "dhEmi")?.textContent) || ret.protocolo?.dhRecbto || "",
    qrCode: (doc && primeiro(doc, "qrCode")?.textContent) || "",
    codigoNumerico: lerChave(chave).codigoNumerico,
  };
  const cancelamento = ret.eventos.find((e) => (e.tpEvento === "110111" || e.tpEvento === "110112") && ["135", "155"].includes(e.cStat));
  if (CANCELADA.has(ret.cStat) || cancelamento) {
    const prot = ret.protocolo && AUTORIZADA.has(ret.protocolo.cStat) ? ret.protocolo : null;
    return falha("rejeitada", "Esta nota foi CANCELADA na SEFAZ.", {
      statusSefaz: ret.cStat,
      detalheDaRejeicao: `[${ret.cStat}] ${ret.xMotivo}`,
      cancelamento: cancelamento
        ? { tpEvento: cancelamento.tpEvento, protocolo: cancelamento.protocolo, em: cancelamento.dhRegEvento, xml: cancelamento.xml }
        : { tpEvento: null, protocolo: null, em: null, xml: null },
      protocoloDaAutorizacao: prot?.protocolo ?? null,
      ...(prot && xml ? { xml: montarNfeProc(xml, prot.xml) } : {}),
    });
  }
  if (AUTORIZADA.has(ret.cStat) && ret.protocolo) {
    const r = notaAutorizada(nota, ret.protocolo, xml ?? "", ctx.ambiente);
    if (r.ok) {
      r.urlDoQrCode = nota.qrCode || null;
      if (!xml) delete r.xml; // sem a NFe não há nfeProc
    }
    return r;
  }
  if (DENEGADA.has(ret.cStat)) return traduzirRecusa(ret.cStat, ret.xMotivo, "");
  if (ret.cStat === "217") return falha("erro_de_comunicacao", "A SEFAZ não tem nenhuma nota com esta chave (217). Ela NÃO foi autorizada.", { statusSefaz: "217" });
  return falha("erro_de_comunicacao", `A SEFAZ respondeu à consulta: [${ret.cStat}] ${ret.xMotivo}`, { statusSefaz: ret.cStat });
}

/**
 * O resultado de um lote pelo RECIBO (retAutorizacao). É a primeira pergunta
 * sobre um envio que voltou 103: enquanto o lote está na fila (105), a chave
 * consultada dá 217 — e isso não quer dizer que a nota não chegou.
 */
export async function consultarReciboNaSefaz(
  recibo: string,
  ctx: Pick<ContextoDoEmissor, "certificado" | "uf" | "ambiente" | "transporte" | "agora"> & { chave: string; xmlAssinado?: string | null }
): Promise<ResultadoDaEmissaoSefaz> {
  const agora = (ctx.agora ?? (() => new Date()))();
  if (!/^\d{1,15}$/.test(String(recibo ?? ""))) return falha("dados_incompletos", `Recibo inválido: "${recibo}".`);
  const c = prepararCertificado(ctx, null, agora);
  if (!c.ok) return c.falha;
  const transporte = ctx.transporte ?? transporteHttps(c.cert);
  let lote: ReturnType<typeof lerRetConsReciNFe>;
  let corpo = "";
  try {
    const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "retAutorizacao", mensagem: montarConsReciNFe(ctx.ambiente, recibo), transporte, timeoutMs: 15_000 });
    corpo = r.corpo;
    lote = lerRetConsReciNFe(r.resposta);
  } catch (e: any) {
    return falha("erro_de_comunicacao", "Não consegui consultar o recibo do lote na SEFAZ.", { detalheDaRejeicao: String(e?.message ?? e).slice(0, 300) });
  }
  if (lote.cStat === "105") return falha("processando", "O lote desta nota ainda está em processamento na SEFAZ (105).", { statusSefaz: "105", recibo });
  const prot = lote.protocolos.find((p) => p.chave === ctx.chave) ?? null;
  if (lote.cStat === "104" && prot) {
    const doc = ctx.xmlAssinado ? lerXml(ctx.xmlAssinado) : null;
    const nota = {
      xml: ctx.xmlAssinado ?? "",
      chave: ctx.chave,
      dhEmi: (doc && primeiro(doc, "dhEmi")?.textContent) || prot.dhRecbto || "",
      qrCode: (doc && primeiro(doc, "qrCode")?.textContent) || "",
      codigoNumerico: lerChave(ctx.chave).codigoNumerico,
    };
    const t = await interpretarProtocolo(nota, prot, corpo, { uf: ctx.uf, ambiente: ctx.ambiente }, transporte);
    if (t.tipo === "resultado") {
      const r = t.resultado;
      if (r.ok && !ctx.xmlAssinado) delete r.xml;
      return { ...r, recibo };
    }
    return falha("erro_de_comunicacao", `O lote foi processado e a nota não foi analisada: ${t.motivo}`, { statusSefaz: t.statusSefaz, recibo });
  }
  // 106: o recibo não existe mais (ou nunca existiu) — quem sabe agora é a chave.
  return falha("erro_de_comunicacao", `A SEFAZ respondeu à consulta do recibo: [${lote.cStat}] ${lote.xMotivo}`, { statusSefaz: lote.cStat, recibo });
}

export type ResultadoDoCancelamentoSefaz = ResultadoDoCancelamento & {
  xml?: string;
  statusSefaz?: string;
  /** Falha de transporte DEPOIS de o pedido sair: o evento pode ter sido registrado. */
  enviado?: boolean;
};

/**
 * Cancela: o evento 110111 (cancelamento comum) ou, com `chaveSubstituta`, o
 * 110112 (cancelamento POR SUBSTITUIÇÃO — ver sefaz.ts,
 * `montarEventoDeCancelamento`). Devolve o formato de `cancelarNfce` + o
 * procEventoNFe em `xml`.
 */
export async function cancelarNaSefaz(
  p: { chave: string; protocolo: string; justificativa: string; chaveSubstituta?: string | null },
  ctx: Pick<ContextoDoEmissor, "certificado" | "uf" | "ambiente" | "transporte" | "agora">
): Promise<ResultadoDoCancelamentoSefaz> {
  const agora = (ctx.agora ?? (() => new Date()))();
  if (!chaveValida(p.chave)) return { ok: false, motivo: "rejeitado", mensagem: `Chave de acesso inválida: "${p.chave}".` };
  const cnpj = lerChave(p.chave).cnpj;
  const c = prepararCertificado(ctx, cnpj, agora);
  if (!c.ok) return { ok: false, motivo: "rejeitado", mensagem: c.falha.mensagem };
  const transporte = ctx.transporte ?? transporteHttps(c.cert);
  let montado: { envEvento: string; evento: string };
  try {
    montado = montarEventoDeCancelamento(
      {
        chave: p.chave,
        protocolo: p.protocolo,
        justificativa: p.justificativa,
        cnpj,
        ambiente: ctx.ambiente,
        dhEvento: hojeNoFuso(agora, ctx.uf),
        idLote: idLote(agora),
        chaveSubstituta: p.chaveSubstituta ?? null,
        versaoDoAplicativo: VERSAO_DO_EMISSOR,
      },
      c.cert
    );
  } catch (e: any) {
    return { ok: false, motivo: "rejeitado", mensagem: String(e?.message ?? e) };
  }
  try {
    const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "evento", mensagem: montado.envEvento, transporte, timeoutMs: 30_000 });
    const ret = lerRetEnvEvento(r.resposta);
    const ev = ret.eventos[0];
    if (ev && ["135", "155"].includes(ev.cStat)) {
      return {
        ok: true,
        protocolo: ev.protocolo ?? "",
        mensagemSefaz: ev.xMotivo,
        canceladaEm: ev.dhRegEvento ?? agora.toISOString(),
        urlDoXmlCancelamento: null,
        xml: montarProcEventoNFe(montado.evento, ev.xml),
        statusSefaz: ev.cStat,
      };
    }
    const cStat = ev?.cStat ?? ret.cStat;
    const xMotivo = ev?.xMotivo ?? ret.xMotivo;
    const dica =
      cStat === "501"
        ? " — passou o prazo de cancelamento da NFC-e."
        : cStat === "573"
          ? " — esta nota já tem cancelamento registrado."
          : cStat === "580"
            ? " — a nota não está autorizada."
            : cStat === "656"
              ? ` — ${O_QUE_FAZER["656"]}`
              : "";
    return { ok: false, motivo: "rejeitado", mensagem: `A SEFAZ não aceitou o cancelamento: [${cStat}] ${xMotivo}${dica}`, detalhe: r.corpo.slice(0, 600), statusSefaz: cStat };
  } catch (e: any) {
    // O pedido SAIU e a resposta não veio: a SEFAZ pode ter registrado o
    // evento. Dizer "não foi feito" levava ao segundo clique (573) e a nota
    // ficava cancelada lá sem o XML do evento aqui.
    if (e instanceof FalhaDeTransporte && e.enviado) {
      return {
        ok: false,
        motivo: "erro_de_comunicacao",
        mensagem:
          "O pedido de cancelamento chegou a sair e a SEFAZ não respondeu: ele PODE ter sido registrado. " +
          "Use \"Consultar situação\" antes de tentar de novo.",
        detalhe: String(e?.message ?? e).slice(0, 300),
        enviado: true,
      };
    }
    return { ok: false, motivo: "erro_de_comunicacao", mensagem: "Não consegui falar com a SEFAZ. O cancelamento NÃO foi feito — tente de novo.", detalhe: String(e?.message ?? e).slice(0, 300), enviado: false };
  }
}

export type ResultadoDaInutilizacaoSefaz = ResultadoDaInutilizacao & {
  xml?: string;
  /** Também na falha: 256/563/206 = a SEFAZ já tem a faixa inutilizada (ver `JA_INUTILIZADA`). */
  statusSefaz?: string;
  /** Falha de transporte DEPOIS de o pedido sair: a inutilização pode ter sido homologada. */
  enviado?: boolean;
};

/**
 * Inutiliza uma faixa de numeração. Devolve o formato de `inutilizarNumeracao`
 * + o procInutNFe em `xml`. `aoAssinarPedido` recebe o pedido (inutNFe) ASSINADO
 * antes de ele sair: se a resposta se perder, é o que sobra da inutilização
 * que a SEFAZ pode ter homologado.
 */
export async function inutilizarNaSefaz(
  faixa: { cnpj: string; serie: number; numeroInicial: number; numeroFinal: number; justificativa: string; ano?: number },
  ctx: Pick<ContextoDoEmissor, "certificado" | "uf" | "ambiente" | "transporte" | "agora"> & { aoAssinarPedido?: (inutNFe: string) => Promise<void> | void }
): Promise<ResultadoDaInutilizacaoSefaz> {
  const agora = (ctx.agora ?? (() => new Date()))();
  const cnpj = String(faixa.cnpj ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const c = prepararCertificado(ctx, cnpj, agora);
  if (!c.ok) return { ok: false, motivo: "rejeitada", mensagem: c.falha.mensagem };
  const transporte = ctx.transporte ?? transporteHttps(c.cert);
  const ano = faixa.ano ?? Number(hojeNoFuso(agora, ctx.uf).slice(0, 4));
  let pedido: string;
  try {
    pedido = montarInutilizacao({ uf: ctx.uf, ano, cnpj, serie: faixa.serie, numeroInicial: faixa.numeroInicial, numeroFinal: faixa.numeroFinal, justificativa: faixa.justificativa, ambiente: ctx.ambiente }, c.cert);
  } catch (e: any) {
    return { ok: false, motivo: "rejeitada", mensagem: String(e?.message ?? e) };
  }
  if (ctx.aoAssinarPedido) await ctx.aoAssinarPedido(pedido);
  try {
    const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "inutilizacao", mensagem: pedido, transporte, timeoutMs: 30_000 });
    const ret = lerRetInutNFe(r.resposta);
    if (ret.cStat === "102") {
      return {
        ok: true,
        protocolo: ret.protocolo ?? "",
        statusSefaz: ret.cStat,
        mensagemSefaz: ret.xMotivo,
        serie: faixa.serie,
        numeroInicial: faixa.numeroInicial,
        numeroFinal: faixa.numeroFinal,
        homologadaEm: ret.dhRecbto ?? agora.toISOString(),
        urlDoXml: null,
        xml: montarProcInutNFe(pedido, ret.xml),
      };
    }
    return {
      ok: false,
      motivo: "rejeitada",
      mensagem: `A SEFAZ não homologou a inutilização: [${ret.cStat}] ${ret.xMotivo}${ret.cStat === "656" ? ` — ${O_QUE_FAZER["656"]}` : ""}`,
      detalhe: r.corpo.slice(0, 600),
      statusSefaz: ret.cStat,
    };
  } catch (e: any) {
    const enviado = e instanceof FalhaDeTransporte && e.enviado;
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem: enviado
        ? "O pedido de inutilização saiu e a SEFAZ não respondeu: ela PODE ter homologado. A próxima tentativa confere."
        : "Não consegui falar com a SEFAZ. A inutilização NÃO foi feita — tente de novo.",
      detalhe: String(e?.message ?? e).slice(0, 300),
      enviado,
    };
  }
}

/** Status do serviço de autorização (consStatServ). 107 = em operação. */
export async function statusDoServico(
  ctx: Pick<ContextoDoEmissor, "certificado" | "uf" | "ambiente" | "transporte" | "agora">
): Promise<{ ok: boolean; cStat: string | null; mensagem: string; tempoMedio?: number | null; dhRecbto?: string | null }> {
  const agora = (ctx.agora ?? (() => new Date()))();
  const c = prepararCertificado(ctx, null, agora);
  if (!c.ok) return { ok: false, cStat: null, mensagem: c.falha.mensagem };
  const transporte = ctx.transporte ?? transporteHttps(c.cert);
  try {
    const r = await chamarServico({ uf: ctx.uf, ambiente: ctx.ambiente, servico: "status", mensagem: montarConsStatServ(ctx.ambiente, ctx.uf), transporte, timeoutMs: 15_000 });
    const ret = lerRetConsStatServ(r.resposta);
    return {
      ok: ret.cStat === "107",
      cStat: ret.cStat,
      mensagem: `[${ret.cStat}] ${ret.xMotivo}${ret.observacao ? ` — ${ret.observacao}` : ""}`,
      tempoMedio: ret.tempoMedio,
      dhRecbto: ret.dhRecbto,
    };
  } catch (e: any) {
    return { ok: false, cStat: null, mensagem: `Sem resposta da SEFAZ: ${String(e?.message ?? e)}` };
  }
}
