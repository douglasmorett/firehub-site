import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FireHub — Sistema Completo para Restaurantes",
  description: "Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro e auditoria com IA. Tudo num só lugar para o seu restaurante.",
  keywords: "sistema restaurante, cardápio digital, delivery, gestão restaurante, FireHub",
  openGraph: {
    title: "FireHub — Sistema Completo para Restaurantes",
    description: "Pare de perder vendas. Comece a crescer com o FireHub.",
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
        <link rel="icon" href="/firehub-flame.png" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
