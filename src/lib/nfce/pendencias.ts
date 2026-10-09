/**
 * /src/lib/nfce/pendencias.ts
 *
 * O que falta para uma loja emitir pelo EMISSOR PRÓPRIO (fiscalConfig.provedor
 * = "sefaz") — a parte que só ele tem. Os dados da empresa (CNPJ, IE, razão,
 * CRT, endereço com IBGE, série, ambiente) continuam conferidos por
 * `pendenciasDoEmitente` (lib/fiscal-validacao), chamada de
 * lib/fiscal-emissao → pendenciasParaEmitir com o CSC e o certificado DESTE
 * bloco, e não com os campos da Focus.
 *
 * ── Por que conferir antes, se o emissor confere de novo ─────────────────────
 *
 * lib/nfce/emissor recusa na hora de emitir o certificado vencido ou de outro
 * CNPJ (rejeições 280 e 213 antes de sair). Mas a pendência na TELA é o que
 * impede de ligar a emissão com o cadastro errado — ligada assim, toda venda
 * vira "Falhou" no meio do salão. E é pela pendência que a automática e o
 * cron deixam de tentar (lib/fiscal-automatico).
 *
 * ── O CNPJ do certificado ───────────────────────────────────────────────────
 *
 * Confere o CNPJ-BASE (8 primeiras posições), que é o que a SEFAZ confere
 * (rejeição 213, "CNPJ-Base do Emitente difere do CNPJ-Base do Certificado
 * Digital"): o e-CNPJ da matriz assina a nota da filial. Base diferente é
 * certificado de OUTRA empresa — pendência.
 *
 * Puro (sem banco, sem cofre, sem cripto): o que a tela e o PUT de ligar
 * conferem é o que está gravado no fiscalConfig. Se o arquivo do certificado
 * sumir do cofre ou a senha não abrir, quem diz é a emissão
 * (lib/nfce/credenciais-da-loja), com a mesma pendência "certificado".
 */
import type { Problema } from "../fiscal-validacao";
import { chaveDoAmbiente, configDoEmissorProprio } from "./config-da-loja";
import { URL_DO_QRCODE } from "./qrcode";
import { AUTORIZADOR_DA_UF } from "./sefaz";

type ConfigComEmissor = {
  cnpj?: string | null;
  uf?: string | null;
  ambiente?: number | null;
  serie?: number | null;
  regimeTributario?: number | string | null;
  [chave: string]: unknown;
};

const alfanumerico = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * A maior série que a loja pode usar. MOC 7.0, Anexo I: com processo de
 * emissão pelo contribuinte (procEmi 0, o do FireHub), a série vai de 0 a 889
 * ou de 920 a 969 (B26-10, rejeição 244) e, com emitente CNPJ, de 0 a 909
 * (C02-30, rejeição 503) — juntas, 0 a 889. A 890–919 é da nota avulsa do
 * fisco. O FireHub começa na 1 (a 0 é a "série única" do Ajuste SINIEF 19/16,
 * cl. 4ª §1º I, que a loja que já emitiu por outro sistema não usa).
 */
export const SERIE_MAXIMA = 889;
const serieValida = (n: number) => Number.isInteger(n) && n >= 1 && n <= SERIE_MAXIMA;

/**
 * A série do emissor próprio: a do bloco `sefaz` (a loja que emitiu antes por
 * outro sistema usa uma série NOVA — ver lib/nfce/config-da-loja), senão a do
 * cadastro, senão 1. É ela que vai no corpo, no XML e na numeração. Série fora
 * de 1–889 no bloco não vale (a pendência "serie" trava a emissão).
 */
export function serieDoEmissor(config: ConfigComEmissor | null | undefined): number {
  const doBloco = Number(configDoEmissorProprio(config).serie);
  if (serieValida(doBloco)) return doBloco;
  const doCadastro = Number(config?.serie);
  if (serieValida(doCadastro)) return doCadastro;
  return 1;
}

/** O primeiro número desta série no FireHub (padrão 1). */
export function numeroInicialDoEmissor(config: ConfigComEmissor | null | undefined): number {
  const n = Number(configDoEmissorProprio(config).numeroInicial);
  return Number.isInteger(n) && n >= 1 && n <= 999_999_999 ? n : 1;
}

/** 1 = produção; qualquer outra coisa é homologação (a regra de toda a emissão). */
export const ambienteDaLoja = (config: { ambiente?: unknown } | null | undefined): 1 | 2 => (Number(config?.ambiente) === 1 ? 1 : 2);

/** As UFs em que o emissor próprio sabe transmitir (webservice E endereço do QR Code). */
export function ufsDoEmissorProprio(): string[] {
  return Object.keys(AUTORIZADOR_DA_UF).filter((uf) => Boolean(URL_DO_QRCODE[uf])).sort();
}

/**
 * O que `pendenciasDoEmitente` precisa ver, tirado do bloco do emissor próprio:
 * o CSC DO AMBIENTE (o de homologação não vale em produção), a série do
 * emissor e o certificado presente. O CSC nunca sai daqui: o que vai para a
 * conferência é um marcador de "existe".
 */
export function dadosDoEmissorParaConferencia(config: ConfigComEmissor | null | undefined): {
  serie: number;
  cscId: string | null;
  csc: string | null;
  temCertificado: boolean;
} {
  const s = configDoEmissorProprio(config);
  const serie = serieDoEmissor(config);
  const temCertificado = Boolean(s.certificado?.arquivo && s.certificado?.sha256);
  // QR Code v3 (NT 2025.001) não usa CSC: nada a cobrar.
  if (Number(s.qrVersao) === 3) return { serie, cscId: "v3", csc: "(QR Code v3, sem CSC)", temCertificado };
  const csc = s.csc?.[chaveDoAmbiente(config?.ambiente)] ?? null;
  return {
    serie,
    cscId: csc?.id ? String(csc.id) : null,
    csc: csc?.cifrado ? "(cadastrado)" : null,
    temCertificado,
  };
}

const dataBr = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/**
 * As pendências que só o emissor próprio tem. Não repete as do emitente
 * (CNPJ, IE, CRT, endereço, IBGE, série, CSC e certificado AUSENTES — essas
 * vêm de `pendenciasDoEmitente` com `dadosDoEmissorParaConferencia`).
 */
export function pendenciasDoEmissorProprio(config: ConfigComEmissor | null | undefined, agora: Date = new Date()): Problema[] {
  const faltas: Problema[] = [];
  const falta = (campo: string, valor: unknown, mensagem: string) =>
    faltas.push({ campo, valor: valor == null ? null : String(valor), mensagem });
  const s = configDoEmissorProprio(config);

  // ── Regime Normal (CRT 3) ────────────────────────────────────────────────
  // O emissor próprio não monta o grupo IBSCBS da reforma tributária
  // (NT 2025.002, leiaute UB), e a regra UB12-10 rejeita sem ele (rejeição
  // 1115): em produção desde 03/08/2026 para o CRT 3 e a partir de 04/01/2027
  // para os CRT 1, 2 e 4 (cronograma da NT 2025.002 v1.51, conferido em
  // 30/09/2026). Então o Regime Normal fica de fora aqui — mesmo que um dia a
  // regra geral (lib/fiscal-validacao → pendenciasDoEmitente) passe a aceitar
  // o CRT 3 pela Focus. Simples (1 e 2) e MEI (4) seguem; ANTES de 04/01/2027
  // o IBSCBS tem de estar no XML deles também (lib/nfce/xml-da-nota).
  if (Number(config?.regimeTributario) === 3) {
    falta(
      "regimeTributario",
      3,
      "Regime Normal (CRT 3) ainda não é emitido pelo emissor do FireHub: a nota desse regime já exige o grupo " +
        "IBS/CBS da reforma tributária (NT 2025.002, rejeição 1115 desde 03/08/2026), que o emissor ainda não monta. " +
        "Fale com o suporte do FireHub."
    );
  }

  // ── UF ───────────────────────────────────────────────────────────────────
  const uf = String(config?.uf ?? "").trim().toUpperCase();
  const atendidas = ufsDoEmissorProprio();
  if (/^[A-Z]{2}$/.test(uf) && !atendidas.includes(uf)) {
    falta(
      "uf",
      uf,
      `O Emissor do FireHub não transmite NFC-e da UF "${uf}" (atende: ${atendidas.join(", ")}). ` +
        "Confira a UF do endereço fiscal em Dados da empresa."
    );
  }

  // ── Certificado A1 ───────────────────────────────────────────────────────
  const c = s.certificado;
  if (c?.arquivo) {
    if (!c.senhaCifrada) {
      falta("certificado", null, "Falta a senha do certificado digital A1. Envie o .pfx de novo com a senha.");
    }
    const ate = Date.parse(String(c.validoAte ?? ""));
    const de = Date.parse(String(c.validoDe ?? ""));
    if (!Number.isFinite(ate)) {
      falta("certificado", null, "A validade do certificado digital não foi lida no envio. Envie o .pfx de novo.");
    } else if (ate <= agora.getTime()) {
      falta(
        "certificado",
        String(c.validoAte),
        `O certificado digital venceu em ${dataBr(new Date(ate))}. Renove o A1 na certificadora e envie o novo — sem ele a SEFAZ recusa toda nota.`
      );
    }
    if (Number.isFinite(de) && de > agora.getTime()) {
      falta("certificado", String(c.validoDe), `O certificado digital só passa a valer em ${dataBr(new Date(de))}.`);
    }
    const doCertificado = alfanumerico(c.cnpj);
    const daLoja = alfanumerico(config?.cnpj);
    if (!doCertificado) {
      falta("certificado", null, "O CNPJ do certificado digital não foi lido no envio. Envie o .pfx de novo (tem de ser e-CNPJ A1).");
    } else if (daLoja.length === 14 && doCertificado.slice(0, 8) !== daLoja.slice(0, 8)) {
      falta(
        "certificado",
        doCertificado,
        `O certificado digital é do CNPJ ${doCertificado}, e o CNPJ desta loja é ${daLoja}: é de outra empresa ` +
          "(a SEFAZ recusa com a rejeição 213). Envie o A1 da própria loja (o da matriz vale para a filial)."
      );
    }
  }

  // ── CSC do ambiente ──────────────────────────────────────────────────────
  // A ausência é cobrada por `pendenciasDoEmitente` (cscId/csc); aqui só o formato.
  if (Number(s.qrVersao) !== 3) {
    const csc = s.csc?.[chaveDoAmbiente(config?.ambiente)] ?? null;
    if (csc?.id && !/^\d{1,6}$/.test(String(csc.id).trim())) {
      falta("cscId", String(csc.id), "O identificador do CSC tem de 1 a 6 dígitos (o \"ID do token\" que o portal da SEFAZ mostra).");
    }
  }
  if (s.qrVersao != null && ![2, 3].includes(Number(s.qrVersao))) {
    falta("qrVersao", s.qrVersao, "Versão do QR Code tem de ser 2 (com CSC) ou 3 (sem CSC).");
  }

  // ── Numeração ────────────────────────────────────────────────────────────
  // A série do bloco; sem ela, a do cadastro (a mesma ordem de `serieDoEmissor`,
  // que NÃO usa série fora da faixa — cairia calada na 1).
  const serie = s.serie != null ? s.serie : config?.serie != null && String(config.serie).trim() !== "" ? config.serie : null;
  if (serie != null && !serieValida(Number(serie))) {
    falta(
      "serie",
      serie,
      `Série da NFC-e do emissor próprio: de 1 a ${SERIE_MAXIMA}. A SEFAZ recusa série acima de ${SERIE_MAXIMA} na nota ` +
        "emitida pelo contribuinte (rejeições 244 e 503; a 890–919 é da nota avulsa do fisco)."
    );
  }
  if (s.numeroInicial != null && !(Number.isInteger(Number(s.numeroInicial)) && Number(s.numeroInicial) >= 1 && Number(s.numeroInicial) <= 999_999_999)) {
    falta("numeroInicial", s.numeroInicial, "Número inicial da NFC-e: de 1 a 999.999.999.");
  }

  return faltas;
}
