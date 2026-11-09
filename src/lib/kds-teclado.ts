export type ControleDoKds = "aumentar" | "diminuir" | "subir" | "descer";

export const VALIDADE_DA_BAIXA_NO_KDS = 30 * 60 * 1000;

/** Keypads USB podem enviar Backspace com location 0, como o teclado comum. */
export function desfazerPeloTeclado(
  e: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">
): boolean {
  if (e.altKey || e.metaKey || e.shiftKey) return false;
  const tecla = (e.key || "").toLowerCase();
  if (e.ctrlKey) return tecla === "z";
  return e.key === "Backspace" || e.code === "Backspace" || tecla === "z" || tecla === "u";
}

/** O histórico pertence à conta/visão e à tela exatas deste aparelho. */
export function chaveDaBaixaNoKds(conta: string, visao: string, etapa: string, tela: string, nome: string): string {
  if (!conta) return "";
  return `firehub_kds_ultima_baixa_v2_${JSON.stringify([conta, visao || "atual", etapa, tela || nome])}`;
}

export function baixaRecenteNoKds(
  baixa: { em: number; escopo: string; previousStage: string } | null,
  escopo: string,
  etapa: string | null,
  agora: number,
): boolean {
  return !!(baixa && escopo && baixa.escopo === escopo && baixa.previousStage === etapa &&
    Number.isFinite(baixa.em) && baixa.em > 0 && agora >= baixa.em && agora - baixa.em <= VALIDADE_DA_BAIXA_NO_KDS);
}

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
