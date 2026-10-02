/**
 * QUAIS FORMAS DE PAGAMENTO NA ENTREGA O CARDÁPIO OFERECE.
 *
 * A loja liga e desliga cada forma em Minha Loja → Formas de Pagamento
 * (`paymentFees.<FORMA>.active`), mas o cardápio só lia o Voucher — e mesmo
 * desligado ele entrava pelo `else` como "🎟️ Voucher". Dinheiro, Débito e
 * Crédito nem eram lidos (Showrrascão e outra loja reclamaram, 02/10/2026).
 *
 * Loja que nunca salvou a tela (sem `paymentFees`, ou a forma sem `active`)
 * continua com tudo: só `active: false` explícito tira a forma.
 *
 * O pagamento PELO SITE (Pix/cartão no Asaas) não passa por aqui: ele é ligado
 * em Integrações → Asaas (`pixOnlineAtivo`/`cartaoOnlineAtivo`).
 */

/** A chave de `paymentFees` que manda nesta forma do cardápio. */
export function chaveDaForma(paymentMethod: unknown): "PIX" | "DINHEIRO" | "DEBITO" | "CREDITO" | "VOUCHER" | null {
  const pm = String(paymentMethod || "").toUpperCase().trim();
  if (pm === "PIX_ENTREGA") return "PIX";
  if (pm === "DINHEIRO") return "DINHEIRO";
  if (pm === "DEBITO") return "DEBITO";
  if (pm === "CREDITO") return "CREDITO";
  if (pm === "VOUCHER" || pm.startsWith("VOUCHER_")) return "VOUCHER";
  return null;
}

export function formaLigada(paymentFees: unknown, chave: string): boolean {
  return (paymentFees as any)?.[chave]?.active !== false;
}

/** As bandeiras de vale ligadas (nomes). Vazio = "Voucher" genérico. */
export function bandeirasDeValeLigadas(paymentFees: unknown): string[] {
  const brands = (paymentFees as any)?.VOUCHER?.brands;
  if (!Array.isArray(brands)) return [];
  return brands.filter((b: any) => b && b.active !== false && String(b.name || "").trim()).map((b: any) => String(b.name).trim());
}

/**
 * Esta forma, escolhida no cardápio, está desligada pela loja? Devolve o nome
 * para a frase de recusa, ou null quando pode. Forma que não é desta tela
 * (Pix/cartão pelo site, texto de outro canal) → null.
 */
export function formaDesligada(paymentFees: unknown, paymentMethod: unknown): string | null {
  const chave = chaveDaForma(paymentMethod);
  if (!chave) return null;
  const nome = { PIX: "Pix na entrega", DINHEIRO: "dinheiro", DEBITO: "débito", CREDITO: "crédito", VOUCHER: "vale/voucher" }[chave];
  if (!formaLigada(paymentFees, chave)) return nome;
  if (chave === "VOUCHER") {
    const pm = String(paymentMethod || "").trim();
    const bandeira = pm.toUpperCase().startsWith("VOUCHER_") ? pm.slice("VOUCHER_".length) : "";
    const ligadas = bandeirasDeValeLigadas(paymentFees);
    if (bandeira && Array.isArray((paymentFees as any)?.VOUCHER?.brands) && !ligadas.includes(bandeira)) return bandeira;
  }
  return null;
}
