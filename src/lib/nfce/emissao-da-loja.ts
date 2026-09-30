/**
 * /src/lib/nfce/emissao-da-loja.ts
 *
 * O emissor próprio (lib/nfce/emissor) ligado à LOJA: credenciais do cofre,
 * número reservado no banco, XML guardado por 5 anos. É o caminho de
 * fiscalConfig.provedor = "sefaz" — lib/fiscal-emissao (emitirNfce) chama
 * `emitirNaSefazDaLoja`, e lib/fiscal-automatico grava o resultado pelo mesmo
 * `gravarResultado` da Focus, com os campos que só este caminho tem em
 * `gravarNoPedido`.
 *
 * ── A ordem de uma emissão ──────────────────────────────────────────────────
 *
 *  1. credenciais (certificado e CSC do cofre) — sem elas não se gasta número;
 *  2. a loja bloqueada por consumo indevido (656, `sefazBloqueadaAte`): com
 *     contingência, a nota sai off-line sem tocar a SEFAZ; sem, fica pendente;
 *  3. reserva do número (lib/nfce/numeracao, com a trava da série);
 *  4. se o pedido tem um ENVIO anterior sem desfecho (a tentativa passada pode
 *     ter chegado à SEFAZ), confere antes (`conferirEnvio`: o recibo, depois a
 *     chave, no ritmo que a SEFAZ tolera): autorizada → é ela a nota; não
 *     consta DUAS vezes, com 10 min entre elas → o número está livre;
 *     cancelada/denegada → número queimado, reserva outro; sem resposta → não
 *     transmite nada;
 *  5. a contingência RECUSADA na transmissão é gerada de novo com o mesmo
 *     número, série, data e chave (Ajuste SINIEF 19/16, cl. 11ª § 1º III);
 *  6. assina e, ANTES de transmitir, guarda o XML assinado no cofre e marca o
 *     pedido "processando" com o envio (`aoAssinar`) — se o processo cair no
 *     meio, o cron consulta a chave e remonta o nfeProc com ESTE XML;
 *  7. transmite (lib/nfce/emissor): autorizada → nfeProc no cofre (tipo
 *     "nota"); contingência → NFe assinada no cofre (tipo "contingencia"),
 *     transmitida depois pelo cron; rejeitada → a reserva fica para a próxima
 *     tentativa (539/denegação queimam o número — a não ser que o 539 aponte
 *     para uma chave que ESTE pedido já mandou: aí a nota é adotada).
 *
 * ── O que fica no fiscalInfo (além do que a Focus já gravava) ───────────────
 *
 *   provedor: "sefaz"          quem consulta, cancela e guarda o XML desta nota
 *   xmlNoCofre {caminho,sha256} o nfeProc autorizado (na contingência, a NFe assinada)
 *   xmlDaContingencia          a NFe off-line (é ela que o cron transmite)
 *   qrCode, urlConsulta        o QR e o endereço de consulta impressos no DANFE
 *   numeroReservado            a reserva (lib/nfce/numeracao)
 *   envioSefaz                 a última nota assinada que foi (ou ia) à SEFAZ, com o
 *                              recibo (lote 103) e o ritmo das consultas
 *   enviosAnteriores           os envios que ele substituiu (o 539 procura aqui)
 *   numeroTentado              enviado sem resposta; a contingência saiu com outro
 *   numeroDeContingencia       a reserva extra da contingência
 *   numerosQueimados           números que a SEFAZ diz usados (539, denegação)
 *   contingenciaPrazo          até quando transmitir a contingência
 *   transmissoesDaContingencia quantas transmissões seguidas falharam (o recuo)
 *   alertaSefaz                autorizada com alerta (cStat 120, NT 2026.002)
 *   esperaSefazAte             a SEFAZ bloqueada: a retentativa espera até esta hora
 *   cStat, oQueFazer           a última recusa da SEFAZ, com o que fazer
 *
 * Só servidor.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CorpoDaNfce, ResultadoDaEmissao } from "../fiscal-emissao";
import type { Problema } from "../fiscal-validacao";
import { idDaNotaDaMesa, notasAnterioresComA, refDaReemissao } from "../fiscal-momento";
import { guardarArquivoFiscal, lerXmlFiscal, type ArquivoGuardado, type TipoDeArquivoFiscal } from "./armazenamento";
import { diasParaVencer } from "./assinatura";
import { chaveValida, lerChave } from "./chave";
import { configDoEmissorProprio, PROVEDOR_PROPRIO } from "./config-da-loja";
import { FaltaNoEmissor, certificadoDaLoja, contextoDaLoja } from "./credenciais-da-loja";
import {
  O_QUE_FAZER,
  cancelarNaSefaz,
  consultarNaSefaz,
  consultarReciboNaSefaz,
  contingenciaDoXml,
  emitirNfceNaSefaz,
  statusDoServico,
  transmitirContingencia,
  type ContingenciaARefazer,
  type ContextoDoEmissor,
  type NotaAssinada,
  type ResultadoDaEmissaoSefaz,
} from "./emissor";
import {
  emissaoEmCurso,
  reservarNumero,
  reservarNumeroDeContingencia,
  sqlMesclarNoFiscalInfo,
  sqlMarcarEmEmissao,
  type Ambiente,
} from "./numeracao";
import { ambienteDaLoja, numeroInicialDoEmissor, serieDoEmissor, ufsDoEmissorProprio } from "./pendencias";
import { urlsDaUf } from "./qrcode";
import type { Transporte } from "./sefaz";
import { FUSO_DA_UF, dataHoraNoFuso } from "./xml-da-nota";

// ── Injetáveis (testes) ──────────────────────────────────────────────────────

let transporteDeTeste: Transporte | null = null;
let relogioDeTeste: (() => Date) | null = null;
let bancoDeTeste: any = null;

/** A SEFAZ falsa dos testes (scripts/nfce-teste-apoio → sefazFalsa). Em produção fica null. */
export function usarTransporteDeTeste(t: Transporte | null): void {
  transporteDeTeste = t;
}
/** O relógio dos testes (datas de emissão, prazos). */
export function usarRelogioDeTeste(r: (() => Date) | null): void {
  relogioDeTeste = r;
}
/** O banco dos testes, quando não é o `globalThis.prisma` falso. */
export function usarBancoDeTeste(b: unknown): void {
  bancoDeTeste = b;
}
export const agoraDoEmissor = (): Date => (relogioDeTeste ? relogioDeTeste() : new Date());
export const bancoDoEmissor = (): any => bancoDeTeste ?? prisma;
export const transporteDoEmissor = (): Transporte | undefined => transporteDeTeste ?? undefined;
const relogioDoEmissor = (): (() => Date) | undefined => relogioDeTeste ?? undefined;

// ── Utilitários ──────────────────────────────────────────────────────────────

type ConfigDaLoja = {
  uf?: string | null;
  ambiente?: number | null;
  cnpj?: string | null;
  inscricaoEstadual?: string | null;
  sefaz?: unknown;
  [chave: string]: unknown;
};
type Registro = Record<string, any>;
export type PonteiroNoCofre = { caminho: string; sha256: string; tipo?: string };

const objeto = (v: unknown): Registro => (v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : {});
const ponteiro = (g: ArquivoGuardado | null | undefined, tipo?: TipoDeArquivoFiscal): PonteiroNoCofre | null =>
  g ? { caminho: g.caminho, sha256: g.sha256, ...(tipo ? { tipo } : {}) } : null;
export const ponteiroValido = (v: unknown): PonteiroNoCofre | null => {
  const o = objeto(v);
  return typeof o.caminho === "string" && o.caminho && typeof o.sha256 === "string" && o.sha256 ? { caminho: o.caminho, sha256: o.sha256 } : null;
};
const ambienteDoRegistro = (v: unknown): Ambiente | null => (Number(v) === 1 ? 1 : Number(v) === 2 ? 2 : null);
const lerDoCofre = (p: PonteiroNoCofre | null): Promise<string | null> => (p ? lerXmlFiscal(p.caminho, p.sha256).catch(() => null) : Promise.resolve(null));

/** A nota deste fiscalInfo é do emissor próprio? (as antigas, da Focus, não têm `provedor`.) */
export function notaDoEmissorProprio(fiscalInfo: unknown): boolean {
  return objeto(fiscalInfo).provedor === PROVEDOR_PROPRIO;
}

/** AAAAMM do dia local da nota ("2026-09-29T21:10:00-03:00" → "202609"): a pasta do cofre e o mês do contador. */
export function mesDaNota(dhEmi: string | null | undefined, agora: Date = agoraDoEmissor()): string {
  const m = /^(\d{4})-(\d{2})-\d{2}T/.exec(String(dhEmi ?? ""));
  if (m) return `${m[1]}${m[2]}`;
  const local = dataHoraNoFuso(agora, "America/Sao_Paulo");
  return local.slice(0, 4) + local.slice(5, 7);
}

function urlDeConsulta(uf: string, ambiente: Ambiente): string | null {
  try {
    return urlsDaUf(uf, ambiente).urlChave;
  } catch {
    return null;
  }
}

/** "14:32" na hora da loja. */
const horaNaLoja = (quando: Date, uf: string | null | undefined): string => dataHoraNoFuso(quando, FUSO_DA_UF[String(uf ?? "").toUpperCase()] ?? "America/Sao_Paulo").slice(11, 16);

/**
 * Guarda no cofre, com uma segunda tentativa. O XML autorizado é o documento
 * que a loja guarda por 5 anos: um soluço do disco não pode perdê-lo, e um
 * disco quebrado de vez não pode derrubar a venda (a nota EXISTE na SEFAZ) —
 * aí volta null, o pedido fica marcado `xmlPendente` e o log grita.
 */
export async function guardar(p: { lojaId: string; tipo: TipoDeArquivoFiscal; identificacao: string; conteudo: string; mes?: string }): Promise<ArquivoGuardado | null> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return await guardarArquivoFiscal(p);
    } catch (e: any) {
      if (tentativa === 2) {
        console.error(`[NFC-e] ❌ NÃO consegui guardar no cofre (${p.tipo} ${p.identificacao}): ${String(e?.message ?? e)}`);
        return null;
      }
    }
  }
  return null;
}

/** O primeiro dia útil seguinte (fim do dia) — no PA, 24 horas. Ver `prazoDaContingencia`. */
const FERIADOS_NACIONAIS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];

/**
 * Até quando a NFC-e emitida em contingência off-line tem de ser transmitida.
 *
 * Ajuste SINIEF 19/16, cl. 11ª, § 1º, II: "até o primeiro dia útil subsequente
 * contado a partir de sua emissão" (texto conferido no CONFAZ em 29/09/2026).
 * No PA, 24 horas (regra da SEFA-PA, informada pelo dono do projeto — conferir
 * se a loja do Pará mudar de enquadramento).
 *
 * Conta só sábado, domingo e os feriados nacionais FIXOS: feriado móvel,
 * estadual ou municipal não entra — o prazo calculado sai igual ou MAIS CEDO
 * que o de verdade, e o aviso vem antes, nunca depois.
 */
export function prazoDaContingencia(uf: string, emitidaEm: Date): Date {
  const sigla = String(uf ?? "").toUpperCase();
  if (sigla === "PA") return new Date(emitidaEm.getTime() + 24 * 60 * 60_000);
  const fuso = FUSO_DA_UF[sigla] ?? "America/Sao_Paulo";
  const local = dataHoraNoFuso(emitidaEm, fuso); // "2026-09-29T21:10:00-03:00"
  const offset = local.slice(19);
  let dia = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  for (let i = 0; i < 15; i++) {
    dia = new Date(dia.getTime() + 24 * 60 * 60_000);
    const semana = dia.getUTCDay();
    const mmdd = dia.toISOString().slice(5, 10);
    if (semana !== 0 && semana !== 6 && !FERIADOS_NACIONAIS_FIXOS.includes(mmdd)) break;
  }
  return new Date(`${dia.toISOString().slice(0, 10)}T23:59:59${offset}`);
}

// ── O BLOQUEIO POR CONSUMO INDEVIDO (656) ────────────────────────────────────

/**
 * Quanto a loja fica sem chamar a SEFAZ depois de um 656. MOC 7.0, Anexo I,
 * 4.3: o autorizador recusa TODAS as requisições "por até 1 (uma) hora", e a
 * requisição que chega nesse meio tempo pode renovar o bloqueio — e 50
 * bloqueios podem virar bloqueio permanente, "até entrar em contato com a UF
 * autorizadora". 65 minutos: a hora dele e uma folga.
 */
export const BLOQUEIO_DO_CONSUMO_INDEVIDO_MS = 65 * 60_000;
/** O bloqueio também em memória: a config da rodada do cron foi lida antes do 656. */
const bloqueiosEmMemoria = new Map<string, number>();

/** Para os testes (e para a loja liberada à mão pela UF). */
export function esquecerBloqueiosDaSefaz(): void {
  bloqueiosEmMemoria.clear();
}

/**
 * Até quando esta loja não pode chamar a SEFAZ (fiscalConfig.sefaz.bloqueadoAte,
 * ou o bloqueio registrado neste processo depois da leitura) — null se pode.
 * Emissão, consulta, transmissão, eventos, inutilização, cron e teste de
 * conexão respeitam.
 */
export function sefazBloqueadaAte(lojaId: string, config: unknown, agora: Date = agoraDoEmissor()): Date | null {
  const gravado = Date.parse(String(objeto(configDoEmissorProprio(config)).bloqueadoAte ?? ""));
  const memoria = bloqueiosEmMemoria.get(lojaId) ?? 0;
  const ate = Math.max(Number.isFinite(gravado) ? gravado : 0, memoria);
  return ate > agora.getTime() ? new Date(ate) : null;
}

/** A frase do bloqueio para a tela e o log. */
export function mensagemDoBloqueio(ate: Date, uf: string | null | undefined): string {
  return (
    `A SEFAZ recusou por CONSUMO INDEVIDO (656) e o FireHub não chama a SEFAZ por esta loja até ${horaNaLoja(ate, uf)} ` +
    "(MOC 7.0, 4.3: chamar durante o bloqueio só o prolonga)."
  );
}

/**
 * Registra um 656 (de qualquer serviço): grava fiscalConfig.sefaz.bloqueadoAte
 * = agora + 65 min pelo `||` do jsonb (sem reescrever o resto — como toda
 * gravação do emissor no fiscalConfig) e guarda em memória para o resto desta
 * rodada. Nunca lança.
 */
export async function registrarConsumoIndevido(lojaId: string, origem: string, agora: Date = agoraDoEmissor()): Promise<Date> {
  const ate = new Date(agora.getTime() + BLOQUEIO_DO_CONSUMO_INDEVIDO_MS);
  bloqueiosEmMemoria.set(lojaId, Math.max(bloqueiosEmMemoria.get(lojaId) ?? 0, ate.getTime()));
  console.error(`[NFC-e] ⛔ 656 (consumo indevido) na loja ${lojaId} (${origem}): sem chamar a SEFAZ até ${ate.toISOString()}.`);
  await bancoDoEmissor()
    .$executeRaw(sqlMesclarNoEmissorDaLoja(lojaId, { bloqueadoAte: ate.toISOString(), ultimoBloqueio: { em: agora.toISOString(), cStat: "656", origem } }))
    .catch((e: any) => console.error("[NFC-e] Não gravei o bloqueio da SEFAZ:", String(e?.message ?? e).slice(0, 200)));
  return ate;
}

/** Se a resposta foi 656, registra o bloqueio. Devolve se foi. */
export async function conferirO656(lojaId: string, statusSefaz: string | null | undefined, origem: string): Promise<boolean> {
  if (String(statusSefaz ?? "") !== "656") return false;
  await registrarConsumoIndevido(lojaId, origem);
  return true;
}

// ── O ENVIO ──────────────────────────────────────────────────────────────────

/** O envio registrado no fiscalInfo (`envioSefaz`), se estiver inteiro. */
export type EnvioRegistrado = {
  chave: string;
  numero: number;
  serie: number;
  ambiente: Ambiente;
  tipoDeEmissao: number;
  xml: PonteiroNoCofre | null;
  em: string;
  /** Lote assíncrono (103): o recibo. Consultado ANTES da chave. */
  recibo: string | null;
  /** Consultas já feitas deste envio e a última — o ritmo (`proximaConsultaDoEnvio`). */
  consultas: number;
  ultimaConsultaEm: string | null;
  /** As horas em que a SEFAZ respondeu 217 (não consta) para a chave. */
  naoConsta: string[];
  /**
   * Ainda sem desfecho: é por esta marca que a reconciliação lenta do cron
   * acha o envio num pedido FAILED (lib/nfce/rotina-da-sefaz).
   */
  aConferir: boolean;
  /** "para_pessoa": 7 dias sem desfecho — sai da conferência automática, com a orientação. */
  situacao: string | null;
  orientacao: string | null;
};
export function envioDoFiscalInfo(info: unknown): EnvioRegistrado | null {
  return envioDoRegistro(objeto(info).envioSefaz);
}
function envioDoRegistro(bruto: unknown): EnvioRegistrado | null {
  const e = objeto(bruto);
  const chave = String(e.chave ?? "");
  const ambiente = ambienteDoRegistro(e.ambiente);
  if (!chaveValida(chave) || !ambiente) return null;
  return {
    chave,
    numero: Number(e.numero) || lerChave(chave).numero,
    serie: Number(e.serie) || lerChave(chave).serie,
    ambiente,
    tipoDeEmissao: Number(e.tipoDeEmissao) || lerChave(chave).tipoDeEmissao,
    xml: ponteiroValido(e.xml),
    em: String(e.em ?? ""),
    recibo: typeof e.recibo === "string" && e.recibo ? e.recibo : null,
    consultas: Number(e.consultas) || 0,
    ultimaConsultaEm: typeof e.ultimaConsultaEm === "string" ? e.ultimaConsultaEm : null,
    naoConsta: Array.isArray(e.naoConsta) ? e.naoConsta.filter((x: unknown): x is string => typeof x === "string") : [],
    aConferir: e.aConferir === true,
    situacao: typeof e.situacao === "string" ? e.situacao : null,
    orientacao: typeof e.orientacao === "string" ? e.orientacao : null,
  };
}
function envioComoRegistro(e: EnvioRegistrado): Registro {
  return {
    chave: e.chave,
    numero: e.numero,
    serie: e.serie,
    ambiente: e.ambiente,
    tipoDeEmissao: e.tipoDeEmissao,
    xml: e.xml,
    em: e.em,
    ...(e.recibo ? { recibo: e.recibo } : {}),
    ...(e.consultas ? { consultas: e.consultas } : {}),
    ...(e.ultimaConsultaEm ? { ultimaConsultaEm: e.ultimaConsultaEm } : {}),
    ...(e.naoConsta.length ? { naoConsta: e.naoConsta.slice(-5) } : {}),
    aConferir: e.aConferir,
    ...(e.situacao ? { situacao: e.situacao } : {}),
    ...(e.orientacao ? { orientacao: e.orientacao } : {}),
  };
}

/** Os envios que outros substituíram (o 539 procura a chave aqui). */
function enviosAnteriores(info: unknown): EnvioRegistrado[] {
  const lista = objeto(info).enviosAnteriores;
  return (Array.isArray(lista) ? lista : []).map(envioDoRegistro).filter((e): e is EnvioRegistrado => e != null);
}
/** Até 10 envios anteriores, sem repetir a chave. */
function comNoHistorico(lista: EnvioRegistrado[], envio: EnvioRegistrado | null): EnvioRegistrado[] {
  if (!envio) return lista;
  return [...lista.filter((e) => e.chave !== envio.chave), { ...envio, aConferir: false }].slice(-10);
}
const historicoComoRegistro = (lista: EnvioRegistrado[]): Registro[] | null => (lista.length ? lista.map(envioComoRegistro) : null);

// O ritmo das consultas de um envio sem desfecho.
/** A primeira consulta: a SEFAZ pode ainda estar processando o que recebeu. */
const ESPERA_PARA_CONFERIR_MS = 10 * 60_000;
/** "Não consta" só vale com DOIS 217 separados por isto (o lote na fila também dá 217). */
const ESPERA_ENTRE_NAO_CONSTA_MS = 10 * 60_000;
/** O teto entre consultas da mesma chave: 2 por hora. MOC 7.0, 4.3.4: mais de 10 por hora = 656. */
const TETO_ENTRE_CONSULTAS_MS = 30 * 60_000;
/** Pedida à mão ("Consultar situação"), a mesma chave não sai de novo antes disto. */
const MINIMO_ENTRE_CONSULTAS_MS = 2 * 60_000;
/** Sem desfecho por 7 dias, o envio sai da conferência automática e vai para uma pessoa. */
export const PRAZO_DO_ENVIO_SEM_DESFECHO_MS = 7 * 24 * 60 * 60_000;

/** Quando este envio pode ser consultado de novo (ms). */
export function proximaConsultaDoEnvio(envio: Pick<EnvioRegistrado, "em" | "consultas" | "ultimaConsultaEm">, opcoes: { manual?: boolean } = {}): number {
  const desde = Date.parse(envio.em);
  const ultima = Date.parse(String(envio.ultimaConsultaEm ?? ""));
  if (!Number.isFinite(ultima)) return (Number.isFinite(desde) ? desde : 0) + (opcoes.manual ? 0 : ESPERA_PARA_CONFERIR_MS);
  if (opcoes.manual) return ultima + MINIMO_ENTRE_CONSULTAS_MS;
  const n = Math.max(1, envio.consultas);
  return ultima + Math.min(ESPERA_PARA_CONFERIR_MS * 2 ** (n - 1), TETO_ENTRE_CONSULTAS_MS);
}

/** Os números queimados de todos os pedidos da nota, sem repetir. */
function juntarQueimados(infos: Registro[]): Registro[] {
  const vistos = new Set<string>();
  const saida: Registro[] = [];
  for (const info of infos) {
    for (const q of Array.isArray(info.numerosQueimados) ? info.numerosQueimados : []) {
      const o = objeto(q);
      const k = `${o.serie}:${o.ambiente}:${o.numero}`;
      if (!o.numero || vistos.has(k)) continue;
      vistos.add(k);
      saida.push(o);
    }
  }
  return saida;
}

/** Os campos do emissor próprio que a consulta carrega adiante (a gravação da autorizada monta o fiscalInfo do zero). */
const CAMPOS_DO_EMISSOR = [
  "provedor",
  "xmlNoCofre",
  "xmlDaContingencia",
  "qrCode",
  "urlConsulta",
  "envioSefaz",
  "enviosAnteriores",
  "numeroTentado",
  "numeroDeContingencia",
  "numerosQueimados",
  "contingenciaPrazo",
  "contingenciaTransmitidaEm",
  "contingenciaRefeita",
  "alertaSefaz",
  "xmlPendente",
] as const;
export function camposDoEmissor(info: unknown): Registro {
  const i = objeto(info);
  const saida: Registro = {};
  for (const c of CAMPOS_DO_EMISSOR) if (i[c] !== undefined && i[c] !== null) saida[c] = i[c];
  return saida;
}

/** O NFe assinado de dentro de um nfeProc (a consulta remonta o nfeProc com ele). */
export function nfeDoNfeProc(xml: string | null | undefined): string | null {
  const m = /<NFe[\s>][\s\S]*<\/NFe>/.exec(String(xml ?? ""));
  return m ? m[0] : null;
}

/** 539/205/206 e denegação: o número é da SEFAZ agora — não volta. */
const QUEIMAM_O_NUMERO: Record<string, string> = {
  "539": "já existe NFC-e com este número e outra chave",
  "205": "número denegado na SEFAZ",
  "206": "número inutilizado na SEFAZ",
  "110": "uso denegado",
  "301": "uso denegado (irregularidade do emitente)",
  "302": "uso denegado (irregularidade do destinatário)",
  "303": "uso denegado (destinatário não habilitado)",
};

const falhaDeConfiguracao = (e: FaltaNoEmissor): ResultadoDaEmissao => ({
  ok: false,
  motivo: "nao_configurado",
  mensagem: e.message,
  pendencias: e.pendencias as Problema[],
});

/** O alerta da autorização (cStat 120) para o fiscalInfo, ou null. */
const alertaParaGravar = (r: ResultadoDaEmissaoSefaz): Registro | null => (r.alertaSefaz ? { ...r.alertaSefaz } : null);

/** O cancelamento que a consulta achou, guardado no cofre, no formato que o pedido grava. */
async function registroDoCancelamentoAchado(lojaId: string, chave: string, r: ResultadoDaEmissaoSefaz, agora: Date): Promise<Registro> {
  const ev = r.cancelamento ?? null;
  const guardado = ev?.xml ? await guardar({ lojaId, tipo: "evento", identificacao: `cancelamento:${chave}`, conteudo: ev.xml, mes: mesDaNota(null, agora) }) : null;
  return {
    ...(ev?.em ? { canceladaEm: ev.em } : {}),
    ...(ev?.protocolo ? { protocoloCancelamento: ev.protocolo } : {}),
    ...(ev?.tpEvento === "110112" ? { cancelamentoPorSubstituicao: true } : {}),
    ...(guardado ? { xmlCancelamentoNoCofre: ponteiro(guardado, "evento") } : {}),
  };
}

// ── EMISSÃO ──────────────────────────────────────────────────────────────────

class NotaJaEmitida extends Error {}

/**
 * Emite a NFC-e pela SEFAZ para os pedidos de `alvo` (ver o cabeçalho). O
 * corpo é o de `montarCorpoDaNfce` (lib/fiscal-emissao), com a série do
 * emissor. Nunca lança por falha da SEFAZ; lança só defeito de programação
 * (o chamador — lib/fiscal-automatico — registra como erro interno).
 */
export async function emitirNaSefazDaLoja(
  config: ConfigDaLoja,
  ref: string,
  corpo: CorpoDaNfce,
  alvo: { lojaId: string; pedidos: string[] } | undefined
): Promise<ResultadoDaEmissao> {
  if (!alvo?.lojaId || !alvo.pedidos?.length) {
    return { ok: false, motivo: "nao_configurado", mensagem: `Emissão pelo emissor próprio sem os pedidos da nota (${ref}). Nada foi enviado.` };
  }
  const { lojaId } = alvo;
  const pedidos = [...new Set(alvo.pedidos)];
  const ambiente = ambienteDaLoja(config);
  const serie = serieDoEmissor(config);
  const numeroInicial = numeroInicialDoEmissor(config);
  const banco = bancoDoEmissor();

  // 1. Credenciais — sem certificado ou CSC não se gasta número.
  let base: Omit<ContextoDoEmissor, "numero">;
  try {
    base = await contextoDaLoja(config, { ambiente });
  } catch (e) {
    if (e instanceof FaltaNoEmissor) return falhaDeConfiguracao(e);
    throw e;
  }
  const uf = base.uf;
  const urlConsulta = urlDeConsulta(uf, ambiente);

  // 2. A loja bloqueada (656): sem contingência, a nota fica pendente — sem
  // gastar número e sem contar tentativa (`esperaSefazAte`, lib/fiscal-automatico).
  const bloqueio = sefazBloqueadaAte(lojaId, config);
  if (bloqueio && base.contingenciaOffline === false) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem: `${mensagemDoBloqueio(bloqueio, uf)} A contingência off-line está desligada: a nota sai sozinha depois do bloqueio.`,
      statusSefaz: "656",
      gravarNoPedido: { provedor: PROVEDOR_PROPRIO, esperaSefazAte: bloqueio.toISOString() },
    };
  }

  // 3. O número.
  const reserva = await reservarNumero({ lojaId, pedidos, serie, ambiente, numeroInicial, agora: agoraDoEmissor(), banco });
  if (!reserva.ok) {
    // Outra emissão do mesmo pedido está no ar, ou a nota já saiu por outro
    // caminho: quem grava é o outro — nada aqui.
    if (reserva.motivo === "em_curso" || reserva.motivo === "ja_emitida") return { ok: false, motivo: "processando", mensagem: reserva.mensagem, naoGravar: true };
    return { ok: false, motivo: "nao_configurado", mensagem: reserva.mensagem };
  }
  let numero = reserva.numero;
  let reservadaEm = reserva.reservadaEm;
  const lidos = reserva.lidos;
  const lido = lidos[0]?.fiscalInfo ?? {};
  let queimados = juntarQueimados(lidos.map((l) => l.fiscalInfo));
  let historico = enviosAnteriores(lido);
  const tentadoAnterior = lidos.map((l) => l.fiscalInfo.numeroTentado).find((t) => t && typeof t === "object") ?? null;
  const reservaSemMarca = () => ({ serie, numero, ambiente, em: reservadaEm });
  // Tudo que o emissor põe no fiscalInfo vai EXPLÍCITO (null quando não vale):
  // a gravação da falha parte do fiscalInfo lido antes desta emissão, e uma
  // reserva ou envio velhos ficariam lá se não fossem sobrescritos.
  const comum = () => ({
    provedor: PROVEDOR_PROPRIO,
    numerosQueimados: queimados.length > 0 ? queimados : null,
    numeroTentado: tentadoAnterior,
    enviosAnteriores: historicoComoRegistro(historico),
    esperaSefazAte: null,
  });

  // 4. A tentativa anterior pode ter chegado à SEFAZ: confere antes.
  const envioAnterior = envioDoFiscalInfo(lido);
  if (envioAnterior && envioAnterior.chave !== lido.nfceKey && envioAnterior.ambiente !== ambiente) {
    // Envio de OUTRO ambiente (o teste de homologação que ficou sem desfecho,
    // e a loja agora em produção): a nota de lá não é a desta venda aqui —
    // não se adota. Fica no histórico, e a emissão segue no ambiente de agora.
    historico = comNoHistorico(historico, envioAnterior);
  } else if (envioAnterior && envioAnterior.chave !== lido.nfceKey) {
    const conferido = await conferirEnvio(envioAnterior, { certificado: base.certificado, uf, config }, lojaId);
    if (conferido.tipo === "autorizada") {
      const r = conferido.resultado;
      return {
        ...r,
        gravarNoPedido: {
          ...comum(),
          xmlNoCofre: conferido.xmlNoCofre,
          ...(conferido.xmlNoCofre ? {} : { xmlPendente: true }),
          qrCode: r.urlDoQrCode ?? null,
          urlConsulta: urlDeConsulta(uf, envioAnterior.ambiente),
          envioSefaz: envioComoRegistro(conferido.envio),
          alertaSefaz: alertaParaGravar(r),
        },
      };
    }
    if (conferido.tipo === "indefinido") {
      return {
        ok: false,
        motivo: "erro_de_comunicacao",
        mensagem:
          `A tentativa anterior desta nota (chave ${envioAnterior.chave}) pode ter chegado à SEFAZ, e ela ainda não foi confirmada ` +
          `(${conferido.mensagem}). Nada foi enviado de novo — a próxima tentativa confere antes.`,
        gravarNoPedido: {
          ...comum(),
          numeroReservado: reservaSemMarca(),
          envioSefaz: envioComoRegistro(conferido.envio),
          ...(conferido.esperaSefazAte ? { esperaSefazAte: conferido.esperaSefazAte } : {}),
        },
      };
    }
    historico = comNoHistorico(historico, conferido.envio);
    if (conferido.tipo === "queimado") {
      queimados = [
        ...queimados,
        { serie: envioAnterior.serie, numero: envioAnterior.numero, ambiente: envioAnterior.ambiente, motivo: conferido.motivo, em: agoraDoEmissor().toISOString(), chave: envioAnterior.chave },
      ];
      if (envioAnterior.numero === numero && envioAnterior.serie === serie && envioAnterior.ambiente === ambiente) {
        const nova = await reservarNumero({ lojaId, pedidos, serie, ambiente, numeroInicial, agora: agoraDoEmissor(), descartar: [numero], ignorarEmCurso: true, banco });
        if (!nova.ok) {
          if (nova.motivo === "ja_emitida") return { ok: false, motivo: "processando", mensagem: nova.mensagem, naoGravar: true };
          return { ok: false, motivo: "nao_configurado", mensagem: nova.mensagem };
        }
        numero = nova.numero;
        reservadaEm = nova.reservadaEm;
      }
    }
    // "livre": a SEFAZ não tem a nota — o número segue o mesmo.
  }

  // 5. A contingência RECUSADA: a nota corrigida sai com o mesmo número,
  // série, data e chave do cupom que o cliente levou.
  let refazer: ContingenciaARefazer | null = null;
  if (lido.contingenciaRecusadaEm && ponteiroValido(lido.xmlDaContingencia)) {
    const guardada = await lerDoCofre(ponteiroValido(lido.xmlDaContingencia));
    const dados = guardada ? contingenciaDoXml(guardada) : null;
    if (dados && dados.numero === numero && dados.serie === serie && (dados.ambiente ?? ambiente) === ambiente) {
      refazer = { chave: dados.chave, dhEmi: dados.dhEmi, dhCont: dados.dhCont, xJust: dados.xJust, codigoNumerico: dados.codigoNumerico };
    } else {
      console.warn(
        `[NFC-e] ⚠️ Contingência recusada dos pedidos ${pedidos.join(", ")} não pôde ser refeita com a mesma chave ` +
          `(${!guardada ? "XML fora do cofre" : !dados ? "XML sem os dados da contingência" : `reserva ${serie}/${numero}, cupom ${dados.serie}/${dados.numero}`}): sai uma nota nova.`
      );
    }
  }

  // 6. Assina, guarda e transmite. O que os ganchos do emissor descobrem
  // mora num objeto (e não em `let`): o TypeScript não acompanha atribuição
  // feita dentro de callback.
  const feito: { assinada: NotaAssinada | null; envio: Registro | null; contingencia: number | null } = {
    assinada: null,
    envio: null,
    contingencia: null,
  };
  const ctx: ContextoDoEmissor = {
    ...base,
    numero,
    transporte: transporteDoEmissor(),
    agora: relogioDoEmissor(),
    contingenciaDireta: bloqueio ? `SEFAZ bloqueada por consumo indevido (656) ate ${horaNaLoja(bloqueio, uf)}; emissao em contingencia off-line` : null,
    refazerContingencia: refazer,
    reservarNumeroDeContingencia: async () => {
      feito.contingencia = await reservarNumeroDeContingencia({ lojaId, pedidos, serie, ambiente, numeroInicial, agora: agoraDoEmissor(), banco });
      return feito.contingencia;
    },
    aoAssinar: async (nota) => {
      const guardado = await guardarArquivoFiscal({ lojaId, tipo: "nota", identificacao: `assinada:${nota.chave}`, conteudo: nota.xml, mes: mesDaNota(nota.dhEmi) });
      const registro = envioComoRegistro({
        chave: nota.chave,
        numero: nota.numero,
        serie,
        ambiente,
        tipoDeEmissao: nota.tipoDeEmissao,
        xml: ponteiro(guardado),
        em: agoraDoEmissor().toISOString(),
        recibo: null,
        consultas: 0,
        ultimaConsultaEm: null,
        naoConsta: [],
        aConferir: true,
        situacao: null,
        orientacao: null,
      });
      // O envio que este substitui vai para o histórico NA MESMA gravação: é
      // por lá que um 539 futuro reconhece uma chave deste pedido.
      historico = comNoHistorico(historico, envioDoFiscalInfo(lido)?.chave === nota.chave ? null : envioDoFiscalInfo(lido));
      const n = await banco.$executeRaw(
        sqlMarcarEmEmissao(pedidos, { processando: true, provedor: PROVEDOR_PROPRIO, ambiente, envioSefaz: registro, enviosAnteriores: historicoComoRegistro(historico) })
      );
      if (Number(n) < pedidos.length) throw new NotaJaEmitida("Outro caminho autorizou a nota deste pedido agora mesmo.");
      feito.envio = registro;
      feito.assinada = nota;
    },
  };

  let r: ResultadoDaEmissaoSefaz;
  try {
    r = await emitirNfceNaSefaz(corpo, ctx);
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    if (!feito.assinada) {
      if (e instanceof NotaJaEmitida) {
        // A reserva que ficou no pedido autorizado não vai ser usada: sai.
        await banco.$executeRaw(sqlMesclarNoFiscalInfo(pedidos, {}, ["numeroReservado"])).catch(() => {});
        return { ok: false, motivo: "processando", mensagem: `${msg} Nada foi enviado de novo.`, naoGravar: true };
      }
      return {
        ok: false,
        motivo: "erro_de_comunicacao",
        mensagem: `Não consegui guardar a nota assinada antes de transmitir (${msg}). Nada foi enviado à SEFAZ — a nota sai na próxima tentativa.`,
        gravarNoPedido: { ...comum(), numeroReservado: reservaSemMarca(), envioSefaz: null },
      };
    }
    // Depois de guardar a assinada, a nota PODE ter saído: quem decide é a consulta pela chave.
    return {
      ok: false,
      motivo: "processando",
      mensagem: `Erro depois de assinar a nota (${msg}). A consulta automática confere na SEFAZ pela chave ${feito.assinada.chave}.`,
      gravarNoPedido: { ...comum(), numeroReservado: reservaSemMarca(), envioSefaz: feito.envio },
    };
  }
  const envio = feito.envio;
  const contingenciaReservada = feito.contingencia;
  await conferirO656(lojaId, r.statusSefaz, "emissão");
  // A contingência refeita (item 5): a marca faz a gravação reimprimir o
  // DANFE — "imprimir o DANFE-NFC-e correspondente à NFC-e, autorizada, no
  // mesmo tipo de papel utilizado para imprimir o DANFE-NFC-e original"
  // (Ajuste SINIEF 19/16, cl. 11ª § 1º III, c).
  const refeita = refazer ? { chave: refazer.chave, recusadaEm: lido.contingenciaRecusadaEm, refeitaEm: agoraDoEmissor().toISOString() } : null;

  // 7. O resultado, com o que fica no pedido.
  if (r.ok && !r.emContingencia) {
    const guardado = r.xml ? await guardar({ lojaId, tipo: "nota", identificacao: r.chaveDeAcesso, conteudo: r.xml, mes: mesDaNota(r.emitidaEm) }) : null;
    return {
      ...semXml(r),
      gravarNoPedido: {
        ...comum(),
        xmlNoCofre: ponteiro(guardado, "nota"),
        ...(guardado ? {} : { xmlPendente: true }),
        qrCode: r.urlDoQrCode ?? null,
        urlConsulta,
        envioSefaz: envio ? { ...envio, aConferir: false } : null,
        alertaSefaz: alertaParaGravar(r),
        ...(refeita ? { contingenciaRefeita: refeita } : {}),
      },
    };
  }

  if (r.ok && r.emContingencia) {
    // A refeita tem a MESMA chave da recusada: outro nome no cofre, para a
    // gravação nunca trocar o arquivo que o pedido ainda aponta.
    const identificacao = refazer ? `refeita:${r.chaveDeAcesso}:${Date.now()}` : r.chaveDeAcesso;
    const guardado = r.xml ? await guardar({ lojaId, tipo: "contingencia", identificacao, conteudo: r.xml, mes: mesDaNota(r.emitidaEm) }) : null;
    const emitidaEm = Date.parse(r.emitidaEm);
    const tentado = r.numeroTentado
      ? {
          numero: r.numeroTentado.numero,
          chave: r.numeroTentado.chave,
          serie,
          ambiente,
          xml: envio?.xml ?? null,
          desde: agoraDoEmissor().toISOString(),
          situacao: "a_conferir",
        }
      : null;
    return {
      ...semXml(r),
      gravarNoPedido: {
        ...comum(),
        xmlNoCofre: ponteiro(guardado, "contingencia"),
        xmlDaContingencia: ponteiro(guardado, "contingencia"),
        ...(guardado ? {} : { xmlPendente: true }),
        qrCode: r.urlDoQrCode ?? null,
        urlConsulta,
        contingenciaPrazo: prazoDaContingencia(uf, Number.isFinite(emitidaEm) ? new Date(emitidaEm) : agoraDoEmissor()).toISOString(),
        ...(tentado ? { numeroTentado: tentado } : {}),
        numeroDeContingencia: contingenciaReservada != null ? { serie, numero: contingenciaReservada, ambiente, em: agoraDoEmissor().toISOString() } : null,
        // O envio foi o da nota normal (a tentada, se saiu): quem acompanha agora
        // é o `numeroTentado`. Na refeita, o que a SEFAZ pode ter é a própria
        // contingência (mesma chave): a transmissão dela confere.
        envioSefaz: null,
        ...(refazer && envio ? { contingenciaAConferirEm: agoraDoEmissor().toISOString() } : {}),
        transmissoesDaContingencia: null,
        ...(refeita ? { contingenciaRefeita: refeita } : {}),
      },
    };
  }

  // Falhou.
  const falha = r as Extract<ResultadoDaEmissaoSefaz, { ok: false }>;
  const cStat = falha.statusSefaz ?? null;

  // 539 que aponta para uma chave que ESTE pedido já mandou: o número é nosso
  // — a nota de uma tentativa anterior foi autorizada depois. Consultar e
  // ADOTAR; queimar o número aqui fazia a venda sair com duas notas.
  if (cStat === "539" && falha.chaveDuplicada) {
    const nossa = [envioAnterior, ...historico].find((e): e is EnvioRegistrado => e != null && e.chave === falha.chaveDuplicada);
    if (nossa) return adotarDoCinco39(nossa, { base, uf, config, lojaId, comum, reservaSemMarca, envio });
  }

  const queimou = Boolean(cStat && QUEIMAM_O_NUMERO[cStat]);
  if (queimou) {
    queimados = [
      ...queimados,
      { serie, numero, ambiente, motivo: `${cStat}: ${QUEIMAM_O_NUMERO[cStat!]}`, em: agoraDoEmissor().toISOString(), chave: feito.assinada?.chave ?? null },
    ];
  }
  // A nota pode estar na SEFAZ (processando, sem resposta, duplicidade da
  // mesma chave, resposta ilegível): o envio fica para ser conferido pela
  // chave (e pelo recibo). Nada saiu, ou o lote foi recusado sem ser
  // processado: o número segue livre, sem conferência.
  const manterEnvio = Boolean(envio) && (falha.talvezNaSefaz === true || falha.motivo === "processando");
  const bloqueadaAgora = cStat === "656" ? sefazBloqueadaAte(lojaId, config) : null;
  return {
    ...falha,
    ...(bloqueadaAgora ? { mensagem: `${falha.mensagem} ${mensagemDoBloqueio(bloqueadaAgora, uf)}` } : {}),
    gravarNoPedido: {
      ...comum(),
      numeroReservado: queimou ? null : reservaSemMarca(),
      envioSefaz: manterEnvio && envio ? { ...envio, ...(falha.recibo ? { recibo: falha.recibo } : {}) } : null,
      numeroDeContingencia: null,
      cStat,
      oQueFazer: cStat ? O_QUE_FAZER[cStat] ?? null : null,
      ...(bloqueadaAgora ? { esperaSefazAte: bloqueadaAgora.toISOString() } : {}),
    },
  };
}

/**
 * O 539 apontou para uma chave deste pedido: confere e adota. Autorizada → é a
 * nota da venda. Sem resposta → "processando" com AQUELE envio, e o cron
 * resolve. Não autorizada (cancelada, denegada) → aí sim o número queima, e a
 * próxima tentativa reserva outro.
 */
async function adotarDoCinco39(
  nossa: EnvioRegistrado,
  p: {
    base: Omit<ContextoDoEmissor, "numero">;
    uf: string;
    config: ConfigDaLoja;
    lojaId: string;
    comum: () => Registro;
    reservaSemMarca: () => Registro;
    envio: Registro | null;
  }
): Promise<ResultadoDaEmissao> {
  const conferido = await conferirEnvio({ ...nossa, consultas: 0, ultimaConsultaEm: null, naoConsta: [] }, { certificado: p.base.certificado, uf: p.uf, config: p.config }, p.lojaId, {
    manual: true,
  });
  if (conferido.tipo === "autorizada") {
    const r = conferido.resultado;
    console.warn(`[NFC-e] 539 apontou a chave ${nossa.chave}, de uma tentativa anterior deste pedido: autorizada — adotada (o número não queima).`);
    return {
      ...r,
      gravarNoPedido: {
        ...p.comum(),
        xmlNoCofre: conferido.xmlNoCofre,
        ...(conferido.xmlNoCofre ? {} : { xmlPendente: true }),
        qrCode: r.urlDoQrCode ?? null,
        urlConsulta: urlDeConsulta(p.uf, nossa.ambiente),
        envioSefaz: envioComoRegistro(conferido.envio),
        alertaSefaz: alertaParaGravar(r),
      },
    };
  }
  if (conferido.tipo === "queimado" || conferido.tipo === "livre") {
    return {
      ok: false,
      motivo: "rejeitada",
      mensagem: `A SEFAZ tem este número na chave ${nossa.chave} (539), de uma tentativa anterior, e ela não vale (${conferido.tipo === "queimado" ? conferido.motivo : "não consta"}). A próxima tentativa usa outro número.`,
      statusSefaz: "539",
      gravarNoPedido: {
        ...p.comum(),
        numerosQueimados: [
          ...juntarQueimados([{ numerosQueimados: p.comum().numerosQueimados ?? [] }]),
          { serie: nossa.serie, numero: nossa.numero, ambiente: nossa.ambiente, motivo: "539: número de uma tentativa anterior que não vale", em: agoraDoEmissor().toISOString(), chave: nossa.chave },
        ],
        numeroReservado: null,
        envioSefaz: null,
        cStat: "539",
      },
    };
  }
  return {
    ok: false,
    motivo: "processando",
    mensagem:
      `A SEFAZ tem este número na chave ${nossa.chave}, de uma tentativa anterior DESTE pedido, e a consulta não confirmou agora ` +
      `(${conferido.mensagem}). A consulta automática confere — o número não foi queimado.`,
    statusSefaz: "539",
    gravarNoPedido: {
      ...p.comum(),
      numeroReservado: p.reservaSemMarca(),
      envioSefaz: envioComoRegistro({ ...conferido.envio, aConferir: true }),
      ...(conferido.esperaSefazAte ? { esperaSefazAte: conferido.esperaSefazAte } : {}),
    },
  };
}

/** O resultado sem o XML (ele já está no cofre; não precisa atravessar o resto do caminho). */
function semXml<T extends { xml?: string }>(r: T): Omit<T, "xml"> {
  const { xml, ...resto } = r;
  void xml;
  return resto;
}

type EnvioConferido =
  | { tipo: "autorizada"; resultado: Extract<ResultadoDaEmissaoSefaz, { ok: true }>; xmlNoCofre: PonteiroNoCofre | null; envio: EnvioRegistrado }
  | { tipo: "livre"; envio: EnvioRegistrado }
  | { tipo: "queimado"; motivo: string; envio: EnvioRegistrado; resultado: ResultadoDaEmissaoSefaz }
  | {
      tipo: "indefinido";
      mensagem: string;
      /** O envio com a marca desta conferência (consultas, 217...) — quem chama grava. */
      envio: EnvioRegistrado;
      /** Consultou agora (a marca mudou). */
      consultou: boolean;
      /** A SEFAZ bloqueada: a retentativa espera até aqui. */
      esperaSefazAte?: string;
      /** 7 dias sem desfecho: vai para uma pessoa. */
      paraPessoa?: boolean;
      /** O último resultado da SEFAZ, quando houve. */
      resultado?: ResultadoDaEmissaoSefaz;
    };

/**
 * O que aconteceu com um envio sem desfecho. No ritmo que a SEFAZ tolera
 * (`proximaConsultaDoEnvio`: a primeira 10 min depois do envio, depois 10,
 * 20, 30 min...; MOC 7.0, 4.3.4 — mais de 10 consultas da mesma chave por hora
 * = 656): o RECIBO primeiro (lote 103), depois a chave, no ambiente DELE.
 * Autorizada → remonta o nfeProc com o XML assinado guardado. "Não consta"
 * só depois de DOIS 217 com 10 min entre eles — o lote ainda na fila da SEFAZ
 * também dá 217, e o número reusado cedo demais virava 539 e duas notas.
 */
async function conferirEnvio(
  envio: EnvioRegistrado,
  loja: { certificado: ContextoDoEmissor["certificado"]; uf: string; config: ConfigDaLoja },
  lojaId: string,
  opcoes: { manual?: boolean } = {}
): Promise<EnvioConferido> {
  const agora = agoraDoEmissor();
  const bloqueio = sefazBloqueadaAte(lojaId, loja.config, agora);
  if (bloqueio) return { tipo: "indefinido", mensagem: mensagemDoBloqueio(bloqueio, loja.uf), envio, consultou: false, esperaSefazAte: bloqueio.toISOString() };
  const proxima = proximaConsultaDoEnvio(envio, opcoes);
  if (proxima > agora.getTime()) {
    return {
      tipo: "indefinido",
      mensagem: `a SEFAZ pode ainda estar processando; a próxima consulta da chave é às ${horaNaLoja(new Date(proxima), loja.uf)}`,
      envio,
      consultou: false,
    };
  }
  const marcado: EnvioRegistrado = { ...envio, consultas: envio.consultas + 1, ultimaConsultaEm: agora.toISOString() };
  const indefinido = (mensagem: string, resultado?: ResultadoDaEmissaoSefaz): EnvioConferido => {
    const desde = Date.parse(envio.em);
    const paraPessoa = Number.isFinite(desde) && agora.getTime() - desde > PRAZO_DO_ENVIO_SEM_DESFECHO_MS;
    return { tipo: "indefinido", mensagem, envio: marcado, consultou: true, ...(paraPessoa ? { paraPessoa } : {}), ...(resultado ? { resultado } : {}) };
  };
  const xml = await lerDoCofre(envio.xml);
  const ctx = { certificado: loja.certificado, uf: loja.uf, ambiente: envio.ambiente, transporte: transporteDoEmissor(), agora: relogioDoEmissor() };
  const autorizada = async (r: Extract<ResultadoDaEmissaoSefaz, { ok: true }>): Promise<EnvioConferido> => {
    const guardado = r.xml ? await guardar({ lojaId, tipo: "nota", identificacao: r.chaveDeAcesso, conteudo: r.xml, mes: mesDaNota(r.emitidaEm) }) : null;
    return { tipo: "autorizada", resultado: semXml(r) as Extract<ResultadoDaEmissaoSefaz, { ok: true }>, xmlNoCofre: ponteiro(guardado, "nota"), envio: { ...marcado, aConferir: false } };
  };

  // O recibo: enquanto o lote está na fila (105), a nota NUNCA está livre.
  if (envio.recibo) {
    const r = await consultarReciboNaSefaz(envio.recibo, { ...ctx, chave: envio.chave, xmlAssinado: xml });
    if (await conferirO656(lojaId, r.statusSefaz, "consulta do recibo")) return indefinido("a SEFAZ recusou a consulta por consumo indevido (656)", r);
    if (r.ok) return autorizada(r);
    if (r.motivo === "processando") return indefinido("o lote desta nota ainda está em processamento na SEFAZ (105)", r);
    if (r.motivo === "rejeitada") {
      // O lote foi processado e a nota, recusada: ela não entrou na SEFAZ —
      // o número segue livre (539 e denegação o queimam).
      if (r.statusSefaz && QUEIMAM_O_NUMERO[r.statusSefaz]) return { tipo: "queimado", motivo: r.mensagem.slice(0, 200), envio: { ...marcado, aConferir: false }, resultado: r };
      return { tipo: "livre", envio: { ...marcado, aConferir: false } };
    }
    // 106 (recibo que não existe mais), sem resposta: segue para a chave.
  }

  const r = await consultarNaSefaz(envio.chave, { ...ctx, xmlAssinado: xml });
  if (await conferirO656(lojaId, r.statusSefaz, "consulta")) return indefinido("a SEFAZ recusou a consulta por consumo indevido (656)", r);
  if (r.ok) return autorizada(r);
  if (r.statusSefaz === "217") {
    const antes = envio.naoConsta.map((t) => Date.parse(t)).filter((t) => Number.isFinite(t));
    const comAgora = { ...marcado, naoConsta: [...envio.naoConsta, agora.toISOString()] };
    if (antes.some((t) => agora.getTime() - t >= ESPERA_ENTRE_NAO_CONSTA_MS)) return { tipo: "livre", envio: { ...comAgora, aConferir: false } };
    return { ...(indefinido("a SEFAZ ainda não tem a nota (217); só depois de uma segunda consulta, 10 min depois, o número fica livre", r) as Extract<EnvioConferido, { tipo: "indefinido" }>), envio: comAgora };
  }
  if (r.motivo === "rejeitada") {
    return { tipo: "queimado", motivo: /CANCELADA/.test(r.mensagem) ? "a nota da tentativa anterior foi cancelada" : r.mensagem.slice(0, 200), envio: { ...marcado, aConferir: false }, resultado: r };
  }
  return indefinido(r.mensagem.slice(0, 200), r);
}

// ── CONSULTA E TRANSMISSÃO DA CONTINGÊNCIA (cron e "Consultar situação") ─────

export type SincronizacaoSefaz = {
  resultado: ResultadoDaEmissao;
  /** false: nada muda no pedido (sem resposta, cancelada que já está cancelada...). */
  gravar: boolean;
  ambiente: Ambiente;
  /** A gravação é de uma nota em contingência (a recusa pode trocar o EMITTED por FAILED). */
  deContingencia: boolean;
};

// O ritmo da transmissão da contingência que falhou.
/** Espera depois da n-ésima falha seguida: 2, 4, 8, 16, 30, 30... min. */
const PRIMEIRA_ESPERA_DA_TRANSMISSAO_MS = 2 * 60_000;
const TETO_DA_ESPERA_DA_TRANSMISSAO_MS = 30 * 60_000;
/**
 * Recusas SEGUIDAS do lote (sem protNFe, que não derrubam o cupom) até a
 * transmissão automática parar e a nota ir para uma pessoa: a mesma recusa
 * repetida vira 656 (MOC 7.0, 4.3.1: 30 rejeições iguais).
 */
const RECUSAS_DO_LOTE_ATE_A_PESSOA = 3;

export function proximaTransmissaoDaContingencia(info: unknown, opcoes: { manual?: boolean } = {}): number {
  const i = objeto(info);
  const ultima = Date.parse(String(i.ultimaTransmissaoEm ?? ""));
  if (!Number.isFinite(ultima)) return 0;
  if (opcoes.manual) return ultima + MINIMO_ENTRE_CONSULTAS_MS;
  const n = Math.max(1, Number(i.transmissoesDaContingencia) || 1);
  return ultima + Math.min(PRIMEIRA_ESPERA_DA_TRANSMISSAO_MS * 2 ** (n - 1), TETO_DA_ESPERA_DA_TRANSMISSAO_MS);
}

/**
 * O que uma nota do emissor próprio é de verdade agora — e o que fazer:
 *
 *  - em CONTINGÊNCIA: transmite a NFe guardada, sem mexer (mesma chave);
 *    autorizada → nfeProc no cofre; recusada COM protNFe desta chave → o
 *    cupom deixa de valer e o número volta para a nota corrigida (a mesma
 *    chave — `emitirNaSefazDaLoja`, item 5); a SEFAZ já tem (204) ou pode ter
 *    recebido → a próxima rodada CONSULTA a chave antes de transmitir de novo;
 *    sem resposta, recusa do lote, certificado → tenta de novo com recuo (a
 *    mesma recusa repetida é 656), e a recusa do lote repetida vai para uma
 *    pessoa;
 *  - com ENVIO sem desfecho ("processando", queda no meio, falha sem
 *    resposta): `conferirEnvio`; autorizada → EMITTED com o nfeProc; "não
 *    consta" duas vezes → falha transitória, e a retentativa emite com o MESMO
 *    número; cancelada/denegada → o número queima; 7 dias sem desfecho → uma
 *    pessoa;
 *  - AUTORIZADA: consulta a chave (a nota cancelada por fora vira CANCELED,
 *    com o evento no cofre).
 *
 * `gravarResultado` (lib/fiscal-automatico) grava — a mesma gravação da Focus.
 * `manual`: o "Consultar situação" da tela, que não espera o recuo do cron
 * (mas respeita o bloqueio e o mínimo de 2 min entre consultas da mesma chave).
 */
export async function sincronizarNotaNaSefaz(
  grupo: { ids: string[]; info: Registro; fiscalStatus: string | null | undefined },
  config: ConfigDaLoja,
  lojaId: string,
  opcoes: { manual?: boolean } = {}
): Promise<SincronizacaoSefaz> {
  const info = objeto(grupo.info);
  const ambienteDaNota = ambienteDoRegistro(info.ambiente) ?? ambienteDaLoja(config);
  const agora = agoraDoEmissor();
  const semGravar = (resultado: ResultadoDaEmissao, ambiente: Ambiente = ambienteDaNota, deContingencia = false): SincronizacaoSefaz => ({
    resultado,
    gravar: false,
    ambiente,
    deContingencia,
  });
  const uf = String(config.uf ?? "").trim().toUpperCase();
  const bloqueio = sefazBloqueadaAte(lojaId, config, agora);
  const bloqueada = (ambiente: Ambiente = ambienteDaNota, deContingencia = false) =>
    semGravar({ ok: false, motivo: "erro_de_comunicacao", mensagem: `${mensagemDoBloqueio(bloqueio!, uf)} A situação é conferida depois.`, statusSefaz: "656" }, ambiente, deContingencia);

  let certificado;
  try {
    certificado = await certificadoDaLoja(config);
  } catch (e) {
    if (e instanceof FaltaNoEmissor) return semGravar(falhaDeConfiguracao(e));
    throw e;
  }
  const ctx = { certificado, uf, transporte: transporteDoEmissor(), agora: relogioDoEmissor() };

  // ── Contingência: transmitir ────────────────────────────────────────────
  // Também a contingência que ficou "processando" porque a gravação caiu
  // logo depois de emiti-la (lib/fiscal-automatico → oQueGravarNaExcecao):
  // ela existe e tem o XML no cofre — transmitida, vira a nota da venda. Não
  // enquanto uma emissão estiver no ar (a marca é dela).
  const envioPendente = envioDoFiscalInfo(info);
  const contingenciaSemGravacao =
    grupo.fiscalStatus !== "EMITTED" &&
    grupo.fiscalStatus !== "CANCELED" &&
    info.processando === true &&
    !envioPendente &&
    !emissaoEmCurso(info, agora) &&
    Boolean(ponteiroValido(info.xmlDaContingencia));
  if ((grupo.fiscalStatus === "EMITTED" && info.contingencia === true) || contingenciaSemGravacao) {
    return sincronizarContingencia({ grupo, info, lojaId, uf, ambienteDaNota, agora, ctx, bloqueio, opcoes, semGravar, bloqueada });
  }

  // ── Envio sem desfecho ──────────────────────────────────────────────────
  const envio = envioDoFiscalInfo(info);
  if (envio && envio.chave !== info.nfceKey && grupo.fiscalStatus !== "EMITTED" && grupo.fiscalStatus !== "CANCELED") {
    if (emissaoEmCurso(info, agora)) {
      return semGravar({ ok: false, motivo: "processando", mensagem: "A nota está sendo transmitida agora (ou acabou de ser). Consulte de novo em instantes." }, envio.ambiente);
    }
    if (envio.situacao === "para_pessoa" && !opcoes.manual) {
      return semGravar({ ok: false, motivo: "erro_de_comunicacao", mensagem: envio.orientacao ?? "Este envio saiu da conferência automática." }, envio.ambiente);
    }
    const conferido = await conferirEnvio(envio, { certificado, uf, config }, lojaId, opcoes);
    if (conferido.tipo === "autorizada") {
      const r = conferido.resultado;
      return {
        resultado: {
          ...r,
          gravarNoPedido: {
            ...camposDoEmissor(info),
            xmlNoCofre: conferido.xmlNoCofre,
            xmlPendente: conferido.xmlNoCofre ? null : true,
            qrCode: r.urlDoQrCode ?? null,
            urlConsulta: urlDeConsulta(uf, envio.ambiente),
            envioSefaz: envioComoRegistro(conferido.envio),
            alertaSefaz: alertaParaGravar(r),
            numeroReservado: null,
            esperaSefazAte: null,
            cStat: null,
            oQueFazer: null,
          },
        },
        gravar: true,
        ambiente: envio.ambiente,
        deContingencia: false,
      };
    }
    if (conferido.tipo === "livre") {
      // Não chegou: o número está livre e a nota sai de novo pela retentativa
      // (falha transitória), com o MESMO número.
      return {
        resultado: {
          ok: false,
          motivo: "erro_de_comunicacao",
          mensagem: `A SEFAZ não tem a nota da chave ${envio.chave} (217, confirmado): ela não foi autorizada. A emissão tenta de novo com o mesmo número.`,
          statusSefaz: "217",
          gravarNoPedido: {
            ...camposDoEmissor(info),
            numeroReservado: { serie: envio.serie, numero: envio.numero, ambiente: envio.ambiente, em: agora.toISOString() },
            envioSefaz: null,
            enviosAnteriores: historicoComoRegistro(comNoHistorico(enviosAnteriores(info), conferido.envio)),
            esperaSefazAte: null,
          },
        },
        gravar: true,
        ambiente: envio.ambiente,
        deContingencia: false,
      };
    }
    if (conferido.tipo === "queimado") {
      // Cancelada por fora (vira CANCELED na gravação, com o evento) ou
      // denegada: o número é da SEFAZ.
      const r = conferido.resultado;
      const queimados = [
        ...juntarQueimados([info]),
        { serie: envio.serie, numero: envio.numero, ambiente: envio.ambiente, motivo: conferido.motivo, em: agora.toISOString(), chave: envio.chave },
      ];
      const cancelamento = !r.ok && /CANCELADA/.test(r.mensagem) ? await registroDoCancelamentoAchado(lojaId, envio.chave, r, agora) : {};
      return {
        resultado: {
          ...(r.ok ? { ok: false as const, motivo: "rejeitada" as const, mensagem: conferido.motivo } : r),
          gravarNoPedido: {
            ...camposDoEmissor(info),
            ...cancelamento,
            numerosQueimados: queimados,
            numeroReservado: null,
            envioSefaz: null,
            enviosAnteriores: historicoComoRegistro(comNoHistorico(enviosAnteriores(info), conferido.envio)),
          },
        },
        gravar: true,
        ambiente: envio.ambiente,
        deContingencia: false,
      };
    }
    // Sem desfecho: a marca da consulta fica (é ela que dá o ritmo).
    if (conferido.paraPessoa) {
      const orientacao =
        `A nota da chave ${envio.chave} (nº ${envio.numero}, série ${envio.serie}) foi à SEFAZ em ${envio.em} e, em 7 dias de consultas, ` +
        `nunca teve resposta conclusiva (${conferido.mensagem}). Consulte a chave no portal da SEFAZ: autorizada, ela é a nota desta venda; ` +
        "não autorizada, emita de novo pela tela Fiscal.";
      return {
        resultado: {
          ok: false,
          motivo: "erro_de_comunicacao",
          mensagem: orientacao,
          gravarNoPedido: {
            ...camposDoEmissor(info),
            envioSefaz: envioComoRegistro({ ...conferido.envio, aConferir: false, situacao: "para_pessoa", orientacao }),
            numeroReservado: info.numeroReservado ?? null,
          },
        },
        gravar: true,
        ambiente: envio.ambiente,
        deContingencia: false,
      };
    }
    if (conferido.consultou) {
      await bancoDoEmissor()
        .$executeRaw(sqlMesclarNoFiscalInfo(grupo.ids, { envioSefaz: envioComoRegistro(conferido.envio) }))
        .catch(() => {});
    }
    return semGravar(
      conferido.resultado && !conferido.resultado.ok
        ? { ...conferido.resultado, motivo: conferido.resultado.motivo === "processando" ? "processando" : "erro_de_comunicacao", mensagem: conferido.mensagem }
        : { ok: false, motivo: "processando", mensagem: `A nota ainda não foi confirmada: ${conferido.mensagem}.` },
      envio.ambiente
    );
  }

  // ── Emissão interrompida ANTES de sair ───────────────────────────────────
  // "Processando" sem envio registrado nem contingência: a reserva marcou o
  // pedido e o processo caiu antes de assinar — nada foi à SEFAZ. Vira falha
  // transitória com a MESMA reserva, e a retentativa emite. O envio cuja
  // chave é a da nota do pedido é o da nota ANTERIOR (a reemissão de uma
  // cancelada que caiu logo depois da reserva): não é envio pendente — e a
  // cancelada vai para `notasAnteriores`, como a reemissão faria.
  if (grupo.fiscalStatus !== "EMITTED" && grupo.fiscalStatus !== "CANCELED" && info.processando === true && (!envio || envio.chave === info.nfceKey)) {
    if (emissaoEmCurso(info, agora)) {
      return semGravar({ ok: false, motivo: "processando", mensagem: "A nota está sendo emitida agora. Consulte de novo em instantes." });
    }
    const reservado = objeto(info.numeroReservado);
    const daCancelada = info.nfceKey && (info.canceladaEm || info.protocoloCancelamento) ? reemissaoInterrompida(grupo.ids[0], info) : {};
    return {
      resultado: {
        ok: false,
        motivo: "erro_de_comunicacao",
        mensagem: "A emissão foi interrompida antes de a nota ir à SEFAZ (nada foi enviado). Ela sai de novo pela retentativa, com o mesmo número.",
        gravarNoPedido: {
          ...camposDoEmissor(info),
          ...daCancelada,
          numeroReservado: reservado.numero
            ? { serie: reservado.serie, numero: reservado.numero, ambiente: reservado.ambiente, em: reservado.em ?? agora.toISOString() }
            : null,
        },
      },
      gravar: true,
      ambiente: ambienteDaNota,
      deContingencia: false,
    };
  }

  // ── Autorizada (ou cancelada): consulta a chave ──────────────────────────
  const chave = String(info.nfceKey ?? "");
  if (chaveValida(chave) && (grupo.fiscalStatus === "EMITTED" || grupo.fiscalStatus === "CANCELED")) {
    if (bloqueio) return bloqueada();
    const doCofre = ponteiroValido(info.xmlNoCofre);
    let nfe: string | null = null;
    if (doCofre) nfe = nfeDoNfeProc(await lerDoCofre(doCofre));
    if (!nfe && envio?.chave === chave && envio.xml) nfe = await lerDoCofre(envio.xml);
    const r = await consultarNaSefaz(chave, { ...ctx, ambiente: ambienteDaNota, xmlAssinado: nfe });
    await conferirO656(lojaId, r.statusSefaz, "consulta");
    // Cancelada que já está cancelada: nada muda.
    if (grupo.fiscalStatus === "CANCELED") return semGravar(r);
    if (r.ok) {
      // XML que não tinha ido para o cofre (disco falhou na hora): vai agora.
      const faltavaXml = !doCofre && r.xml;
      const guardado = faltavaXml ? await guardar({ lojaId, tipo: "nota", identificacao: chave, conteudo: r.xml!, mes: mesDaNota(r.emitidaEm) }) : null;
      return {
        resultado: {
          ...semXml(r),
          gravarNoPedido: {
            ...camposDoEmissor(info),
            ...(guardado ? { xmlNoCofre: ponteiro(guardado, "nota"), xmlPendente: null } : {}),
            ...(r.alertaSefaz ? { alertaSefaz: alertaParaGravar(r) } : {}),
          },
        },
        gravar: true,
        ambiente: ambienteDaNota,
        deContingencia: false,
      };
    }
    if (r.motivo === "rejeitada" && /CANCELADA/.test(r.mensagem)) {
      // O cancelamento cuja resposta se perdeu (ou feito por fora): a SEFAZ
      // devolve o procEventoNFe na consulta — é ele que prova o cancelamento,
      // e ele vai para o cofre junto com a marca.
      const cancelamento = await registroDoCancelamentoAchado(lojaId, chave, r, agora);
      return { resultado: { ...r, gravarNoPedido: { ...camposDoEmissor(info), ...cancelamento } }, gravar: true, ambiente: ambienteDaNota, deContingencia: false };
    }
    return semGravar(r);
  }

  return semGravar({ ok: false, motivo: "erro_de_comunicacao", mensagem: "Este pedido não tem nota enviada à SEFAZ para consultar." });
}

/**
 * A reemissão de uma nota CANCELADA que parou logo depois da reserva: o
 * pedido ficou PENDING com o fiscalInfo da cancelada. A falha que a consulta
 * grava leva a cancelada para `notasAnteriores` (o contador precisa dela) e
 * a ref nova da reemissão — como `emitirNfceDoPedidoPelaTela` gravaria —, e
 * tira do topo os campos da nota velha.
 */
function reemissaoInterrompida(pedidoId: string, info: Registro): Registro {
  const conta = objeto(info.notaDaConta).tableSessionId;
  const base = typeof conta === "string" && conta ? idDaNotaDaMesa(conta) : pedidoId;
  const refAtual = typeof info.idDaNota === "string" && info.idDaNota ? info.idDaNota : base;
  const semNota: Registro = {};
  for (const c of ["nfceKey", "nfceNumber", "protocol", "emittedAt", "xmlUrl", "pdfUrl", "canceladaEm", "protocoloCancelamento", "justificativaCancelamento", "xmlCancelamentoUrl", "xmlNoCofre", "xmlCancelamentoNoCofre", "qrCode", "urlConsulta", "envioSefaz", "canceladaForaDoFireHub"]) {
    semNota[c] = null;
  }
  return {
    ...semNota,
    idDaNota: refDaReemissao(refAtual, base),
    notasAnteriores: notasAnterioresComA({ id: pedidoId, fiscalInfo: info }),
  };
}

/** A contingência: transmitir (ou conferir) — ver `sincronizarNotaNaSefaz`. */
async function sincronizarContingencia(p: {
  grupo: { ids: string[]; info: Registro; fiscalStatus: string | null | undefined };
  info: Registro;
  lojaId: string;
  uf: string;
  ambienteDaNota: Ambiente;
  agora: Date;
  ctx: { certificado: any; uf: string; transporte: Transporte | undefined; agora: (() => Date) | undefined };
  bloqueio: Date | null;
  opcoes: { manual?: boolean };
  semGravar: (resultado: ResultadoDaEmissao, ambiente?: Ambiente, deContingencia?: boolean) => SincronizacaoSefaz;
  bloqueada: (ambiente?: Ambiente, deContingencia?: boolean) => SincronizacaoSefaz;
}): Promise<SincronizacaoSefaz> {
  const { info, lojaId, ambienteDaNota, agora } = p;
  if (p.bloqueio) return p.bloqueada(ambienteDaNota, true);
  if (info.contingenciaParaPessoa && !p.opcoes.manual) {
    return p.semGravar({ ok: false, motivo: "erro_de_comunicacao", mensagem: String(objeto(info.contingenciaParaPessoa).orientacao ?? "A transmissão desta contingência parou: fale com o suporte.") }, ambienteDaNota, true);
  }
  const proxima = proximaTransmissaoDaContingencia(info, p.opcoes);
  if (proxima > agora.getTime()) {
    return p.semGravar(
      { ok: false, motivo: "processando", mensagem: `A NFC-e em contingência segue válida; a próxima transmissão é às ${horaNaLoja(new Date(proxima), p.uf)}.` },
      ambienteDaNota,
      true
    );
  }
  const doCofre = ponteiroValido(info.xmlDaContingencia) ?? ponteiroValido(info.xmlNoCofre);
  const xml = await lerDoCofre(doCofre);
  if (!xml) {
    return p.semGravar(
      { ok: false, motivo: "erro_de_comunicacao", mensagem: "A NFC-e em contingência não tem o XML guardado no cofre — não há o que transmitir. Fale com o suporte." },
      ambienteDaNota,
      true
    );
  }
  const chaveDaNota = /Id="NFe([0-9A-Z]{44})"/.exec(xml)?.[1] ?? String(info.nfceKey ?? "");
  const autorizada = async (r: Extract<ResultadoDaEmissaoSefaz, { ok: true }>): Promise<SincronizacaoSefaz> => {
    const guardado = r.xml ? await guardar({ lojaId, tipo: "nota", identificacao: r.chaveDeAcesso, conteudo: r.xml, mes: mesDaNota(r.emitidaEm) }) : null;
    return {
      resultado: {
        ...semXml(r),
        gravarNoPedido: {
          ...camposDoEmissor(info),
          xmlNoCofre: ponteiro(guardado, "nota") ?? info.xmlNoCofre ?? null,
          xmlPendente: guardado ? null : true,
          contingenciaTransmitidaEm: agora.toISOString(),
          alertaSefaz: alertaParaGravar(r),
          contingenciaAConferirEm: null,
          transmissoesDaContingencia: null,
        },
      },
      gravar: true,
      ambiente: ambienteDaNota,
      deContingencia: true,
    };
  };

  // A SEFAZ já tem (204) ou pode ter recebido esta chave: CONSULTA antes de
  // transmitir de novo — cada retransmissão de uma nota que ela já tem é uma
  // recusa 204 igual à anterior, e 30 iguais são 656.
  let r: ResultadoDaEmissaoSefaz;
  if (info.contingenciaAConferirEm) {
    r = await consultarNaSefaz(chaveDaNota, { ...p.ctx, ambiente: ambienteDaNota, xmlAssinado: xml });
    if (r.ok) return autorizada(r);
    if (r.motivo === "rejeitada" && /CANCELADA/.test(r.mensagem)) {
      // Autorizada numa transmissão cuja resposta se perdeu e cancelada por
      // fora: a nota da venda está cancelada (CANCELED na gravação, com o evento).
      const cancelamento = await registroDoCancelamentoAchado(lojaId, chaveDaNota, r, agora);
      return { resultado: { ...r, gravarNoPedido: { ...camposDoEmissor(info), ...cancelamento } }, gravar: true, ambiente: ambienteDaNota, deContingencia: true };
    }
    if (r.statusSefaz !== "217" && r.motivo !== "rejeitada") {
      await conferirO656(lojaId, r.statusSefaz, "consulta da contingência");
      await marcarTransmissao(p.grupo.ids, info, agora, r, { aConferir: true });
      return p.semGravar(r, ambienteDaNota, true);
    }
    // 217: não chegou — transmite. Denegada: a transmissão diz.
  }
  r = await transmitirContingencia(xml, { ...p.ctx, ambiente: ambienteDaNota });
  if (r.ok) return autorizada(r);
  await conferirO656(lojaId, r.statusSefaz, "transmissão da contingência");

  if (r.motivo === "rejeitada" && r.recusaDaNota === true) {
    // O cupom deixa de valer. A nota corrigida sai com o MESMO número (é o
    // que está impresso no cupom que o cliente levou) — a não ser que a
    // SEFAZ diga que o número é de outra nota (539, denegação): aí ele queima.
    const partes = lerChave(chaveDaNota);
    const queima = Boolean(r.statusSefaz && QUEIMAM_O_NUMERO[r.statusSefaz]);
    return {
      resultado: {
        ...r,
        gravarNoPedido: {
          ...camposDoEmissor(info),
          numeroReservado:
            partes.numero && !queima ? { serie: partes.serie, numero: partes.numero, ambiente: ambienteDaNota, em: agora.toISOString() } : null,
          ...(queima
            ? {
                numerosQueimados: [
                  ...juntarQueimados([info]),
                  { serie: partes.serie, numero: partes.numero, ambiente: ambienteDaNota, motivo: `${r.statusSefaz}: ${QUEIMAM_O_NUMERO[r.statusSefaz!]}`, em: agora.toISOString(), chave: chaveDaNota },
                ],
              }
            : {}),
          cStat: r.statusSefaz ?? null,
          oQueFazer: r.statusSefaz ? O_QUE_FAZER[r.statusSefaz] ?? null : null,
          contingenciaAConferirEm: null,
          transmissoesDaContingencia: null,
        },
      },
      gravar: true,
      ambiente: ambienteDaNota,
      deContingencia: true,
    };
  }

  // Não derruba o cupom: a SEFAZ não disse nada sobre ESTA nota (lote
  // recusado, certificado, sistema dela, sem resposta), ou disse que já a tem
  // (204 sem a consulta confirmar). Fica para a próxima rodada, com recuo.
  const recusaDoLote = r.motivo === "rejeitada";
  const recusasSeguidas = recusaDoLote ? (Number(info.recusasDoLoteDaContingencia) || 0) + 1 : 0;
  const talvezNaSefaz = r.talvezNaSefaz === true || r.motivo === "processando";
  const paraPessoa = recusasSeguidas >= RECUSAS_DO_LOTE_ATE_A_PESSOA;
  await marcarTransmissao(p.grupo.ids, info, agora, r, {
    aConferir: talvezNaSefaz,
    recusasDoLote: recusasSeguidas,
    ...(paraPessoa
      ? {
          paraPessoa: {
            em: agora.toISOString(),
            cStat: r.statusSefaz ?? null,
            orientacao:
              `A SEFAZ recusou o LOTE desta NFC-e de contingência ${recusasSeguidas} vezes seguidas ([${r.statusSefaz ?? "?"}] ${r.mensagem.slice(0, 160)}), ` +
              "sem analisar a nota. O cupom continua valendo, mas a transmissão automática parou para não virar consumo indevido (656): fale com o suporte.",
          },
        }
      : {}),
  });
  const prazo = Date.parse(String(info.contingenciaPrazo ?? ""));
  if (Number.isFinite(prazo) && agora.getTime() > prazo) {
    console.error(`[NFC-e] ⏰ Contingência ${info.nfceKey} passou do prazo de transmissão (${info.contingenciaPrazo}) e a SEFAZ ainda não recebeu: ${r.mensagem}`);
  }
  return p.semGravar(
    r.motivo === "rejeitada" ? { ...r, motivo: "erro_de_comunicacao", mensagem: `A NFC-e em contingência segue válida; a SEFAZ recusou o lote sem analisar a nota: ${r.mensagem}` } : r,
    ambienteDaNota,
    true
  );
}

/**
 * A marca da transmissão da contingência que não deu certo: a hora, quantas
 * seguidas (o recuo), o erro e — quando a SEFAZ pode ter recebido — que a
 * próxima rodada consulta antes. Mexe no `updatedAt`, e é por ele que o cron
 * acha a nota: sem isto, dois dias de SEFAZ fora a tirariam da fila.
 */
async function marcarTransmissao(
  ids: string[],
  info: Registro,
  agora: Date,
  r: ResultadoDaEmissaoSefaz,
  o: { aConferir: boolean; recusasDoLote?: number; paraPessoa?: Registro }
): Promise<void> {
  const prazo = Date.parse(String(info.contingenciaPrazo ?? ""));
  await bancoDoEmissor()
    .$executeRaw(
      sqlMesclarNoFiscalInfo(ids, {
        ultimaTransmissaoEm: agora.toISOString(),
        transmissoesDaContingencia: (Number(info.transmissoesDaContingencia) || 0) + 1,
        ultimoErroDaTransmissao: (r.ok ? "" : r.mensagem).slice(0, 300),
        contingenciaAConferirEm: o.aConferir ? info.contingenciaAConferirEm ?? agora.toISOString() : null,
        recusasDoLoteDaContingencia: o.recusasDoLote ?? null,
        ...(o.paraPessoa ? { contingenciaParaPessoa: o.paraPessoa } : {}),
        ...(Number.isFinite(prazo) && agora.getTime() > prazo ? { contingenciaVencida: true } : {}),
      })
    )
    .catch(() => {});
}

// ── CANCELAMENTO ─────────────────────────────────────────────────────────────

/**
 * Cancela na SEFAZ a nota (autorizada) do emissor próprio e grava nos pedidos
 * dela — a rota api/store/fiscal/cancelar já conferiu quem pede, a
 * contingência e a regra legal (mercadoria não saiu + 30 min). O evento
 * (procEventoNFe) vai para o cofre: é ele que prova o cancelamento na
 * fiscalização e vai no pacote do contador.
 */
export async function cancelarNotaDoPedidoNaSefaz(p: {
  lojaId: string;
  config: ConfigDaLoja;
  pedido: { id: string; fiscalInfo: unknown };
  /** Os pedidos da nota (a conta da mesa tem vários) — lib/fiscal-config → notaDoPedido. */
  pedidosDaNota: string[];
  ambiente: Ambiente | null;
  justificativa: string;
}): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const info = objeto(p.pedido.fiscalInfo);
  const chave = String(info.nfceKey ?? "");
  const protocolo = String(info.protocol ?? "");
  const ambiente = p.ambiente ?? ambienteDoRegistro(info.ambiente) ?? ambienteDaLoja(p.config);
  const bloqueio = sefazBloqueadaAte(p.lojaId, p.config);
  if (bloqueio) {
    return {
      status: 503,
      corpo: {
        error: "sefaz_bloqueada",
        mensagem: `${mensagemDoBloqueio(bloqueio, String(p.config.uf ?? ""))} O cancelamento não foi pedido — tente depois desse horário (o prazo legal de 30 minutos continua correndo).`,
        cStat: "656",
      },
    };
  }
  let certificado;
  try {
    certificado = await certificadoDaLoja(p.config);
  } catch (e) {
    if (e instanceof FaltaNoEmissor) return { status: 409, corpo: { error: "nao_configurado", mensagem: e.message, pendencias: e.pendencias } };
    throw e;
  }
  const agora = agoraDoEmissor();
  const r = await cancelarNaSefaz(
    { chave, protocolo, justificativa: p.justificativa },
    { certificado, uf: String(p.config.uf ?? "").toUpperCase(), ambiente, transporte: transporteDoEmissor(), agora: relogioDoEmissor() }
  );
  if (!r.ok) {
    await conferirO656(p.lojaId, r.statusSefaz, "cancelamento");
    return {
      status: r.motivo === "erro_de_comunicacao" ? 502 : 409,
      corpo: {
        error: r.motivo,
        mensagem:
          r.mensagem +
          (r.statusSefaz === "573" ? " Use \"Consultar situação\": a nota já cancelada aparece como cancelada aqui." : ""),
        detalhe: r.detalhe ?? null,
        cStat: r.statusSefaz ?? null,
        ...(r.enviado ? { podeTerSidoRegistrado: true } : {}),
      },
    };
  }

  const guardado = r.xml ? await guardar({ lojaId: p.lojaId, tipo: "evento", identificacao: `cancelamento:${chave}`, conteudo: r.xml, mes: mesDaNota(null, agora) }) : null;
  // Os pedidos da MESMA nota (a conta da mesa): só os que têm esta chave.
  const banco = bancoDoEmissor();
  const daNota: Array<{ id: string; fiscalInfo: unknown }> =
    p.pedidosDaNota.length > 1
      ? await banco.customerOrder.findMany({ where: { id: { in: p.pedidosDaNota }, franchiseeId: p.lojaId }, select: { id: true, fiscalInfo: true } })
      : [{ id: p.pedido.id, fiscalInfo: p.pedido.fiscalInfo }];
  const alvos = daNota.filter((o) => o.id === p.pedido.id || objeto(o.fiscalInfo).nfceKey === chave);
  const registro = {
    canceladaEm: r.canceladaEm,
    protocoloCancelamento: r.protocolo,
    justificativaCancelamento: p.justificativa,
    xmlCancelamentoNoCofre: ponteiro(guardado, "evento"),
    ...(guardado ? {} : { xmlCancelamentoPendente: true }),
  };
  await banco.$transaction(
    alvos.map((o) =>
      banco.customerOrder.update({
        where: { id: o.id },
        data: { fiscalStatus: "CANCELED", fiscalInfo: { ...objeto(o.fiscalInfo), ...registro } as Prisma.InputJsonValue },
      })
    )
  );
  return {
    status: 200,
    corpo: {
      success: true,
      protocolo: r.protocolo,
      mensagem:
        `Nota cancelada na SEFAZ (${r.mensagemSefaz}). Protocolo do cancelamento: ${r.protocolo}.` +
        (alvos.length > 1 ? ` A nota era da conta da mesa: os ${alvos.length} pedidos da conta ficaram cancelados na parte fiscal.` : ""),
    },
  };
}

// ── TESTE DE CONEXÃO (o "dia 1") ─────────────────────────────────────────────

export type TesteDeConexao = {
  ok: boolean;
  cStat: string | null;
  mensagem: string;
  ambiente: Ambiente;
  certificado: { titular: string; validoAte: string; diasParaVencer: number } | null;
};

/**
 * O status do serviço de autorização da UF (consStatServ), com o certificado
 * da LOJA no TLS — é o teste que prova, antes da primeira venda, que o A1 abre,
 * que a cadeia ICP-Brasil fecha e que a SEFAZ responde. Grava o resultado em
 * fiscalConfig.sefaz.ultimoTeste (a tela mostra). Com a loja bloqueada (656),
 * não chama: o teste só prolongaria o bloqueio.
 */
export async function testarConexaoDaLoja(p: { lojaId: string; config: ConfigDaLoja; ambiente?: Ambiente | null }): Promise<TesteDeConexao> {
  const ambiente: Ambiente = p.ambiente === 1 ? 1 : 2;
  const agora = agoraDoEmissor();
  const uf = String(p.config.uf ?? "").trim().toUpperCase();
  let resultado: TesteDeConexao;
  try {
    const certificado = await certificadoDaLoja(p.config);
    const infoDoCertificado = {
      titular: certificado.titular,
      validoAte: certificado.validoAte.toISOString(),
      diasParaVencer: diasParaVencer(certificado, agora),
    };
    const bloqueio = sefazBloqueadaAte(p.lojaId, p.config, agora);
    if (!ufsDoEmissorProprio().includes(uf)) {
      resultado = {
        ok: false,
        cStat: null,
        mensagem: `O emissor próprio ainda não transmite NFC-e da UF "${uf || "?"}" (hoje: ${ufsDoEmissorProprio().join(", ")}).`,
        ambiente,
        certificado: infoDoCertificado,
      };
    } else if (bloqueio) {
      resultado = { ok: false, cStat: "656", mensagem: `${mensagemDoBloqueio(bloqueio, uf)} O teste não foi feito.`, ambiente, certificado: infoDoCertificado };
    } else {
      const s = await statusDoServico({ certificado, uf, ambiente, transporte: transporteDoEmissor(), agora: relogioDoEmissor() });
      await conferirO656(p.lojaId, s.cStat, "teste de conexão");
      resultado = { ok: s.ok, cStat: s.cStat, mensagem: s.mensagem, ambiente, certificado: infoDoCertificado };
    }
  } catch (e) {
    if (!(e instanceof FaltaNoEmissor)) throw e;
    resultado = { ok: false, cStat: null, mensagem: e.message, ambiente, certificado: null };
  }
  await bancoDoEmissor()
    .$executeRaw(
      sqlMesclarNoEmissorDaLoja(p.lojaId, {
        ultimoTeste: { quando: agora.toISOString(), ambiente, ok: resultado.ok, cStat: resultado.cStat, mensagem: resultado.mensagem.slice(0, 300) },
      })
    )
    .catch((e: any) => console.error("[NFC-e] Não gravei o último teste de conexão:", String(e?.message ?? e).slice(0, 200)));
  return resultado;
}

// ── fiscalConfig: gravações pontuais ─────────────────────────────────────────

/**
 * Junta chaves ao bloco `sefaz` do fiscalConfig NO BANCO. O PUT da tela grava o
 * fiscalConfig inteiro; um read-modify-write aqui (o cron, o teste de conexão)
 * desfaria um "Salvar" feito no meio — o `||` do jsonb mexe só nestas chaves.
 */
export function sqlMesclarNoEmissorDaLoja(lojaId: string, dados: Record<string, unknown>): Prisma.Sql {
  return Prisma.sql`/* fh:mesclar-sefaz */ UPDATE "User"
SET "fiscalConfig" = jsonb_set(
      CASE WHEN jsonb_typeof("fiscalConfig") = 'object' THEN "fiscalConfig" ELSE '{}'::jsonb END,
      '{sefaz}',
      (CASE WHEN jsonb_typeof("fiscalConfig"->'sefaz') = 'object' THEN "fiscalConfig"->'sefaz' ELSE '{}'::jsonb END) || ${JSON.stringify(dados)}::jsonb,
      true),
    "updatedAt" = NOW()
WHERE "id" = ${lojaId}`;
}

/** Leitura do bloco do emissor para quem só tem o fiscalConfig cru. */
export const emissorDaLoja = configDoEmissorProprio;
