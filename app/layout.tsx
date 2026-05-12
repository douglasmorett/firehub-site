import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FireHub — Simples, Rápido e Completo. Sistema para Restaurantes.",
  description: "Tudo que o seu restaurante precisa em um só lugar. Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro e auditoria com IA. Teste grátis por 15 dias.",
  keywords: "sistema restaurante, cardápio digital, delivery, gestão restaurante, FireHub, sistema para delivery, chatbot whatsapp restaurante",
  openGraph: {
    title: "FireHub — Tudo que o seu restaurante precisa em um só lugar",
    description: "Simples, rápido e completo. Cardápio digital, pedidos, WhatsApp, financeiro e IA. Teste grátis por 15 dias.",
    url: "https://www.firehubfood.com.br",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link rel="icon" href="/firehub-flame.png" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
