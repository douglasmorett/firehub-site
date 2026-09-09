import type { Metadata } from "next";
import AtivacaoClient from "./AtivacaoClient";

export const metadata: Metadata = {
  title: "Ativar o FireHub Prazos",
  description: "Clique no link do seu e-mail de compra e a extensão entra sozinha.",
  // O endereço carrega o código de ativação de alguém. Fora do índice.
  robots: { index: false, follow: false },
};

/**
 * /prazos/ativar?t=<código> — o link que vai no e-mail da compra.
 *
 * Quem faz o trabalho é o content script da extensão, que casa com esta URL no
 * manifest. A página é só a conversa com o lojista enquanto isso acontece.
 */
export default function AtivarPage() {
  return <AtivacaoClient />;
}
