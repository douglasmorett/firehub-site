"use client";

import { useEffect } from "react";

/**
 * Duas coisas que a página precisa no clique de "Assinar" e um <a> não faz
 * sozinho:
 *
 * 1. Levar para o checkout da Cakto os parâmetros de origem que vieram no
 *    anúncio (utm_*, fbclid, gclid) e o gatilho da página (?g=). A Cakto
 *    captura UTM do link do checkout e mostra na venda; sem isso, R$ 1.000
 *    por dia de anúncio vira "venda direta" no relatório e ninguém sabe qual
 *    gancho vendeu. O gatilho vira utm_content quando o anúncio não mandou um.
 *
 * 2. Avisar o pixel do Meta que a pessoa foi para o checkout
 *    (InitiateCheckout). É o sinal do meio do funil que o algoritmo usa para
 *    achar quem compra; o Purchase é da Cakto (pixel configurado lá), não
 *    daqui. Se o pixel não carregou (bloqueador), segue sem ele.
 *
 * Tudo acontece no clique, na fase de captura, e não na montagem: o seletor
 * de plano troca o href quando o lojista muda de faixa, e um href reescrito
 * na montagem seria perdido na re-renderização. No clique, o navegador usa
 * o href que estiver no <a> na hora da ação padrão — depois deste listener.
 */
const PARAMETROS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "g", "fbclid", "gclid", "ttclid"];

function comOrigem(href: string): string {
  const atual = new URLSearchParams(window.location.search);
  const url = new URL(href);
  for (const p of PARAMETROS) {
    const v = atual.get(p);
    if (v && !url.searchParams.has(p)) url.searchParams.set(p, v);
  }
  const g = atual.get("g");
  if (g && !url.searchParams.has("utm_content")) url.searchParams.set("utm_content", "gatilho-" + g);
  return url.toString();
}

export default function RastreioDeClique() {
  useEffect(() => {
    function aoClicar(e: MouseEvent) {
      const alvo = (e.target as HTMLElement | null)?.closest?.('a[href^="https://pay.cakto.com.br/"]') as HTMLAnchorElement | null;
      if (!alvo) return;
      try { alvo.href = comOrigem(alvo.href); } catch { /* href estranho: deixa como está */ }
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (typeof fbq === "function") {
        fbq("track", "InitiateCheckout", { currency: "BRL", value: 29.9, content_name: "FireHub Prazos" });
      }
    }
    document.addEventListener("click", aoClicar, true);
    return () => document.removeEventListener("click", aoClicar, true);
  }, []);
  return null;
}
