/**
 * "Sem cebola", "bem passado", "capricha no molho" — a observação que o cliente
 * escreveu SOBRE O PRATO, em qualquer marketplace.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 *
 * O campo `CustomerOrderItem.notes` existe desde sempre, e é dele que a comanda
 * da cozinha e a notinha tiram a linha embaixo do item. Só que cada integração
 * foi escrita numa semana diferente, e só o iFood chegou a preenchê-lo.
 *
 * Medido em 19/09/2026, últimos 30 dias:
 *
 *   iFood        544 de 9.144 itens com observação   ✅
 *   99Food         0 de   366                        ❌
 *   JotaJá         0 de   365                        ❌
 *   Brendi         0 de   105                        ❌
 *   Wabiz          0 de    15                        ❌
 *
 * Nos quatro de baixo a observação até chegava — mas era jogada na descrição do
 * produto-espelho (que ninguém imprime) ou concatenada no rodapé do pedido. O
 * Frangoso reclamou exatamente disso: "a observação que vem da Brendi não sai
 * no pedido nem na notinha". Não saía mesmo.
 *
 * ── Os nomes do campo ──────────────────────────────────────────────────────
 *
 * Cada plataforma batiza o mesmo campo de um jeito, e algumas mandam mais de um
 * conforme a versão da API. A ordem aqui é a do iFood, que já estava em
 * produção e é a mais específica primeiro:
 *
 *   observations         iFood, Brendi, JotaJá
 *   specialInstructions  Brendi, JotaJá (Open Delivery)
 *   notes                genérico
 *   remark               99Food
 *   obs                  Wabiz
 *
 * ── Cuidado com `??` ───────────────────────────────────────────────────────
 *
 * Use `||`, não `??`: string vazia é o que essas APIs mandam quando não há
 * observação, e `??` só cai para o próximo em null/undefined. Com `??`, um
 * `observations: ""` barrava o `specialInstructions` que vinha preenchido logo
 * atrás — a observação existia no payload e sumia na tradução.
 */

/** Os nomes que já vimos, na ordem em que devem ser tentados. */
const CAMPOS = ["observations", "specialInstructions", "notes", "remark", "obs"] as const;

/**
 * A observação do item, ou `null` quando não há.
 *
 * Aceita o item CRU da plataforma. Devolve `null` (e não `""`) porque é assim
 * que a coluna fica quando não há observação — e é o que as telas testam.
 */
export function observacaoDoItem(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const i = item as Record<string, unknown>;
  for (const campo of CAMPOS) {
    const v = i[campo];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Junta observações de várias partes num item só — a pizza meio a meio da
 * Wabiz, em que cada metade tem a sua ("1/2 Portuguesa: sem azeitona").
 *
 * Sem o rótulo da metade a cozinha não sabe em qual lado vai o pedido; com uma
 * parte só, o rótulo é ruído e fica de fora.
 */
export function observacaoDasPartes(
  partes: { rotulo: string; observacao: string | null | undefined }[]
): string | null {
  const comObs = partes.filter((p) => (p.observacao || "").trim());
  if (comObs.length === 0) return null;
  if (comObs.length === 1 && partes.length === 1) return String(comObs[0].observacao).trim();
  return comObs.map((p) => `${p.rotulo}: ${String(p.observacao).trim()}`).join(" | ");
}
