/** O WhatsApp do material de divulgação (tela e rota usam o mesmo). */

/** Só dígitos, 10 a 13. Devolve com o 55 na frente (pronto para o wa.me), ou null. */
export function whatsappValido(bruto: unknown): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  if (d.length <= 11) return `55${d}`;
  return d.startsWith("55") ? d : null;
}

/** 5522981118514 → (22) 98111-8514 */
export function telefoneFormatado(whatsapp: string): string {
  const n = whatsapp.startsWith("55") ? whatsapp.slice(2) : whatsapp;
  const meio = n.length === 11 ? 7 : 6;
  return `(${n.slice(0, 2)}) ${n.slice(2, meio)}-${n.slice(meio)}`;
}
