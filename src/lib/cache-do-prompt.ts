/**
 * O prompt fixo da loja (regras, dados, cardápio) GUARDADO no Google — o cache
 * explícito do Gemini (`ai.caches`).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Cada resposta do robô manda de novo o prompt da loja: 6 a 25 mil tokens,
 * quase tudo cardápio. O Gemini já tem um cache IMPLÍCITO (lê a parte repetida
 * com 90% de desconto), mas sem garantia: em 10–17/10/2026 ele pegou 61% do
 * prompt nas lojas grandes, 49% nas médias e 31% nas pequenas. O cache
 * explícito guarda o mesmo texto no Google e cobra uma "diária" (US$ 0,50 por
 * milhão de tokens por hora no 3.6 Flash, o dobro a partir de 2027); em troca,
 * TODA resposta lê o prompt com o desconto. Conta loja por loja com o uso real
 * daquela semana: ~R$ 600/mês a menos de leitura e ~R$ 180/mês de diária.
 *
 * O texto é o MESMO `systemInstruction` de sempre: o robô vê exatamente o que
 * via, só mais barato. Provado contra a API em 17/10/2026: 22.214 de 22.223
 * tokens vieram do cache e a resposta copiou o preço do cardápio.
 *
 * ── Regras ──────────────────────────────────────────────────────────────────
 *
 * - Nunca segura a mensagem: falta de cache = a resposta sai como antes
 *   (`systemInstruction`), e o cache é criado em segundo plano para as próximas.
 * - Só guarda loja ATENDENDO (2 mensagens em 10 min): loja com uma conversa por
 *   hora pagaria a diária para nada — para ela fica o cache implícito.
 * - Vida curta e renovada no uso (10 min, renova faltando 4): a diária só corre
 *   enquanto a loja atende. Prompt mudou (abriu/fechou, cardápio editado) =
 *   cache novo, e o velho é apagado na hora.
 * - Freio: loja cujo prompt muda a toda hora (mais de 6 caches numa hora) volta
 *   para o cache implícito por uma hora — senão pagaria criação atrás de criação.
 * - O cache que o Google não acha mais responde 403 "CachedContent not found".
 *   Quem chama esquece o cache (`esquecerCacheDaLoja`) e repete a chamada sem
 *   ele — esse 403 NÃO pode chegar a `classificarFalhaDaIa`, que o leria como
 *   chave recusada e abriria incidente.
 */
import { createHash } from "node:crypto";

/** O mínimo que o 3.6 Flash aceita guardar. Abaixo disso nem tenta. */
export const MINIMO_DE_CARACTERES = 4096 * 3;
export const VIDA_DO_CACHE_S = 600;
export const RENOVAR_FALTANDO_MS = 4 * 60_000;
export const JANELA_DE_ATIVIDADE_MS = 10 * 60_000;
export const MENSAGENS_PARA_GUARDAR = 2;
export const MAX_CACHES_POR_HORA = 6;
export const PAUSA_DEPOIS_DO_FREIO_MS = 60 * 60_000;
/** Criação que falhou não tenta de novo (para o mesmo prompt) antes disto. */
export const ESPERA_DEPOIS_DE_FALHA_MS = 15 * 60_000;

/** O pedaço do cliente do Gemini que este arquivo usa (o teste injeta um falso). */
export type ClienteDeCache = {
  caches: {
    create(p: { model: string; config: { systemInstruction: string; ttl: string; displayName?: string } }): Promise<{ name?: string; usageMetadata?: { totalTokenCount?: number } }>;
    update(p: { name: string; config: { ttl: string } }): Promise<unknown>;
    delete(p: { name: string }): Promise<unknown>;
  };
};

type Entrada = {
  hash: string;
  nome: string | null;
  expiraEm: number;
  tokens: number;
  criando: boolean;
  renovando: boolean;
  falhouEm?: number;
};

type Estado = {
  porChave: Map<string, Entrada>;
  atividade: Map<string, number[]>;
  criacoes: Map<string, number[]>;
  pausadoAte: Map<string, number>;
};

function estado(): Estado {
  const g = globalThis as any;
  if (!g.__firehubCacheDoPrompt) {
    g.__firehubCacheDoPrompt = { porChave: new Map(), atividade: new Map(), criacoes: new Map(), pausadoAte: new Map() };
  }
  return g.__firehubCacheDoPrompt as Estado;
}

const resumo = (s: string) => createHash("sha1").update(s).digest("hex");

/** Loja + modelo + chave da API: o cache mora no projeto da chave que o criou. */
function chaveDe(loja: string, modelo: string, apiKey: string) {
  return `${loja}|${modelo}|${resumo(apiKey).slice(0, 10)}`;
}

/** O que a diária e a criação custaram — para o painel de custos (UsageLog). */
export type CustoDoCache = (e: { loja: string; modelo: string; tokens: number; segundos: number; motivo: "criado" | "renovado" }) => void;

type PedidoDeCache = { loja: string; modelo: string; apiKey: string; prompt: string; custo?: CustoDoCache; agora?: number };

/**
 * O nome do cache a usar NESTA chamada, ou null (use `systemInstruction`).
 * Nunca espera nada do Google: criação e renovação correm em segundo plano.
 * Nunca lança: qualquer surpresa aqui (SDK sem `caches`, estado estranho) faz a
 * resposta sair como antes, sem cache.
 */
export function cacheDoPromptDaLoja(ai: ClienteDeCache, o: PedidoDeCache): string | null {
  try {
    return escolherCache(ai, o);
  } catch (err: any) {
    console.warn(`[Cache do prompt] Ignorado nesta mensagem: ${String(err?.message || err).slice(0, 160)}`);
    return null;
  }
}

function escolherCache(ai: ClienteDeCache, o: PedidoDeCache): string | null {
  const agora = o.agora ?? Date.now();
  const e = estado();
  const chave = chaveDe(o.loja, o.modelo, o.apiKey);

  // Atividade da loja: as mensagens dos últimos 10 min.
  const recentes = (e.atividade.get(chave) || []).filter((t) => agora - t < JANELA_DE_ATIVIDADE_MS);
  recentes.push(agora);
  e.atividade.set(chave, recentes.slice(-20));

  if (o.prompt.length < MINIMO_DE_CARACTERES) return null;
  if ((e.pausadoAte.get(chave) || 0) > agora) return null;

  const hash = resumo(o.prompt);
  const atual = e.porChave.get(chave);

  if (atual && atual.hash === hash && atual.nome && atual.expiraEm - agora > 30_000) {
    if (atual.expiraEm - agora < RENOVAR_FALTANDO_MS && !atual.renovando) {
      atual.renovando = true;
      const nome = atual.nome;
      ai.caches.update({ name: nome, config: { ttl: `${VIDA_DO_CACHE_S}s` } })
        .then(() => {
          const restavaS = Math.max(0, (atual.expiraEm - Date.now()) / 1000);
          atual.expiraEm = Date.now() + VIDA_DO_CACHE_S * 1000;
          o.custo?.({ loja: o.loja, modelo: o.modelo, tokens: atual.tokens, segundos: VIDA_DO_CACHE_S - restavaS, motivo: "renovado" });
        })
        .catch(() => { if (e.porChave.get(chave) === atual) e.porChave.delete(chave); })
        .finally(() => { atual.renovando = false; });
    }
    return atual.nome;
  }

  // Sem cache utilizável para ESTE prompt. Guarda em segundo plano, se valer.
  if (recentes.length < MENSAGENS_PARA_GUARDAR) return null;
  if (atual && atual.hash === hash && (atual.criando || (atual.falhouEm && agora - atual.falhouEm < ESPERA_DEPOIS_DE_FALHA_MS))) return null;

  const criacoes = (e.criacoes.get(chave) || []).filter((t) => agora - t < 60 * 60_000);
  if (criacoes.length >= MAX_CACHES_POR_HORA) {
    e.pausadoAte.set(chave, agora + PAUSA_DEPOIS_DO_FREIO_MS);
    console.warn(`[Cache do prompt] ⛔ Loja ${o.loja}: ${criacoes.length} caches na última hora (o prompt muda demais). Volta ao cache implícito por 1 h.`);
    return null;
  }
  criacoes.push(agora);
  e.criacoes.set(chave, criacoes);

  // O cache do prompt anterior (loja abriu/fechou, cardápio editado) para de
  // cobrar diária agora, não quando vencer.
  if (atual?.nome && atual.hash !== hash) ai.caches.delete({ name: atual.nome }).catch(() => {});

  const nova: Entrada = { hash, nome: null, expiraEm: 0, tokens: 0, criando: true, renovando: false };
  e.porChave.set(chave, nova);
  ai.caches.create({
    model: o.modelo,
    config: { systemInstruction: o.prompt, ttl: `${VIDA_DO_CACHE_S}s`, displayName: `firehub-${o.loja}`.slice(0, 120) },
  })
    .then((c) => {
      if (!c?.name) throw new Error("cache sem nome");
      nova.nome = c.name;
      nova.tokens = Number(c.usageMetadata?.totalTokenCount) || Math.round(o.prompt.length / 3);
      nova.expiraEm = Date.now() + VIDA_DO_CACHE_S * 1000;
      o.custo?.({ loja: o.loja, modelo: o.modelo, tokens: nova.tokens, segundos: VIDA_DO_CACHE_S, motivo: "criado" });
      // Se outro prompt tomou o lugar enquanto este era criado, ele não serve mais.
      if (e.porChave.get(chave) !== nova) ai.caches.delete({ name: c.name }).catch(() => {});
    })
    .catch((err) => {
      nova.falhouEm = Date.now();
      console.warn(`[Cache do prompt] Não consegui guardar o prompt da loja ${o.loja}: ${String(err?.message || err).slice(0, 160)}`);
    })
    .finally(() => { nova.criando = false; });
  return null;
}

/** O Google não achou o cache (venceu antes da hora, ou foi apagado): esquece, a próxima chamada cria outro. */
export function esquecerCacheDaLoja(o: { loja: string; modelo: string; apiKey: string; nome: string }) {
  const e = estado();
  const chave = chaveDe(o.loja, o.modelo, o.apiKey);
  if (e.porChave.get(chave)?.nome === o.nome) e.porChave.delete(chave);
}

/** É o erro do cache que sumiu? (403 "CachedContent not found (or permission denied)") */
export function ehErroDeCacheSumido(erro: unknown): boolean {
  const t = String((erro as any)?.message ?? erro ?? "");
  return /cached ?content/i.test(t) && /not found|permission|expired|invalid|does not exist/i.test(t);
}

/** Só para o teste. */
export function limparEstadoDoCacheDoPrompt() {
  delete (globalThis as any).__firehubCacheDoPrompt;
}
