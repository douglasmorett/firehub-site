/**
 * Abre a aba "Suporte FireHub" do balão do painel (HumanSupportFloatingWidget
 * escuta o evento). Mora fora do componente para o "Fale conosco", que fica no
 * layout raiz, não levar o balão inteiro para as páginas públicas.
 */
export const EVENTO_ABRIR_SUPORTE = "firehub:abrir-suporte";

export function abrirSuporteDoFireHub() {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_SUPORTE));
}
