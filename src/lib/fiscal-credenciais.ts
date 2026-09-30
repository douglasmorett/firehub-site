/**
 * As credenciais que emitem nota em nome da loja — guardadas cifradas.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * O token da Focus NFe emite, cancela e inutiliza NFC-e em nome da empresa. A
 * auditoria de 24/09/2026 achou ele em texto puro dentro de User.fiscalConfig:
 * qualquer dump do banco, backup ou rota de debug entregaria a credencial
 * fiscal de todas as lojas. Agora ele é gravado com AES-256-GCM, com a chave
 * em variável de ambiente (FISCAL_CHAVE — ver "A chave fiscal", abaixo).
 *
 * ── Um token por ambiente ───────────────────────────────────────────────────
 *
 * A Focus tem um token de HOMOLOGAÇÃO e outro de PRODUÇÃO por empresa (a API
 * de Empresas devolve os dois). O FireHub guardava um só, e trocar de ambiente
 * obrigava o lojista a colar outro token. Agora ficam os dois em
 * `fiscalConfig.tokens`, e o ambiente escolhido decide qual vai na chamada.
 * O `tokenDoProvedor` antigo (texto puro, colado à mão) continua valendo como
 * reserva até a loja ser cadastrada pelo caminho novo — mas SÓ no ambiente
 * dele (`ambienteDoToken`). Ver `tokenDoAmbiente`.
 *
 * O certificado A1 e o CSC NÃO ficam aqui: vão direto para a Focus no
 * cadastro da empresa (api/store/fiscal/provisionar) e o FireHub guarda só a
 * validade do certificado e os 4 últimos dígitos do CSC, para mostrar.
 *
 * Só servidor.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "crypto";

// ── A CHAVE FISCAL ──────────────────────────────────────────────────────────
//
// Uma chave guarda, por 5 anos, tudo o que emite nota em nome das lojas: o
// certificado A1 e a senha dele, o CSC, o token da Focus, os XMLs com CPF e
// endereço de cliente, e é ela que sela o link público do DANFE. Por isso:
//
//  - Em PRODUÇÃO a FISCAL_CHAVE é obrigatória, sem reserva. Antes, na falta
//    dela, a chave caía no NEXTAUTH_SECRET — e girar o segredo de sessão (o
//    que se faz depois de qualquer suspeita de vazamento) tornaria ilegíveis,
//    de uma vez, todos os certificados, senhas, CSCs, XMLs e links já
//    enviados. Em desenvolvimento e nos testes a reserva continua valendo.
//
//  - Uma SUBCHAVE por uso (HKDF-SHA256): a que cifra (AES-256-GCM), a que dá
//    nome aos arquivos do cofre e a que sela o link do DANFE. Usar o mesmo
//    segredo para cifrar e para HMAC não quebra nada hoje, mas amarra os três
//    usos: a subchave de um não diz nada da do outro.
//
//  - Todo valor cifrado leva o ID DA CHAVE que o cifrou (8 hexadecimais,
//    também derivado por HKDF, que não revela a chave): "fh2:<id>:…" no texto
//    e "FHC2" + id nos arquivos. Trocar a chave é pôr a nova em FISCAL_CHAVE e
//    a velha em FISCAL_CHAVES_ANTIGAS (separadas por vírgula): o que foi
//    cifrado com a velha continua abrindo (e o link continua conferindo), e
//    tudo o que se cifra dali em diante sai com a nova.
//
//  - Os formatos de antes ("fh1:" e "FHC1", sem id, chave = SHA-256 do
//    segredo) só existiram em desenvolvimento — este emissor nunca foi para
//    produção com eles. Continuam abrindo FORA de produção (com a FISCAL_CHAVE,
//    o NEXTAUTH_SECRET de reserva ou uma antiga); em produção, não.

/** Os usos da chave fiscal — cada um com a sua subchave, nunca a mesma. */
export type UsoDaChaveFiscal = "cifra" | "nome-de-arquivo" | "selo-do-link";

/** Chave fiscal ausente, curta ou inválida: erro de CONFIGURAÇÃO do servidor, não da loja. */
export class ErroDaChaveFiscal extends Error {}

/**
 * O que a TELA diz quando o servidor está sem a FISCAL_CHAVE. A mensagem do
 * erro (com o `openssl rand`) é para quem administra o servidor e vai só para
 * o log; o lojista não tem o que fazer além de avisar — "tente de novo" o
 * mandaria repetir à toa.
 */
export const MENSAGEM_SEM_CHAVE_FISCAL =
  "O servidor do FireHub está sem a chave que protege os dados fiscais (FISCAL_CHAVE). Não é nada na sua loja: avise o suporte do FireHub.";

type ChaveFiscal = {
  /** 8 hexadecimais: vai no cabeçalho do que é cifrado, para achar a chave certa depois de uma troca. */
  id: string;
  subchaves: Record<UsoDaChaveFiscal, Buffer>;
  /** A chave dos formatos de desenvolvimento (fh1:/FHC1): SHA-256 do segredo, sem HKDF. */
  daVersao1: Buffer;
};

/** Em produção: o mínimo de uma chave gerada ao acaso (ex.: `openssl rand -base64 48` dá 64). */
export const TAMANHO_MINIMO_DA_FISCAL_CHAVE = 32;

const PREFIXO = "fh2:";
const PREFIXO_DA_VERSAO_1 = "fh1:";
const MAGICO = Buffer.from("FHC2");
const MAGICO_DA_VERSAO_1 = Buffer.from("FHC1");
/** "FHC2" + id(4) + iv(12) + tag(16). */
const CABECALHO = 4 + 4 + 12 + 16;

const emProducao = () => process.env.NODE_ENV === "production";

function derivar(segredo: string, uso: string, bytes: number): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(segredo, "utf8"), Buffer.from("firehub-fiscal", "utf8"), Buffer.from(`firehub-fiscal/${uso}/v2`, "utf8"), bytes));
}

function chaveDoSegredo(segredo: string): ChaveFiscal {
  return {
    id: derivar(segredo, "id-da-chave", 4).toString("hex"),
    subchaves: {
      cifra: derivar(segredo, "cifra", 32),
      "nome-de-arquivo": derivar(segredo, "nome-de-arquivo", 32),
      "selo-do-link": derivar(segredo, "selo-do-link", 32),
    },
    daVersao1: createHash("sha256").update(`firehub-fiscal:${segredo}`).digest(),
  };
}

// As variáveis são lidas a cada uso (o teste troca a chave no meio), mas as
// derivações só se refazem quando alguma delas muda.
let emMemoria: { de: string; atual: ChaveFiscal; antigas: ChaveFiscal[] } | null = null;

function chavesFiscais(): { atual: ChaveFiscal; antigas: ChaveFiscal[] } {
  const producao = emProducao();
  const propria = String(process.env.FISCAL_CHAVE ?? "").trim();
  const reserva = producao ? "" : String(process.env.NEXTAUTH_SECRET ?? "").trim();
  const antigasCruas = String(process.env.FISCAL_CHAVES_ANTIGAS ?? "");
  const de = JSON.stringify([producao, propria, reserva, antigasCruas]);
  if (emMemoria?.de === de) return emMemoria;

  if (producao && !propria) {
    throw new ErroDaChaveFiscal(
      "Configure FISCAL_CHAVE no servidor (ex.: `openssl rand -base64 48`). Em produção a chave fiscal não cai mais no " +
        "NEXTAUTH_SECRET: sem ela não se cifra nem se abre certificado, senha, CSC, token da Focus, XML de nota ou link do DANFE."
    );
  }
  if (producao && propria.length < TAMANHO_MINIMO_DA_FISCAL_CHAVE) {
    throw new ErroDaChaveFiscal(
      `Configure FISCAL_CHAVE com pelo menos ${TAMANHO_MINIMO_DA_FISCAL_CHAVE} caracteres aleatórios (ex.: \`openssl rand -base64 48\`).`
    );
  }
  const segredo = propria || reserva;
  if (!segredo) throw new ErroDaChaveFiscal("Configure FISCAL_CHAVE (fora de produção, o NEXTAUTH_SECRET serve de reserva).");

  const antigas = [...new Set(antigasCruas.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s && s !== segredo))];
  emMemoria = { de, atual: chaveDoSegredo(segredo), antigas: antigas.map(chaveDoSegredo) };
  return emMemoria;
}

/** A subchave de um uso, da chave ATUAL — a que cifra, nomeia e sela daqui em diante. */
export function subchaveFiscal(uso: UsoDaChaveFiscal): Buffer {
  return chavesFiscais().atual.subchaves[uso];
}

/** As subchaves de um uso que ainda CONFEREM: a atual primeiro, depois as de FISCAL_CHAVES_ANTIGAS. */
export function subchavesQueConferem(uso: UsoDaChaveFiscal): Buffer[] {
  const { atual, antigas } = chavesFiscais();
  return [atual, ...antigas].map((c) => c.subchaves[uso]);
}

/** O id (8 hexadecimais) da chave atual: o que vai no cabeçalho do que se cifra agora. */
export function idDaChaveFiscal(): string {
  return chavesFiscais().atual.id;
}

/** As chaves com este id (a atual ou alguma antiga). Duas com o mesmo id é azar de 1 em 4 bilhões — tenta as duas. */
function chavesComId(id: string): ChaveFiscal[] {
  const { atual, antigas } = chavesFiscais();
  return [atual, ...antigas].filter((c) => c.id === id);
}

/** As chaves que abrem o formato de desenvolvimento (só fora de produção). */
function chavesDaVersao1(): Buffer[] {
  if (emProducao()) return [];
  const { atual, antigas } = chavesFiscais();
  return [atual, ...antigas].map((c) => c.daVersao1);
}

function abrirGcm(chave: Buffer, iv: Buffer, tag: Buffer, dados: Buffer, aad: Buffer | null): Buffer {
  const d = createDecipheriv("aes-256-gcm", chave, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]);
}

/** Cifra um segredo: "fh2:<id da chave>:<iv>.<tag>.<dados>" (base64). Vazio continua vazio. */
export function cifrar(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").trim();
  if (!t) return null;
  const { atual } = chavesFiscais();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", atual.subchaves.cifra, iv);
  // O cabeçalho entra na autenticação: trocar o id (ou a versão) não abre.
  c.setAAD(Buffer.from(`${PREFIXO}${atual.id}`, "utf8"));
  const dados = Buffer.concat([c.update(t, "utf8"), c.final()]);
  return `${PREFIXO}${atual.id}:${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${dados.toString("base64")}`;
}

/**
 * Decifra. Valor sem prefixo é o formato antigo (texto puro) e volta como
 * está — a loja que colou o token à mão antes desta mudança continua emitindo.
 * Valor cifrado que não abre (chave trocada sem a antiga em
 * FISCAL_CHAVES_ANTIGAS, valor mexido) volta null: melhor "falta token" na
 * tela do que mandar lixo para a Focus. Servidor SEM chave fiscal não é "não
 * abre": é erro de configuração (ErroDaChaveFiscal), e ele sobe.
 */
export function decifrar(valor: string | null | undefined): string | null {
  const v = String(valor ?? "").trim();
  if (!v) return null;
  if (v.startsWith(PREFIXO)) {
    const m = /^fh2:([0-9a-f]{8}):([^.]*)\.([^.]*)\.(.*)$/.exec(v);
    if (!m) return null;
    const [, id, iv, tag, dados] = m;
    for (const chave of chavesComId(id)) {
      try {
        return abrirGcm(chave.subchaves.cifra, Buffer.from(iv, "base64"), Buffer.from(tag, "base64"), Buffer.from(dados, "base64"), Buffer.from(`${PREFIXO}${id}`, "utf8")).toString("utf8");
      } catch {
        /* a próxima com o mesmo id, se houver */
      }
    }
    return null;
  }
  if (v.startsWith(PREFIXO_DA_VERSAO_1)) {
    const [iv, tag, dados] = v.slice(PREFIXO_DA_VERSAO_1.length).split(".");
    for (const chave of chavesDaVersao1()) {
      try {
        return abrirGcm(chave, Buffer.from(iv ?? "", "base64"), Buffer.from(tag ?? "", "base64"), Buffer.from(dados ?? "", "base64"), null).toString("utf8");
      } catch {
        /* a próxima */
      }
    }
    return null;
  }
  return v;
}

// ── ARQUIVOS: o certificado A1 e os XMLs das notas ──────────────────────────
//
// O emissor próprio (lib/nfce) guarda arquivos que não podem vazar: o .pfx da
// loja (quem tem o arquivo e a senha assina nota em nome da empresa) e os XMLs
// autorizados, que trazem CPF e endereço do cliente. Eles moram no volume de
// uploads (lib/nfce/armazenamento.ts), e esse volume fica dentro de public/ —
// por isso o conteúdo é cifrado (a subchave de cifra, a mesma dos tokens), e
// não só escondido.

/** Cifra bytes: "FHC2" + id da chave(4) + iv(12) + tag(16) + dados. */
export function cifrarBytes(dados: Buffer | Uint8Array): Buffer {
  const { atual } = chavesFiscais();
  const id = Buffer.from(atual.id, "hex");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", atual.subchaves.cifra, iv);
  c.setAAD(Buffer.concat([MAGICO, id]));
  const corpo = Buffer.concat([c.update(Buffer.from(dados)), c.final()]);
  return Buffer.concat([MAGICO, id, iv, c.getAuthTag(), corpo]);
}

/** Decifra o que `cifrarBytes` fez. Chave que o servidor não tem, ou arquivo mexido: erro — nunca devolve lixo. */
export function decifrarBytes(cifrado: Buffer | Uint8Array): Buffer {
  const b = Buffer.from(cifrado);
  if (b.length >= CABECALHO && b.subarray(0, 4).equals(MAGICO)) {
    const id = b.subarray(4, 8).toString("hex");
    const chaves = chavesComId(id);
    if (chaves.length === 0) {
      throw new Error(`Arquivo fiscal cifrado com uma chave que este servidor não tem (id ${id}): confira FISCAL_CHAVE e FISCAL_CHAVES_ANTIGAS.`);
    }
    let erro: unknown = null;
    for (const chave of chaves) {
      try {
        return abrirGcm(chave.subchaves.cifra, b.subarray(8, 20), b.subarray(20, 36), b.subarray(36), Buffer.concat([MAGICO, b.subarray(4, 8)]));
      } catch (e) {
        erro = e;
      }
    }
    throw erro;
  }
  // "FHC1" + iv(12) + tag(16) + dados: o formato de desenvolvimento.
  if (b.length >= 32 && b.subarray(0, 4).equals(MAGICO_DA_VERSAO_1)) {
    if (emProducao()) throw new Error("Arquivo fiscal no formato de desenvolvimento (FHC1): não é aceito em produção.");
    let erro: unknown = new Error("Arquivo fiscal em formato desconhecido.");
    for (const chave of chavesDaVersao1()) {
      try {
        return abrirGcm(chave, b.subarray(4, 16), b.subarray(16, 32), b.subarray(32), null);
      } catch (e) {
        erro = e;
      }
    }
    throw erro;
  }
  throw new Error("Arquivo fiscal em formato desconhecido.");
}

/**
 * Um nome de arquivo que não se adivinha: HMAC da identificação (a chave da
 * nota, por exemplo) com a subchave de nomes. Sem isto, quem soubesse a chave
 * de acesso de uma nota (ela sai impressa no cupom) acharia o arquivo no
 * disco. O caminho vai gravado no banco, então trocar a chave fiscal não
 * perde arquivo: só os guardados depois da troca ganham nome novo.
 */
export function nomeOpaco(identificacao: string): string {
  return createHmac("sha256", subchaveFiscal("nome-de-arquivo")).update(`arquivo:${identificacao}`).digest("hex").slice(0, 40);
}

export type TokensDoProvedor = { homologacao?: string | null; producao?: string | null };

/** 1 = produção, 2 = homologação (o `ambiente` do fiscalConfig). */
export function nomeDoAmbiente(ambiente: unknown): "producao" | "homologacao" {
  return Number(ambiente) === 1 ? "producao" : "homologacao";
}

/**
 * De que ambiente é o token colado à mão (`tokenDoProvedor`).
 *
 * A Focus dá um token por ambiente, e o colado à mão é UM deles. Antes ele
 * servia de reserva para os dois: a tela mostrava "token ✓" em homologação e
 * em produção, e a guarda de troca de ambiente deixava passar para produção
 * com o token de homologação — toda NFC-e de produção voltaria 401 da Focus.
 *
 * `ambienteDoToken` é gravado junto com o token (lib/fiscal-config →
 * aplicarFormularioFiscal). Config antiga, sem a marca: lib/fiscal-config →
 * normalizarConfigFiscal carimba o ambiente gravado na época, ANTES de qualquer
 * rota trocar o `ambiente` do objeto (cancelar e DANFE usam o da nota; o
 * pacote do contador, o de produção). Quem chega aqui sem normalizar (a
 * emissão, a automática, a inutilização) passa o ambiente gravado, que é o
 * mesmo palpite. Medido em 24/09/2026: nenhuma loja tem `tokenDoProvedor`
 * gravado — a regra vale para quem colar daqui em diante.
 */
export function ambienteDoTokenColado(config: { ambiente?: unknown; ambienteDoToken?: unknown }): "producao" | "homologacao" {
  const marcado = config.ambienteDoToken;
  if (marcado === null || marcado === undefined || marcado === "") return nomeDoAmbiente(config.ambiente);
  if (Number(marcado) === 1) return "producao";
  // "Produção", "producao", "PRODUCAO": o texto que a tela antiga gravava.
  return /produ[cç]/i.test(String(marcado)) ? "producao" : "homologacao";
}

/**
 * O token que vale para o ambiente escolhido: o do cadastro pela API (cifrado,
 * em `tokens`) e, na falta, o colado à mão (`tokenDoProvedor`) — este só se
 * for DESTE ambiente (ver `ambienteDoTokenColado`).
 */
export function tokenDoAmbiente(
  config: { ambiente?: unknown; tokens?: TokensDoProvedor | null; tokenDoProvedor?: string | null; ambienteDoToken?: unknown } | null | undefined
): string | null {
  if (!config) return null;
  const alvo = nomeDoAmbiente(config.ambiente);
  const doCadastro = decifrar(config.tokens?.[alvo]);
  if (doCadastro) return doCadastro;
  if (ambienteDoTokenColado(config) !== alvo) return null;
  return decifrar(config.tokenDoProvedor);
}
