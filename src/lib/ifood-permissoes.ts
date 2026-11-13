/**
 * O que cada loja já liberou para o FireHub no iFood — lido do próprio token.
 *
 * Em 12/11/2026 o iFood aprovou no app distribuído os módulos Merchant,
 * Catalog e Shipping (antes só Order e Events). Mas a permissão de cada LOJA
 * fica gravada na autorização que ela deu: o token traz `merchant_scope` com
 * "<merchantId>:<módulo>", e as lojas autorizadas antes de 12/11 continuam
 * só com order/events. Para elas o iFood responde 403 no entregador, no
 * cardápio e na pausa — até a loja autorizar o FireHub de novo (Integrações).
 * Medido na Hakim Centro em 12/11/2026.
 */

/** Os módulos que as novidades usam. */
export const MODULOS_DAS_NOVIDADES = ["merchant", "catalog", "shipping"] as const;

/** Os módulos que esta loja liberou no token, ou null quando o token não diz (não é JWT, sem merchant_scope). */
export function modulosLiberados(accessToken: string | null | undefined, merchantId: string): Set<string> | null {
  const partes = String(accessToken || "").split(".");
  if (partes.length < 2) return null;
  try {
    const corpo = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    const escopo: unknown = corpo?.merchant_scope;
    if (!Array.isArray(escopo)) return null;
    const meus = escopo
      .map(String)
      .filter((s) => s.startsWith(`${merchantId}:`))
      .map((s) => s.slice(merchantId.length + 1));
    return new Set(meus);
  } catch {
    return null;
  }
}

/** true quando o token mostra que falta algum módulo das novidades. Sem informação, não acusa. */
export function faltaReautorizar(accessToken: string | null | undefined, merchantId: string): boolean {
  const mods = modulosLiberados(accessToken, merchantId);
  if (!mods) return false;
  return MODULOS_DAS_NOVIDADES.some((m) => !mods.has(m));
}
