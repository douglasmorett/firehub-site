/**
 * /src/lib/wabiz-api.ts — autenticação e chamadas à API da Wabiz (Believery).
 *
 * ── O contrato, medido em 12/09/2026 contra a sandbox (unidade 110) ─────────
 *
 * A Wabiz é um app de delivery com a marca do restaurante. A API é pequena e
 * NÃO é Open Delivery — são três chamadas e mais nada:
 *
 *   POST api/v1/token            form-urlencoded, grant_type=password + usuário
 *                                e senha DA LOJA. Token de 24h (86399s).
 *   GET  api/v1/orders/pending   pedidos que ainda não foram processados.
 *                                Fila vazia responde **404**, não 200 com [].
 *   POST api/v1/orders/status    form-urlencoded: orderNumber, internalKey,
 *                                newOrderStatus, sendNotification,
 *                                additionalMessage, isProcessed.
 *
 * Não há webhook, não há fila de eventos, não há ACK: quem tira o pedido de
 * `pending` é o `status` com `isProcessed=true`. Por isso a confirmação só sai
 * depois de o pedido estar gravado no banco (ver cron/wabiz-poll).
 *
 * Doc: https://docs.believery.com.br (Postman). Contato técnico: dev@wabiz.com.br.
 *
 * ── Credencial por loja, sem fallback de ambiente ───────────────────────────
 *
 * Usuário e senha são da LOJA na Wabiz (fornecidos pelo suporte deles). Mesma
 * regra da Brendi: credencial vem do banco ou a chamada falha. Fallback de
 * variável de ambiente foi o que fez loja nova do JotaJá puxar pedido alheio.
 *
 * As colunas `wabiz*` são garantidas no boot (garantirColunasWabiz) e ficam
 * fora do schema.prisma — regra da casa — então o acesso é SQL cru.
 */

import { prisma } from "@/lib/prisma";

export const WABIZ_BASE = (process.env.WABIZ_BASE_URL || "https://delivery.wabiz.com.br").replace(/\/+$/, "");

/** Parceiro fora do ar não pode segurar a operação: falha em 15s e o próximo ciclo tenta. */
const TIMEOUT_MS = 15_000;

/** Status da Wabiz (doc "Status dos Pedidos"). */
export const WABIZ_STATUS = {
  NAO_CONFIRMADO: 1,
  CONFIRMADO: 2,
  EM_PRODUCAO: 3,
  PRONTO_PARA_RETIRAR: 4,
  SAIU_PARA_ENTREGA: 5,
  FINALIZADO: 6,
  CANCELADO: 7,
} as const;

// ── Credenciais ─────────────────────────────────────────────────────────────

export interface WabizCredenciais {
  usuario: string;
  senha: string;
  connected: boolean;
  /** User onde a credencial mora (dono da conta) — chave do cache de token. */
  donoId: string;
}

interface LinhaUser {
  id: string;
  ownerId: string | null;
  wabizUsername: string | null;
  wabizPassword: string | null;
  wabizConnected: boolean | null;
}

async function linhaDoUsuario(id: string): Promise<LinhaUser | null> {
  const r = await prisma.$queryRaw<LinhaUser[]>`
    SELECT "id", "ownerId", "wabizUsername", "wabizPassword", "wabizConnected"
    FROM "User"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return Array.isArray(r) && r[0] ? r[0] : null;
}

/** Credencial da loja — sempre do dono da conta (`ownerId || id`), nunca de ambiente. */
export async function getWabizCredenciais(storeId: string): Promise<WabizCredenciais | null> {
  try {
    const linha = await linhaDoUsuario(storeId);
    if (!linha) return null;
    const dono =
      linha.ownerId && linha.ownerId !== linha.id ? (await linhaDoUsuario(linha.ownerId)) ?? linha : linha;
    if (!dono.wabizUsername || !dono.wabizPassword) return null;
    return {
      usuario: dono.wabizUsername,
      senha: dono.wabizPassword,
      connected: !!dono.wabizConnected,
      donoId: dono.id,
    };
  } catch {
    // Colunas ainda não criadas = integração nunca configurada.
    return null;
  }
}

// ── Token ───────────────────────────────────────────────────────────────────

/** Cache por dono; o usuário gravado junto derruba o cache quando a credencial muda. */
const cacheToken = new Map<string, { token: string; exp: number; usuario: string }>();
const tokensEmVoo = new Map<string, Promise<string>>();

async function buscarToken(creds: WabizCredenciais): Promise<string> {
  const res = await fetch(`${WABIZ_BASE}/api/v1/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: creds.usuario, password: creds.senha }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    // 400 com "invalid_grant" é o usuário/senha errado — o caso comum.
    throw new Error(`Wabiz recusou o login (HTTP ${res.status}): ${texto.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => ({} as any));
  const token: string | undefined = data?.access_token;
  if (!token) throw new Error("Wabiz: resposta do token sem access_token");

  // Folga de 5 min: token que vence no meio de um ciclo vira 401 aleatório.
  const exp = Date.now() + (Number(data?.expires_in) || 86399) * 1000 - 5 * 60_000;
  cacheToken.set(creds.donoId, { token, exp, usuario: creds.usuario });
  return token;
}

async function tokenDaLoja(storeId: string): Promise<{ token: string; creds: WabizCredenciais }> {
  const creds = await getWabizCredenciais(storeId);
  if (!creds) throw new Error(`Wabiz: credenciais não configuradas para a loja ${storeId}`);

  const emCache = cacheToken.get(creds.donoId);
  if (emCache && emCache.exp > Date.now() && emCache.usuario === creds.usuario) {
    return { token: emCache.token, creds };
  }

  let voo = tokensEmVoo.get(creds.donoId);
  if (!voo) {
    voo = buscarToken(creds).finally(() => tokensEmVoo.delete(creds.donoId));
    tokensEmVoo.set(creds.donoId, voo);
  }
  return { token: await voo, creds };
}

/**
 * Teste REAL de login, ignorando o cache — é o que a tela de Integrações chama
 * antes de gravar `wabizConnected=true`. Conectado é resposta do parceiro.
 */
export async function autenticarWabiz(storeId: string): Promise<{ ok: boolean; erro?: string }> {
  const creds = await getWabizCredenciais(storeId);
  if (!creds) return { ok: false, erro: "Usuário e senha da Wabiz não configurados para esta loja." };
  try {
    await buscarToken(creds);
    return { ok: true };
  } catch (e: any) {
    const erro =
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? `Wabiz não respondeu em ${TIMEOUT_MS / 1000}s`
        : e?.message || "Falha ao autenticar na Wabiz.";
    return { ok: false, erro };
  }
}

/** Chamada autenticada com uma nova tentativa em 401 (token revogado do lado deles). */
async function chamar(storeId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const tentar = async () => {
    const { token } = await tokenDaLoja(storeId);
    return fetch(`${WABIZ_BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
  const res = await tentar();
  if (res.status !== 401) return res;
  const creds = await getWabizCredenciais(storeId);
  if (creds) cacheToken.delete(creds.donoId);
  return tentar();
}

// ── Pedidos ─────────────────────────────────────────────────────────────────

/**
 * Pedidos pendentes da loja. Lança em falha real (rede, 401 persistente, 5xx);
 * fila vazia devolve []. O 404 é o "nada pendente" deles — medido na sandbox.
 */
export async function pedidosPendentesWabiz(storeId: string): Promise<WabizPedido[]> {
  // ── v2 SÓ AQUI ────────────────────────────────────────────────────────────
  //
  // O `pending` ganhou uma v2 (liberada para integrações em 09/2026) que traz
  // `fidelity` e `discountCoupon` — informativos, para a comanda poder dizer
  // POR QUE o total veio menor. A estrutura do resto é idêntica à v1, então
  // nada na tradução muda por causa disto.
  //
  // O token e o `orders/status` continuam em v1: a v2 existe só neste método.
  // Diferença medida em 15/09/2026 contra a sandbox: a v1 responde 404 quando
  // a fila está vazia e a v2 responde 200 com `[]`. Os dois casos já eram
  // tratados aqui.
  const res = await chamar(storeId, "/api/v2/orders/pending", { method: "GET" });
  if (res.status === 404 || res.status === 204) return [];
  const texto = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`orders/pending: HTTP ${res.status} — ${texto.slice(0, 200)}`);
  if (!texto.trim()) return [];
  const data = JSON.parse(texto);
  return Array.isArray(data) ? data : [data];
}

export interface ResultadoWabiz {
  ok: boolean;
  erro?: string;
}

/**
 * Muda o status do pedido na Wabiz. Nunca lança: falha em avisar o parceiro
 * vira log de quem chamou, jamais impede a loja de tocar o pedido.
 *
 * `isProcessed=false` com status 1 é o "não consegui incluir": o painel da
 * Wabiz pinta o pedido de vermelho e toca alerta para o atendente.
 */
export async function mudarStatusWabiz(
  storeId: string,
  pedido: { orderNumber: string | number; internalKey: string },
  novoStatus: number,
  opts: { notificar?: boolean; mensagem?: string; processado?: boolean } = {}
): Promise<ResultadoWabiz> {
  const rotulo = `status ${novoStatus} do pedido ${pedido.orderNumber}`;
  try {
    const res = await chamar(storeId, "/api/v1/orders/status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        orderNumber: String(pedido.orderNumber),
        internalKey: pedido.internalKey,
        newOrderStatus: String(novoStatus),
        sendNotification: String(opts.notificar ?? true),
        additionalMessage: opts.mensagem ?? "",
        isProcessed: String(opts.processado ?? true),
      }),
    });
    const texto = await res.text().catch(() => "");
    if (res.ok) {
      // O corpo traz `success`; 200 com success=false também é recusa.
      try {
        const j = JSON.parse(texto);
        if (j && j.success === false) {
          const erro = `${rotulo}: ${j?.message?.message || texto.slice(0, 200)}`;
          console.warn(`[Wabiz] ⚠️ ${erro}`);
          return { ok: false, erro };
        }
      } catch {
        /* corpo não-JSON com 200: aceita */
      }
      return { ok: true };
    }
    const erro = `${rotulo}: HTTP ${res.status} — ${texto.slice(0, 200)}`;
    console.warn(`[Wabiz] ⚠️ ${erro}`);
    return { ok: false, erro };
  } catch (e: any) {
    const motivo =
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? `Wabiz não respondeu em ${TIMEOUT_MS / 1000}s`
        : e?.message || "falha desconhecida";
    console.warn(`[Wabiz] ⚠️ ${rotulo}: ${motivo}`);
    return { ok: false, erro: `${rotulo}: ${motivo}` };
  }
}

// ── Formato do pedido (doc "Pedidos Pendentes") ─────────────────────────────

export interface WabizOpcao {
  externalCode?: string | null;
  name?: string | null;
  price?: number | null;
  /**
   * QUANTAS vezes esta opção foi escolhida.
   *
   * A doc não declara, e nos pedidos de setembro/2026 o sabor repetido vinha
   * REPETIDO (três "Esfiha Muçarela" como três opções). No Combo 4 da NIK, em
   * 22/09/2026, não veio: 12 esfihas obrigatórias chegaram como 8 opções, uma
   * de cada sabor — o que só fecha se a quantidade estiver num campo destes.
   *
   * Por isso os quatro nomes: o leitor aceita o que vier e continua somando as
   * repetições quando não vier nenhum (ver `quantidadeDaOpcao`).
   */
  qty?: number | string | null;
  quantity?: number | string | null;
  amount?: number | string | null;
  qtd?: number | string | null;
}

export interface WabizCustomizacao {
  name?: string | null;
  options?: WabizOpcao[] | null;
}

export interface WabizParte {
  name?: string | null;
  price?: number | null;
  externalCode?: string | null;
  customization?: {
    additionals?: WabizCustomizacao[] | null;
    edge?: WabizCustomizacao | null;
    others?: WabizCustomizacao[] | null;
  } | null;
  obs?: string | null;
}

export interface WabizProduto {
  pos?: number;
  qty?: number;
  /** Preço de UMA unidade, já com borda/adicionais/massa (conferido nos exemplos). */
  price?: number;
  unity?: string | null;
  parts?: WabizParte[] | null;
  /**
   * Desconto DESTE produto — troca de fidelidade. Vem como texto ("50.00") e é
   * o valor da LINHA (desconto × quantidade), não o unitário.
   *
   * NÃO somar: ele já está dentro do `discounts` da raiz do pedido, e a
   * tradução lê de lá. Fica declarado aqui porque o campo existe e para quem
   * for mexer não achar que está faltando tratamento.
   *
   * Não existe troca parcial: ou o item é trocado por pontos, ou não. O que
   * pode acontecer é o cliente pôr borda ou adicional na pizza trocada — esses
   * ele paga à parte, e é por isso que `price` pode ser maior que `discount`.
   */
  discount?: string | number | null;
}

export interface WabizPagamento {
  type?: number;
  name?: string | null;
  /** Valor que o cliente vai pagar — é daqui que sai o troco. */
  value?: number | null;
  externalCode?: string | null;
  cardFlag?: string | null;
}

export interface WabizPedido {
  orderNumber: number;
  status?: number;
  internalKey: string;
  dateTime?: string;
  obs?: string | null;
  customer?: {
    name?: string | null;
    email?: string | null;
    phoneCode?: string | null;
    phoneNumber?: string | null;
    document?: string | null;
  } | null;
  items?: Array<{ groupName?: string | null; subGroupName?: string | null; products?: WabizProduto[] | null }> | null;
  service?: {
    type?: string;
    delivery?: {
      address?: string | null;
      number?: string | number | null;
      compl?: string | null;
      region?: string | null;
      postalCode?: string | null;
      city?: string | null;
      state?: string | null;
      tax?: number | null;
      referencePoint?: string | null;
      payment?: WabizPagamento | null;
    } | null;
    internalDelivery?: { info?: string | null; payment?: WabizPagamento | null } | null;
    tableCode?: string | null;
    tablePassword?: string | null;
    datetime?: string | null;
    scheduleDatetime?: string | null;
    /** Retirada não traz pagamento na doc; aceitamos se vier. */
    payment?: WabizPagamento | null;
  } | null;
  priceRules?: unknown;
  /**
   * O valor FINAL do pedido, com tudo já calculado — confirmado por escrito
   * pela Wabiz em 15/09/2026. É o líquido: o que o cliente paga.
   */
  total?: number;
  /**
   * TODO o desconto do pedido, incluindo o `discount` que vem dentro de cada
   * produto (a troca de fidelidade) — também confirmado por eles. Por isso a
   * tradução lê só este campo: somar o do produto contaria duas vezes.
   */
  discounts?: number;
  /**
   * Informativos da v2 do `pending`, quando o pedido teve fidelidade ou cupom.
   * O formato não foi declarado e eles avisam que não entram em cálculo algum:
   * servem para a comanda dizer de onde veio o desconto. Leitura tolerante em
   * `wabiz-traducao.ts` — qualquer coisa que vier é tratada como rótulo.
   */
  fidelity?: unknown;
  discountCoupon?: unknown;
}
