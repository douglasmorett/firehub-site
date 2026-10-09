/**
 * O `fiscalConfig` como ele está de verdade no banco — e como o resto do
 * código espera ler.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * A Hakim Centro, única loja com fiscalConfig gravado em 24/09/2026, tem isto,
 * herdado da tela antiga:
 *
 *   { ie: "", ambiente: "homologacao", regimeTributario: "Simples Nacional",
 *     ncmDefault: "2106.90.90", cstDefault: "102", ... }
 *
 * O servidor faz `Number(ambiente)` e `Number(regimeTributario)`: os dois viram
 * NaN, e a tela passava a acusar "ambiente inválido" e "regime inválido" para
 * dados que o lojista tinha preenchido. Pior: "producao" por extenso também
 * vira NaN, e NaN !== 1 — a loja que escolheu produção emitiria em homologação
 * sem aviso nenhum. E a IE digitada na chave antiga `ie` nunca aparecia.
 *
 * Normalizar na LEITURA conserta a tela na hora; normalizar na GRAVAÇÃO
 * conserta o banco na primeira vez que a loja salva qualquer coisa.
 *
 * Este arquivo é puro (sem banco, sem crypto — o `cifrar` e a conferência de
 * pendências entram por parâmetro): as regras da gravação ficam testáveis em
 * scripts/teste-fiscal-cadastro.ts sem sessão, sem Prisma e sem FISCAL_CHAVE.
 */
import type { ConfiguracaoFiscal } from "./fiscal-emissao";
import { cnpjValido, type Problema } from "./fiscal-validacao";
import { ehNotaDaConta, idDaNotaDoPedido, pedidoDeMesaExigeNotaDaConta } from "./fiscal-momento";
import { lerFormasPorIntegracao } from "./fiscal-modo";
import { finalDoCsc } from "./focus-empresas";
import { PROVEDOR_PROPRIO, provedorEfetivoDaLoja } from "./nfce/config-da-loja";

/** O que fica guardado no fiscalConfig além dos dados do emitente. */
export type ConfigFiscalGravada = ConfiguracaoFiscal & {
  enabled?: boolean;
  complemento?: string | null;
  inscricaoMunicipal?: string | null;
  autoEmitPaymentMethods?: string[];
  cfopPadrao?: string | null;
  csosnPadrao?: string | null;
  /** Tokens da Focus por ambiente, CIFRADOS (lib/fiscal-credenciais). */
  tokens?: { homologacao?: string | null; producao?: string | null } | null;
  /**
   * De que ambiente é o `tokenDoProvedor` colado à mão (1 produção, 2
   * homologação). Ele só vale nesse ambiente — lib/fiscal-credenciais →
   * tokenDoAmbiente.
   */
  ambienteDoToken?: 1 | 2 | null;
  /** Id da empresa na Focus, quando cadastrada pela conta de revenda do FireHub. */
  focusEmpresaId?: string | null;
  cadastradoNaFocusEm?: string | null;
  certificadoValidoAte?: string | null;
  certificadoCnpj?: string | null;
  /** Só os 4 últimos caracteres do CSC — o CSC inteiro fica na Focus. */
  cscFinal?: string | null;
  /** Id e final do CSC de cada ambiente, para a tela mostrar o que foi cadastrado. */
  cscNaFocus?: {
    homologacao?: { id: string; final: string } | null;
    producao?: { id: string; final: string } | null;
  } | null;
  /**
   * Quando a emissão passou a valer como está (ligada, ou trocada de ambiente
   * com ela ligada). A varredura de lib/fiscal-automatico nunca emite para
   * pedido anterior a isto — ver `carimbarEmissaoLigada`.
   */
  emissaoLigadaEm?: string | null;
  /** Como a nota é emitida (lib/fiscal-modo): "automatico" (ausente) ou "manual". */
  modoDaEmissao?: string;
  /** Lista própria de formas por integração; canal ausente segue `autoEmitPaymentMethods`. */
  formasPorIntegracao?: Partial<Record<string, string[]>>;
  /** Entrega pelo FireHub sem CPF: "opcional" (ausente) ou "obrigatorio". */
  cpfNaEntrega?: string;
  contador?: unknown;
  [chave: string]: unknown;
};

/**
 * As formas que a tela mostra marcadas quando a loja ainda não escolheu.
 *
 * O servidor precisa usar a MESMA lista: lib/fiscal-momento lê lista ausente
 * como vazia, e a loja nova via PIX, crédito e débito marcados enquanto nenhuma
 * nota automática saía. A tela antiga escondia isso gravando a lista em todo
 * "Salvar"; quando o Salvar deixou de mandar o campo (24/09/2026), o buraco
 * apareceu. A tela (store/fiscal/page.tsx) tem a mesma lista no estado inicial.
 */
export const FORMAS_AUTOMATICAS_PADRAO: readonly string[] = ["PIX", "CREDIT_CARD", "DEBIT_CARD"];

/**
 * 1 = produção, 2 = homologação — o número que vai no XML.
 *
 * Texto antigo ("homologacao", "Produção") vira o número certo. O que não se
 * reconhece vira HOMOLOGAÇÃO: no pior caso a nota sai sem valor fiscal e a
 * faixa amarela da tela avisa; o contrário (cair em produção por engano)
 * emitiria nota de verdade que ninguém pediu.
 */
export function ambienteNumerico(valor: unknown): 1 | 2 | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (n === 1 || n === 2) return n;
  const t = semAcento(String(valor));
  if (/produc|production/.test(t)) return 1;
  return 2;
}

/**
 * CRT: 1 Simples Nacional, 2 Simples com excesso de sublimite, 3 Regime
 * Normal, 4 MEI (os mesmos códigos da Focus e do XML).
 *
 * O texto por extenso da tela antiga ("Simples Nacional") volta a ser número.
 * Texto que não se reconhece fica null — é o validador que diz ao lojista para
 * escolher, e não este arquivo que chuta um regime.
 */
export function regimeNumerico(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (Number.isInteger(n) && n >= 1 && n <= 4) return n;
  const t = semAcento(String(valor));
  if (/\bmei\b|microempreendedor/.test(t)) return 4;
  if (/excesso|sublimite/.test(t)) return 2;
  if (/simples/.test(t)) return 1;
  if (/normal|presumido|lucro real/.test(t)) return 3;
  return null;
}

const CSOSN_VALIDOS = ["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"];

/**
 * Devolve uma cópia do fiscalConfig com os campos conhecidos no formato certo.
 *
 * Chaves que este arquivo não conhece (a config do contador, os tokens
 * cifrados, o id da empresa na Focus) passam intactas — normalizar não pode
 * apagar a agenda do contador de ninguém.
 */
export function normalizarConfigFiscal(bruto: unknown): ConfigFiscalGravada {
  const origem = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const c: ConfigFiscalGravada = { ...origem };

  if ("enabled" in origem) c.enabled = origem.enabled === true || origem.enabled === "true";

  const ambiente = ambienteNumerico(origem.ambiente);
  if (ambiente === null) delete c.ambiente;
  else c.ambiente = ambiente;

  if ("regimeTributario" in origem) c.regimeTributario = regimeNumerico(origem.regimeTributario);

  // A tela antiga gravava a IE na chave `ie`. Vale só quando a nova está vazia —
  // quem já digitou na chave nova é quem manda.
  const ieNova = texto(origem.inscricaoEstadual);
  const ieAntiga = texto(origem.ie);
  if (!ieNova && ieAntiga) c.inscricaoEstadual = ieAntiga;
  delete c.ie;

  // `cstDefault: "102"` era o CSOSN padrão com outro nome. Aproveita se o novo
  // estiver vazio e o valor for CSOSN de verdade.
  const cstAntigo = texto(origem.cstDefault);
  if (!texto(origem.csosnPadrao) && CSOSN_VALIDOS.includes(cstAntigo)) c.csosnPadrao = cstAntigo;
  delete c.cstDefault;

  // `ncmDefault: "2106.90.90"` era aplicado em silêncio ao produto sem NCM e o
  // fazia aparecer "Regular" com o cadastro vazio. Nada mais lê essa chave;
  // guardá-la só deixa a armadilha pronta para quem voltar a ler.
  delete c.ncmDefault;

  if ("serie" in origem) {
    const serie = Number(origem.serie);
    if (Number.isInteger(serie) && serie >= 1) c.serie = serie;
    else delete c.serie;
  }

  if (typeof origem.uf === "string") c.uf = origem.uf.trim().toUpperCase();
  if ("temCertificado" in origem) c.temCertificado = origem.temCertificado === true || origem.temCertificado === "true";

  if ("autoEmitPaymentMethods" in origem) {
    c.autoEmitPaymentMethods = Array.isArray(origem.autoEmitPaymentMethods)
      ? origem.autoEmitPaymentMethods.filter((x): x is string => typeof x === "string")
      : [];
  }

  // O token colado à mão é de UM ambiente. A config antiga não diz qual: vale
  // o ambiente gravado na época (ausente = homologação, como a emissão lê).
  // Carimbar AQUI, na leitura, é o que protege as rotas que trocam o
  // `ambiente` do objeto antes de pedir o token (cancelar e DANFE usam o da
  // nota, o pacote do contador usa o de produção): sem o carimbo, o token
  // "seria" do ambiente que a rota pediu. Ver lib/fiscal-credenciais →
  // tokenDoAmbiente.
  if (texto(origem.tokenDoProvedor)) {
    c.ambienteDoToken = ambienteNumerico(origem.ambienteDoToken) ?? ambiente ?? 2;
  } else {
    delete c.ambienteDoToken;
  }

  return c;
}

/** 1 = produção; qualquer outra coisa é homologação (a mesma regra de lib/fiscal-credenciais). */
function ambienteDe(config: { ambiente?: unknown }): 1 | 2 {
  return Number(config.ambiente) === 1 ? 1 : 2;
}

/** A loja foi cadastrada na Focus pela conta de revenda do FireHub (rota /provisionar)? */
export function cadastradaNaFocus(config: ConfigFiscalGravada): boolean {
  return Boolean(texto(config.focusEmpresaId));
}

/**
 * O CSC que vale num ambiente.
 *
 * Na loja cadastrada pelo FireHub o CSC é POR AMBIENTE (`cscNaFocus`): é o
 * que a Focus tem em csc_nfce_homologacao e csc_nfce_producao. O formulário
 * aceita "ao menos o de homologação", e a loja que cadastrou só esse não tem
 * CSC de produção — cada NFC-e de produção seria recusada. Antes, o CSC de
 * homologação era espelhado nos campos de cima (`cscId`, `cscFinal`) e valia
 * para os dois ambientes: a loja passava para produção com zero pendências.
 *
 * Na loja de conta própria (token colado) o FireHub só sabe o CSC que o
 * lojista digitou, um só — vale para o ambiente escolhido.
 */
export function cscDoAmbiente(config: ConfigFiscalGravada, ambiente: 1 | 2): { id: string | null; final: string | null; temCsc: boolean } {
  if (cadastradaNaFocus(config)) {
    const c = config.cscNaFocus?.[ambiente === 1 ? "producao" : "homologacao"] ?? null;
    return { id: texto(c?.id) || null, final: texto(c?.final) || null, temCsc: Boolean(c && texto(c.id)) };
  }
  const final = texto(config.cscFinal) || (texto(config.csc) ? finalDoCsc(config.csc) : "");
  return { id: texto(config.cscId) || null, final: final || null, temCsc: Boolean(texto(config.csc) || texto(config.cscFinal)) };
}

/**
 * A config como a conferência de pendências precisa ver: com o CSC DO
 * AMBIENTE escolhido nos campos que o validador lê (`cscId`, `csc`).
 *
 * O validador (pendenciasDoEmitente) exige `csc` preenchido, e o FireHub não
 * guarda o CSC inteiro — quem assina o QR Code é a Focus. O marcador abaixo
 * diz "existe" SÓ EM MEMÓRIA; nunca vai para o banco nem para a Focus.
 *
 * lib/fiscal-emissao (pendenciasParaEmitir, usado pela emissão, pela
 * automática e pela inutilização com a config crua) tem a mesma ponte. As duas
 * concordam porque a loja cadastrada pelo FireHub não tem mais `cscId` nem
 * `cscFinal` em cima — só `cscNaFocus` —, então lá também só vale o CSC do
 * ambiente.
 */
export const CSC_GUARDADO_NA_FOCUS = "(cadastrado na Focus)";
export function configParaConferencia<T extends ConfigFiscalGravada>(config: T): T {
  const csc = cscDoAmbiente(config, ambienteDe(config));
  if (cadastradaNaFocus(config)) {
    return { ...config, cscId: csc.id, csc: csc.temCsc ? CSC_GUARDADO_NA_FOCUS : null, cscFinal: csc.final };
  }
  if (texto(config.csc) || !texto(config.cscFinal)) return config;
  return { ...config, csc: CSC_GUARDADO_NA_FOCUS };
}

/**
 * Carimba `emissaoLigadaEm` quando a emissão passa a valer como está.
 *
 * lib/fiscal-automatico lê esse carimbo para a varredura nunca emitir para
 * pedido anterior — e nada o gravava. Sem ele, o fechamento de caixa varre
 * desde a abertura do turno: o titular que abre às 11h e liga em PRODUÇÃO às
 * 21h ganhava NFC-e de verdade para as vendas das 11h às 21h, feitas com a
 * emissão desligada, que só saem por cancelamento em 30 minutos.
 *
 * Trocar de ambiente com a emissão ligada também carimba: o pedido que ficou
 * sem nota em homologação não pode virar nota de produção depois.
 */
export function carimbarEmissaoLigada(antes: ConfigFiscalGravada, depois: ConfigFiscalGravada, agora: Date): ConfigFiscalGravada {
  if (depois.enabled !== true) return depois;
  const acabouDeLigar = antes.enabled !== true;
  const trocouDeAmbiente = ambienteDe(antes) !== ambienteDe(depois);
  if (!acabouDeLigar && !trocouDeAmbiente) return depois;
  return { ...depois, emissaoLigadaEm: agora.toISOString() };
}

// ── A MESMA CONFERÊNCIA NA TELA, NO LIGAR E NO /provisionar ─────────────────

/**
 * Os padrões que a GRAVAÇÃO aplica ao campo que nunca foi gravado — e só esses.
 *
 * São valores operacionais, não dados da empresa: o ambiente ausente já é lido
 * como homologação por toda a emissão, a série é "normalmente 1" e as formas
 * automáticas são a lista que a tela mostra marcada. O PUT grava os três na
 * primeira vez que a loja salva qualquer coisa, e o GET confere a loja com
 * eles aplicados: assim "sem pendência" na tela é exatamente o que o PUT de
 * ligar vai conferir. Antes o GET preenchia a série e o ambiente só no
 * retrato — a loja nova via "pode ligar" e o ligar recusava por "ambiente" e
 * "série" que a tela mostrava preenchidos.
 *
 * Razão social, CNPJ, nome fantasia e regime NÃO entram aqui: são a identidade
 * fiscal da empresa, e o que o FireHub tem para eles é palpite (ver
 * `sugestoesDoCadastro`).
 */
export function comPadroesDeGravacao<T extends ConfigFiscalGravada>(config: T): T {
  const c: T = { ...config };
  if (ambienteNumerico(c.ambiente) === null) c.ambiente = 2;
  if (!(Number.isInteger(Number(c.serie)) && Number(c.serie) >= 1)) c.serie = 1;
  if (!Array.isArray(c.autoEmitPaymentMethods)) c.autoEmitPaymentMethods = [...FORMAS_AUTOMATICAS_PADRAO];
  // O emissor: desde 09/10/2026 só existe o do FireHub. A loja que nunca
  // escolheu passa a ter "sefaz" gravado no primeiro Salvar — e o GET confere
  // com ele, então a tela não pede mais para "escolher quem transmite". A loja
  // que já estava na Focus (token, empresa cadastrada) fica onde está até trocar.
  if (!texto(c.provedor) && provedorEfetivoDaLoja(c) === PROVEDOR_PROPRIO) c.provedor = PROVEDOR_PROPRIO;
  return c;
}

/** O que o FireHub sabe da loja fora do fiscalConfig. */
export type DadosDaLojaParaSugestao = { storeName?: string | null; cpfCnpj?: string | null };

export type SugestoesDoCadastro = {
  cnpj?: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  regimeTributario?: number;
};

/**
 * Sugestões para os dados da empresa que ainda não foram GRAVADOS.
 *
 * O GET preenchia razão social, CNPJ e nome fantasia vazios com o nome da loja
 * e o documento do cadastro, e calculava as pendências sobre esse retrato —
 * mas o PUT de ligar e o /provisionar conferem o que está gravado. Caso real
 * (24/09/2026): a Hakim Centro tem `razaoSocial: ""` gravado; a tela não
 * acusava a razão social (mostrava "Hakim Centro") e o ligar recusaria por
 * razão social vazia. Além disso "Hakim Centro" é o nome da loja, não a razão
 * social que consta no CNPJ — ir para a nota sem o lojista conferir seria erro
 * de emitente.
 *
 * Agora a conferência é a do gravado, nos três lugares, e isto aqui volta à
 * tela como SUGESTÃO: o lojista vê, confirma com um clique e salva.
 */
export function sugestoesDoCadastro(config: ConfigFiscalGravada, loja: DadosDaLojaParaSugestao | null | undefined): SugestoesDoCadastro {
  const s: SugestoesDoCadastro = {};
  const nomeDaLoja = texto(loja?.storeName);
  const documento = texto(loja?.cpfCnpj);
  if (!texto(config.cnpj) && documento) s.cnpj = documento;
  if (!texto(config.razaoSocial) && nomeDaLoja) s.razaoSocial = nomeDaLoja;
  if (!texto(config.nomeFantasia) && nomeDaLoja) s.nomeFantasia = nomeDaLoja;
  // Simples Nacional é o caso da esmagadora maioria — mas MEI (4) e Simples
  // com excesso (2) existem, e o regime vai em cada item da nota.
  if (regimeNumerico(config.regimeTributario) === null) s.regimeTributario = 1;
  return s;
}

/**
 * O retrato que a tela recebe e confere: o que está gravado (normalizado),
 * com os padrões da gravação — nada da identidade fiscal inventado — e, à
 * parte, as sugestões para o que falta.
 */
export function retratoDoCadastro(bruto: unknown, loja: DadosDaLojaParaSugestao | null | undefined): {
  config: ConfigFiscalGravada;
  sugestoes: SugestoesDoCadastro;
} {
  const config = comPadroesDeGravacao(normalizarConfigFiscal(bruto));
  return { config, sugestoes: sugestoesDoCadastro(config, loja) };
}

// ── GRAVAÇÃO DO FORMULÁRIO (PUT /api/store/fiscal) ──────────────────────────

/**
 * Campos que a tela pode gravar.
 *
 * Antes o PUT fazia `{ ...configAtual, ...body }` — o corpo inteiro da
 * requisição caía dentro do `fiscalConfig`. Qualquer chave inventada entrava, e
 * qualquer sessão autenticada (um STAFF de balcão inclusive) trocava CNPJ,
 * inscrição estadual e o ambiente de homologação para produção.
 *
 * Os campos do cadastro na Focus (focusEmpresaId, tokens, certificadoValidoAte,
 * cscNaFocus) e o carimbo `emissaoLigadaEm` NÃO estão aqui: só a rota
 * /provisionar e a própria gravação escrevem neles.
 */
const CAMPOS_PERMITIDOS = [
  "enabled",
  "provedor",
  "tokenDoProvedor",
  "tokenHomologacao",
  "tokenProducao",
  "cnpj",
  "inscricaoEstadual",
  "inscricaoMunicipal",
  "razaoSocial",
  "nomeFantasia",
  "regimeTributario",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "municipio",
  "codigoMunicipio",
  "uf",
  "cep",
  "serie",
  "ambiente",
  "cscId",
  "csc",
  "cfopPadrao",
  "csosnPadrao",
  "autoEmitPaymentMethods",
  // Declaração do titular de que o certificado A1 foi enviado ao provedor
  // (caminho manual, conta própria na Focus). No cadastro pelo FireHub quem
  // marca é a rota /provisionar, com a validade que a Focus devolveu.
  "temCertificado",
  // As regras da nota que a emissão já lia (lib/fiscal-momento,
  // lib/fiscal-emissao) e que NINGUÉM conseguia gravar: sem estes nomes aqui
  // o PUT descartava o campo em silêncio, e a loja cujo contador pediu a nota
  // no aceite, a taxa de serviço dentro da nota ou o Pix estático não tinha
  // como pedir.
  "momentoDaEmissao",
  "taxaDeServicoNaNota",
  "intermediadores",
  "pixEstatico",
  "entregaComoPresencial",
  // Como a nota é emitida (lib/fiscal-modo): sozinha ou pelo pedido, a lista
  // de formas de cada integração e se a entrega exige o CPF no pedido.
  "modoDaEmissao",
  "formasPorIntegracao",
  "cpfNaEntrega",
] as const;

/** Campos que só o responsável pela loja altera — são a identidade fiscal dela. */
const CAMPOS_DO_TITULAR = new Set<string>([
  // Ligar a emissão (sobretudo em produção) gera nota com valor fiscal e
  // imposto em nome da empresa. É decisão do titular, não do balcão.
  "enabled",
  "cnpj",
  "inscricaoEstadual",
  "razaoSocial",
  "regimeTributario",
  "ambiente",
  "csc",
  "cscId",
  "provedor",
  "tokenDoProvedor",
  "tokenHomologacao",
  "tokenProducao",
  "temCertificado",
  // Série e endereço do emitente também são identidade fiscal: mudar a série
  // fura a numeração na SEFAZ, e o endereço/código IBGE vai no XML de toda
  // nota. STAFF de balcão não mexe.
  "serie",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "municipio",
  "codigoMunicipio",
  "uf",
  "cep",
  // Mudam o conteúdo de toda nota (quando sai, o que entra no total, o
  // intermediador declarado, a presença): decisão do titular com o contador.
  "momentoDaEmissao",
  "taxaDeServicoNaNota",
  "intermediadores",
  "pixEstatico",
  "entregaComoPresencial",
  // Decidem se a venda tem nota e se o cliente é obrigado a dar o CPF: é o
  // titular quem escolhe, com o contador — não o balcão. As formas da venda
  // da loja entraram junto: a tela as mostra na mesma tabela das integrações
  // ("Como a nota é emitida"), e metade da decisão não pode ser do balcão.
  "autoEmitPaymentMethods",
  "modoDaEmissao",
  "formasPorIntegracao",
  "cpfNaEntrega",
]);

/** Os canais em que a loja pode ajustar o intermediador (lib/fiscal-emissao → intermediadorDoPedido). */
export const CANAIS_DO_INTERMEDIADOR = ["IFOOD", "99FOOD", "BRENDI", "WABIZ", "JOTAJA"] as const;

export type AjusteDoIntermediador = { cnpj?: string | null; id?: string | null; ativo?: boolean };

/**
 * O `intermediadores` que pode ir para o banco: só os canais conhecidos, CNPJ
 * sem máscara e com dígito conferido (CNPJ errado é rejeição 440 em TODA nota
 * daquele canal — melhor recusar aqui), identificador de até 60 caracteres.
 *
 * CNPJ vazio = "o oficial do código" (INTERMEDIADORES_CONHECIDOS). A tela
 * manda vazio quando o valor é o oficial, para uma correção no código chegar
 * a todas as lojas que não mudaram nada.
 */
export function lerIntermediadores(bruto: unknown): { valor: Partial<Record<string, AjusteDoIntermediador>>; avisos: string[] } {
  const valor: Partial<Record<string, AjusteDoIntermediador>> = {};
  const avisos: string[] = [];
  const origem = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, any>) : {};
  for (const canal of CANAIS_DO_INTERMEDIADOR) {
    const a = origem[canal];
    if (!a || typeof a !== "object") continue;
    const ajuste: AjusteDoIntermediador = {};
    const cnpj = String(a.cnpj ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (cnpj) {
      if (cnpjValido(cnpj)) ajuste.cnpj = cnpj;
      else avisos.push(`O CNPJ do intermediador ${canal} não é válido (os dígitos não conferem) e não foi gravado.`);
    }
    const id = String(a.id ?? "").trim().slice(0, 60);
    if (id) ajuste.id = id;
    if (a.ativo === false) ajuste.ativo = false;
    else if (a.ativo === true) ajuste.ativo = true;
    if (Object.keys(ajuste).length > 0) valor[canal] = ajuste;
  }
  return { valor, avisos };
}

const MOMENTOS_VALIDOS = ["aceite", "saida", "conclusao"];

const SEGREDOS = new Set<string>(["tokenDoProvedor", "tokenHomologacao", "tokenProducao", "csc"]);

export type ResultadoDoFormulario =
  | { ok: true; antes: ConfigFiscalGravada; config: ConfigFiscalGravada; recusados: string[]; avisos: string[] }
  | { ok: false; status: 409; corpo: Record<string, unknown> };

/**
 * O que o PUT grava a partir do fiscalConfig do banco e do corpo recebido.
 *
 * `cifrar` (lib/fiscal-credenciais) e `conferir` (pendências da loja, com a
 * ponte do CSC) entram por parâmetro para este arquivo continuar puro.
 */
export function aplicarFormularioFiscal(
  bruto: unknown,
  body: Record<string, unknown>,
  opcoes: {
    papel: string | null | undefined;
    cifrar: (segredo: string) => string | null;
    conferir: (config: ConfigFiscalGravada) => Problema[];
    agora?: Date;
  }
): ResultadoDoFormulario {
  // Normaliza o que já estava gravado: a primeira gravação depois desta
  // mudança conserta o legado ("homologacao", "Simples Nacional", `ie`).
  const antes = normalizarConfigFiscal(bruto);
  let config: ConfigFiscalGravada = { ...antes };
  // O que a tela MOSTROU ao STAFF: o gravado com os padrões da gravação (o
  // GET usa o mesmo retratoDoCadastro). É contra isto que se sabe se ele
  // tentou mudar um campo do titular. Comparando com o `antes` cru, o Salvar
  // Dados de um STAFF que não mexeu em nada listava a série como "mantida
  // como estava" — e este mesmo PUT gravava a série 1 (medido em 24/09/2026
  // com o fiscalConfig real do Pastel, da NIK e da Hakim).
  const mostradoNaTela = comPadroesDeGravacao(antes);
  const naFocus = cadastradaNaFocus(antes);
  // CSC em texto puro gravado pela tela antiga: vira só o final (ver abaixo).
  if (typeof config.csc === "string" && config.csc.trim()) {
    if (!config.cscFinal) config.cscFinal = finalDoCsc(config.csc);
    delete config.csc;
  }

  const recusados: string[] = [];
  const avisos: string[] = [];
  let tokenColado = false;
  for (const campo of CAMPOS_PERMITIDOS) {
    if (!(campo in body)) continue;

    let valor = body[campo];

    // Números chegam como string do formulário; guardar como número evita
    // comparação frouxa depois ("2" !== 2 quebrava a checagem de ambiente).
    // Texto antigo ("homologacao", "Simples Nacional") também vira número.
    if (campo === "regimeTributario" || campo === "serie" || campo === "ambiente") {
      valor = normalizarConfigFiscal({ [campo]: valor })[campo];
      if (valor === null || valor === undefined) continue;
    }
    if (campo === "uf" && typeof valor === "string") valor = valor.trim().toUpperCase();
    if (campo === "temCertificado" || campo === "enabled") valor = valor === true;
    // Segredos vazios não sobrescrevem: a tela manda o token/CSC apenas
    // quando o lojista digita um novo — "" aqui significa "manter o salvo".
    if (SEGREDOS.has(campo) && (typeof valor !== "string" || !valor.trim())) continue;

    // Loja cadastrada pelo FireHub: o CSC mora na Focus, por ambiente, e só
    // muda pelo formulário do cadastro (/provisionar). O CSC digitado no modo
    // manual não chegaria à Focus — gravá-lo faria a tela dizer "cadastrado"
    // para um CSC que a Focus não tem. A tela manda `cscId: ""` em todo
    // Salvar: vazio passa calado.
    if ((campo === "csc" || campo === "cscId") && naFocus) {
      if (texto(valor) && avisos.length === 0) {
        avisos.push(
          "Esta loja foi cadastrada na Focus pelo FireHub: o CSC se troca em \"Cadastro na Focus NFe\" " +
            "(um por ambiente). O CSC digitado no modo manual não foi gravado."
        );
      }
      continue;
    }

    if (CAMPOS_DO_TITULAR.has(campo) && opcoes.papel === "STAFF") {
      // A tela manda o formulário inteiro; só é "recusado" o que o STAFF
      // de fato tentou mudar — senão todo salvamento dele listava o CNPJ.
      // "Mudar" é em relação ao que a tela mostrou, e o campo nunca gravado
      // a tela mostra como "": sem isso o Pastel e a NIK (fiscalConfig null)
      // recebiam 13 campos "mantidos como estavam" num Salvar sem mudança.
      if (SEGREDOS.has(campo) || !mesmoValorNaTela(mostradoNaTela[campo], valor)) {
        recusados.push(campo);
      }
      continue;
    }

    if (campo === "tokenDoProvedor") {
      // Token colado à mão (conta própria na Focus) também é credencial:
      // cifrado, como os do cadastro automático. O ambiente dele é marcado
      // depois do laço, quando o `ambiente` do corpo já foi aplicado.
      config.tokenDoProvedor = opcoes.cifrar(String(valor));
      tokenColado = true;
      continue;
    }
    if (campo === "tokenHomologacao" || campo === "tokenProducao") {
      const tokens = { ...(config.tokens || {}) };
      tokens[campo === "tokenProducao" ? "producao" : "homologacao"] = opcoes.cifrar(String(valor));
      config.tokens = tokens;
      continue;
    }
    if (campo === "csc") {
      // O CSC não é usado pelo FireHub: quem assina o QR Code é a Focus, com
      // o CSC cadastrado lá. Guardar o código inteiro só criava mais um
      // segredo para vazar — fica o final, para o lojista reconhecer. A
      // emissão (lib/fiscal-emissao) aceita o final como CSC presente.
      config.cscFinal = finalDoCsc(valor);
      delete config.csc;
      continue;
    }
    if (campo === "autoEmitPaymentMethods") {
      config.autoEmitPaymentMethods = Array.isArray(valor) ? valor.filter((x): x is string => typeof x === "string") : [];
      continue;
    }
    if (campo === "momentoDaEmissao") {
      const m = String(valor ?? "").trim().toLowerCase();
      if (MOMENTOS_VALIDOS.includes(m)) config.momentoDaEmissao = m;
      else avisos.push(`Momento da emissão "${String(valor)}" não existe (vale aceite, saida ou conclusao) — mantido como estava.`);
      continue;
    }
    if (campo === "taxaDeServicoNaNota" || campo === "pixEstatico" || campo === "entregaComoPresencial") {
      (config as Record<string, unknown>)[campo] = valor === true;
      continue;
    }
    if (campo === "intermediadores") {
      const lido = lerIntermediadores(valor);
      config.intermediadores = lido.valor;
      avisos.push(...lido.avisos);
      continue;
    }
    if (campo === "modoDaEmissao" || campo === "cpfNaEntrega") {
      const escolha = String(valor ?? "").trim().toLowerCase();
      const validos = campo === "modoDaEmissao" ? ["automatico", "manual"] : ["obrigatorio", "opcional"];
      if (validos.includes(escolha)) (config as Record<string, unknown>)[campo] = escolha;
      else avisos.push(`"${String(valor)}" não é uma opção de ${campo} (vale ${validos.join(" ou ")}) — mantido como estava.`);
      continue;
    }
    if (campo === "formasPorIntegracao") {
      // Canal fora da lista ou forma desconhecida não entram; o canal que a
      // tela manda como `null` volta a seguir as vendas da loja.
      config.formasPorIntegracao = lerFormasPorIntegracao(valor);
      continue;
    }

    (config as Record<string, unknown>)[campo] = valor;
  }

  // O token colado vale só no ambiente dele (lib/fiscal-credenciais →
  // tokenDoAmbiente). Quem cola diz de qual é (`ambienteDoToken` no corpo);
  // sem isso, é o ambiente em que a loja fica depois deste Salvar — a tela
  // antiga colava o token do ambiente escolhido no mesmo formulário.
  // `ambienteDoToken` sozinho, sem token novo, não muda nada: trocar a marca
  // de um token já colado seria declarar produção sem ter o de produção.
  if (tokenColado) {
    config.ambienteDoToken = ambienteNumerico(body.ambienteDoToken) ?? ambienteDe(config);
  }

  // Ambiente, série e a lista de formas automáticas que a tela mostra quando
  // a loja nunca escolheu passam a existir no banco também — é o que a
  // emissão lê, e é com eles que o GET confere (ver comPadroesDeGravacao).
  config = comPadroesDeGravacao(config);

  // ── Ligar a emissão ─────────────────────────────────────────────────────
  // O erro de emissão mandava "ligar em Fiscal → Configuração" e a tela não
  // tinha botão. Agora tem — e só liga com o cadastro sem pendência, porque
  // ligar incompleto só troca "desligada" por "toda venda falhando".
  // Trocar de ambiente com a emissão ligada vale o mesmo: passar para
  // produção sem token ou sem CSC de produção deixaria toda venda falhando.
  const vaiLigar = config.enabled === true && antes.enabled !== true;
  const trocaAmbienteLigada = config.enabled === true && antes.enabled === true && ambienteDe(config) !== ambienteDe(antes);
  if (vaiLigar || trocaAmbienteLigada) {
    const pendencias = opcoes.conferir(config);
    if (pendencias.length > 0) {
      return {
        ok: false,
        status: 409,
        corpo: {
          error: "pendencias",
          mensagem: vaiLigar
            ? `A emissão não foi ligada: ainda há ${pendencias.length} pendência(s) no cadastro. Resolva a lista e tente de novo.`
            : `O ambiente não foi trocado: com a emissão ligada, ele teria ${pendencias.length} pendência(s) — ` +
              "toda venda falharia. Resolva a lista (normalmente o token ou o CSC do outro ambiente) e tente de novo.",
          pendencias,
          podeEmitir: false,
        },
      };
    }
  }
  // Produção emite nota com valor fiscal: ligar nela, ou passar para ela com
  // a emissão ligada, pede confirmação explícita — não basta um clique perdido.
  const emProducaoDepois = config.enabled === true && ambienteDe(config) === 1;
  const emProducaoAntes = antes.enabled === true && ambienteDe(antes) === 1;
  if (emProducaoDepois && !emProducaoAntes && body.confirmarProducao !== true) {
    return {
      ok: false,
      status: 409,
      corpo: {
        error: "confirmacao_necessaria",
        mensagem:
          "Em PRODUÇÃO cada nota vale de verdade: vai para a SEFAZ, gera imposto e só sai por cancelamento " +
          "em até 30 minutos. Confirme para continuar.",
      },
    };
  }

  config = carimbarEmissaoLigada(antes, config, opcoes.agora ?? new Date());
  return { ok: true, antes, config, recusados, avisos };
}

// ── A NOTA DE UM PEDIDO ─────────────────────────────────────────────────────

/**
 * Onde está a nota de um pedido: a ref no provedor, o ambiente em que ela
 * saiu e os pedidos que ela cobre.
 *
 * A nota da conta da mesa sai com a ref `mesa-<sessão>` (lib/fiscal-momento)
 * e a mesma chave fica em todos os pedidos da conta. Cancelar ou consultar por
 * `order.id` ia para `firehub-<pedido>`, que não existe na Focus: o titular
 * tentava cancelar dentro dos 30 minutos e recebia "nota não encontrada".
 *
 * O ambiente é o da NOTA, não o da loja hoje: a nota de homologação emitida
 * antes de a loja passar para produção só existe no servidor de homologação.
 */
export function notaDoPedido(pedido: { id: string; fiscalInfo?: unknown }): {
  idDaNota: string;
  ambiente: 1 | 2 | null;
  pedidos: string[];
  daConta: boolean;
} {
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" && !Array.isArray(pedido.fiscalInfo)
    ? (pedido.fiscalInfo as Record<string, any>)
    : {};
  const idDaNota = idDaNotaDoPedido(pedido);
  // Pela ref, não por "idDaNota diferente do id": a reemissão de um pedido
  // comum depois de a nota ser cancelada tem ref própria (`<pedido>-2`) e
  // continua sendo nota de UM pedido.
  const daConta = idDaNota.startsWith("mesa-") || Boolean(info.notaDaConta);
  const daMesa = daConta && Array.isArray(info.notaDaConta?.pedidos)
    ? (info.notaDaConta.pedidos as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  return {
    idDaNota,
    ambiente: ambienteNumerico(info.ambiente),
    pedidos: [...new Set([pedido.id, ...daMesa])],
    daConta,
  };
}

// ── O BOTÃO EMITIR DE UM PEDIDO (POST /api/store/fiscal/emitir) ────────────

/** Um pedido da conta da mesa, com o que a decisão lê. */
export type PedidoDaConta = {
  id: string;
  dailyOrderNumber?: number | null;
  status?: string | null;
  fiscalStatus?: string | null;
  fiscalInfo?: unknown;
};

export type CaminhoDaNota =
  /** Pedido comum: a nota é dele (ref `firehub-<pedido>`). */
  | { caminho: "avulsa" }
  /**
   * Pedido de mesa com a conta fechada: sai a nota da CONTA, pedida à mão.
   * `restante`: uma rodada já tem nota própria (legado) e a nota leva só as
   * outras. `reemissao`: a nota da conta foi cancelada e sai outra, com ref
   * nova (`mesa-<sessão>-2`).
   */
  | { caminho: "conta"; tableSessionId: string; restante?: boolean; reemissao?: boolean }
  | { caminho: "recusa"; corpo: { error: string; mensagem: string } };

/**
 * O estado da nota de um pedido, na mesma ordem de lib/fiscal-automatico
 * (`estadoFiscal`, que não é exportado e mora num arquivo com banco).
 */
function estadoDaNota(p: PedidoDaConta): "autorizada" | "cancelada" | "processando" | "outro" {
  const info = objeto(p.fiscalInfo);
  if (p.fiscalStatus === "EMITTED" && info.nfceKey) return "autorizada";
  if (p.fiscalStatus === "CANCELED") return "cancelada";
  if (info.processando === true) return "processando";
  return "outro";
}

/**
 * Por onde sai a nota que o botão Emitir da tela fiscal pede para um pedido.
 *
 * Pedido de mesa nunca tem nota avulsa: a NFC-e é uma por conta, com todas as
 * rodadas (lib/fiscal-momento → pedidoDeMesaExigeNotaDaConta, a regra e a
 * frase de conta aberta vêm de lá, numa fonte só). Com a conta FECHADA, o
 * botão emite a nota da conta — `emitirNfceDaMesa(sessão, { manual: true })`,
 * que não passa pela lista de formas da automática.
 *
 * ── Por quê ──
 * A versão anterior recusava todo pedido de mesa com 409 e mandava "fechar a
 * conta em Mesas". Só que o fechamento e a varredura passam pela lista de
 * formas automáticas, e a conta paga fora dela não ganha nota nenhuma. Medido
 * em 24/09/2026 (banco de produção, só leitura): das 479 contas fechadas com
 * venda do Pastel da Paulista, 52 foram pagas só em Dinheiro ou Voucher — 71
 * pedidos, R$ 3.774,51 — e, com a lista padrão (PIX, crédito, débito), a
 * conta já fechada não tinha caminho para a NFC-e. A nota rejeitada (NCM que
 * faltava) também não: a retentativa só refaz falha de comunicação.
 *
 * A nota avulsa de uma rodada também não é saída: os 719 pedidos de mesa do
 * Pastel têm `paymentMethod: "N/A"` (quem pagou foi a conta), e a nota avulsa
 * seria recusada por "forma de pagamento não informada" (lib/fiscal-emissao →
 * formaDaNota). O pagamento de verdade está na sessão, e só a nota da conta o
 * lê.
 *
 * Recusa, dizendo o porquê, quando a nota da conta não pode sair: conta
 * aberta (a saída é fechar), uma nota da mesa em processamento (emitir agora
 * duplicaria; a saída é consultar), a conta que já tem nota, ou todas as
 * rodadas com nota própria (não sobra nada para declarar).
 *
 * Os dois casos que antes eram "fale com o contador" agora têm caminho,
 * sempre pedido por uma pessoa (a automática continua sem emitir):
 *  - rodada com nota própria (legado) → a nota do RESTANTE, com as outras
 *    rodadas (lib/fiscal-momento → pagamentosDoRestante; se o pagamento da
 *    rodada não se separa sem palpite, a própria emissão recusa e diz);
 *  - nota da conta CANCELADA pela loja → reemissão com ref nova
 *    (`mesa-<sessão>-2`): a ref antiga está queimada no provedor, e reenviá-la
 *    só devolveria a nota cancelada.
 */
export function caminhoDaNotaDoPedido(
  pedido: { id: string; tableSessionId?: string | null },
  conta: { status?: string | null; pedidos: PedidoDaConta[] } | null | undefined
): CaminhoDaNota {
  const mesa = pedidoDeMesaExigeNotaDaConta(pedido);
  if (!mesa) return { caminho: "avulsa" };
  const recusa = (error: string, mensagem: string): CaminhoDaNota => ({ caminho: "recusa", corpo: { error, mensagem } });

  // O `tableSessionId` do pedido é SetNull quando a sessão é apagada: sem a
  // sessão não há conta para montar a nota — nem forma de pagamento.
  if (!conta) return recusa("conta_nao_encontrada", "A conta da mesa deste pedido não foi encontrada, e a nota de pedido de mesa sai pela conta.");
  if (String(conta.status ?? "").toUpperCase() !== "CLOSED") return recusa("conta_aberta", mesa.mensagem);

  const validos = conta.pedidos.filter((p) => !String(p.status ?? "").toUpperCase().startsWith("CANCEL"));
  const estados = validos.map((p) => ({ p, daConta: ehNotaDaConta(idDaNotaDoPedido(p), mesa.tableSessionId), estado: estadoDaNota(p) }));
  const nome = (p: PedidoDaConta) => (p.dailyOrderNumber != null ? `#${p.dailyOrderNumber}` : `(${p.id.slice(-6)})`);

  if (estados.some((e) => e.estado === "processando")) {
    return recusa(
      "nota_em_processamento",
      "Uma nota desta mesa ainda está em processamento na SEFAZ. Use \"Consultar situação\" no pedido que está " +
        "processando antes de emitir — emitir agora poderia gerar a mesma nota duas vezes."
    );
  }
  if (estados.some((e) => e.estado === "autorizada" && e.daConta)) {
    const comNota = estados.find((e) => e.estado === "autorizada" && e.daConta)!;
    return recusa("ja_emitida", `A conta desta mesa já tem NFC-e autorizada (chave ${objeto(comNota.p.fiscalInfo).nfceKey}).`);
  }
  // Nota própria de uma rodada só existe por legado: a automática pula mesa,
  // a varredura filtra `tableSessionId: null`, e este botão nunca faz nota
  // avulsa de mesa (em 24/09/2026, 0 dos 779 pedidos de mesa da base tinham
  // nota). A nota do restante não repete a rodada, e a frase da automática
  // ("emita a nota do restante pela tela Fiscal") passa a ter para onde ir.
  const proprias = estados.filter((e) => e.estado === "autorizada" && !e.daConta);
  if (proprias.length > 0 && proprias.length === estados.length) {
    return recusa(
      "mesa_toda_com_nota",
      `Todos os pedidos desta mesa já têm NFC-e própria (${proprias.map((e) => nome(e.p)).join(", ")}): não sobra nada para a nota da conta.`
    );
  }
  const reemissao = estados.some((e) => e.estado === "cancelada" && e.daConta);
  return {
    caminho: "conta",
    tableSessionId: mesa.tableSessionId,
    ...(proprias.length > 0 ? { restante: true } : {}),
    ...(reemissao ? { reemissao: true } : {}),
  };
}

/**
 * A resposta do botão Emitir quando a nota que saiu foi a da CONTA da mesa.
 *
 * `emitirNfceDaMesa` grava o resultado em todos os pedidos da conta e devolve
 * só `{ acao, motivo }`; a chave, o número e os pedidos cobertos são lidos do
 * pedido depois da gravação. `pedidos` volta na resposta para o lote da tela
 * não pedir de novo, rodada a rodada, a nota que acabou de sair (cada pedido
 * seguinte voltaria 409 "já emitida" e o lote contaria como não emitido).
 *
 * Na falha vão as `pendencias` (produto sem NCM, forma de pagamento...) e o
 * detalhe da rejeição, como na resposta do pedido comum: sem elas a tela só
 * dizia "1 problema(s) nos itens deste pedido impedem a emissão", sem dizer
 * qual produto. Vêm do resultado da emissão ou, na falta dele, do que a
 * falha gravou no pedido (`fiscalInfo.pendencias`).
 */
export function respostaDaNotaDaConta(
  resultado: { acao: string; motivo: string; pendencias?: unknown[]; detalhe?: string },
  pedido: { fiscalStatus?: string | null; fiscalInfo?: unknown } | null | undefined
): { status: number; corpo: Record<string, unknown> } {
  const info = objeto(pedido?.fiscalInfo);
  if (resultado.acao === "emitida") {
    const pedidos = Array.isArray(info.notaDaConta?.pedidos)
      ? (info.notaDaConta.pedidos as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const ambiente = ambienteNumerico(info.ambiente);
    return {
      status: 200,
      corpo: {
        success: true,
        notaDaConta: true,
        pedidos,
        chaveDeAcesso: info.nfceKey ?? resultado.motivo,
        numero: info.nfceNumber ?? null,
        serie: info.serie ?? null,
        protocolo: info.protocol ?? null,
        ambiente,
        urlDoXml: info.xmlUrl ?? null,
        urlDoDanfe: info.pdfUrl ?? null,
        // A nota da conta em contingência off-line: vale para o cliente e o
        // DANFE tem de ser impresso, mas a SEFAZ ainda vai recebê-la — a tela
        // diz isso em vez de "autorizada".
        contingencia: info.contingencia === true,
        aviso:
          [
            info.contingencia === true
              ? "Nota emitida em CONTINGÊNCIA OFF-LINE (a SEFAZ estava fora): imprima o DANFE; a consulta automática acompanha até a SEFAZ efetivar."
              : null,
            ambiente === 2 ? "Nota emitida em HOMOLOGAÇÃO — é um teste e não tem valor fiscal." : null,
          ].filter(Boolean).join(" ") || null,
      },
    };
  }
  if (resultado.acao === "processando") {
    return { status: 202, corpo: { error: "processando", notaDaConta: true, mensagem: resultado.motivo } };
  }
  if (resultado.acao === "falhou") {
    const pendencias = Array.isArray(resultado.pendencias) && resultado.pendencias.length > 0
      ? resultado.pendencias
      : Array.isArray(info.pendencias) ? info.pendencias : [];
    return {
      status: info.motivo === "erro_de_comunicacao" ? 502 : 409,
      corpo: {
        error: texto(info.motivo) || "falhou",
        notaDaConta: true,
        mensagem: `A nota da conta desta mesa não foi autorizada: ${resultado.motivo}`,
        pendencias,
        detalhe: resultado.detalhe ?? null,
      },
    };
  }
  return {
    status: 409,
    corpo: {
      error: "nota_da_conta_nao_saiu",
      notaDaConta: true,
      // O motivo de lib/fiscal-momento já pode vir com ponto final ("…não há venda para a nota.").
      mensagem: `A nota da conta desta mesa não saiu: ${String(resultado.motivo).replace(/\.\s*$/, "")}.`,
    },
  };
}

export type SituacaoDoCertificado = {
  validoAte: string;
  /** Dias inteiros até vencer (negativo = já venceu). */
  dias: number;
  situacao: "vencido" | "vence_em_breve" | "ok";
};

/**
 * Validade do certificado A1 para a tela.
 *
 * O A1 vale 1 ano e vence sem avisar: no dia seguinte toda NFC-e é recusada,
 * com a fila do balcão esperando o cupom. O alerta começa 30 dias antes — o
 * tempo de comprar outro na certificadora e mandar de novo.
 */
export function situacaoDoCertificado(validoAte: unknown, agora: Date = new Date()): SituacaoDoCertificado | null {
  const t = texto(validoAte);
  if (!t) return null;
  const fim = new Date(t);
  if (Number.isNaN(fim.getTime())) return null;
  const dias = Math.floor((fim.getTime() - agora.getTime()) / 86_400_000);
  const situacao = fim.getTime() <= agora.getTime() ? "vencido" : dias <= 30 ? "vence_em_breve" : "ok";
  return { validoAte: t, dias, situacao };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
}

/**
 * O valor que voltou do formulário é o mesmo que a tela mostrou?
 *
 * Ausente, null, "" e false são "vazio" (a tela mostra o campo nunca gravado
 * como "" e o liga-desliga nunca gravado como desligado). Texto compara sem
 * os espaços das pontas, e número com texto compara pelo texto ("1" e 1).
 */
function mesmoValorNaTela(mostrado: unknown, recebido: unknown): boolean {
  const vazio = (v: unknown) => v === null || v === undefined || v === false || (typeof v === "string" && !v.trim());
  if (vazio(mostrado) || vazio(recebido)) return vazio(mostrado) && vazio(recebido);
  if (typeof mostrado === "object" || typeof recebido === "object") return JSON.stringify(mostrado) === JSON.stringify(recebido);
  return texto(mostrado) === texto(recebido);
}

const objeto = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
