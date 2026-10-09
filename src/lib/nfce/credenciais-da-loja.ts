/**
 * /src/lib/nfce/credenciais-da-loja.ts
 *
 * O que o emissor próprio precisa da LOJA para assinar e transmitir: o A1 (do
 * cofre, com a senha decifrada), o CSC do ambiente (decifrado) e o resto do
 * contexto da nota (UF, ambiente, série, versão do QR Code, contingência,
 * inscrição estadual, responsável técnico).
 *
 * ── Onde cada coisa mora ────────────────────────────────────────────────────
 *
 * fiscalConfig.sefaz (lib/nfce/config-da-loja): o .pfx é um arquivo CIFRADO no
 * cofre (lib/nfce/armazenamento), conferido pelo SHA-256 na leitura; a senha
 * dele e o CSC vão cifrados (lib/fiscal-credenciais, FISCAL_CHAVE). Os dados
 * da empresa (CNPJ, razão, CRT, endereço, IBGE) vão no CORPO da nota
 * (lib/fiscal-emissao → montarCorpoDaNfce), que é o mesmo da Focus.
 *
 * ── Erros viram pendência ───────────────────────────────────────────────────
 *
 * Arquivo que sumiu, senha que não abre (FISCAL_CHAVE trocada depois do envio),
 * CSC do ambiente que falta: `FaltaNoEmissor`, com a pendência no formato da
 * tela ("certificado", "csc"). A emissão devolve `nao_configurado` com ela —
 * não gasta número e não tenta a SEFAZ.
 *
 * ── Responsável técnico ─────────────────────────────────────────────────────
 *
 * O grupo infRespTec (NT 2018.005) identifica a empresa do SOFTWARE emissor.
 * É facultativo por UF — a que exige recusa com 972. Vem das variáveis
 * FH_RESP_TEC_CNPJ, FH_RESP_TEC_NOME, FH_RESP_TEC_EMAIL e FH_RESP_TEC_FONE
 * (as quatro, ou nenhuma: o schema pede as quatro juntas).
 *
 * Só servidor.
 */
import { cnpjValido, type Problema } from "../fiscal-validacao";
import { decifrar } from "../fiscal-credenciais";
import { lerArquivoFiscal } from "./armazenamento";
import { carregarCertificado, ErroDoCertificado, type CertificadoCarregado } from "./assinatura";
import { chaveDoAmbiente, configDoEmissorProprio } from "./config-da-loja";
import type { ConfiguracaoDoQrCode, ContextoDoEmissor } from "./emissor";
import { ambienteDaLoja, serieDoEmissor } from "./pendencias";
import type { ResponsavelTecnico } from "./xml-da-nota";

/** O que falta para o emissor próprio falar com a SEFAZ por esta loja. */
export class FaltaNoEmissor extends Error {
  constructor(public readonly pendencias: Problema[]) {
    super(pendencias.map((p) => p.mensagem).join(" "));
  }
}

const falta = (campo: string, mensagem: string, valor: string | null = null) => new FaltaNoEmissor([{ campo, valor, mensagem }]);

type ConfigDaLoja = { uf?: string | null; ambiente?: number | null; inscricaoEstadual?: string | null; complemento?: unknown; [chave: string]: unknown };

// ── O certificado ─────────────────────────────────────────────────────────

/**
 * Ler o PKCS#12 com o node-forge custa dezenas de milissegundos (a cifra do
 * .pfx é derivada da senha com milhares de rodadas). Cada nota pediria isso de
 * novo; o cache guarda o certificado já carregado por 10 minutos. A chave do
 * cache é o arquivo + o SHA-256 + a senha cifrada: o A1 renovado (mesmo
 * arquivo no cofre, outro conteúdo) entra na hora.
 */
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { cert: CertificadoCarregado; ate: number }>();

export async function certificadoDaLoja(config: unknown): Promise<CertificadoCarregado> {
  const c = configDoEmissorProprio(config).certificado;
  if (!c?.arquivo || !c.sha256) {
    throw falta("certificado", "Envie o certificado digital A1 (.pfx) e a senha em Fiscal → Configuração. Sem ele nada é assinado.");
  }
  if (!c.senhaCifrada) throw falta("certificado", "Falta a senha do certificado digital A1. Envie o .pfx de novo com a senha.");
  const chave = `${c.arquivo}|${c.sha256}|${c.senhaCifrada}`;
  const guardado = cache.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.cert;

  let pfx: Buffer;
  try {
    pfx = await lerArquivoFiscal(c.arquivo, c.sha256);
  } catch (e: any) {
    throw falta("certificado", `Não consegui ler o certificado guardado no servidor (${String(e?.message ?? e).slice(0, 160)}). Envie o A1 de novo.`);
  }
  const senha = decifrar(c.senhaCifrada);
  if (senha == null) {
    throw falta(
      "certificado",
      "A senha do certificado não abre com a chave fiscal deste servidor (a FISCAL_CHAVE mudou depois do envio?). Envie o A1 e a senha de novo."
    );
  }
  let cert: CertificadoCarregado;
  try {
    cert = carregarCertificado(pfx, senha);
  } catch (e: any) {
    throw falta("certificado", e instanceof ErroDoCertificado ? e.message : `Não consegui abrir o certificado digital: ${String(e?.message ?? e).slice(0, 160)}`);
  }
  cache.set(chave, { cert, ate: Date.now() + CACHE_MS });
  return cert;
}

/** Para o teste (e para a troca de certificado no mesmo processo). */
export function esquecerCertificados(): void {
  cache.clear();
}

// ── O CSC e o QR Code ────────────────────────────────────────────────────────

/**
 * A configuração do QR Code do AMBIENTE: v3 não usa CSC (NT 2025.001); v2 usa
 * o CSC daquele ambiente — o de homologação não assina QR de produção
 * (rejeição 464, hash que não confere).
 */
export function qrCodeDaLoja(config: unknown, ambiente: 1 | 2): ConfiguracaoDoQrCode {
  const s = configDoEmissorProprio(config);
  if (Number(s.qrVersao) === 3) return { versao: 3 };
  const nome = ambiente === 1 ? "PRODUÇÃO" : "HOMOLOGAÇÃO";
  const csc = s.csc?.[chaveDoAmbiente(ambiente)] ?? null;
  if (!csc?.id || !csc.cifrado) {
    throw falta("csc", `Cadastre o CSC de ${nome} (o ID e o código, gerados no portal da SEFAZ). Sem ele o QR Code não é assinado.`);
  }
  const codigo = decifrar(csc.cifrado);
  if (!codigo) {
    throw falta("csc", `O CSC de ${nome} guardado não abre com a chave fiscal deste servidor (a FISCAL_CHAVE mudou?). Cadastre o CSC de novo.`);
  }
  return { versao: 2, idCsc: String(csc.id).trim(), csc: codigo };
}

// ── O responsável técnico ────────────────────────────────────────────────────

/**
 * As UF em que a SEFAZ RECUSA a NFC-e sem o grupo infRespTec (rejeição 972),
 * desde 07/05/2019: AL, AM, MS, PE, PR, SC e TO. Nas outras o grupo é
 * facultativo ("implementação futura", sem data). Levantado em 09/10/2026
 * (NT 2018.005; oobj.com.br/bc/rejeicao-972-como-resolver). O emissor manda
 * o grupo sempre que FH_RESP_TEC_* está completo — a lista serve para a
 * conferência avisar ANTES da primeira nota, e só onde dói.
 */
export const UFS_QUE_EXIGEM_RESP_TEC = new Set(["AL", "AM", "MS", "PE", "PR", "SC", "TO"]);

let avisouRespTec = false;

export function responsavelTecnico(env: Record<string, string | undefined> = process.env): ResponsavelTecnico | null {
  const cnpj = String(env.FH_RESP_TEC_CNPJ ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const contato = String(env.FH_RESP_TEC_NOME ?? "").trim();
  const email = String(env.FH_RESP_TEC_EMAIL ?? "").trim();
  const telefone = String(env.FH_RESP_TEC_FONE ?? "").replace(/\D/g, "");
  if (!cnpj && !contato && !email && !telefone) return null;
  // Incompleto não vai: o schema pede os quatro (CNPJ, xContato, email, fone
  // de 6 a 14 dígitos) e um grupo pela metade derrubaria TODA nota por
  // schema (225). Sem o grupo, só a UF que exige recusa (972) — e diz por quê.
  if (!cnpjValido(cnpj) || contato.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^\d{6,14}$/.test(telefone)) {
    if (!avisouRespTec) {
      avisouRespTec = true;
      console.warn("[NFC-e] FH_RESP_TEC_* incompleto ou inválido: a nota sai SEM o responsável técnico (infRespTec).");
    }
    return null;
  }
  return { cnpj, contato, email, telefone };
}

// ── O contexto do emissor ────────────────────────────────────────────────────

/**
 * Tudo que o emissor (lib/nfce/emissor → ContextoDoEmissor) precisa da loja,
 * menos o número — que sai da numeração (lib/nfce/numeracao) só depois de
 * saber que as credenciais estão boas (sem certificado não se gasta número).
 */
export async function contextoDaLoja(
  config: ConfigDaLoja,
  opcoes: { ambiente?: 1 | 2 } = {}
): Promise<Omit<ContextoDoEmissor, "numero">> {
  const ambiente = opcoes.ambiente ?? ambienteDaLoja(config);
  const certificado = await certificadoDaLoja(config);
  const qrCode = qrCodeDaLoja(config, ambiente);
  const s = configDoEmissorProprio(config);
  const complemento = typeof config.complemento === "string" ? config.complemento : null;
  const telefone = typeof config.telefone === "string" ? config.telefone : null;
  return {
    certificado,
    uf: String(config.uf ?? "").trim().toUpperCase(),
    ambiente,
    serie: serieDoEmissor(config),
    qrCode,
    // A UF pode não admitir contingência off-line: a loja desliga no bloco.
    contingenciaOffline: s.contingenciaOffline !== false,
    emitente: { inscricaoEstadual: config.inscricaoEstadual ?? null, complemento, telefone },
    responsavelTecnico: responsavelTecnico(),
  };
}
