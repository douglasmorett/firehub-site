/**
 * Copiar para a área de transferência sem quebrar fora do https.
 *
 * `navigator.clipboard` só existe em endereço seguro (https ou localhost). No
 * computador da loja (http://<ip>:7890, o Modo Contingência) ele é
 * `undefined`, e o `navigator.clipboard.writeText` direto dava TypeError: nada
 * copiado, e o botão nem mostrava "copiado". Aqui tenta a API e, sem ela, o
 * jeito antigo (textarea + execCommand), o mesmo do "Ver cardápio" do topo.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Clipboard API bloqueada (aba sem foco, navegador antigo): cai no jeito velho.
  }
  try {
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.setAttribute("readonly", "");
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand("copy");
    campo.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A nuvem do FireHub: onde moram os links que vão para fora da loja. */
export const ORIGEM_DA_NUVEM = "https://firehubfood.com.br";
/** A porta da loja (o supervisor da contingência no computador do caixa). */
const PORTA_DA_LOJA = "7890";

/**
 * A origem para um link que vai para FORA da loja (o do app do motoboy): na
 * porta da loja (http://<ip>:7890 ou http://127.0.0.1:7890) o
 * `location.origin` é o endereço do computador do caixa, que não serve ao
 * motoboy na rua — o link sai com a nuvem. Em qualquer outro endereço (a
 * nuvem, a prévia, o desenvolvimento) fica a origem da página.
 */
export function origemParaLinkDeFora(origem: string): string {
  try {
    const u = new URL(origem);
    if (u.protocol === "http:" && u.port === PORTA_DA_LOJA) return ORIGEM_DA_NUVEM;
    return u.origin;
  } catch {
    return origem;
  }
}
