export type ControleDoKds = "aumentar" | "diminuir" | "subir" | "descer";

/** O código físico continua igual com Num Lock desligado. O teclado normal
 * não deve transformar /, * ou +/- digitados em comandos do KDS. */
export function controleDoTecladoNumerico(
  e: Pick<KeyboardEvent, "code" | "key" | "location" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">
): ControleDoKds | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  const controles: Record<string, ControleDoKds> = {
    NumpadAdd: "aumentar", NumpadSubtract: "diminuir",
    NumpadDivide: "subir", NumpadMultiply: "descer",
  };
  if (e.code) return controles[e.code] || null;
  // Navegador antigo que informa a localização, mas não KeyboardEvent.code.
  if (e.location !== 3) return null;
  return ({ "+": "aumentar", "-": "diminuir", "/": "subir", "*": "descer" } as const)[e.key as "+" | "-" | "/" | "*"] || null;
}

/** Inclui filhos de botões e campos, não apenas o elemento que recebeu foco. */
export function focoProtegidoNoKds(
  e: Pick<KeyboardEvent, "target" | "defaultPrevented" | "isComposing">,
  dialogoAberto = false
): boolean {
  if (dialogoAberto || e.defaultPrevented || e.isComposing) return true;
  const elemento = e.target as HTMLElement | null;
  const alvo = elemento?.nodeType === 3 ? elemento.parentElement : elemento;
  return !!(alvo?.isContentEditable || alvo?.closest?.(
    'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="button"], dialog, [role="dialog"], [aria-modal="true"]'
  ));
}
