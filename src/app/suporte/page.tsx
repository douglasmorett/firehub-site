import type { Metadata, Viewport } from "next";
import SuporteClient from "./SuporteClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Suporte FireHub",
  description: "Fale com o suporte do FireHub pelo navegador: texto, foto e áudio.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#075E54" };

/**
 * /suporte — o suporte pelo navegador, com cara de WhatsApp (lib/atendimento/site.ts).
 * `?c=<token>` é o link pessoal que a equipe manda para um contato que já existe.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  return <SuporteClient token={typeof c === "string" ? c : null} />;
}
