import type { Metadata, Viewport } from "next";
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
