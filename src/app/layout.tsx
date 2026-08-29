import type { Metadata, Viewport } from "next";
// ANTES do globals.css de propósito: os tokens são a camada de base, e o
// globals continua vencendo onde já decide alguma coisa. Nenhuma tela muda de
// aparência só por este import — todo hex daqui já é um hex que o painel usa.
import "../styles/fh-tokens.css";
import "../styles/fh-componentes.css";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#DC2626",
};

export const metadata: Metadata = {
  title: "FireHub — Simples, Rápido e Completo. Sistema para Restaurantes.",
  description: "Tudo que o seu restaurante precisa em um só lugar. Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro e auditoria com IA. Teste grátis por 15 dias.",
  keywords: "sistema restaurante, cardápio digital, delivery, gestão restaurante, FireHub, sistema para delivery, chatbot whatsapp restaurante",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "FireHub" },
  icons: {
    icon: "/firehub-flame.png",
    apple: "/firehub-flame.png",
  },
  openGraph: {
    title: "FireHub — Tudo que o seu restaurante precisa em um só lugar",
    description: "Simples, rápido e completo. Cardápio digital, pedidos, WhatsApp, financeiro e IA. Teste grátis por 15 dias.",
    url: "https://www.firehubfood.com.br",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "website",
  },
};

import { Providers } from "@/components/Providers";
import FloatingContactWidget from "@/components/FloatingContactWidget";
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link rel="icon" href="/firehub-flame.png" />
      </head>
      <body>
        <Script
          id="fb-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '1508278337585097');
              fbq('track', 'PageView');
            `,
          }}
        />
        <Script
          src="https://sdk.mercadopago.com/js/v2"
          strategy="lazyOnload"
          id="mp-sdk-global"
        />
        <Providers>{children}</Providers>
        <FloatingContactWidget />
      </body>
    </html>
  );
}
