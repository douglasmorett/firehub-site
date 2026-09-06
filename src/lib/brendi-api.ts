/**
 * /src/lib/brendi-api.ts
 * Helper centralizado para autenticação e chamadas à API da Brendi (Open Delivery).
 * Clone estrutural de jotaja-api.ts — mesma família Abrasel: OAuth2
 * client_credentials + wrappers autenticados + ações de status do pedido.
 *
 * MULTI-TENANT: cada loja tem credencial própria, gerada no painel da Brendi
 * (app.brendi.com.br → Integrações → API Pública) e colada no FireHub.
 *
 * ── Por que NÃO existe fallback para variável de ambiente ───────────────────
 *
 * O jotaja-api.ts tem um fallback para JOTAJA_CLIENT_ID/SECRET quando a loja
 * não tem credencial no banco — e foi exatamente esse fallback que fez loja
 * recém-conectada herdar credencial ALHEIA e puxar pedido de outro restaurante.
 * Aqui a regra é uma só: credencial vem do banco ou a chamada falha com erro
 * claro. Loja sem credencial não fala com a Brendi, ponto.
 *
 * (Se a Brendi confirmar que a credencial é do PARCEIRO — uma só para o FireHub
 * cobrindo N lojas — o pivô acontece SÓ dentro de getBrendiCredentials; nenhum
 * outro módulo precisa saber.)
 *
 * ── Por que SQL cru em vez do Prisma Client ─────────────────────────────────
 *
 * As colunas brendi* do User são garantidas no boot por brendi-colunas.ts
 * (ALTER TABLE ... IF NOT EXISTS), ANTES de entrarem no schema.prisma — regra
 * da casa para não quebrar produção com migração. Enquanto não estão no schema,
 * o Prisma Client não as conhece: `prisma.user.findUnique({ select: ... })`
 * com esses campos nem compila. Então este módulo acessa via $queryRaw
 * parametrizado, com tipagem manual, igual food99-lojas.ts faz.
 */

import { prisma } from "@/lib/prisma";

/** Endpoints confirmados na RAIZ do domínio — sem sufixo /openDelivery como no JotaJá. */
export const BRENDI_BASE = process.env.BRENDI_BASE_URL || "https://api.brendi.com.br";

/**
 * Teto por requisição. Lição do 99Food: o parceiro fora do ar nunca pode
 * segurar a operação da loja — melhor falhar em 15s e tentar de novo do que
 * deixar o atendente olhando para uma tela travada.
 */
const TIMEOUT_MS = 15_000;

// ── Credenciais ─────────────────────────────────────────────────────────────

export interface BrendiCredentials {
  clientId: string;
  clientSecret: string;
  merchantId: string | null;
  connected: boolean;
  /** Id do User onde as credenciais moram (o dono da conta) — chave do cache de token. */
  donoId: string;
}

/** Linha crua do User com os campos que o Prisma Client ainda não conhece. */
interface LinhaUser {
  id: string;
  ownerId: string | null;
  brendiClientId: string | null;
  brendiClientSecret: string | null;
  brendiMerchantId: string | null;
  brendiConnected: boolean | null;
}

async function linhaDoUsuario(id: string): Promise<LinhaUser | null> {
  const r = await prisma.$queryRaw<LinhaUser[]>`
    SELECT "id", "ownerId", "brendiClientId", "brendiClientSecret", "brendiMerchantId", "brendiConnected"
    FROM "User"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return Array.isArray(r) && r[0] ? r[0] : null;
}

/**
 * Resolve as credenciais Brendi de uma loja — SEMPRE do banco, SEM fallback.
 *
 * A credencial mora no DONO da conta (`ownerId || id`): filial de rede aponta
 * para o dono via ownerId, e é lá que a tela de Integrações grava. Buscar na
 * filial devolveria null e pareceria "loja não conectada" — sintoma idêntico ao
 * de credencial errada, diagnóstico oposto.
 *
 * Devolve null quando não há credencial (ou quando as colunas ainda não
 * existem — boot ensure não rodou): sem credencial, nada roda, que é o gate
 * natural do deploy.
 */
export async function getBrendiCredentials(storeId: string): Promise<BrendiCredentials | null> {
  try {
    const linha = await linhaDoUsuario(storeId);
    if (!linha) return null;

    // Filial aponta para o dono; se a busca do dono falhar, a própria linha
    // ainda pode ter credencial (o caso comum: storeId JÁ é o dono).
    const dono =
      linha.ownerId && linha.ownerId !== linha.id
        ? (await linhaDoUsuario(linha.ownerId)) ?? linha
        : linha;

    if (!dono.brendiClientId || !dono.brendiClientSecret) return null;

    return {
      clientId: dono.brendiClientId,
      clientSecret: dono.brendiClientSecret,
      merchantId: dono.brendiMerchantId ?? null,
      connected: !!dono.brendiConnected,
      donoId: dono.id,
    };
  } catch {
    // Colunas brendi* ainda não criadas neste banco. Não é exceção de quem
    // chama: é o estado "integração nunca configurada".
    return null;
  }
}

// ── Token OAuth ─────────────────────────────────────────────────────────────

/**
 * Cache POR DONO, não por processo: duas lojas da mesma conta compartilham
 * token; contas diferentes jamais se cruzam. O clientId gravado junto derruba
 * o cache sozinho quando o lojista troca a credencial — token antigo com
 * credencial nova é 401 garantido.
 */
const _tokenCache = new Map<string, { token: string; exp: number; clientId: string }>();

/**
 * Promise-sharing anti-corrida: cron, poll do dashboard e webhook podem pedir
 * token da MESMA loja no mesmo instante. Sem isto, três idas ao oauth/token —
 * e provedores OAuth costumam invalidar o token anterior a cada emissão.
 */
const _pendingTokenFetches = new Map<string, Promise<string>>();

const chaveDoCache = (creds: BrendiCredentials) => `dono_${creds.donoId}`;

async function fetchNewToken(creds: BrendiCredentials): Promise<string> {
  const res = await fetch(`${BRENDI_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Brendi auth falhou: ${res.status} — ${err.slice(0, 300)}`);
  }

  // Mesmo cuidado do JotaJá: implementações Open Delivery divergem entre
  // snake_case e camelCase até no token. Aceitar os dois custa uma linha;
  // não aceitar custa a integração inteira.
  const data = await res.json();
  const token: string | undefined = data.access_token ?? data.accessToken;
  if (!token) {
    throw new Error("Brendi auth: resposta 200 sem access_token — contrato inesperado");
  }

  // Folga de 60s: token que vence NO MEIO da chamada seguinte é 401 aleatório,
  // o tipo de erro que some quando se tenta reproduzir.
  const expMs = Date.now() + ((data.expires_in ?? data.expiresIn ?? 3600) - 60) * 1000;
  _tokenCache.set(chaveDoCache(creds), { token, exp: expMs, clientId: creds.clientId });

  return token;
}

/** Obtém (ou reutiliza) o Bearer token da loja, com cache por dono. */
export async function getBrendiToken(storeId: string): Promise<string> {
  const creds = await getBrendiCredentials(storeId);
  if (!creds) {
    throw new Error(`Brendi: credenciais não configuradas para a loja ${storeId}`);
  }

  const chave = chaveDoCache(creds);
  const cached = _tokenCache.get(chave);
  if (cached && Date.now() < cached.exp && cached.clientId === creds.clientId) {
    return cached.token;
  }

  const pending = _pendingTokenFetches.get(chave);
  if (pending) return pending;

  const tokenPromise = fetchNewToken(creds);
  _pendingTokenFetches.set(chave, tokenPromise);
  try {
    return await tokenPromise;
  } finally {
    _pendingTokenFetches.delete(chave);
  }
}

/** 401 no meio do caminho = token revogado do lado deles. Derruba o cache e o próximo uso renova. */
async function invalidateTokenCache(storeId: string): Promise<void> {
  const creds = await getBrendiCredentials(storeId);
  if (creds) _tokenCache.delete(chaveDoCache(creds));
}

/**
 * Teste de conexão REAL: bate no oauth/token da Brendi com a credencial que
 * está no banco e diz se autenticou. É o que a tela de Integrações chama antes
 * de gravar `brendiConnected=true` — regra da casa desde o 99Food: "conectado"
 * é resposta do parceiro, nunca booleano de formulário.
 *
 * Ignora o cache de propósito: teste de conexão que devolve token requentado
 * diria "verde" para credencial recém-trocada e inválida.
 */
export async function autenticarBrendi(storeId: string): Promise<{ ok: boolean; erro?: string }> {
  const creds = await getBrendiCredentials(storeId);
  if (!creds) {
    return { ok: false, erro: "Credenciais da Brendi não configuradas para esta loja." };
  }
  try {
    await fetchNewToken(creds);
    return { ok: true };
  } catch (e: any) {
    const erro =
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? `Brendi não respondeu em ${TIMEOUT_MS / 1000}s`
        : e?.message || "Falha ao autenticar na Brendi.";
    return { ok: false, erro };
  }
}

// ── Wrappers autenticados ───────────────────────────────────────────────────

/**
 * Wrapper autenticado para LEITURAS (GET) — per-store.
 * Devolve o Response cru: quem chama (polling, import, diagnóstico) decide o
 * que fazer com status e corpo. Pode lançar em falha de rede/timeout — os
 * wrappers de status abaixo é que nunca deixam exceção escapar.
 */
export async function brendiFetch(
  path: string,
  storeId: string,
  options: RequestInit = {}
): Promise<Response> {
  const doFetch = async () => {
    const token = await getBrendiToken(storeId);
    return fetch(`${BRENDI_BASE}${path}`, {
      method: "GET",
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
      signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  };

  const res = await doFetch();
  if (res.status === 401) {
    // Token expirou ou foi revogado — invalida o cache e tenta UMA vez.
    await invalidateTokenCache(storeId);
    return doFetch();
  }
  return res;
}

/**
 * Wrapper autenticado para ESCRITAS (POST/PUT/DELETE) — per-store.
 * `body` null/undefined = requisição sem corpo (os endpoints de status da
 * Brendi em geral não exigem corpo; requestCancellation é a exceção).
 */
export async function brendiMutate(
  method: string,
  path: string,
  body: unknown,
  storeId: string
): Promise<Response> {
  const doFetch = async () => {
    const token = await getBrendiToken(storeId);
    return fetch(`${BRENDI_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };

  const res = await doFetch();
  if (res.status === 401) {
    await invalidateTokenCache(storeId);
    return doFetch();
  }
  return res;
}

// ── Ações de status do pedido ───────────────────────────────────────────────
//
// Todas devolvem { ok, erro? } e NUNCA lançam: uma falha ao avisar a Brendi
// vira log/lista de quem chamou, jamais impede a loja de tocar a operação
// dela. Encerrar pedido no FireHub não depende da Brendi responder — lição
// aprendida no sync do 99Food.

export interface ResultadoBrendi {
  ok: boolean;
  erro?: string;
}

async function acaoDePedido(
  acao: string,
  orderId: string,
  storeId: string,
  body?: Record<string, unknown>
): Promise<ResultadoBrendi> {
  try {
    const res = await brendiMutate("POST", `/v1/orders/${orderId}/${acao}`, body ?? null, storeId);
    if (res.ok) return { ok: true };

    const texto = await res.text().catch(() => "");
    const erro = `${acao} ${orderId}: HTTP ${res.status} — ${texto.slice(0, 300)}`;
    console.warn(`[Brendi] ⚠️ ${erro}`);
    return { ok: false, erro };
  } catch (e: any) {
    const motivo =
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? `Brendi não respondeu em ${TIMEOUT_MS / 1000}s`
        : e?.message || "falha desconhecida";
    const erro = `${acao} ${orderId}: ${motivo}`;
    console.warn(`[Brendi] ⚠️ ${erro}`);
    return { ok: false, erro };
  }
}

/**
 * Confirma o pedido. É a chamada mais importante do arquivo: originadores Open
 * Delivery CANCELAM sozinhos o pedido que a loja não confirma a tempo — um
 * confirm repetido custa uma chamada; um confirm que faltou custa a venda.
 */
export async function confirmarPedidoBrendi(orderId: string, storeId: string): Promise<ResultadoBrendi> {
  return acaoDePedido("confirm", orderId, storeId);
}

export async function preparandoBrendi(orderId: string, storeId: string): Promise<ResultadoBrendi> {
  return acaoDePedido("preparing", orderId, storeId);
}

export async function prontoBrendi(orderId: string, storeId: string): Promise<ResultadoBrendi> {
  return acaoDePedido("readyForPickup", orderId, storeId);
}

export async function despacharBrendi(orderId: string, storeId: string): Promise<ResultadoBrendi> {
  return acaoDePedido("dispatch", orderId, storeId);
}

/**
 * Fecha o pedido de ENTREGA.
 *
 * A pergunta "quem dá baixa quando a Brendi é que entrega?" tem resposta, e
 * ela vem no próprio pedido: o campo de topo `sendDelivered` (booleano) diz se
 * esta chamada é nossa. Medido no primeiro pedido real da sandbox em
 * 05/09/2026. Quem decide é `brendi-status.ts`, lendo a flag gravada — não
 * mais o palpite por `deliveryBy`.
 */
export async function entregueBrendi(orderId: string, storeId: string): Promise<ResultadoBrendi> {
  return acaoDePedido("delivered", orderId, storeId);
}

/**
 * Fecha o pedido de RETIRADA — o equivalente ao `delivered` quando o cliente
 * busca no balcão. Governado por `sendPickedUp` no pedido.
 *
 * Faltava: sem esta chamada, todo pedido de retirada ficava aberto para sempre
 * do lado da Brendi, por mais que a loja o finalizasse aqui.
 */
export async function retiradoBrendi(orderId: string, storeId: string): Promise<ResultadoBrendi> {
  return acaoDePedido("pickedUp", orderId, storeId);
}

/**
 * Os únicos motivos de cancelamento que a Brendi aceita.
 *
 * Medidos contra a API em 05/09/2026, no erro que ela mesma devolve:
 * `{"path":["code"],"message":"Required","expected":"'SYSTEMIC_ISSUES' | …"}`.
 *
 * Até aqui mandávamos `cancellationCode: "501"` — o código numérico do padrão
 * Open Delivery, que o iFood e o JotaJá usam. A Brendi **não** usa números e o
 * campo nem se chama assim: é `code`, com um destes textos. O resultado é que
 * **nenhum cancelamento nosso jamais teria funcionado**: HTTP 400 em toda
 * tentativa, virando linha de log enquanto o cliente esperava por um pedido que
 * a loja já tinha cancelado.
 */
export const MOTIVOS_CANCELAMENTO_BRENDI = [
  "SYSTEMIC_ISSUES",
  "DUPLICATE_APPLICATION",
  "UNAVAILABLE_ITEM",
  "RESTAURANT_WITHOUT_DELIVERY_PERSON",
  "OUTDATED_MENU",
  "ORDER_OUTSIDE_THE_DELIVERY_AREA",
  "BLOCKED_CUSTOMER",
  "OUTSIDE_DELIVERY_HOURS",
  "INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT",
  "RISK_AREA",
  "DELIVERY_PROBLEM",
] as const;

export type MotivoCancelamentoBrendi = (typeof MOTIVOS_CANCELAMENTO_BRENDI)[number];

/**
 * Traduz o motivo que veio da tela (texto livre, escrito pelo lojista) para um
 * dos códigos aceitos.
 *
 * O default é `INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT` — o mais genérico e o
 * mais honesto quando não se sabe: pedido recusado por dificuldade da loja. O
 * texto original continua indo em `reason`, então nada se perde para quem lê.
 */
export function motivoCancelamentoBrendi(texto?: string | null): MotivoCancelamentoBrendi {
  const t = String(texto || "").toUpperCase();
  // Um código já válido vindo de cima passa direto.
  if ((MOTIVOS_CANCELAMENTO_BRENDI as readonly string[]).includes(t)) return t as MotivoCancelamentoBrendi;

  if (/DUPLICAD|DUPLICAT|REPETID/.test(t)) return "DUPLICATE_APPLICATION";
  if (/INDISPON|SEM ESTOQUE|ACABOU|FALTA/.test(t)) return "UNAVAILABLE_ITEM";
  if (/MOTOBOY|ENTREGADOR/.test(t)) return "RESTAURANT_WITHOUT_DELIVERY_PERSON";
  if (/CARD(Á|A)PIO|PRE(Ç|C)O/.test(t)) return "OUTDATED_MENU";
  if (/(Á|A)REA DE ENTREGA|FORA DA (Á|A)REA|LONGE|DIST(Â|A)NCIA/.test(t)) return "ORDER_OUTSIDE_THE_DELIVERY_AREA";
  if (/RISCO|PERIGO|VIOL(Ê|E)NCIA/.test(t)) return "RISK_AREA";
  if (/FECHAD|HOR(Á|A)RIO/.test(t)) return "OUTSIDE_DELIVERY_HOURS";
  if (/ENTREGA|ROTA/.test(t)) return "DELIVERY_PROBLEM";
  if (/CLIENTE|TROTE|BLOQUEAD/.test(t)) return "BLOCKED_CUSTOMER";
  if (/SISTEMA|INTERNET|QUEDA/.test(t)) return "SYSTEMIC_ISSUES";
  return "INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT";
}

/**
 * Solicita cancelamento — e também é a RECUSA de pedido novo: a Brendi não
 * expõe `/deny` como o JotaJá, então recusar = requestCancellation com motivo.
 *
 * O campo obrigatório é `code`, com um dos textos de
 * `MOTIVOS_CANCELAMENTO_BRENDI`. O `reason` continua indo junto porque é o que
 * uma pessoa lê do outro lado.
 */
export async function solicitarCancelamentoBrendi(
  orderId: string,
  storeId: string,
  reason?: string
): Promise<ResultadoBrendi> {
  return acaoDePedido("requestCancellation", orderId, storeId, {
    code: motivoCancelamentoBrendi(reason),
    reason: reason || "Restaurante não pode aceitar o pedido no momento.",
  });
}

/** Aceita o cancelamento pedido pelo cliente (fluxo de disputa do dashboard). */
export async function aceitarCancelamentoBrendi(
  orderId: string,
  storeId: string,
  reason?: string
): Promise<ResultadoBrendi> {
  return acaoDePedido("acceptCancellation", orderId, storeId, {
    reason: reason || "Cancelamento aceito pelo restaurante.",
  });
}

/** Nega o cancelamento pedido pelo cliente — o pedido continua de pé. */
export async function negarCancelamentoBrendi(
  orderId: string,
  storeId: string,
  reason?: string
): Promise<ResultadoBrendi> {
  return acaoDePedido("denyCancellation", orderId, storeId, {
    reason: reason || "O restaurante não pode aceitar o cancelamento neste momento.",
  });
}
