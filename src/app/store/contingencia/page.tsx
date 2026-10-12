/**
 * /store/contingencia — o módulo "Modo Contingência" do menu lateral.
 * Obsidian: Projetos/FireHub - Modo Contingência.md, item 11.
 *
 * Explica ao dono o que é, o que precisa e o que instalar; ativa neste
 * computador; mostra a situação ao vivo, o endereço para a TV e o garçom, as
 * últimas quedas e o botão de testar. Opcional: quem não ativa não muda nada.
 */
import ModoContingenciaClient from "./ModoContingenciaClient";

export const dynamic = "force-dynamic";

export default function ModoContingenciaPage() {
  return <ModoContingenciaClient />;
}
