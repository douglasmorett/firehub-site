import type { Metadata } from "next";
import RelatorioClient from "./RelatorioClient";

export const metadata: Metadata = {
  title: "FireHub Prazos — relatório do prazo",
  description: "Quanto tempo o prazo ficou alto, baixo ou em estouro, dia a dia.",
  robots: { index: false, follow: false },
};

/**
 * /prazos/relatorio — o painel do dono da loja que assina a extensão.
 *
 * Abre pelo botão "Relatório" do popup, que manda o token da conta no hash
 * da URL (#token=…): sem segundo login, e o token nunca vai ao servidor na
 * URL — a página guarda na sessão e usa no header. Quem calcula os minutos
 * por faixa é o navegador do dono, no fuso dele.
 */
export default function Page() {
  return <RelatorioClient />;
}
