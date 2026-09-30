/**
 * Cadastro da loja na Focus NFe pela API de Empresas, com a conta de REVENDA
 * do FireHub.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * Até aqui o lojista precisava abrir conta própria na Focus, cadastrar a
 * empresa lá, subir o certificado no painel deles e colar o token aqui — e
 * repetir a colagem ao trocar de homologação para produção, porque cada
 * ambiente tem um token. Na prática nenhuma loja chegou a ligar a emissão.
 * Com a API de Empresas o FireHub cadastra a empresa em nome da loja, recebe
 * os DOIS tokens de uma vez e a troca de ambiente vira um clique.
 *
 * ── O que a documentação diz (conferido em 24/09/2026) ─────────────────────
 *
 *   https://doc.focusnfe.com.br/reference/empresas
 *   https://doc.focusnfe.com.br/reference/criar_empresa        POST /v2/empresas
 *   https://doc.focusnfe.com.br/reference/atualizar_empresa    PUT  /v2/empresas/{id}
 *   https://doc.focusnfe.com.br/reference/consultar_empresa_por_id  GET /v2/empresas/{id}
 *   https://doc.focusnfe.com.br/reference/listar_empresas      GET  /v2/empresas?cnpj=
 *
 * - "Esta API opera exclusivamente no ambiente de produção" (api.focusnfe.com.br).
 *   Não existe empresa de homologação: a MESMA empresa devolve token_producao
 *   e token_homologacao. Para testar sem gravar, `?dry_run=1` no POST e no PUT.
 * - Autenticação Basic com o token da conta (aqui, o de revenda) e senha vazia.
 * - Erros: 422 `{ codigo: "erro_validacao", erros: [{ codigo, mensagem, campo }] }`
 *   (certificado com senha errada, de outro CNPJ, vencido); 401 texto
 *   "HTTP Basic: Access denied"; 404 `nao_encontrado`; 422 `permissao_negada`
 *   ("Empresa não encontrada como propriedade da revenda"); 400
 *   `parametros_invalidos`, cuja mensagem ECOA o corpo recebido — por isso
 *   nenhuma mensagem da Focus é repassada ou logada sem passar por
 *   `semSegredos`.
 *
 * ── O que NUNCA fica no FireHub ─────────────────────────────────────────────
 *
 * O .pfx, a senha dele e o CSC passam por este arquivo a caminho da Focus e
 * morrem aqui. Não vão para o banco, nem para log, nem para a resposta. Quem
 * guarda é a Focus, que é quem assina e transmite.
 *
 * Só servidor.
 */

export const API_DE_EMPRESAS = "https://api.focusnfe.com.br/v2/empresas";

/** Um A1 de verdade tem 3 a 8 KB. 50 KB já é folga larga — acima disso não é certificado. */
export const TAMANHO_MAXIMO_DO_CERTIFICADO = 50 * 1024;

export const SEM_CONTA_DE_REVENDA =
  "O FireHub ainda não tem conta de revenda na Focus NFe, então o cadastro automático da empresa " +
  "ainda não está disponível. Nada foi enviado. Se você já tem conta própria na Focus, use a opção " +
  "\"Já tenho conta na Focus NFe\" e cole o token de acesso.";

/** Token da conta de revenda do FireHub na Focus (variável de ambiente do servidor). */
export function tokenDeRevenda(): string | null {
  const t = String(process.env.FOCUS_NFE_TOKEN_REVENDA ?? "").trim();
  return t || null;
}

export class SemContaDeRevenda extends Error {
  constructor() {
    super(SEM_CONTA_DE_REVENDA);
    this.name = "SemContaDeRevenda";
  }
}

// ─── Montagem do corpo ─────────────────────────────────────────────────────

export type EmitenteParaCadastro = {
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  regimeTributario: number;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  email?: string | null;
  telefone?: string | null;
};

export type CscDoAmbiente = { id: string; codigo: string };

export type PedidoDeCadastro = {
  emitente: EmitenteParaCadastro;
  /** Obrigatório para criar; na atualização, só quando o lojista troca o certificado. */
  certificado?: { base64: string; senha: string } | null;
  csc?: { homologacao?: CscDoAmbiente | null; producao?: CscDoAmbiente | null } | null;
};

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const limpo = (v: unknown) => String(v ?? "").trim();

/**
 * O JSON do POST/PUT /v2/empresas. Função pura: o teste confere campo a campo.
 *
 * Decisões que não estão na cara:
 * - IE, CEP e número vão como TEXTO, embora a doc tipifique como inteiro: IE
 *   com zero à esquerda perderia o zero, e "S/N" é número de endereço válido.
 *   A própria resposta da Focus devolve esses campos como texto.
 * - `discrimina_impostos: true` — a Lei 12.741 exige o valor aproximado dos
 *   tributos no cupom do consumidor; a Focus calcula pela tabela do IBPT.
 * - `habilita_contingencia_offline_nfce: false` — em contingência a nota sai
 *   sem protocolo e é transmitida depois; o FireHub ainda não acompanha esse
 *   segundo passo, e uma rejeição posterior ficaria invisível para o lojista.
 * - `certificado_especifico: true` — sem isso, a Focus propaga o certificado
 *   para todas as empresas do mesmo CNPJ raiz (matriz e filiais). Cada loja
 *   manda o seu pela própria tela; trocar o de uma não pode trocar o da outra
 *   sem ninguém ver.
 * - `enviar_email_destinatario: false` — o FireHub não coleta e-mail do
 *   consumidor para isso, e a Focus cobraria o envio.
 * - `habilita_nfe` não é enviado: numa atualização, mandar false desligaria a
 *   NF-e de uma empresa que talvez a use por fora.
 */
export function montarCorpoDaEmpresa(p: PedidoDeCadastro): Record<string, unknown> {
  const e = p.emitente;
  const corpo: Record<string, unknown> = {
    nome: limpo(e.razaoSocial),
    nome_fantasia: limpo(e.nomeFantasia) || limpo(e.razaoSocial),
    // CNPJ alfanumérico (julho/2026) mantém as letras: só tira pontuação.
    cnpj: String(e.cnpj ?? "").toUpperCase().replace(/[^0-9A-Z]/g, ""),
    inscricao_estadual: soDigitos(e.inscricaoEstadual),
    regime_tributario: Number(e.regimeTributario),
    logradouro: limpo(e.logradouro),
    numero: limpo(e.numero),
    bairro: limpo(e.bairro),
    municipio: limpo(e.municipio),
    uf: limpo(e.uf).toUpperCase(),
    cep: soDigitos(e.cep),
    habilita_nfce: true,
    discrimina_impostos: true,
    enviar_email_destinatario: false,
    habilita_contingencia_offline_nfce: false,
  };
  if (limpo(e.complemento)) corpo.complemento = limpo(e.complemento);
  if (limpo(e.email)) corpo.email = limpo(e.email);
  if (soDigitos(e.telefone)) corpo.telefone = soDigitos(e.telefone);

  if (p.certificado?.base64) {
    corpo.arquivo_certificado_base64 = p.certificado.base64;
    corpo.senha_certificado = p.certificado.senha;
    corpo.certificado_especifico = true;
  }

  // O ID do CSC é inteiro na doc; "000001" e 1 são o mesmo idToken.
  const h = p.csc?.homologacao;
  if (h?.codigo && h?.id) {
    corpo.csc_nfce_homologacao = limpo(h.codigo);
    corpo.id_token_nfce_homologacao = Number(soDigitos(h.id));
  }
  const pr = p.csc?.producao;
  if (pr?.codigo && pr?.id) {
    corpo.csc_nfce_producao = limpo(pr.codigo);
    corpo.id_token_nfce_producao = Number(soDigitos(pr.id));
  }

  return corpo;
}

const CAMPOS_SECRETOS = ["arquivo_certificado_base64", "senha_certificado", "csc_nfce_producao", "csc_nfce_homologacao"];

/** Cópia do corpo que pode ir para log: os segredos viram "[omitido]". */
export function corpoSemSegredos(corpo: Record<string, unknown>): Record<string, unknown> {
  const copia = { ...corpo };
  for (const campo of CAMPOS_SECRETOS) if (campo in copia) copia[campo] = "[omitido]";
  return copia;
}

/** Os 4 últimos caracteres do CSC: o bastante para o lojista reconhecer, inútil para assinar. */
export function finalDoCsc(codigo: unknown): string {
  return limpo(codigo).slice(-4).toUpperCase();
}

/**
 * Tira de um texto qualquer coisa que se pareça com segredo antes de mostrar
 * ou logar: as senhas/CSCs informados (exatos) e sequências longas de base64
 * (pedaço do .pfx ecoado numa mensagem de "JSON inválido").
 */
export function semSegredos(texto: unknown, segredos: (string | null | undefined)[] = []): string {
  let t = String(texto ?? "");
  for (const s of segredos) {
    const v = limpo(s);
    if (v.length >= 3) t = t.split(v).join("•••");
  }
  return t.replace(/[A-Za-z0-9+/=]{40,}/g, "[…]").slice(0, 500);
}

// ─── Conferência do que o lojista mandou ───────────────────────────────────

export type ProblemaDoCadastro = { campo: string; mensagem: string };

/**
 * Confere certificado e CSCs ANTES de gastar a viagem até a Focus.
 *
 * Não tenta abrir o .pfx (isso exigiria a senha e uma lib de PKCS#12 só para
 * repetir o que a Focus já faz com mensagem clara); confere o que dá para
 * conferir de graça: tamanho, base64 válido e cara de arquivo DER.
 */
export function conferirPedidoDeCadastro(
  p: Pick<PedidoDeCadastro, "certificado" | "csc">,
  opcoes: { exigirCertificado: boolean }
): ProblemaDoCadastro[] {
  const faltas: ProblemaDoCadastro[] = [];

  const base64 = limpo(p.certificado?.base64);
  if (!base64) {
    if (opcoes.exigirCertificado) {
      faltas.push({ campo: "certificado", mensagem: "Envie o arquivo do certificado digital A1 (.pfx ou .p12)." });
    }
  } else {
    const bytes = bytesDoBase64(base64);
    if (!bytes) {
      faltas.push({ campo: "certificado", mensagem: "O arquivo do certificado chegou corrompido. Selecione o .pfx de novo." });
    } else if (bytes.length > TAMANHO_MAXIMO_DO_CERTIFICADO) {
      faltas.push({
        campo: "certificado",
        mensagem: `O arquivo tem ${Math.ceil(bytes.length / 1024)} KB — um certificado A1 tem poucos KB (limite 50 KB). Confira se escolheu o .pfx certo.`,
      });
    } else if (bytes[0] !== 0x30) {
      // Todo PKCS#12 começa com SEQUENCE (0x30). PDF, imagem ou o .cer
      // público (texto "-----BEGIN") caem aqui.
      faltas.push({
        campo: "certificado",
        mensagem: "Este arquivo não é um certificado A1 (.pfx/.p12). O .cer ou .crt é só a parte pública e não serve para assinar.",
      });
    }
    if (!limpo(p.certificado?.senha)) {
      faltas.push({ campo: "senhaCertificado", mensagem: "Informe a senha do certificado — é a que você definiu ao baixá-lo da certificadora." });
    }
  }

  let algumCsc = false;
  for (const amb of ["homologacao", "producao"] as const) {
    const c = p.csc?.[amb];
    const id = limpo(c?.id);
    const codigo = limpo(c?.codigo);
    const nome = amb === "producao" ? "produção" : "homologação";
    if (!id && !codigo) continue;
    if (!id || !codigo) {
      faltas.push({ campo: `csc.${amb}`, mensagem: `Para o CSC de ${nome}, informe os dois: o ID (ex.: 000001) e o código.` });
      continue;
    }
    if (!/^\d{1,6}$/.test(id)) {
      faltas.push({ campo: `csc.${amb}.id`, mensagem: `O ID do CSC de ${nome} é um número curto (ex.: 000001 ou 1).` });
    }
    if (!/^[A-Za-z0-9-]{6,64}$/.test(codigo)) {
      faltas.push({ campo: `csc.${amb}.codigo`, mensagem: `O CSC de ${nome} tem letras e números, sem espaços. Copie de novo do portal da SEFAZ.` });
    }
    algumCsc = true;
  }
  if (opcoes.exigirCertificado && !algumCsc) {
    faltas.push({
      campo: "csc",
      mensagem: "Informe ao menos o CSC de homologação (para testar) ou o de produção, com o ID de cada um. Eles são gerados no portal da SEFAZ do seu estado.",
    });
  }

  return faltas;
}

function bytesDoBase64(b64: string): Buffer | null {
  const semPrefixo = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(semPrefixo)) return null;
  const bytes = Buffer.from(semPrefixo, "base64");
  return bytes.length > 0 ? bytes : null;
}

/** Base64 limpo (sem prefixo data:, sem quebras) — é o que vai para a Focus. */
export function base64Limpo(b64: string): string {
  return b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
}

// ─── Tradução dos erros da Focus ───────────────────────────────────────────

/**
 * Traduz a resposta de erro da Focus para uma frase que o lojista entende e
 * sabe o que fazer. Casos reais da doc: senha errada, certificado de outro
 * CNPJ, certificado vencido, empresa de fora da revenda, token recusado.
 */
export function traduzirErroDaFocus(status: number, dados: any, segredos: (string | null | undefined)[] = []): string {
  if (status === 401 || status === 403) {
    return (
      "A Focus NFe recusou a conta de revenda do FireHub (token inválido). O problema é do nosso lado, " +
      "não do seu cadastro — avise o suporte do FireHub. Nada foi cadastrado."
    );
  }
  if (status === 404) {
    return "A empresa desta loja não foi encontrada na Focus NFe. Tente o cadastro de novo; se persistir, avise o suporte.";
  }
  if (status >= 500) {
    return `A Focus NFe está fora do ar agora (HTTP ${status}). Nada foi cadastrado — tente de novo em alguns minutos.`;
  }

  const erros: any[] = Array.isArray(dados?.erros) ? dados.erros : [];
  const codigoGeral = String(dados?.codigo ?? erros[0]?.codigo ?? "");

  if (codigoGeral === "permissao_negada") {
    return (
      "Este CNPJ já está cadastrado na Focus NFe, mas em outra conta (não na do FireHub). " +
      "Se você tem conta própria lá, use a opção \"Já tenho conta na Focus NFe\"; " +
      "se não, peça à Focus para transferir a empresa para a revenda do FireHub."
    );
  }
  // 400 parametros_invalidos ecoa o corpo cru (com o .pfx e a senha). Nunca repassar.
  if (status === 400 || codigoGeral === "parametros_invalidos") {
    return "A Focus NFe não entendeu os dados enviados. Nada foi cadastrado — avise o suporte do FireHub.";
  }

  const frases = erros.map((e) => traduzirUmErro(e, segredos)).filter(Boolean);
  if (frases.length === 0) {
    const m = semSegredos(dados?.mensagem, segredos);
    return m ? `A Focus NFe recusou o cadastro: ${m}` : `A Focus NFe recusou o cadastro (HTTP ${status}).`;
  }
  return Array.from(new Set(frases)).join(" ");
}

const NOMES_DOS_CAMPOS: Record<string, string> = {
  cnpj: "CNPJ",
  nome: "Razão social",
  nome_fantasia: "Nome fantasia",
  inscricao_estadual: "Inscrição Estadual",
  regime_tributario: "Regime tributário",
  logradouro: "Logradouro",
  numero: "Número",
  bairro: "Bairro",
  municipio: "Município",
  uf: "UF",
  cep: "CEP",
  email: "E-mail",
  telefone: "Telefone",
  csc_nfce_producao: "CSC de produção",
  csc_nfce_homologacao: "CSC de homologação",
  id_token_nfce_producao: "ID do CSC de produção",
  id_token_nfce_homologacao: "ID do CSC de homologação",
};

function traduzirUmErro(e: any, segredos: (string | null | undefined)[]): string {
  const campo = String(e?.campo ?? "");
  const mensagem = semSegredos(e?.mensagem, segredos);
  const m = mensagem.toLowerCase();

  if (campo === "arquivo_certificado_base64" || campo === "senha_certificado" || /certificado/.test(m)) {
    if (/n[aã]o pertence/.test(m)) {
      return "Este certificado é de outro CNPJ. Use o e-CNPJ A1 da própria empresa (o mesmo CNPJ cadastrado aqui).";
    }
    if (/vencid|validade/.test(m)) {
      return "Este certificado está vencido. Compre/renove o A1 na certificadora e envie o arquivo novo.";
    }
    if (/senha|instalar|formato|pfx|p12/.test(m)) {
      return "A senha não abre este certificado (ou o arquivo não é um .pfx/.p12). Confira a senha — ela diferencia maiúsculas de minúsculas.";
    }
    return `Certificado recusado pela Focus: ${mensagem}`;
  }
  if (campo === "cnpj" && /j[aá]|existe|utilizad|cadastrad/.test(m)) {
    return "Este CNPJ já está cadastrado na Focus NFe.";
  }
  const nome = NOMES_DOS_CAMPOS[campo] || campo;
  return nome ? `${nome}: ${mensagem}` : mensagem;
}

// ─── Chamadas ──────────────────────────────────────────────────────────────

export type RespostaDaFocus = { status: number; dados: any };

async function chamar(
  metodo: "GET" | "POST" | "PUT",
  caminho: string,
  opcoes: { corpo?: Record<string, unknown>; dryRun?: boolean } = {}
): Promise<RespostaDaFocus> {
  const token = tokenDeRevenda();
  if (!token) throw new SemContaDeRevenda();

  const url = new URL(`${API_DE_EMPRESAS}${caminho}`);
  if (opcoes.dryRun) url.searchParams.set("dry_run", "1");

  const res = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
      ...(opcoes.corpo ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
    },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    // Até quatro chamadas por cadastro (busca, dry_run, envio, consulta) cabem
    // nos 60 s da rota só se nenhuma passar de ~25 s.
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  const textoDaResposta = await res.text();
  let dados: any = null;
  try {
    dados = textoDaResposta ? JSON.parse(textoDaResposta) : null;
  } catch {
    // 401 vem como texto puro ("HTTP Basic: Access denied").
    dados = { mensagem: textoDaResposta.slice(0, 300) };
  }
  return { status: res.status, dados };
}

/** Empresa já cadastrada na revenda com este CNPJ (evita criar em dobro após uma falha no meio). */
export async function buscarEmpresaPorCnpj(cnpj: string): Promise<string | null> {
  const digitos = soDigitos(cnpj);
  // O filtro da Focus só aceita 14 dígitos; CNPJ alfanumérico segue pelo POST,
  // que acusa duplicidade por conta própria.
  if (!/^\d{14}$/.test(digitos) || digitos !== String(cnpj).replace(/[^0-9A-Za-z]/g, "")) return null;
  const r = await chamar("GET", `?cnpj=${digitos}`);
  if (r.status !== 200 || !Array.isArray(r.dados)) return null;
  const achada = r.dados.find((e: any) => soDigitos(e?.cnpj) === digitos);
  return achada?.id != null ? String(achada.id) : null;
}

export async function consultarEmpresa(id: string): Promise<RespostaDaFocus> {
  return chamar("GET", `/${encodeURIComponent(id)}`);
}

/** Cria (sem id) ou atualiza (com id). `dryRun` valida tudo na Focus sem gravar nada lá. */
export async function enviarEmpresa(
  corpo: Record<string, unknown>,
  empresaId: string | null,
  dryRun: boolean
): Promise<RespostaDaFocus> {
  return empresaId
    ? chamar("PUT", `/${encodeURIComponent(empresaId)}`, { corpo, dryRun })
    : chamar("POST", "", { corpo, dryRun });
}

export type EmpresaNaFocus = {
  id: string | null;
  tokenProducao: string | null;
  tokenHomologacao: string | null;
  certificadoValidoAte: string | null;
  certificadoCnpj: string | null;
  habilitaNfce: boolean;
};

/** O que interessa da resposta da Focus (EmpresaResponse). */
export function lerEmpresa(dados: any): EmpresaNaFocus {
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    id: dados?.id != null && String(dados.id).trim() ? String(dados.id) : null,
    tokenProducao: t(dados?.token_producao),
    tokenHomologacao: t(dados?.token_homologacao),
    certificadoValidoAte: t(dados?.certificado_valido_ate),
    certificadoCnpj: t(dados?.certificado_cnpj),
    habilitaNfce: dados?.habilita_nfce === true,
  };
}
