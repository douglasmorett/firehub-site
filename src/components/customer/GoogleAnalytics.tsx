"use client";
/**
 * FireHub — Google Analytics 4 e Tag Manager POR LOJA
 *
 * Espelho do `FacebookPixel.tsx`, e com o mesmo cuidado que lá custou caro: o
 * evento tem que ir para a propriedade DA LOJA, não para uma medição agregada
 * do FireHub. Por isso todo evento leva `send_to` com o ID de métrica da loja
 * — é o `trackSingle` do lado do Google. Sem ele, no dia em que o layout do
 * FireHub carregar um gtag próprio, todo add_to_cart de todas as lojas passa a
 * cair também na nossa propriedade, misturando dado de lojas concorrentes.
 *
 * ── DOIS CAMINHOS, E ELES NÃO SE SOMAM ──────────────────────────────────────
 *
 *   · ID de métrica ("G-XXXXXXXXXX") → carregamos o gtag.js direto.
 *   · Container do GTM ("GTM-XXXXXXX") → carregamos o container, e os eventos
 *     vão para o `dataLayer` no formato de e-commerce que o GA4 espera.
 *
 * Quem já tem a tag do GA4 configurada DENTRO do container não deve preencher
 * os dois: o mesmo `purchase` sairia pelo gtag direto e pela tag do container,
 * e a venda apareceria em dobro no relatório. A tela de Integrações avisa isso
 * na hora de salvar; aqui a gente respeita o que o lojista configurou.
 */
import { useEffect } from "react";

declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

/** ID de métrica da loja aberta agora. Lido por trackGaEvent. */
let medicaoDaLojaAtual: string | null = null;
/** Se o container do GTM desta loja está carregado (define para onde o evento vai). */
let gtmAtivo = false;

/** IDs já inicializados nesta página, para não repetir. */
const jaIniciados = new Set<string>();

function garantirDataLayer() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    // A forma canônica: `arguments`, não um array espalhado. O gtag.js lê o
    // objeto `arguments` da fila, e `push([...])` não é a mesma coisa.
    // eslint-disable-next-line prefer-rest-params
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
  }
}

function carregarScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

export default function GoogleAnalytics({
  measurementId,
  gtmId,
}: {
  measurementId?: string | null;
  gtmId?: string | null;
}) {
  const medicao = (measurementId || "").trim().toUpperCase();
  const container = (gtmId || "").trim().toUpperCase();

  useEffect(() => {
    if (!medicao && !container) {
      medicaoDaLojaAtual = null;
      gtmAtivo = false;
      return;
    }

    garantirDataLayer();

    // ── GA4 direto (gtag.js) ────────────────────────────────────────────────
    if (medicao.startsWith("G-")) {
      carregarScript(
        `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(medicao)}`,
        `ga4-${medicao}`
      );
      if (!jaIniciados.has(medicao)) {
        window.gtag("js", new Date());
        // `send_page_view` fica ligado: o page_view é o que abre a sessão à
        // qual todo o resto do funil vai se pendurar.
        window.gtag("config", medicao, { send_page_view: true });
        jaIniciados.add(medicao);
      }
      medicaoDaLojaAtual = medicao;
    }

    // ── Google Tag Manager ──────────────────────────────────────────────────
    let noscript: HTMLElement | null = null;
    if (container.startsWith("GTM-")) {
      if (!jaIniciados.has(container)) {
        window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
        carregarScript(
          `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(container)}`,
          `gtm-${container}`
        );
        jaIniciados.add(container);
      }
      gtmAtivo = true;

      noscript = document.createElement("noscript");
      noscript.innerHTML =
        `<iframe src="https://www.googletagmanager.com/ns.html?id=${container}" ` +
        `height="0" width="0" style="display:none;visibility:hidden"></iframe>`;
      document.body.appendChild(noscript);
    }

    return () => {
      noscript?.remove();
      if (medicaoDaLojaAtual === medicao) medicaoDaLojaAtual = null;
      if (container) gtmAtivo = false;
    };
  }, [medicao, container]);

  return null;
}

/**
 * Dispara um evento de e-commerce do GA4.
 *
 * Os nomes são os RECOMENDADOS do GA4 (`view_item`, `add_to_cart`,
 * `begin_checkout`, `purchase`) — não é preciosismo: só esses alimentam os
 * relatórios de monetização e as conversões do Google Ads. Um nome inventado
 * entra como evento personalizado e não vira receita em lugar nenhum.
 */
export const trackGaEvent = (
  nome: string,
  params?: Record<string, any>
) => {
  if (typeof window === "undefined") return;

  // gtag direto, endereçado à propriedade DA LOJA.
  if (medicaoDaLojaAtual && typeof window.gtag === "function") {
    window.gtag("event", nome, { ...(params || {}), send_to: medicaoDaLojaAtual });
  }

  // GTM: o evento vira um gatilho no container do lojista. O `ecommerce: null`
  // antes é obrigatório — sem ele o objeto anterior fica no dataLayer e o
  // próximo evento herda os itens do evento passado (a compra sai com os itens
  // de outro carrinho).
  if (gtmAtivo && Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: nome, ecommerce: params || {} });
  }
};

/** Lê um cookie pelo nome exato. */
function cookie(nome: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * `client_id` do GA4, tirado do cookie `_ga`.
 *
 * É o que amarra a venda enviada pelo NOSSO servidor à mesma pessoa e à mesma
 * origem que o navegador registrou. O cookie é `GA1.1.<id>.<timestamp>` e o
 * client_id são os dois últimos campos — mandar o cookie inteiro cria um
 * visitante fantasma a cada pedido.
 */
export function lerGaClientId(): string | null {
  const bruto = cookie("_ga");
  if (!bruto) return null;
  const p = bruto.split(".");
  if (p.length < 4) return null;
  const id = `${p[p.length - 2]}.${p[p.length - 1]}`;
  return /^\d+\.\d+$/.test(id) ? id : null;
}

/**
 * `session_id` da sessão atual, do cookie `_ga_<medição sem o "G-">`.
 *
 * Sem ele o evento do servidor conta como venda, mas fora da sessão — e o
 * relatório mostra a compra sem o canal que a trouxe.
 */
export function lerGaSessionId(measurementId?: string | null): string | null {
  const medicao = (measurementId || medicaoDaLojaAtual || "").trim().toUpperCase();
  if (!medicao.startsWith("G-")) return null;
  const bruto = cookie(`_ga_${medicao.slice(2)}`);
  if (!bruto) return null;
  // "GS1.1.<session_id>.<nº da sessão>.<...>"
  const p = bruto.split(".");
  return p.length > 2 && /^\d+$/.test(p[2]) ? p[2] : null;
}
