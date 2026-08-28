import { createHash } from "crypto";

/**
 * API de Conversões do Meta (CAPI) — o evento de venda saindo do SERVIDOR.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * O pixel do navegador perde entre 30% e 50% dos eventos: bloqueador de
 * anúncio, iOS pedindo permissão de rastreio, Safari cortando cookie de
 * terceiro. O que se perde não é só relatório — é o SINAL que o Meta usa para
 * decidir a quem mostrar o anúncio. Campanha com metade do sinal otimiza pela
 * metade.
 *
 * A CAPI manda o mesmo evento pelo servidor, onde nada disso alcança. Quem faz
 * tráfego pago hoje considera isso obrigatório, não diferencial.
 *
 * ── DEDUPLICAÇÃO É O PONTO ──────────────────────────────────────────────────
 *
 * O navegador e o servidor mandam O MESMO evento. O Meta só entende que são o
 * mesmo se os dois carregarem o MESMO `event_id`. Sem isso, toda venda conta
 * DUAS vezes — o ROAS dobra no relatório, o lojista acha que está indo bem, e o
 * algoritmo aprende errado. É um estrago pior que não ter CAPI nenhuma.
 *
 * Por isso o `event_id` aqui é DETERMINÍSTICO por pedido (`purchase:<orderId>`):
 * não importa quantas vezes o webhook reenviar nem se o navegador disparar
 * antes, é sempre a mesma chave.
 *
 * ── CORRESPONDÊNCIA AVANÇADA ────────────────────────────────────────────────
 *
 * Telefone, e-mail e nome vão em SHA-256, nunca em claro — é como o Meta exige
 * e é o que permite casar a venda com quem viu o anúncio. Sem isso a atribuição
 * despenca. Normalizar antes de hashear não é detalhe: "(22) 99999-8888" e
 * "5522999998888" geram hashes diferentes e nenhum dos dois casa.
 */

// Mesma versão do resto do módulo de tráfego (lib/meta-ads.ts). Estava em
// v21.0: viva, mas com prazo até 21/01/2027 — um ano e meio ANTES da v25.0
// (29/07/2028), que é o que o restante usa. Divergir de novo era repetir o que
// já custou o módulo inteiro apontando para uma versão morta: ninguém percebe
// até a chamada parar de responder, e aqui o que para de responder é o sinal
// de venda que alimenta o algoritmo — silenciosamente, sem erro na tela.
const VERSAO_API = "v25.0";

/** SHA-256 em minúsculas, como o Meta especifica. Vazio vira undefined. */
function hash(valor: string | null | undefined): string | undefined {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return undefined;
  return createHash("sha256").update(v).digest("hex");
}

/**
 * Telefone no formato que o Meta espera: só dígitos, com código do país.
 *
 * O cadastro brasileiro guarda "(22) 99999-8888", "22999998888" ou
 * "5522999998888" conforme a origem do pedido. Mandar como veio produz três
 * hashes diferentes para a mesma pessoa, e nenhum casa com o que o Meta tem.
 */
function telefoneParaHash(bruto: string | null | undefined): string | undefined {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (!d) return undefined;
  // Já tem o 55 na frente e comprimento de número brasileiro completo.
  if (d.length >= 12 && d.startsWith("55")) return hash(d);
  // 10 (fixo com DDD) ou 11 (celular com DDD) dígitos: falta o país.
  if (d.length === 10 || d.length === 11) return hash("55" + d);
  // Qualquer outra coisa é palpite — melhor não mandar do que mandar errado.
  return undefined;
}

export type EventoDeCompra = {
  /** Pixel da loja. Sem ele não há para onde mandar. */
  pixelId: string;
  /** Token da API de Conversões, gerado no Gerenciador de Eventos do Meta. */
  token: string;
  /** ID do pedido — vira a chave de deduplicação. */
  orderId: string;
  valor: number;
  moeda?: string;
  /** URL do cardápio da loja, para o Meta casar com o anúncio. */
  urlDaLoja?: string | null;
  telefone?: string | null;
  email?: string | null;
  nome?: string | null;
  cidade?: string | null;
  /** Cookies do navegador, quando o pedido carregou eles. Melhoram muito a atribuição. */
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Itens, para Anúncio Dinâmico. */
  itens?: { id: string; quantidade: number; preco: number }[];
  /** Só em teste: o código que o Gerenciador de Eventos mostra na aba "Testar eventos". */
  testEventCode?: string | null;
};

export type ResultadoCapi =
  | { ok: true; eventId: string; recebidos: number }
  | { ok: false; erro: string; eventId: string };

/**
 * O `event_id` do Purchase de um pedido. DETERMINÍSTICO de propósito.
 *
 * O navegador precisa mandar EXATAMENTE este mesmo valor, senão a venda conta
 * duas vezes. É por isso que ele é exportado: o cardápio calcula o dele com
 * esta função, não com um número aleatório.
 */
export function idDoEventoDeCompra(orderId: string): string {
  return `purchase:${orderId}`;
}

export async function enviarCompraParaMeta(e: EventoDeCompra): Promise<ResultadoCapi> {
  const eventId = idDoEventoDeCompra(e.orderId);

  if (!e.pixelId || !e.token) {
    return { ok: false, erro: "Loja sem pixel ou sem token da API de Conversões.", eventId };
  }

  const userData: Record<string, any> = {};
  const ph = telefoneParaHash(e.telefone);
  if (ph) userData.ph = [ph];
  const em = hash(e.email);
  if (em) userData.em = [em];
  if (e.nome) {
    // O Meta quer nome e sobrenome separados, cada um com seu hash.
    const partes = String(e.nome).trim().split(/\s+/);
    const fn = hash(partes[0]);
    const ln = hash(partes.length > 1 ? partes[partes.length - 1] : "");
    if (fn) userData.fn = [fn];
    if (ln) userData.ln = [ln];
  }
  const ct = hash(e.cidade);
  if (ct) userData.ct = [ct];
  if (e.fbp) userData.fbp = e.fbp;
  if (e.fbc) userData.fbc = e.fbc;
  if (e.ip) userData.client_ip_address = e.ip;
  if (e.userAgent) userData.client_user_agent = e.userAgent;

  // Sem NENHUM dado de correspondência o Meta recusa o evento. Melhor devolver
  // isso explicado do que gastar a chamada e ver o erro cru no log.
  if (Object.keys(userData).length === 0) {
    return { ok: false, erro: "Pedido sem telefone, e-mail ou cookie do Meta — nada para casar.", eventId };
  }

  const customData: Record<string, any> = {
    currency: (e.moeda || "BRL").toUpperCase(),
    value: Number(Number(e.valor).toFixed(2)),
  };
  if (e.itens && e.itens.length > 0) {
    // content_ids e content_type sao o que habilita ANUNCIO DINAMICO — aquele
    // que mostra no anuncio exatamente o prato que a pessoa olhou.
    customData.content_type = "product";
    customData.content_ids = e.itens.map((i) => String(i.id));
    customData.contents = e.itens.map((i) => ({
      id: String(i.id),
      quantity: Number(i.quantidade) || 1,
      item_price: Number(Number(i.preco).toFixed(2)),
    }));
    customData.num_items = e.itens.reduce((s, i) => s + (Number(i.quantidade) || 1), 0);
  }

  const corpo: Record<string, any> = {
    data: [
      {
        event_name: "Purchase",
        // Em SEGUNDOS, não milissegundos. O Meta rejeita silenciosamente
        // evento com timestamp fora da janela de 7 dias.
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        ...(e.urlDaLoja ? { event_source_url: e.urlDaLoja } : {}),
        user_data: userData,
        custom_data: customData,
      },
    ],
  };
  if (e.testEventCode) corpo.test_event_code = e.testEventCode;

  const url = `https://graph.facebook.com/${VERSAO_API}/${encodeURIComponent(e.pixelId)}/events?access_token=${encodeURIComponent(e.token)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      // A venda não pode esperar o Meta. 8s é generoso e ainda assim curto o
      // bastante para não segurar a confirmação de pagamento.
      signal: AbortSignal.timeout(8000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = d?.error?.message || `HTTP ${res.status}`;
      return { ok: false, erro: String(msg).slice(0, 300), eventId };
    }
    return { ok: true, eventId, recebidos: Number(d?.events_received) || 0 };
  } catch (err: any) {
    return { ok: false, erro: String(err?.message || err).slice(0, 300), eventId };
  }
}
