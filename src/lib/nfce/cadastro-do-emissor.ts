/**
 * /src/lib/nfce/cadastro-do-emissor.ts
 *
 * O cadastro do EMISSOR PRÓPRIO na tela fiscal: quem transmite (o FireHub ou
 * a Focus), o que o PUT de /api/store/fiscal aceita no bloco
 * `fiscalConfig.sefaz`, o retrato que a tela recebe (sem segredo nenhum), as
 * pendências e o checklist de prontidão.
 *
 * ── Por que um arquivo à parte ──────────────────────────────────────────────
 *
 * lib/fiscal-config (aplicarFormularioFiscal) cuida dos campos de sempre e não
 * conhece o bloco `sefaz` — ele passa intacto por lá. Aqui fica a regra do
 * bloco, pura como a de lá: dá para testar sem sessão, sem banco e sem
 * FISCAL_CHAVE (o `cifrar` entra por parâmetro).
 *
 * ── Segredos ────────────────────────────────────────────────────────────────
 *
 * O CSC entra aqui em claro, sai cifrado (lib/fiscal-credenciais → cifrar) e
 * nunca volta: a tela recebe o ID e os 4 últimos caracteres. O certificado e a
 * senha dele nem passam por aqui — são da rota /api/store/fiscal/certificado.
 */
import { finalDoCsc } from "../focus-empresas";
import { cnpjValido, inscricaoEstadualValida, pendenciasDoEmitente, type Problema } from "../fiscal-validacao";
import { camposEmTexto } from "../textos-da-tela-fiscal";
import { chaveDoAmbiente, configDoEmissorProprio, PROVEDOR_PROPRIO, provedorEfetivoDaLoja, type CertificadoDaLoja, type ConfigDoEmissorProprio, type CscDoAmbiente } from "./config-da-loja";
import { SERIE_MAXIMA } from "./pendencias";

export const PROVEDORES_DA_TELA = ["sefaz", "focusnfe"] as const;
export type ProvedorDaTela = (typeof PROVEDORES_DA_TELA)[number];

/**
 * A série sugerida para o emissor do FireHub.
 *
 * A NIK emitiu NFC-e pela Saipos antes. Se o FireHub começasse na série 1, o
 * primeiro número dele poderia já ter sido usado pela Saipos — nota com o mesmo
 * número e outra chave é rejeição 539 ("duplicidade de NF-e com diferença na
 * chave de acesso"), e o FireHub não tem como saber até onde a Saipos chegou.
 * Numa série nova a numeração começa limpa.
 */
export const SERIE_SUGERIDA = 2;
export const MOTIVO_DA_SERIE =
  "Se a loja já emitiu NFC-e por outro sistema (a NIK usou a Saipos), a série 1 pode ter números usados: número repetido na mesma série é rejeição 539. Numa série nova, a numeração do FireHub começa limpa.";

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim());
const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, "");

export const cnpjLimpo = (v: unknown): string => texto(v).toUpperCase().replace(/[^0-9A-Z]/g, "");
/** CNPJ-base (raiz): os 8 primeiros caracteres — o que a SEFAZ compara com o certificado (rejeição 213). */
export const raizDoCnpj = (v: unknown): string => cnpjLimpo(v).slice(0, 8);
export function cnpjFormatado(v: unknown): string {
  const c = cnpjLimpo(v);
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
}

// ─── QUEM TRANSMITE ─────────────────────────────────────────────────────────

/**
 * O emissor que vale para a loja: a regra é `provedorEfetivoDaLoja`
 * (lib/nfce/config-da-loja), a mesma de quem emite. O `padrao` diz à tela
 * que nada está gravado ainda (o primeiro Salvar grava "sefaz" —
 * lib/fiscal-config → comPadroesDeGravacao).
 */
export function provedorEfetivo(config: Record<string, unknown>): { provedor: ProvedorDaTela; gravado: string | null; padrao: boolean } {
  const gravado = texto(config.provedor) || null;
  return { provedor: provedorEfetivoDaLoja(config), gravado, padrao: gravado !== "sefaz" && gravado !== "focusnfe" };
}

/**
 * O `provedor` que o PUT aceita. "focusnfe" ainda passa por aqui porque o
 * "Salvar Dados" da loja antiga manda o gravado de volta; entrar na Focus é
 * barrado no PUT (a Focus não é mais oferecida desde 09/10/2026).
 */
export function lerProvedor(valor: unknown): { ok: true; provedor: ProvedorDaTela } | { ok: false; mensagem: string } {
  const v = texto(valor).toLowerCase();
  if (v === "sefaz" || v === "focusnfe") return { ok: true, provedor: v };
  return { ok: false, mensagem: "Emissor desconhecido. O emissor é o do FireHub (\"sefaz\")." };
}

// ─── O BLOCO `sefaz` NO PUT ─────────────────────────────────────────────────

export type OpcoesDoFormularioDoEmissor = {
  papel: string | null | undefined;
  cifrar: (segredo: string) => string | null;
  /** A emissão está ligada E pelo emissor próprio: série, número e CSC em uso não se trocam no meio. */
  emissaoLigadaNoProprio: boolean;
  /** O ambiente em que a loja emite (1 produção, 2 homologação). */
  ambiente: 1 | 2;
};

export type ResultadoDoFormularioDoEmissor =
  | { ok: true; sefaz: ConfigDoEmissorProprio; mudou: boolean; recusados: string[]; avisos: string[] }
  | { ok: false; status: 400 | 409; corpo: { error: string; mensagem: string } };

function inteiro(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Aplica o `sefaz` do corpo do PUT sobre o bloco gravado.
 *
 * STAFF não muda nada daqui (é identidade fiscal: série, numeração, CSC): o
 * que ele tentou mudar volta em `recusados`, como nos outros campos do
 * titular. Com a emissão ligada no emissor próprio, série, número inicial e o
 * CSC do ambiente em uso não se trocam — a próxima nota sairia com a
 * numeração ou o QR Code errados.
 */
export function aplicarFormularioDoEmissor(
  atualBruto: ConfigDoEmissorProprio | null | undefined,
  corpo: unknown,
  opcoes: OpcoesDoFormularioDoEmissor
): ResultadoDoFormularioDoEmissor {
  const atual: ConfigDoEmissorProprio = { ...(atualBruto ?? {}) };
  const c = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null;
  if (!c) return { ok: true, sefaz: atual, mudou: false, recusados: [], avisos: [] };

  const erro = (status: 400 | 409, error: string, mensagem: string): ResultadoDoFormularioDoEmissor => ({ ok: false, status, corpo: { error, mensagem } });
  const novo: ConfigDoEmissorProprio = { ...atual };
  const recusados: string[] = [];
  const avisos: string[] = [];
  let mudou = false;
  const titular = opcoes.papel !== "STAFF";

  // ── série e número inicial ──
  // Série até 889 (SERIE_MAXIMA, lib/nfce/pendencias): 890–999 são de emissão
  // avulsa/SCAN, recusadas para CNPJ com procEmi 0 (MOC B26-10 → 244).
  const numeros: Array<{ campo: "serie" | "numeroInicial"; max: number; nome: string }> = [
    { campo: "serie", max: SERIE_MAXIMA, nome: `Série da NFC-e: um número de 1 a ${SERIE_MAXIMA}.` },
    { campo: "numeroInicial", max: 999_999_999, nome: "Número inicial: de 1 a 999.999.999." },
  ];
  for (const { campo, max, nome } of numeros) {
    if (!(campo in c)) continue;
    const n = inteiro(c[campo]);
    if (n === null || n < 1 || n > max) return erro(400, `${campo}_invalido`, nome);
    if (n === atual[campo]) continue;
    if (!titular) {
      recusados.push(`sefaz.${campo}`);
      continue;
    }
    if (opcoes.emissaoLigadaNoProprio && atual[campo] != null) {
      return erro(
        409,
        "emissao_ligada",
        campo === "serie"
          ? "Desligue a emissão antes de trocar a série: as notas em andamento usam a numeração da série atual."
          : "Desligue a emissão antes de trocar o número inicial: a numeração em uso continuaria de onde está."
      );
    }
    novo[campo] = n;
    mudou = true;
  }

  // ── QR Code ──
  // O titular que salva grava o valor explícito (mesmo o padrão): o bloco
  // gravado passa a dizer o que vale, em vez de depender do padrão de quem lê.
  // Para o STAFF, "mudar" é em relação ao que a tela mostrou (o padrão).
  if ("qrVersao" in c) {
    const v = inteiro(c.qrVersao);
    if (v !== 2 && v !== 3) return erro(400, "qr_invalido", "Versão do QR Code: 2 ou 3.");
    if (v !== atual.qrVersao) {
      if (!titular) {
        if (v !== (atual.qrVersao ?? 2)) recusados.push("sefaz.qrVersao");
      } else {
        novo.qrVersao = v;
        mudou = true;
      }
    }
    if (v === 3) {
      avisos.push(
        "QR Code versão 3 (NT 2025.001): dispensa o CSC na nota on-line, mas só vale na UF que já a aceita — se a SEFAZ da sua UF ainda não aceitar, toda nota volta rejeitada. Teste em homologação antes de usar em produção."
      );
    }
  }

  // ── contingência off-line ──
  if ("contingenciaOffline" in c && typeof c.contingenciaOffline === "boolean") {
    if (c.contingenciaOffline !== atual.contingenciaOffline) {
      if (!titular) {
        if (c.contingenciaOffline !== (atual.contingenciaOffline ?? true)) recusados.push("sefaz.contingenciaOffline");
      } else {
        novo.contingenciaOffline = c.contingenciaOffline;
        mudou = true;
      }
    }
  }

  // ── CSC por ambiente ──
  const cscCorpo = c.csc && typeof c.csc === "object" && !Array.isArray(c.csc) ? (c.csc as Record<string, unknown>) : null;
  if (cscCorpo) {
    for (const amb of ["homologacao", "producao"] as const) {
      if (!(amb in cscCorpo)) continue;
      const nomeDoAmb = amb === "producao" ? "produção" : "homologação";
      const valor = cscCorpo[amb];
      const atualDoAmb = atual.csc?.[amb] ?? null;
      // null = remover.
      if (valor === null) {
        if (!atualDoAmb) continue;
        if (!titular) {
          recusados.push(`sefaz.csc.${amb}`);
          continue;
        }
        const emUso = opcoes.emissaoLigadaNoProprio && chaveDoAmbiente(opcoes.ambiente) === amb && (novo.qrVersao ?? 2) === 2;
        if (emUso) {
          return erro(409, "csc_em_uso", `Não dá para remover o CSC de ${nomeDoAmb} com a emissão ligada nesse ambiente: toda venda seria recusada.`);
        }
        novo.csc = { ...(novo.csc ?? {}), [amb]: null };
        mudou = true;
        continue;
      }
      if (!valor || typeof valor !== "object") continue;
      const v = valor as Record<string, unknown>;
      const id = texto(v.id);
      // O CSC não leva trim no meio, mas espaço nas pontas é sempre cópia mal feita.
      const codigo = texto(v.codigo);
      if (!codigo) {
        // Só o ID, sem o código: o ID sozinho não serve (o hash do QR é do par).
        if (id && atualDoAmb && soDigitos(id) !== soDigitos(atualDoAmb.id)) {
          avisos.push(`Para trocar o ID do CSC de ${nomeDoAmb}, digite o CSC junto — o ID sozinho não foi gravado.`);
        } else if (id && !atualDoAmb) {
          avisos.push(`O ID do CSC de ${nomeDoAmb} não foi gravado sem o código do CSC.`);
        }
        continue;
      }
      if (!titular) {
        recusados.push(`sefaz.csc.${amb}`);
        continue;
      }
      // As mesmas regras do cadastro na Focus (lib/focus-empresas → conferirPedidoDeCadastro).
      if (!/^\d{1,6}$/.test(id)) return erro(400, "csc_invalido", `O ID do CSC de ${nomeDoAmb} é um número curto (ex.: 000001 ou 1).`);
      if (!/^[A-Za-z0-9-]{6,64}$/.test(codigo)) {
        return erro(400, "csc_invalido", `O CSC de ${nomeDoAmb} tem letras e números, sem espaços. Copie de novo do portal da SEFAZ.`);
      }
      const cifrado = opcoes.cifrar(codigo);
      if (!cifrado) return erro(400, "csc_invalido", `Não consegui guardar o CSC de ${nomeDoAmb}. Tente de novo.`);
      const registro: CscDoAmbiente = { id, cifrado, final: finalDoCsc(codigo) };
      novo.csc = { ...(novo.csc ?? {}), [amb]: registro };
      mudou = true;
    }
  }

  return { ok: true, sefaz: novo, mudou, recusados, avisos };
}

// ─── O RETRATO PARA A TELA ──────────────────────────────────────────────────

export type SituacaoDoA1 = "vencido" | "vence_em_breve" | "ok" | "ainda_nao_vale";

export type CertificadoNaTela = {
  titular: string;
  cnpj: string;
  cnpjFormatado: string;
  validoDe: string;
  validoAte: string;
  enviadoEm: string;
  /** Dias inteiros até vencer (negativo = vencido). */
  dias: number;
  situacao: SituacaoDoA1;
  /** O CNPJ-base do certificado é o da loja? null = a loja ainda não tem CNPJ gravado. */
  mesmaEmpresa: boolean | null;
  /** Certificado de outro estabelecimento (filial/matriz) da mesma empresa. */
  outroEstabelecimento: boolean;
};

export type EmissorNaTela = {
  certificado: CertificadoNaTela | null;
  csc: { homologacao: { id: string; final: string } | null; producao: { id: string; final: string } | null };
  serie: number | null;
  serieSugerida: number;
  motivoDaSerie: string;
  numeroInicial: number | null;
  qrVersao: 2 | 3;
  contingenciaOffline: boolean;
  ultimoTeste: ConfigDoEmissorProprio["ultimoTeste"] | null;
  /** Certificado válido da empresa + CSC do ambiente (ou QR v3): o que o ambiente precisa do emissor. */
  prontoNoAmbiente: { homologacao: boolean; producao: boolean };
};

export function situacaoDoA1(cert: Pick<CertificadoDaLoja, "validoDe" | "validoAte">, agora: Date = new Date()): { dias: number; situacao: SituacaoDoA1 } {
  const fim = new Date(cert.validoAte);
  const inicio = new Date(cert.validoDe);
  const dias = Number.isNaN(fim.getTime()) ? -1 : Math.floor((fim.getTime() - agora.getTime()) / 86_400_000);
  if (Number.isNaN(fim.getTime()) || fim.getTime() <= agora.getTime()) return { dias, situacao: "vencido" };
  if (!Number.isNaN(inicio.getTime()) && inicio.getTime() > agora.getTime()) return { dias, situacao: "ainda_nao_vale" };
  // O A1 vence sem avisar: o alerta começa 30 dias antes — o tempo de comprar
  // outro na certificadora e mandar de novo (o mesmo de lib/fiscal-config).
  return { dias, situacao: dias <= 30 ? "vence_em_breve" : "ok" };
}

function certificadoNaTela(cert: CertificadoDaLoja | null | undefined, cnpjDaLoja: string, agora: Date): CertificadoNaTela | null {
  if (!cert || !texto(cert.arquivo)) return null;
  const { dias, situacao } = situacaoDoA1(cert, agora);
  const temCnpjDaLoja = cnpjDaLoja.length === 14;
  return {
    // O CN do e-CNPJ é "RAZÃO SOCIAL:CNPJ" (DOC-ICP-04); o CNPJ já vem em campo
    // próprio, então a tela mostra só o nome.
    titular: texto(cert.titular).replace(/:[0-9A-Z]{14}$/i, ""),
    cnpj: cnpjLimpo(cert.cnpj),
    cnpjFormatado: cnpjFormatado(cert.cnpj),
    validoDe: texto(cert.validoDe),
    validoAte: texto(cert.validoAte),
    enviadoEm: texto(cert.enviadoEm),
    dias,
    situacao,
    mesmaEmpresa: temCnpjDaLoja ? raizDoCnpj(cert.cnpj) === raizDoCnpj(cnpjDaLoja) : null,
    outroEstabelecimento: temCnpjDaLoja && raizDoCnpj(cert.cnpj) === raizDoCnpj(cnpjDaLoja) && cnpjLimpo(cert.cnpj) !== cnpjDaLoja,
  };
}

/** O que a tela pode ver do bloco `sefaz`: nada de caminho do cofre, hash, senha ou CSC. */
export function emissorParaTela(config: Record<string, unknown>, agora: Date = new Date()): EmissorNaTela {
  const s = configDoEmissorProprio(config);
  const cnpjDaLoja = cnpjLimpo(config.cnpj);
  const certificado = certificadoNaTela(s.certificado, cnpjDaLoja, agora);
  const csc = {
    homologacao: s.csc?.homologacao ? { id: texto(s.csc.homologacao.id), final: texto(s.csc.homologacao.final) } : null,
    producao: s.csc?.producao ? { id: texto(s.csc.producao.id), final: texto(s.csc.producao.final) } : null,
  };
  const qrVersao: 2 | 3 = s.qrVersao === 3 ? 3 : 2;
  const certOk = Boolean(certificado && (certificado.situacao === "ok" || certificado.situacao === "vence_em_breve") && certificado.mesmaEmpresa !== false);
  return {
    certificado,
    csc,
    serie: Number.isInteger(s.serie) && Number(s.serie) >= 1 ? Number(s.serie) : null,
    serieSugerida: SERIE_SUGERIDA,
    motivoDaSerie: MOTIVO_DA_SERIE,
    numeroInicial: Number.isInteger(s.numeroInicial) && Number(s.numeroInicial) >= 1 ? Number(s.numeroInicial) : null,
    qrVersao,
    contingenciaOffline: s.contingenciaOffline !== false,
    ultimoTeste: s.ultimoTeste ?? null,
    prontoNoAmbiente: {
      homologacao: certOk && (qrVersao === 3 || Boolean(csc.homologacao)),
      producao: certOk && (qrVersao === 3 || Boolean(csc.producao)),
    },
  };
}

// ─── A CONFERÊNCIA DA TELA E DO LIGAR ───────────────────────────────────────

/**
 * A conferência que a tela mostra e que o PUT de ligar exige, a partir da
 * conferência da EMISSÃO (lib/fiscal-emissao → pendenciasParaEmitir, que para
 * o emissor próprio usa lib/nfce/pendencias: certificado, CSC do ambiente, UF).
 * Uma fonte só: a tela não pode dizer "pronto" para o que a emissão recusa.
 *
 * Duas coisas a mais, só aqui:
 *  - a SÉRIE do emissor próprio tem de ser escolhida. A emissão aceita cair na
 *    série do cadastro (1), mas a loja que emitiu por outro sistema (a NIK, pela
 *    Saipos) teria cada número já usado rejeitado (539) — um por venda, até
 *    passar do último da Saipos. Exigir a escolha no LIGAR é o que evita isso;
 *  - sem emissor escolhido, a frase da pendência "provedor" diz as duas saídas.
 */
export function conferirComEmissorProprio(base: Problema[], config: Record<string, unknown>): Problema[] {
  if (provedorEfetivoDaLoja(config) !== PROVEDOR_PROPRIO) {
    if (texto(config.provedor)) return base;
    // Loja antiga na Focus (token, empresa cadastrada) sem a escolha gravada:
    // a Focus não é mais oferecida, então a saída é uma só.
    return base.map((p) =>
      p.campo === "provedor"
        ? {
            ...p,
            mensagem:
              "Esta loja tem um cadastro antigo na Focus NFe e nenhum emissor gravado. A Focus não é mais oferecida: " +
              "passe para o Emissor do FireHub em Configurações fiscais (botão \"Passar para o Emissor do FireHub\").",
          }
        : p
    );
  }
  const serie = configDoEmissorProprio(config).serie;
  if (Number.isInteger(serie) && Number(serie) >= 1) return base;
  return [
    ...base.filter((p) => p.campo !== "serie"),
    {
      campo: "serie",
      valor: null,
      mensagem: `Escolha a série da NFC-e do Emissor do FireHub (sugerimos a ${SERIE_SUGERIDA}: ${MOTIVO_DA_SERIE})`,
    },
  ];
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// ─── CHECKLIST DE PRONTIDÃO ─────────────────────────────────────────────────

export type ItemDeProntidao = {
  chave: "certificado" | "csc" | "ie" | "empresa" | "ncm" | "conexao" | "respTec" | "homologacao" | "notaDeTeste" | "producao";
  rotulo: string;
  ok: boolean;
  detalhe: string;
};

/**
 * O caminho até a primeira nota de verdade, na ordem em que se faz:
 * certificado → CSC → IE → dados da empresa → NCM dos produtos → conexão →
 * emissão ligada em homologação → primeira nota de teste → produção.
 *
 * É a lista que separa "acho que está configurado" de "sei o que falta" — e
 * cada item diz ONDE resolver.
 */
export function prontidaoDoEmissor(
  config: Record<string, unknown>,
  extras: {
    produtosSemNcm: number;
    totalDeProdutos: number;
    temNotaDeHomologacao: boolean;
    /** O servidor tem FH_RESP_TEC_* completo (infRespTec)? Ausente = não conferido (não acusa). */
    responsavelTecnicoOk?: boolean;
    agora?: Date;
  }
): ItemDeProntidao[] {
  const agora = extras.agora ?? new Date();
  const tela = emissorParaTela(config, agora);
  const cert = tela.certificado;
  const uf = texto(config.uf).toUpperCase();
  const ie = texto(config.inscricaoEstadual);
  const ieOk = Boolean(ie) && !/^ISENT[OA]$/i.test(ie) && inscricaoEstadualValida(ie, uf);
  const ligada = config.enabled === true;
  const ambiente = Number(config.ambiente) === 1 ? 1 : 2;
  // Os dados do emitente que o FireHub confere antes de mandar à SEFAZ — sem
  // os do provedor (CSC, certificado, série), que têm linha própria aqui.
  const doEmitente = pendenciasDoEmitente({
    cnpj: texto(config.cnpj),
    inscricaoEstadual: ie,
    razaoSocial: texto(config.razaoSocial),
    regimeTributario: config.regimeTributario as number | null,
    logradouro: texto(config.logradouro),
    numero: texto(config.numero),
    bairro: texto(config.bairro),
    municipio: texto(config.municipio),
    codigoMunicipio: texto(config.codigoMunicipio),
    uf,
    cep: texto(config.cep),
    serie: 1,
    ambiente: 2,
    cscId: "x",
    csc: "x",
    temCertificado: true,
  }).filter((p) => p.campo !== "inscricaoEstadual");
  const ultimo = tela.ultimoTeste;
  const conexaoOk = Boolean(ultimo && ultimo.ok && ultimo.ambiente === 2);

  const itens: ItemDeProntidao[] = [
    {
      chave: "certificado",
      rotulo: "Certificado digital A1",
      ok: Boolean(cert && (cert.situacao === "ok" || cert.situacao === "vence_em_breve") && cert.mesmaEmpresa !== false),
      detalhe: !cert
        ? "Envie o .pfx e a senha em \"Certificado digital\"."
        : cert.situacao === "vencido"
          ? `Venceu em ${dataCurta(cert.validoAte)} — envie o novo.`
          : cert.mesmaEmpresa === false
            ? `É do CNPJ ${cert.cnpjFormatado}, de outra empresa.`
            : `${cert.titular} · vale até ${dataCurta(cert.validoAte)}${cert.situacao === "vence_em_breve" ? ` (faltam ${cert.dias} dia(s) — renove já)` : ""}.`,
    },
    {
      chave: "csc",
      rotulo: "CSC de homologação e de produção",
      ok: tela.qrVersao === 3 || (Boolean(tela.csc.homologacao) && Boolean(tela.csc.producao)),
      detalhe:
        tela.qrVersao === 3
          ? "QR Code versão 3: o CSC não é usado na nota on-line."
          : [
              tela.csc.homologacao ? `homologação ✓ (ID ${tela.csc.homologacao.id})` : "falta o de homologação",
              tela.csc.producao ? `produção ✓ (ID ${tela.csc.producao.id})` : "falta o de produção",
            ].join(" · "),
    },
    {
      chave: "ie",
      rotulo: "Inscrição Estadual",
      ok: ieOk,
      detalhe: ieOk ? ie : uf === "DF" ? "Digite o CF/DF (13 dígitos) em \"Dados da empresa\" — a Receita Federal não informa." : "Digite a IE em \"Dados da empresa\" — a Receita Federal não informa.",
    },
    {
      chave: "empresa",
      rotulo: "Dados da empresa e endereço fiscal",
      ok: doEmitente.length === 0,
      // O rótulo do formulário, não o nome interno: "Falta: CNPJ, Razão
      // social, Regime tributário…" — e não "cnpj, razaoSocial, regimeTributario".
      detalhe: doEmitente.length === 0 ? "Completos." : `Falta: ${camposEmTexto(doEmitente)}.`,
    },
    {
      chave: "ncm",
      rotulo: "NCM dos produtos",
      ok: extras.totalDeProdutos > 0 && extras.produtosSemNcm === 0,
      detalhe:
        extras.produtosSemNcm === 0
          ? `${extras.totalDeProdutos} produto(s) com NCM.`
          : `${extras.produtosSemNcm} de ${extras.totalDeProdutos} produto(s) sem NCM — aba Produtos, com a sugestão por categoria.`,
    },
    {
      chave: "conexao",
      rotulo: "Conexão com a SEFAZ (homologação)",
      ok: conexaoOk,
      detalhe: ultimo
        ? `${ultimo.ok ? "OK" : "Falhou"} em ${dataCurta(ultimo.quando)}${ultimo.cStat ? ` (cStat ${ultimo.cStat})` : ""}: ${ultimo.mensagem}`
        : "Use \"Testar conexão com a SEFAZ\".",
    },
    {
      // É do FireHub, não da loja: o grupo infRespTec (NT 2018.005) leva o
      // CNPJ e o contato de quem fez o software, e várias UF recusam a nota
      // sem ele (972). Fica no checklist para ninguém descobrir na recusa.
      chave: "respTec",
      rotulo: "Responsável técnico do software (FireHub)",
      ok: extras.responsavelTecnicoOk !== false,
      detalhe:
        extras.responsavelTecnicoOk !== false
          ? "Configurado no servidor do FireHub."
          : "O FireHub ainda não configurou o responsável técnico (infRespTec) no servidor: em vários estados a SEFAZ recusa a nota sem ele (rejeição 972). É com o suporte do FireHub, não com a loja.",
    },
    {
      chave: "homologacao",
      rotulo: "Emissão ligada em homologação",
      ok: ligada,
      detalhe: ligada ? (ambiente === 1 ? "Ligada (já em produção)." : "Ligada em homologação.") : "Ligue no topo da tela, em homologação.",
    },
    {
      chave: "notaDeTeste",
      rotulo: "Primeira nota de teste autorizada",
      ok: extras.temNotaDeHomologacao,
      detalhe: extras.temNotaDeHomologacao ? "Há nota de homologação autorizada." : "Emita uma nota em homologação e confira o DANFE.",
    },
    {
      chave: "producao",
      rotulo: "Produção",
      ok: ligada && ambiente === 1,
      detalhe: ligada && ambiente === 1 ? "Emitindo com valor fiscal." : "Por último: passe para produção no topo da tela.",
    },
  ];
  return itens;
}

/** O identificador do emissor próprio, reexportado para a rota não importar config-da-loja à parte. */
export { PROVEDOR_PROPRIO };

/** CNPJ gravado ou o do cadastro da loja — o que o certificado precisa bater. */
export function cnpjParaConferir(config: Record<string, unknown>, documentoDaLoja: unknown): string | null {
  const gravado = cnpjLimpo(config.cnpj);
  if (gravado.length === 14 && cnpjValido(gravado)) return gravado;
  const doc = cnpjLimpo(documentoDaLoja);
  if (doc.length === 14 && cnpjValido(doc)) return doc;
  return null;
}
