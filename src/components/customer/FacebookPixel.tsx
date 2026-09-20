"use client";
/**
 * FireHub — Pixel do Meta POR LOJA
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
 * O componente começava com:
 *
 *     if (!pixelId || window.fbq) return;
 *
 * Só que `src/app/layout.tsx` já injeta o pixel do FireHub em TODAS as páginas,
 * inclusive no cardápio das lojas. Quando este componente montava, `window.fbq`
 * já existia — então o pixel do lojista NUNCA era inicializado, e todo
 * AddToCart / InitiateCheckout / Purchase de TODAS as lojas era contabilizado
 * no pixel único do SaaS.
 *
 * Efeito prático: o lojista não conseguia medir retorno nenhum (o painel
 * mostrava ROAS zero), e a Meta não tinha sinal de conversão por loja para
 * otimizar a entrega dos anúncios — que é justamente o que faz a campanha
 * funcionar. Também misturava dado de negócio entre lojas concorrentes.
 *
 * ── COMO FUNCIONA AGORA ─────────────────────────────────────────────────────
 * O Meta Pixel aceita VÁRIOS pixels na mesma página. Então:
 *   - o pixel do FireHub continua onde está (métrica agregada nossa);
 *   - o da loja é inicializado por cima, sem conflito;
 *   - os eventos vão com `trackSingle`, endereçados ao pixel da loja.
 *
 * `trackSingle` é o que garante o endereçamento: com `track` puro, o evento é
 * enviado para TODOS os pixels da página — e voltaríamos a misturar tudo.
 */
import { useEffect } from "react";

declare global {
  interface Window { fbq: any; _fbq: any; }
}

/** Pixel da loja aberta agora. Lido por trackPixelEvent. */
let pixelDaLojaAtual: string | null = null;

/** Pixels já inicializados nesta página, para não repetir o init. */
const jaIniciados = new Set<string>();

function carregarBaseDoPixel() {
  if (typeof window === "undefined" || window.fbq) return;
  /* eslint-disable */
  (function (f: any, b: any, e: string, v: string, n?: any, t?: any, s?: any) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    t = b.createElement(e); t.async = true; t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */
}

export default function FacebookPixel({ pixelId }: { pixelId: string }) {
  useEffect(() => {
    if (!pixelId) {
      pixelDaLojaAtual = null;
      return;
    }

    // Garante a biblioteca (ela pode já ter vindo do layout — tudo bem).
    carregarBaseDoPixel();

    // Inicializa o pixel DA LOJA por cima do que já existir. A única coisa que
    // se evita é inicializar o MESMO pixel duas vezes.
    if (!jaIniciados.has(pixelId)) {
      window.fbq("init", pixelId);
      jaIniciados.add(pixelId);
    }
    pixelDaLojaAtual = pixelId;

    // PageView endereçado: sem `trackSingle`, o evento iria para todos os
    // pixels da página, incluindo o do FireHub.
    window.fbq("trackSingle", pixelId, "PageView");

    const noscript = document.createElement("noscript");
    noscript.innerHTML =
      `<img height="1" width="1" style="display:none" ` +
      `src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/>`;
    document.head.appendChild(noscript);

    return () => {
      noscript.remove();
      if (pixelDaLojaAtual === pixelId) pixelDaLojaAtual = null;
    };
  }, [pixelId]);

  return null;
}

/**
 * Dispara evento de conversão.
 *
 * Vai para o pixel DA LOJA, e SÓ para ele.
 *
 * ── O que o fallback custou (20/09/2026) ──────────────────────────────────
 * Até aqui, loja sem pixel caía num `fbq("track", …)` solto "para não perder
 * a métrica agregada". Mas o pixel solto da página é o do FIREHUB
 * (1508278337585097, iniciado no layout). Resultado: quando um cliente final
 * comprava comida numa loja sem pixel próprio, o Purchase — com o valor do
 * pedido — entrava na CONTA DE ANÚNCIOS do FireHub, e o Meta atribuía a
 * venda à campanha que estivesse rodando. Foi assim que a campanha da
 * extensão de prazos apareceu com "1 Compra no site · R$ 22,33" num dia em
 * que nada foi vendido: R$ 22,33 é ticket de comida, não a assinatura.
 *
 * O estrago não é só o relatório errado: o algoritmo passa a procurar quem
 * compra hambúrguer para vender software de prazo.
 *
 * Sem pixel da loja, portanto, NÃO se dispara nada. Métrica agregada de
 * cardápio de terceiro no nosso pixel não vale o que ela estraga. Os eventos
 * do próprio FireHub (StartTrial e CompleteRegistration em /cadastro) não
 * passam por aqui: aqueles são nossos e continuam no `track` de lá.
 */
export const trackPixelEvent = (
  event: string,
  params?: Record<string, any>,
  /**
   * ID do evento, para DEDUPLICAÇÃO com a API de Conversões.
   *
   * O servidor manda o MESMO evento (src/lib/meta-purchase.ts). O Meta só
   * entende que são o mesmo se os dois carregarem este id — senão a venda
   * conta DUAS vezes: o ROAS dobra no relatório, o lojista acha que está indo
   * bem, e o algoritmo aprende errado. É um estrago pior que não ter CAPI.
   *
   * Use `idDoEventoDeCompra(orderId)` de src/lib/meta-capi.ts para calcular —
   * nunca um número aleatório, que nunca casaria com o do servidor.
   */
  eventID?: string
) => {
  if (typeof window === "undefined" || !window.fbq) return;

  const opts = eventID ? { eventID } : undefined;

  if (!pixelDaLojaAtual) {
    // Loja sem pixel: o evento morre aqui, de propósito (ver o bloco acima).
    if (process.env.NODE_ENV !== "production") {
      console.info(`[Pixel] "${event}" não enviado: esta loja não tem pixel próprio configurado.`);
    }
    return;
  }
  window.fbq("trackSingle", pixelDaLojaAtual, event, params, opts);
};

// Eventos padrão para delivery:
// trackPixelEvent("ViewContent", { content_name: "Cardápio" })
// trackPixelEvent("AddToCart", { value: 29.90, currency: "BRL" })
// trackPixelEvent("InitiateCheckout", { value: total, currency: "BRL" })
// trackPixelEvent("Purchase", { value: total, currency: "BRL", order_id: orderId })
