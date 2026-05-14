"use client";
/**
 * FireHub — Facebook Pixel automático por loja
 * Injeta o pixel do Meta/Facebook no cardápio de cada franqueado
 * O pixelId é configurado em Minha Loja → Integrações
 */
import { useEffect } from "react";

declare global {
  interface Window { fbq: any; _fbq: any; }
}

export default function FacebookPixel({ pixelId }: { pixelId: string }) {
  useEffect(() => {
    if (!pixelId || window.fbq) return;

    // Injeta o script do Meta Pixel
    const script = document.createElement("script");
    script.innerHTML = `
      !function(f,b,e,v,n,t,s){
        if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixelId}');
      fbq('track', 'PageView');
    `;
    document.head.appendChild(script);

    // Noscript fallback
    const noscript = document.createElement("noscript");
    noscript.innerHTML = `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/>`;
    document.head.appendChild(noscript);
  }, [pixelId]);

  // Expõe helper para rastrear eventos de conversão
  return null;
}

// Helpers para disparar eventos do Pixel em qualquer componente
export const trackPixelEvent = (event: string, params?: Record<string, any>) => {
  if (typeof window !== "undefined" && window.fbq) {
    window.fbq("track", event, params);
  }
};

// Eventos padrão para delivery:
// trackPixelEvent("ViewContent", { content_name: "Cardápio" })
// trackPixelEvent("AddToCart", { value: 29.90, currency: "BRL" })
// trackPixelEvent("InitiateCheckout", { value: total, currency: "BRL" })
// trackPixelEvent("Purchase", { value: total, currency: "BRL", order_id: orderId })
