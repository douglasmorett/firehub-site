/**
 * /store/contingencia — o módulo "Modo Contingência" do menu lateral.
 * Obsidian: Projetos/FireHub - Modo Contingência.md, item 11 e seção 13/11.
 *
 * Explica os dois modos (na web e FireHub instalado no computador, o
 * recomendado), entrega o instalador, ativa neste computador e mostra a
 * situação ao vivo, o endereço para a TV e o garçom, as últimas quedas e o
 * botão de testar. Opcional: quem não ativa não muda nada.
 */
import ModoContingenciaClient from "./ModoContingenciaClient";
import { enderecoDoInstalador } from "@/lib/contingencia/instalador";

export const dynamic = "force-dynamic";

export default function ModoContingenciaPage() {
  return <ModoContingenciaClient instalador={enderecoDoInstalador()} />;
}
