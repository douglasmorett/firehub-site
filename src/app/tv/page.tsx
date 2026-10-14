import type { Metadata } from "next";
import DigitarCodigo from "./DigitarCodigo";

export const metadata: Metadata = {
  title: "Painel de senhas — FireHub",
  robots: { index: false, follow: false },
};

/**
 * firehubfood.com.br/tv — a TV digita o código que a loja vê em
 * Painel de senhas. Endereço curto de propósito: é digitado no controle remoto.
 */
export default async function TvPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return <DigitarCodigo erro={erro === "codigo" ? "Código não encontrado. Confira no painel da loja, em Painel de senhas." : null} />;
}
