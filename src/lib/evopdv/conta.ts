/**
 * /src/lib/evopdv/conta.ts
 *
 * A CONTA FISCAL do EvoPDV no FireHub — "tudo nos bastidores" (decisão do
 * Douglas, 25/10/2026): o lojista nunca vê o FireHub. Uma conta por CNPJ,
 * criada pelo PROVISIONAMENTO servidor-a-servidor (a Vercel do EvoPDV chama
 * POST /api/integracoes/evopdv/provisionar com o segredo compartilhado) e
 * devolve a CHAVE Bearer da loja, que o EvoPDV guarda cifrada (safeStorage).
 *
 * ── A conta ─────────────────────────────────────────────────────────────────
 *
 *  - `User` com role "EVOPDV": fora das listas do Admin, da cobrança, do CRM e
 *    de tudo que filtra role "FRANCHISEE"; `planPercent` 0, isenta pelo
 *    `lojaIsenta` (lib/billing); e-mail interno `evopdv-<cnpj>@evopdv.invalid`
 *    (domínio reservado: nada é entregue) e senha aleatória que ninguém tem —
 *    não há login. Não passa pelo /api/register: nada de e-mail, CRM ou Meta.
 *  - `fiscalConfig` com o emissor próprio ("sefaz"), homologação, contingência
 *    ligada (padrão da casa) e `origem: "evopdv"`. A série padrão é a 2
 *    (SERIE_SUGERIDA, lib/nfce/cadastro-do-emissor): o lojista emitia pela
 *    Focus, e número repetido na mesma série é rejeição 539. Se o MESMO CNPJ
 *    for uma loja do FireHub, a série dela não é usada (as duas contas não
 *    enxergam a numeração uma da outra).
 *  - `IntegracaoEvopdv`: o CNPJ, o sha256 da chave (a chave em claro só sai na
 *    resposta do provisionamento) e o cache da assinatura (lib/evopdv/assinatura).
 *
 * O A1, a senha e o CSC chegam pela API (rotas /certificado e /config), com as
 * MESMAS conferências da tela fiscal (lib/nfce/envio-do-certificado e
 * cadastro-do-emissor → aplicarFormularioDoEmissor).
 *
 * Só servidor.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cifrar } from "@/lib/fiscal-credenciais";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { pendenciasParaEmitir, type ConfiguracaoFiscal } from "@/lib/fiscal-emissao";
import { cnpjValido } from "@/lib/fiscal-validacao";
import { notasEmAndamentoDaLoja, respostaDeNotasEmAndamento } from "@/lib/fiscal-notas-em-andamento";
import { guardarArquivoFiscal } from "@/lib/nfce/armazenamento";
import { SERIE_SUGERIDA, aplicarFormularioDoEmissor, cnpjLimpo, emissorParaTela } from "@/lib/nfce/cadastro-do-emissor";
import { PROVEDOR_PROPRIO, configDoEmissorProprio } from "@/lib/nfce/config-da-loja";
import { apagarDoCofre, conferirCertificadoEnviado, identificacaoDoA1, registroDoCertificado } from "@/lib/nfce/envio-do-certificado";
import { alterarFiscalConfig } from "@/lib/nfce/gravar-config-fiscal";
import { SERIE_MAXIMA, serieDoEmissor, ufsDoEmissorProprio } from "@/lib/nfce/pendencias";
import { sefazBloqueadaAte } from "@/lib/nfce/emissao-da-loja";
import { situacaoDaAssinatura } from "./assinatura";

export const ROLE_DA_CONTA = "EVOPDV";
export const ORIGEM = "evopdv";

type Registro = Record<string, any>;
const objeto = (v: unknown): Registro => (v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : {});
const texto = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : "");

export type Resposta = { status: number; corpo: Record<string, unknown> };

// ── A chave Bearer ───────────────────────────────────────────────────────────

export const hashDaChave = (chave: string) => createHash("sha256").update(`evopdv:${chave}`).digest("hex");
export function novaChave(): { chave: string; chaveHash: string } {
  const chave = `evo_${randomBytes(32).toString("hex")}`;
  return { chave, chaveHash: hashDaChave(chave) };
}

export type ContaEvopdv = {
  integracaoId: string;
  lojaId: string;
  cnpj: string;
  email: string | null;
  assinatura: unknown;
  /** O fiscalConfig normalizado (o que a emissão lê). */
  config: ConfiguracaoFiscal & Registro;
};

/** A conta dona da chave que veio no `Authorization: Bearer`, ou null. */
export async function contaDaChave(authorization: string | null | undefined): Promise<ContaEvopdv | null> {
  const chave = String(authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^evo_[0-9a-f]{64}$/.test(chave)) return null;
  const integ = await prisma.integracaoEvopdv.findUnique({ where: { chaveHash: hashDaChave(chave) } });
  if (!integ) return null;
  const loja = await prisma.user.findUnique({ where: { id: integ.franchiseeId }, select: { id: true, role: true, fiscalConfig: true } });
  if (!loja || loja.role !== ROLE_DA_CONTA) return null;
  return {
    integracaoId: integ.id,
    lojaId: loja.id,
    cnpj: integ.cnpj,
    email: integ.email,
    assinatura: integ.assinatura,
    config: normalizarConfigFiscal(loja.fiscalConfig) as ConfiguracaoFiscal & Registro,
  };
}

/** O segredo do provisionamento (EVOPDV_PROVISIONAMENTO_SEGREDO), comparado em tempo constante. */
export function segredoDoProvisionamento(authorization: string | null | undefined, env: Record<string, string | undefined> = process.env): "ok" | "sem_segredo" | "errado" {
  const esperado = String(env.EVOPDV_PROVISIONAMENTO_SEGREDO ?? "").trim();
  if (esperado.length < 32) return "sem_segredo";
  const veio = String(authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = createHash("sha256").update(veio).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b) ? "ok" : "errado";
}

// ── Os dados da empresa ──────────────────────────────────────────────────────

const CAMPOS_DA_EMPRESA = [
  "razaoSocial",
  "nomeFantasia",
  "inscricaoEstadual",
  "regimeTributario",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "municipio",
  "codigoMunicipio",
  "uf",
  "cep",
  "telefone",
] as const;

/**
 * Os dados da empresa que vieram (só os campos conhecidos), já limpos. O que
 * falta ou está errado para emitir a pendência da emissão diz (GET /status) —
 * aqui só a forma, para nada torto entrar no cadastro.
 */
export function lerDadosDaEmpresa(corpo: unknown): { ok: true; dados: Registro } | { ok: false; erros: Array<{ campo: string; mensagem: string }> } {
  const c = objeto(corpo);
  const dados: Registro = {};
  const erros: Array<{ campo: string; mensagem: string }> = [];
  for (const campo of CAMPOS_DA_EMPRESA) {
    if (!(campo in c)) continue;
    const v = texto(c[campo]);
    dados[campo] = v || null;
  }
  if ("regimeTributario" in dados && dados.regimeTributario != null) {
    const r = Number(dados.regimeTributario);
    if (![1, 2, 3, 4].includes(r)) erros.push({ campo: "regimeTributario", mensagem: "CRT: 1 (Simples), 2 (Simples, excesso de sublimite), 3 (Regime Normal) ou 4 (MEI)." });
    else dados.regimeTributario = r;
  }
  if (dados.uf) dados.uf = String(dados.uf).toUpperCase();
  if (dados.uf && !/^[A-Z]{2}$/.test(dados.uf)) erros.push({ campo: "uf", mensagem: "UF com 2 letras." });
  if (dados.codigoMunicipio) dados.codigoMunicipio = String(dados.codigoMunicipio).replace(/\D/g, "");
  if (dados.codigoMunicipio && !/^\d{7}$/.test(dados.codigoMunicipio)) erros.push({ campo: "codigoMunicipio", mensagem: "Código IBGE do município: 7 dígitos." });
  if (dados.cep) dados.cep = String(dados.cep).replace(/\D/g, "");
  if (dados.cep && !/^\d{8}$/.test(dados.cep)) erros.push({ campo: "cep", mensagem: "CEP: 8 dígitos." });
  return erros.length ? { ok: false, erros } : { ok: true, dados };
}

/** As séries que OUTRA conta do FireHub com o mesmo CNPJ usa (uma loja que também emite pelo painel). */
async function seriesDoMesmoCnpj(cnpj: string): Promise<number[]> {
  const linhas: Array<{ id: string; fiscalConfig: unknown }> = await prisma.$queryRaw(Prisma.sql`/* fh:series-do-mesmo-cnpj */
    SELECT "id", "fiscalConfig" FROM "User"
    WHERE "role" <> ${ROLE_DA_CONTA}
      AND (
        upper(regexp_replace(coalesce("fiscalConfig"->>'cnpj', ''), '[^0-9A-Za-z]', '', 'g')) = ${cnpj}
        OR upper(regexp_replace(coalesce("cpfCnpj", ''), '[^0-9A-Za-z]', '', 'g')) = ${cnpj}
      )`);
  return [...new Set(linhas.map((l) => serieDoEmissor(l.fiscalConfig as any)))];
}

// ── O provisionamento ────────────────────────────────────────────────────────

/**
 * Cria (ou acha) a conta fiscal do CNPJ e devolve uma chave NOVA. Chamar de
 * novo com o mesmo CNPJ (reinstalação, chave perdida) troca a chave — a
 * anterior para de valer — e atualiza os dados da empresa e o e-mail.
 */
export async function provisionarConta(corpo: unknown, agora: Date = new Date()): Promise<Resposta> {
  const c = objeto(corpo);
  const cnpj = cnpjLimpo(c.cnpj);
  if (cnpj.length !== 14 || !cnpjValido(cnpj)) return { status: 422, corpo: { error: "cnpj_invalido", mensagem: "CNPJ inválido (14 posições, com os dígitos verificadores)." } };
  const email = texto(c.email).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: 422, corpo: { error: "email_invalido", mensagem: "E-mail da licença inválido." } };
  const lidos = lerDadosDaEmpresa(c);
  if (!lidos.ok) return { status: 422, corpo: { error: "dados_invalidos", erros: lidos.erros } };
  if (!lidos.dados.razaoSocial) return { status: 422, corpo: { error: "dados_invalidos", erros: [{ campo: "razaoSocial", mensagem: "Razão social obrigatória." }] } };

  let serie: number | null = null;
  if (c.serie != null && c.serie !== "") {
    const s = Number(c.serie);
    if (!Number.isInteger(s) || s < 1 || s > SERIE_MAXIMA) return { status: 422, corpo: { error: "serie_invalida", mensagem: `Série da NFC-e: de 1 a ${SERIE_MAXIMA}.` } };
    serie = s;
  }
  let numeroInicial: number | null = null;
  if (c.numeroInicial != null && c.numeroInicial !== "") {
    const n = Number(c.numeroInicial);
    if (!Number.isInteger(n) || n < 1 || n > 999_999_999) return { status: 422, corpo: { error: "numero_inicial_invalido", mensagem: "Número inicial: de 1 a 999.999.999." } };
    numeroInicial = n;
  }

  const existente = await prisma.integracaoEvopdv.findUnique({ where: { cnpj } });
  const { chave, chaveHash } = novaChave();

  if (existente) {
    // Reinstalação: chave nova, dados atualizados. A série não muda aqui (a
    // numeração em uso continuaria de onde está) — troca é pela /config.
    await prisma.integracaoEvopdv.update({ where: { id: existente.id }, data: { chaveHash, ...(email ? { email } : {}) } });
    await alterarFiscalConfig(existente.franchiseeId, (bruto) => ({ gravar: { ...objeto(bruto), ...lidos.dados }, resposta: null }));
    return { status: 200, corpo: { success: true, criada: false, chave, cnpj, mensagem: "Conta fiscal já existia: a chave foi trocada (a anterior não vale mais) e os dados da empresa, atualizados." } };
  }

  // Loja do FireHub com o mesmo CNPJ: a série dela fica de fora.
  const usadas = await seriesDoMesmoCnpj(cnpj);
  if (serie != null && usadas.includes(serie)) {
    return { status: 409, corpo: { error: "serie_em_uso", mensagem: `A série ${serie} já é usada por outra conta do FireHub com este CNPJ: número repetido na mesma série é rejeição 539. Escolha outra.`, seriesEmUso: usadas } };
  }
  if (serie == null) {
    serie = SERIE_SUGERIDA;
    while (usadas.includes(serie)) serie++;
  }

  const fiscalConfig: Registro = {
    origem: ORIGEM,
    provedor: PROVEDOR_PROPRIO,
    enabled: true,
    emissaoLigadaEm: agora.toISOString(),
    // Nenhuma nota "automática": não há pedido. A nota sai quando o EvoPDV pede.
    autoEmitPaymentMethods: [],
    ambiente: 2,
    cnpj,
    ...lidos.dados,
    imprimirDanfe: false,
    sefaz: { serie, ...(numeroInicial ? { numeroInicial } : {}), qrVersao: 2, contingenciaOffline: true, imprimirDanfe: false },
  };
  const senha = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  try {
    const criada = await prisma.$transaction(async (tx) => {
      const loja = await tx.user.create({
        data: {
          name: String(lidos.dados.razaoSocial),
          storeName: String(lidos.dados.nomeFantasia || lidos.dados.razaoSocial),
          email: `evopdv-${cnpj.toLowerCase()}@evopdv.invalid`,
          password: senha,
          role: ROLE_DA_CONTA,
          planPercent: 0,
          cpfCnpj: cnpj,
          fiscalConfig: fiscalConfig as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.integracaoEvopdv.create({ data: { franchiseeId: loja.id, cnpj, chaveHash, email } });
      return loja;
    });
    return { status: 201, corpo: { success: true, criada: true, chave, cnpj, serie, contaId: criada.id, mensagem: "Conta fiscal criada em homologação. Envie o certificado A1 e o CSC, teste a SEFAZ e passe para produção." } };
  } catch (e: any) {
    // Dois provisionamentos do mesmo CNPJ ao mesmo tempo: o outro criou. Este troca a chave.
    if (e?.code === "P2002") return provisionarConta(corpo, agora);
    throw e;
  }
}

// ── A configuração pela API ──────────────────────────────────────────────────

/** A conta já tem nota (venda de fora com fiscalInfo)? Com nota, série e número inicial em uso não se trocam. */
async function temNota(lojaId: string): Promise<boolean> {
  return (await prisma.vendaExterna.count({ where: { franchiseeId: lojaId, NOT: { fiscalInfo: { equals: Prisma.AnyNull } } } })) > 0;
}

/**
 * PUT /config: dados da empresa, ambiente, série, número inicial, CSC por
 * ambiente, contingência e QR Code. Trocar de ambiente com nota em andamento é
 * recusado (a consulta perguntaria no ambiente errado — lib/fiscal-notas-em-andamento).
 */
export async function alterarConfigDaConta(conta: ContaEvopdv, corpo: unknown): Promise<Resposta> {
  const c = objeto(corpo);
  const lidos = lerDadosDaEmpresa(c);
  if (!lidos.ok) return { status: 422, corpo: { error: "dados_invalidos", erros: lidos.erros } };
  let ambiente: 1 | 2 | null = null;
  if ("ambiente" in c) {
    const a = c.ambiente === "producao" || Number(c.ambiente) === 1 ? 1 : c.ambiente === "homologacao" || Number(c.ambiente) === 2 ? 2 : null;
    if (a == null) return { status: 422, corpo: { error: "ambiente_invalido", mensagem: "Ambiente: \"homologacao\" (2) ou \"producao\" (1)." } };
    ambiente = a;
  }
  const ambienteAtual: 1 | 2 = Number(conta.config.ambiente) === 1 ? 1 : 2;
  if (ambiente != null && ambiente !== ambienteAtual) {
    const emAndamento = await notasEmAndamentoDaLoja(conta.lojaId);
    if (emAndamento.length > 0) return { status: 409, corpo: respostaDeNotasEmAndamento(emAndamento, "ambiente") };
  }
  const comNota = await temNota(conta.lojaId);
  type R = Resposta;
  return alterarFiscalConfig<R>(conta.lojaId, (bruto) => {
    const atual = objeto(bruto);
    const sefaz = aplicarFormularioDoEmissor(configDoEmissorProprio(atual), {
      ...("serie" in c ? { serie: c.serie } : {}),
      ...("numeroInicial" in c ? { numeroInicial: c.numeroInicial } : {}),
      ...("qrVersao" in c ? { qrVersao: c.qrVersao } : {}),
      ...("contingenciaOffline" in c ? { contingenciaOffline: c.contingenciaOffline } : {}),
      ...("csc" in c ? { csc: c.csc } : {}),
    }, { papel: null, cifrar, emissaoLigadaNoProprio: comNota, ambiente: ambiente ?? ambienteAtual });
    if (!sefaz.ok) return { gravar: null, resposta: { status: sefaz.status, corpo: sefaz.corpo } };
    const novo: Registro = { ...atual, ...lidos.dados, sefaz: sefaz.sefaz, ...(ambiente != null ? { ambiente } : {}) };
    if ("pixEstatico" in c && typeof c.pixEstatico === "boolean") novo.pixEstatico = c.pixEstatico;
    return { gravar: novo, resposta: { status: 200, corpo: { success: true, avisos: sefaz.avisos } } };
  });
}

/** POST /certificado: o A1 (base64) e a senha, com as conferências da tela fiscal. */
export async function guardarCertificadoDaConta(conta: ContaEvopdv, corpo: unknown): Promise<Resposta> {
  const c = objeto(corpo);
  const b64 = typeof c.certificadoBase64 === "string" ? c.certificadoBase64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { status: 400, corpo: { error: "sem_arquivo", mensagem: "Envie o certificado A1 (.pfx) em `certificadoBase64`." } };
  const pfx = Buffer.from(b64, "base64");
  const conferido = conferirCertificadoEnviado({ pfx, senha: typeof c.senha === "string" ? c.senha : "", cnpjDaLoja: conta.cnpj });
  if (!conferido.ok) return { status: conferido.status, corpo: { error: conferido.erro, mensagem: conferido.mensagem } };
  const senhaCifrada = cifrar(String(c.senha));
  if (!senhaCifrada) return { status: 400, corpo: { error: "sem_senha", mensagem: "Informe a senha do certificado." } };
  const arquivo = await guardarArquivoFiscal({ lojaId: conta.lojaId, tipo: "certificado", identificacao: identificacaoDoA1(conferido.sha256), conteudo: pfx });
  const registro = registroDoCertificado({ conferido, arquivo, senhaCifrada, enviadoPor: "evopdv" });
  let anterior: string | null = null;
  try {
    await alterarFiscalConfig(conta.lojaId, (bruto) => {
      const atual = objeto(bruto);
      const sefaz = configDoEmissorProprio(atual);
      anterior = sefaz.certificado?.arquivo ?? null;
      return { gravar: { ...atual, sefaz: { ...sefaz, certificado: registro, ultimoTeste: null } }, resposta: null };
    });
  } catch (e) {
    if (anterior !== arquivo.caminho) await apagarDoCofre(arquivo.caminho);
    throw e;
  }
  if (anterior && anterior !== arquivo.caminho) await apagarDoCofre(anterior);
  return {
    status: 200,
    corpo: {
      success: true,
      certificado: { titular: conferido.cert.titular, cnpj: conferido.cnpj, validoAte: conferido.cert.validoAte.toISOString(), diasParaVencer: conferido.dias },
      avisos: conferido.avisos,
    },
  };
}

// ── O status ─────────────────────────────────────────────────────────────────

/** GET /status: o que a tela "Nota fiscal" do EvoPDV mostra. Não fala com a SEFAZ. */
export async function statusDaConta(conta: ContaEvopdv, agora: Date = new Date()): Promise<Resposta> {
  const config = conta.config;
  const tela = emissorParaTela(config as Registro, agora);
  const pendencias = pendenciasParaEmitir(config);
  const assinatura = await situacaoDaAssinatura(conta.email, conta.assinatura, agora);
  if (assinatura.gravar) {
    await prisma.integracaoEvopdv.update({ where: { id: conta.integracaoId }, data: { assinatura: assinatura.gravar as Prisma.InputJsonValue } }).catch(() => {});
  }
  const bloqueio = sefazBloqueadaAte(conta.lojaId, config);
  return {
    status: 200,
    corpo: {
      cnpj: conta.cnpj,
      razaoSocial: config.razaoSocial ?? null,
      nomeFantasia: config.nomeFantasia ?? null,
      uf: config.uf ?? null,
      ambiente: Number(config.ambiente) === 1 ? "producao" : "homologacao",
      serie: tela.serie,
      numeroInicial: tela.numeroInicial,
      contingenciaOffline: tela.contingenciaOffline,
      qrVersao: tela.qrVersao,
      certificado: tela.certificado,
      csc: tela.csc,
      ultimoTeste: tela.ultimoTeste,
      pendencias,
      prontaParaEmitir: pendencias.length === 0,
      sefazBloqueadaAte: bloqueio ? bloqueio.toISOString() : null,
      assinatura: { ativa: assinatura.ativa, fonte: assinatura.fonte },
      ufsAtendidas: ufsDoEmissorProprio(),
    },
  };
}
