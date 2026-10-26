/**
 * /src/lib/evopdv/assinatura.ts
 *
 * A assinatura fiscal do EvoPDV (R$ 67/mês na Cakto, produto `fiscal:<email>`)
 * conferida PELO FIREHUB, na Vercel do EvoPDV (`api/fiscal-status.js`).
 *
 * ── A regra (decisão de 25/10/2026) ─────────────────────────────────────────
 *
 *  - cache de 1 hora: dentro dele, vale a última resposta;
 *  - a Vercel fora do ar (rede, 5xx, resposta ilegível): vale a última
 *    confirmação de ATIVA por até 72 horas ("folga"); depois, inativa;
 *  - inativa bloqueia só a nota NOVA. Consultar, cancelar, DANFE, XML e a
 *    contingência que já saiu continuam (as rotas não perguntam aqui).
 *
 * ── O contrato com a Vercel ─────────────────────────────────────────────────
 *
 *   GET  {EVOPDV_FISCAL_STATUS_URL}?email=<e-mail da licença>
 *   Authorization: Bearer {EVOPDV_FISCAL_STATUS_SEGREDO}
 *   200  { "ativo": true | false, "ate"?: ISO }
 *
 * Sem EVOPDV_FISCAL_STATUS_URL a conferência está DESLIGADA e tudo vale como
 * ativo (o FireHub sobe antes de a Vercel ter a rota; o log avisa uma vez).
 *
 * Só servidor. O fetch e o relógio são injetáveis (teste).
 */

export const CACHE_DA_ASSINATURA_MS = 60 * 60_000;
export const FOLGA_DA_ASSINATURA_MS = 72 * 60 * 60_000;
/** Depois de uma falha da Vercel, não pergunta de novo antes disto (cada nota perguntaria). */
const ESPERA_DEPOIS_DA_FALHA_MS = 5 * 60_000;
const TEMPO_DA_CONSULTA_MS = 8_000;

export type CacheDaAssinatura = {
  ativa: boolean;
  conferidaEm: string | null;
  ultimaAtivaEm: string | null;
  falhouEm: string | null;
};

export type SituacaoDaAssinatura = {
  ativa: boolean;
  /** "cache" | "vercel" | "folga" | "desligada" | "sem_resposta" */
  fonte: "cache" | "vercel" | "folga" | "desligada" | "sem_resposta";
  /** O que gravar de volta em IntegracaoEvopdv.assinatura (null = nada mudou). */
  gravar: CacheDaAssinatura | null;
};

type Buscar = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let buscarDeTeste: Buscar | null = null;
/** O fetch dos testes (o stub da Vercel). Em produção fica null. */
export function usarBuscaDaAssinaturaDeTeste(b: Buscar | null): void {
  buscarDeTeste = b;
}

let avisouDesligada = false;

const lerCache = (v: unknown): CacheDaAssinatura => {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const data = (x: unknown) => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);
  return { ativa: o.ativa === true, conferidaEm: data(o.conferidaEm), ultimaAtivaEm: data(o.ultimaAtivaEm), falhouEm: data(o.falhouEm) };
};

/** Pergunta à Vercel; null = sem resposta que sirva. */
async function perguntar(email: string, env: Record<string, string | undefined>): Promise<boolean | null> {
  const url = new URL(String(env.EVOPDV_FISCAL_STATUS_URL));
  url.searchParams.set("email", email);
  const buscar: Buscar = buscarDeTeste ?? ((u, init) => fetch(u, init) as any);
  try {
    const r = await buscar(url.toString(), {
      headers: { Authorization: `Bearer ${env.EVOPDV_FISCAL_STATUS_SEGREDO ?? ""}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TEMPO_DA_CONSULTA_MS),
    });
    if (!r.ok) return null;
    const corpo = (await r.json()) as Record<string, unknown> | null;
    return typeof corpo?.ativo === "boolean" ? corpo.ativo : null;
  } catch {
    return null;
  }
}

/**
 * A assinatura deste e-mail vale agora? Devolve também o que gravar no cache.
 * Sem e-mail da licença não há o que perguntar: inativa.
 */
export async function situacaoDaAssinatura(
  email: string | null | undefined,
  gravado: unknown,
  agora: Date = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<SituacaoDaAssinatura> {
  if (!String(env.EVOPDV_FISCAL_STATUS_URL ?? "").trim()) {
    if (!avisouDesligada) {
      avisouDesligada = true;
      console.warn("[EvoPDV] EVOPDV_FISCAL_STATUS_URL vazio: a assinatura fiscal NÃO é conferida (toda conta vale como ativa).");
    }
    return { ativa: true, fonte: "desligada", gravar: null };
  }
  const cache = lerCache(gravado);
  const t = agora.getTime();
  const conferida = cache.conferidaEm ? Date.parse(cache.conferidaEm) : NaN;
  if (Number.isFinite(conferida) && t - conferida < CACHE_DA_ASSINATURA_MS && t >= conferida) return { ativa: cache.ativa, fonte: "cache", gravar: null };

  const naFolga = () => {
    const ultima = cache.ultimaAtivaEm ? Date.parse(cache.ultimaAtivaEm) : NaN;
    return Number.isFinite(ultima) && t - ultima <= FOLGA_DA_ASSINATURA_MS;
  };
  const falhou = cache.falhouEm ? Date.parse(cache.falhouEm) : NaN;
  if (Number.isFinite(falhou) && t - falhou < ESPERA_DEPOIS_DA_FALHA_MS && t >= falhou) {
    return { ativa: naFolga(), fonte: naFolga() ? "folga" : "sem_resposta", gravar: null };
  }

  const resposta = String(email ?? "").trim() ? await perguntar(String(email).trim().toLowerCase(), env) : false;
  if (resposta == null) {
    const gravar = { ...cache, falhouEm: agora.toISOString() };
    return { ativa: naFolga(), fonte: naFolga() ? "folga" : "sem_resposta", gravar };
  }
  const gravar: CacheDaAssinatura = {
    ativa: resposta,
    conferidaEm: agora.toISOString(),
    ultimaAtivaEm: resposta ? agora.toISOString() : cache.ultimaAtivaEm,
    falhouEm: null,
  };
  return { ativa: resposta, fonte: "vercel", gravar };
}
