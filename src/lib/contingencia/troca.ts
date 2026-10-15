/**
 * PARA ONDE A TELA VAI quando a nuvem some (Modo Contingência) — a regra,
 * sem navegador, para o teste (scripts/teste-contingencia.ts e
 * scripts/teste-marca-de-volta.ts). Quem usa é
 * components/contingencia/TrocaDeContingencia.tsx; a rede de segurança
 * (public/sw-contingencia.js) repete a mesma regra em JavaScript solto, porque
 * o service worker não importa módulo — mudou aqui, muda lá (o teste confere a
 * constante da queda nos dois).
 *
 * Uma página https não consegue "testar" o endereço http do computador da
 * loja antes de ir (o navegador bloqueia o fetch misto): ela vai às cegas. E
 * se o computador estiver desligado, a tela cai na página de erro do Chrome e
 * FICA lá — mesmo depois de a nuvem voltar. Visto em 12/10: num deploy à
 * noite, com o PC do caixa desligado, a TV do KDS ficaria presa no erro até
 * alguém mexer.
 *
 * Por isso:
 *   - no computador que HOSPEDA a contingência, quem decide é o Assistente
 *     dele (alcançável daqui): só vai quando o FireHub local está pronto e o
 *     supervisor declarou a queda (ou é o "Testar agora");
 *   - o computador do caixa NUNCA vira "outro aparelho": se este navegador já
 *     viu o Assistente com a contingência ativada e agora ele não responde
 *     (lento na troca de versão, reiniciando), fica e confere de novo — antes
 *     ele ia para o IP da rede, que estava fechado, e parava no erro do Chrome
 *     (14/10, 11h15);
 *   - nos outros aparelhos (TV, garçom, outro PC), só vai depois de ~45 s de
 *     queda seguida (decisão do Douglas, 14/10 noite: um soluço de 502 no pico
 *     mandava a TV do KDS para o PC de casa dele), se o computador da loja
 *     estava vivo no último sinal da nuvem, se o próprio aparelho tem rede e
 *     se não acabou de voltar do computador da loja (espera crescente).
 */

/**
 * Quanto tempo de queda seguida, no relógio do aparelho, antes de uma tela
 * que NÃO é o computador do caixa ir para o computador da loja. O supervisor
 * declara a queda com ~30 s; a tela espera um pouco mais, para chegar com a
 * porta da loja já em contingência. O mesmo valor está em
 * public/sw-contingencia.js (QUEDA_MS) — o teste confere.
 */
export const QUEDA_ANTES_DE_PULAR_MS = 45_000;

/**
 * Depois de voltar do computador da loja, quanto esperar antes de pular de
 * novo — pelo número de pulos seguidos (1º, 2º, 3º em diante). Sem isso, a
 * nuvem soluçando no pico faz a TV ir e voltar sem parar (o vaivém de 14/10).
 */
export const ESPERAS_ENTRE_PULOS_MS = [60_000, 3 * 60_000, 10 * 60_000];

/** A nuvem respondendo bem por este tempo zera a contagem de pulos. */
export const NUVEM_FIRME_MS = 2 * 60_000;

/** localStorage da NUVEM: `{ em, n }` da última volta (a página do service worker também lê). */
export const CHAVE_DA_VOLTA = "firehub_contingencia_voltou";

/** localStorage: este navegador é o do computador do caixa (o Assistente respondeu ativa=true). */
export const CHAVE_SOU_O_PC = "firehub_contingencia_sou_o_pc";

/**
 * No computador da loja (sessionStorage e localStorage da origem
 * http://<ip>:7890, gravados por app/contingencia/entrar): de que endereço da
 * nuvem a tela saiu (com ou sem www) e quantos pulos seguidos já houve — para
 * a volta (components/contingencia/TrocaDeContingencia.tsx).
 */
export const CHAVE_DA_ORIGEM = "firehub_contingencia_origem";
export const CHAVE_DOS_PULOS = "firehub_contingencia_pulos";

/**
 * Os endereços da nuvem para onde uma tela pode voltar. Lista FIXA: o
 * endereço de volta chega pelo fragmento da URL, e sem a lista qualquer link
 * viraria um redirecionamento para fora. O "www" vale porque cada endereço
 * guarda a própria entrada (cookie): quem saiu do www volta para o www.
 */
export const ORIGENS_DA_NUVEM = ["https://firehubfood.com.br", "https://www.firehubfood.com.br"];

/** Para onde vai a tela sem "volta" válido. */
export const VOLTA_PADRAO = "/store/pedidos-clientes";

export type SituacaoDaTroca = {
  /** O Assistente DESTE computador tem a contingência ativada (é o computador da loja). */
  contingenciaAqui: boolean;
  /** O endereço do FireHub local, se o Assistente diz que está pronto. */
  enderecoNoAssistente: string | null;
  /** O último sinal da nuvem disse que o computador da loja está vivo (sem sinal ainda: true). */
  pcVivo: boolean;
  /** Os endereços do computador da loja na rede, do bilhete. */
  enderecos: string[];
  /** Há quanto tempo a nuvem falha sem parar, no relógio deste aparelho (0 = respondeu na última). */
  quedaHaMs: number;
  /** Este navegador já viu o Assistente com a contingência ativada (CHAVE_SOU_O_PC). */
  souOPc?: boolean;
  /** navigator.onLine: false = o próprio aparelho está sem rede (Wi-Fi caiu). */
  online?: boolean;
  /** O que o supervisor diz, pelo Assistente ("normal", "contingencia", "voltando"…). */
  modoNoAssistente?: string | null;
  /** "Testar agora" neste computador. */
  testando?: boolean;
  /** Quanto ainda falta da espera depois da última volta (esperaDepoisDaVolta). */
  esperaDaVoltaMs?: number;
};

/** O endereço para onde ir agora, ou null para ficar e conferir de novo. */
export function destinoDaTroca(s: SituacaoDaTroca): string | null {
  const esperando = !!s.esperaDaVoltaMs && s.esperaDaVoltaMs > 0;
  // ── O computador do caixa: vale o que o Assistente diz ───────────────────
  if (s.contingenciaAqui) {
    if (!s.enderecoNoAssistente) return null; // FireHub local ainda subindo
    if (s.testando) return s.enderecoNoAssistente;
    // O supervisor já declarou a queda e esta tela também não alcança a nuvem.
    // (O 127.0.0.1 não depende do Wi-Fi: aqui não importa o navigator.onLine.)
    if ((s.modoNoAssistente === "contingencia" || s.modoNoAssistente === "voltando") && s.quedaHaMs > 0) return s.enderecoNoAssistente;
    // Só o navegador deste computador sem a nuvem (o supervisor a vê): espera
    // o mesmo que os outros aparelhos e respeita a volta recente.
    if (s.quedaHaMs >= QUEDA_ANTES_DE_PULAR_MS && !esperando) return s.enderecoNoAssistente;
    return null;
  }
  // Já foi o computador do caixa e o Assistente não respondeu agora: nunca
  // usa o IP da rede — fica e pergunta de novo.
  if (s.souOPc) return null;
  // ── Os outros aparelhos ──────────────────────────────────────────────────
  if (s.online === false) return null; // o Wi-Fi do aparelho caiu: o PC também não estaria lá
  if (esperando) return null;
  if (s.quedaHaMs < QUEDA_ANTES_DE_PULAR_MS) return null;
  if (!s.pcVivo) return null;
  return s.enderecos[0] || null;
}

// ── A marca de volta (#fh-voltou=<ms>&n=<pulos>) ───────────────────────────
// Quem manda a tela de volta para a nuvem leva no FRAGMENTO a hora da volta e
// quantos pulos seguidos já houve. Fragmento porque o localStorage/
// sessionStorage é de cada origem: gravado em http://<ip>:7890, a nuvem nunca
// via (a trava de 60 s de antes nunca funcionou). O fragmento não vai ao
// servidor nem mexe na query (?stage=finishing&… do KDS).

export type MarcaDeVolta = { em: number; n: number };

/** Preferências que só existem por origem (localStorage): som e posição do KDS (app/store/kds/tela). */
export type PreferenciasDoAparelho = Record<string, string>;

// A tela sem id usa `kds-rotacao:<etapa>:<nome da tela>`, e o nome tem espaço
// ("Cozinha Quente"): espaço vale, só caractere de controle fica de fora.
const CHAVE_DE_PREFERENCIA = /^kds-som$|^kds-rotacao:[^\u0000-\u001f\u007f]{1,200}$/;
const VALOR_DE_PREFERENCIA = /^(0|1|90|270)$/;

/** O caminho de volta é deste site: começa com "/" e não com "//" (outro domínio). */
export function voltaSegura(volta: string | null | undefined): string | null {
  const v = String(volta || "");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null;
}

/** A origem só vale se estiver na lista (ORIGENS_DA_NUVEM e as que o supervisor conhece). */
export function origemValida(origem: string | null | undefined, extras: unknown = []): string | null {
  const o = String(origem || "").replace(/\/+$/, "");
  if (!o) return null;
  const doSupervisor = Array.isArray(extras) ? extras.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\/+$/, "")) : [];
  return [...ORIGENS_DA_NUVEM, ...doSupervisor].includes(o) ? o : null;
}

/** Só as chaves e valores conhecidos (nada de gravar o que vier no link). */
export function preferenciasValidas(bruto: unknown): PreferenciasDoAparelho {
  const certo: PreferenciasDoAparelho = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return certo;
  let n = 0;
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (n >= 30) break;
    if (CHAVE_DE_PREFERENCIA.test(k) && typeof v === "string" && VALOR_DE_PREFERENCIA.test(v)) {
      certo[k] = v;
      n++;
    }
  }
  return certo;
}

type Armazenamento = Pick<Storage, "getItem" | "length" | "key">;

/** O localStorage, ou null quando o navegador nega (janela anônima, dados bloqueados). */
export function armazenamentoLocal(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** As preferências deste aparelho, para levar no fragmento. */
export function lerPreferencias(armazenamento: Armazenamento | null | undefined): PreferenciasDoAparelho {
  const bruto: Record<string, string> = {};
  try {
    if (!armazenamento) return {};
    for (let i = 0; i < armazenamento.length; i++) {
      const k = armazenamento.key(i);
      if (!k || !CHAVE_DE_PREFERENCIA.test(k)) continue;
      const v = armazenamento.getItem(k);
      if (v !== null) bruto[k] = v;
    }
  } catch {
    /* sem armazenamento */
  }
  return preferenciasValidas(bruto);
}

/** Grava na origem de destino as preferências que vieram no fragmento. */
export function gravarPreferencias(armazenamento: Pick<Storage, "setItem"> | null | undefined, prefs: unknown): void {
  for (const [k, v] of Object.entries(preferenciasValidas(prefs))) {
    try { armazenamento?.setItem(k, v); } catch { /* sem armazenamento */ }
  }
}

/** Lê as preferências do parâmetro `p` (JSON) de um fragmento. */
export function preferenciasDoFragmento(parametros: URLSearchParams): PreferenciasDoAparelho {
  const p = parametros.get("p");
  if (!p) return {};
  try {
    return preferenciasValidas(JSON.parse(p));
  } catch {
    return {};
  }
}

/**
 * O endereço de volta para a nuvem: origem (da lista) + caminho + a marca.
 * Origem fora da lista vira a `reserva` (se estiver na lista) ou a de sempre;
 * caminho inválido vira VOLTA_PADRAO.
 */
export function urlDeVolta(o: {
  origem: string | null | undefined;
  volta: string | null | undefined;
  em: number;
  n: number;
  /** A origem do supervisor (origemDoPainel / nuvem), se a da tela faltar. */
  reserva?: string | null;
  /** origensDaNuvem do /__contingencia/estado. */
  extras?: unknown;
  preferencias?: PreferenciasDoAparelho;
}): string {
  const origem = origemValida(o.origem, o.extras) || origemValida(o.reserva, o.extras) || ORIGENS_DA_NUVEM[0];
  const caminho = (voltaSegura(o.volta) || VOLTA_PADRAO).split("#")[0];
  const marca = new URLSearchParams({ "fh-voltou": String(Math.trunc(o.em)), n: String(Math.max(1, Math.trunc(o.n) || 1)) });
  const prefs = preferenciasValidas(o.preferencias);
  if (Object.keys(prefs).length) marca.set("p", JSON.stringify(prefs));
  return `${origem}${caminho}#${marca.toString()}`;
}

/** Lê a marca de um location.hash ("#fh-voltou=…&n=…"); sem marca, null. */
export function lerMarcaDeVolta(hash: string): (MarcaDeVolta & { preferencias: PreferenciasDoAparelho }) | null {
  const parametros = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const em = Number(parametros.get("fh-voltou"));
  if (!Number.isFinite(em) || em <= 0) return null;
  const n = Math.max(1, Math.trunc(Number(parametros.get("n"))) || 1);
  return { em, n, preferencias: preferenciasDoFragmento(parametros) };
}

/** Quanto ainda falta esperar depois da última volta (0 = pode pular). */
export function esperaDepoisDaVolta(marca: MarcaDeVolta | null | undefined, agora = Date.now()): number {
  if (!marca || !Number.isFinite(marca.em) || marca.em <= 0) return 0;
  const n = Math.max(1, Math.trunc(marca.n) || 1);
  const espera = ESPERAS_ENTRE_PULOS_MS[Math.min(n, ESPERAS_ENTRE_PULOS_MS.length) - 1];
  // Relógio do aparelho voltou no tempo (marca "no futuro"): conta a partir de agora.
  const passou = Math.max(0, agora - marca.em);
  return Math.max(0, espera - passou);
}

/** A marca guardada (CHAVE_DA_VOLTA), ou null. */
export function lerVoltaGuardada(armazenamento: Pick<Storage, "getItem"> | null | undefined): MarcaDeVolta | null {
  try {
    const g = JSON.parse(armazenamento?.getItem(CHAVE_DA_VOLTA) || "null");
    if (g && Number.isFinite(Number(g.em)) && Number(g.em) > 0) return { em: Number(g.em), n: Math.max(1, Math.trunc(Number(g.n)) || 1) };
  } catch {
    /* ilegível */
  }
  return null;
}

// ── O computador da loja aceita telas? (GET /api/contingencia/sinal) ───────

/** O supervisor relata a cada 30 s: sem notícia há 90 s, o computador conta como desligado. */
export const PC_VIVO_MS = 90_000;

/**
 * A nuvem só diz "pc vivo" a uma tela se o computador falou há pouco, a cópia
 * dele está pronta e ele não avisou que está parando. Usa `copiaPronta` e
 * NÃO `pronta`: `pronta` é sempre false em modo normal (o FireHub local fica
 * desligado), e usá-lo desligaria a troca de todos os aparelhos. Supervisor
 * antigo, sem o campo, conta como pronto (como antes).
 */
export function computadorRecebeTelas(
  vistoEm: number | null | undefined,
  relato: { copiaPronta?: unknown; modo?: unknown; parando?: unknown } | null | undefined,
  agora = Date.now(),
): boolean {
  if (!vistoEm || agora - vistoEm >= PC_VIVO_MS) return false;
  if (relato?.copiaPronta === false || relato?.copiaPronta === "false") return false;
  if (relato?.modo === "parando" || relato?.parando === true || relato?.parando === "true") return false;
  return true;
}
