/**
 * O toque na notificação de promoção (tela Meu aplicativo, no painel da loja)
 * leva a uma página DENTRO do app: o cardápio da loja ou um produto dele
 * (/loja/<slug>?produto=<id>). O aviso pode chegar com o app fechado, antes de
 * a aba Cardápio existir: o caminho fica guardado até ela pedir.
 */
type Ouvinte = (caminho: string) => void;

let pendente: string | null = null;
const ouvintes = new Set<Ouvinte>();

/** Só caminhos da página da loja no FireHub — nada de link para fora vindo do aviso. */
export function caminhoValido(caminho: unknown): caminho is string {
  return typeof caminho === "string" && /^\/lojas?\/[A-Za-z0-9-]+(?:[/?][A-Za-z0-9_\-=&%/?.]*)?$/.test(caminho);
}

export function abrirNoCardapio(caminho: unknown): void {
  if (!caminhoValido(caminho)) return;
  if (ouvintes.size === 0) {
    pendente = caminho;
    return;
  }
  ouvintes.forEach((f) => f(caminho));
}

/** A aba Cardápio escuta; se havia um caminho esperando, recebe na hora. */
export function ouvirCardapio(f: Ouvinte): () => void {
  ouvintes.add(f);
  if (pendente) {
    const c = pendente;
    pendente = null;
    f(c);
  }
  return () => {
    ouvintes.delete(f);
  };
}
