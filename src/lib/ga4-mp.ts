/**
 * Measurement Protocol do GA4 — o evento de venda saindo do SERVIDOR.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * É o mesmo problema que a API de Conversões do Meta resolve (src/lib/meta-capi.ts):
 * o gtag do navegador perde uma fatia grande dos eventos — bloqueador de
 * anúncio, iOS, Safari cortando cookie, aba fechada antes do envio. No GA4 o
 * estrago é diferente do Meta, mas igualmente caro: a venda simplesmente não
 * existe no relatório, e a campanha do Google Ads que trouxe o cliente não
 * recebe o sinal de conversão.
 *
 * ── O QUE EVITA CONTAR DUAS VEZES ───────────────────────────────────────────
 *
 * O navegador e o servidor mandam o MESMO `purchase`. O que impede a venda de
 * aparecer em dobro é o `transaction_id`: o GA4 descarta uma transação repetida
 * quando reconhece o mesmo id. Por isso ele é DETERMINÍSTICO por pedido (o
 * próprio `orderId`), calculado pela mesma função dos dois lados — nunca um
 * número aleatório, que nunca casaria.
 *
 * ── CLIENT_ID É O QUE LIGA A VENDA À ORIGEM ─────────────────────────────────
 *
 * O Meta casa a pessoa por telefone/e-mail em SHA-256. O GA4 não: quem
 * identifica o visitante é o `client_id`, que vive no cookie `_ga` do
 * navegador. Um evento de servidor com `client_id` inventado cria um visitante
 * NOVO — a compra vira "Direct / none" e o anúncio que a gerou não leva o
 * crédito. Por isso o cardápio captura o `_ga` no checkout e o pedido guarda:
 * sem ele, é melhor não mandar (veja `ga-purchase.ts`).
 */

/** Endpoint de produção do Measurement Protocol. */
const URL_COLETA = "https://www.google-analytics.com/mp/collect";

/**
 * Endpoint de validação. Ele NÃO grava nada na propriedade — só devolve o que
 * está errado no corpo (`validationMessages`). O de produção responde 204 para
 * qualquer coisa, inclusive para um payload que o GA4 vai jogar fora depois.
 *
 * CUIDADO: ele valida o FORMATO, não a AUTENTICAÇÃO. Com um `api_secret`
 * inventado ele responde sem reclamar nenhuma vez (medido em 01/09/2026). Por
 * isso o teste da tela não para aqui: manda também um evento de verdade e pede
 * para o lojista confirmar no Tempo real (veja `enviarEventoDeTesteGa4`).
 */
const URL_DEBUG = "https://www.google-analytics.com/debug/mp/collect";

export type ItemDoPedido = {
  id: string;
  nome?: string | null;
  quantidade: number;
  preco: number;
};

export type CompraGa4 = {
  /** ID de métrica da loja ("G-XXXXXXXXXX"). */
  measurementId: string;
  /** Segredo do Measurement Protocol, gerado no Admin do GA4. */
  apiSecret: string;
  /** ID do pedido — vira o `transaction_id` e a chave de deduplicação. */
  orderId: string;
  valor: number;
  moeda?: string;
  frete?: number | null;
  /** Cookie `_ga` do cliente. Sem ele a venda vira "Direct". */
  clientId?: string | null;
  /** Cookie `_ga_<container>`, para o evento cair na sessão certa. */
  sessionId?: string | null;
  itens?: ItemDoPedido[];
  /** Só no teste da tela de Integrações: valida sem gravar. */
  modoValidacao?: boolean;
};

export type ResultadoGa4 =
  | { ok: true; transactionId: string; validado: boolean }
  | { ok: false; erro: string; transactionId: string };

/**
 * O `transaction_id` do purchase de um pedido.
 *
 * O navegador precisa mandar EXATAMENTE este valor, senão a mesma venda entra
 * duas vezes no relatório de e-commerce.
 */
export function idDaTransacao(orderId: string): string {
  return String(orderId);
}

/**
 * `client_id` a partir do cookie `_ga`.
 *
 * O cookie tem a forma `GA1.1.1234567890.1699999999` e o `client_id` são os
 * DOIS últimos campos juntos (`1234567890.1699999999`) — mandar o cookie
 * inteiro é o erro clássico: o GA4 aceita, não reclama, e cria um visitante
 * fantasma a cada pedido.
 */
export function clientIdDoCookieGa(cookieGa: string | null | undefined): string | null {
  const v = String(cookieGa ?? "").trim();
  if (!v) return null;
  const partes = v.split(".");
  if (partes.length < 4) return null;
  const id = `${partes[partes.length - 2]}.${partes[partes.length - 1]}`;
  return /^\d+\.\d+$/.test(id) ? id : null;
}

/**
 * Envia um evento QUALQUER para a propriedade — usado pelo teste da tela.
 *
 * ── POR QUE ISTO EXISTE, SE JÁ HÁ O ENDPOINT DE VALIDAÇÃO ───────────────────
 *
 * Porque o de validação NÃO confere o segredo. Medido em 01/09/2026: com um
 * `api_secret` inventado, `/debug/mp/collect` responde sem nenhuma reclamação —
 * ele valida o FORMATO do evento, não a autenticação. Um botão que dissesse
 * "deu certo" com base só nisso mentiria justamente para quem colou o segredo
 * errado, que é o caso em que o lojista precisa da verdade.
 *
 * A única prova real é o evento aparecer no relatório Tempo real. Então o teste
 * manda também um evento de verdade — de nome próprio, sem valor e sem receita,
 * para não sujar o relatório de vendas — e manda o lojista olhar lá.
 */
export async function enviarEventoDeTesteGa4(e: {
  measurementId: string;
  apiSecret: string;
  clientId: string;
  nomeDoEvento: string;
}): Promise<{ ok: boolean; erro?: string }> {
  const measurementId = String(e.measurementId || "").trim().toUpperCase();
  const apiSecret = String(e.apiSecret || "").trim();
  if (!measurementId.startsWith("G-")) {
    return { ok: false, erro: `"${measurementId}" não é um ID de métrica do GA4. Ele começa com G-.` };
  }
  const url =
    `${URL_COLETA}?measurement_id=${encodeURIComponent(measurementId)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: e.clientId,
        events: [{ name: e.nomeDoEvento, params: { engagement_time_msec: 1, debug_mode: 1 } }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, erro: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, erro: String(err?.message || err).slice(0, 300) };
  }
}

/**
 * Envia o `purchase` para a propriedade do GA4 da loja.
 *
 * Nunca lança: a venda já aconteceu e o Google não pode derrubar nada.
 */
export async function enviarCompraParaGa4(e: CompraGa4): Promise<ResultadoGa4> {
  const transactionId = idDaTransacao(e.orderId);

  const measurementId = String(e.measurementId || "").trim().toUpperCase();
  const apiSecret = String(e.apiSecret || "").trim();

  if (!measurementId || !apiSecret) {
    return { ok: false, erro: "Loja sem ID de métrica ou sem segredo do Measurement Protocol.", transactionId };
  }
  if (!measurementId.startsWith("G-")) {
    // O ID de métrica ("G-") e o ID do container ("GTM-") são trocados o tempo
    // todo. O endpoint aceita os dois e responde 204 — e o evento some.
    return { ok: false, erro: `"${measurementId}" não é um ID de métrica do GA4. Ele começa com G-.`, transactionId };
  }

  const clientId = String(e.clientId || "").trim();
  if (!clientId) {
    return {
      ok: false,
      erro: "Pedido sem client_id do GA4 — a venda apareceria como visitante novo, sem origem.",
      transactionId,
    };
  }

  const params: Record<string, any> = {
    transaction_id: transactionId,
    currency: (e.moeda || "BRL").toUpperCase(),
    value: Number(Number(e.valor).toFixed(2)),
    // Sem isto o GA4 do Measurement Protocol conta o evento mas NÃO conta a
    // sessão: o relatório mostra a compra sem canal de aquisição.
    engagement_time_msec: 1,
  };
  if (e.sessionId) params.session_id = String(e.sessionId);
  if (e.frete != null) params.shipping = Number(Number(e.frete).toFixed(2));
  if (e.itens && e.itens.length > 0) {
    params.items = e.itens.map((i) => ({
      item_id: String(i.id),
      item_name: String(i.nome || i.id),
      quantity: Number(i.quantidade) || 1,
      price: Number(Number(i.preco).toFixed(2)),
    }));
  }

  const corpo = {
    client_id: clientId,
    // Em MICROssegundos, e o GA4 descarta o que estiver fora da janela de 72h.
    timestamp_micros: Date.now() * 1000,
    events: [{ name: "purchase", params }],
  };

  const base = e.modoValidacao ? URL_DEBUG : URL_COLETA;
  const url =
    `${base}?measurement_id=${encodeURIComponent(measurementId)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      // A venda não pode esperar o Google. Mesmo limite da CAPI do Meta.
      signal: AbortSignal.timeout(8000),
    });

    if (e.modoValidacao) {
      const d = await res.json().catch(() => ({} as any));
      const problemas: any[] = d?.validationMessages || [];
      if (problemas.length > 0) {
        const msg = problemas.map((p: any) => p?.description || p?.validationCode).join(" | ");
        return { ok: false, erro: String(msg).slice(0, 300), transactionId };
      }
      return { ok: true, transactionId, validado: true };
    }

    // O endpoint de produção responde 204 mesmo para payload ruim — por isso
    // o teste da tela usa o de validação. Aqui só resta o erro de transporte.
    if (!res.ok) {
      return { ok: false, erro: `HTTP ${res.status}`, transactionId };
    }
    return { ok: true, transactionId, validado: false };
  } catch (err: any) {
    return { ok: false, erro: String(err?.message || err).slice(0, 300), transactionId };
  }
}
