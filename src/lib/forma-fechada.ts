/**
 * Fechar só UMA forma de compra no site: a loja para a entrega e segue com a
 * retirada (ou o contrário) — Bruno, 12/11/2026: "dá pra desligar entrega a
 * partir de um certo horário e deixar só pra retirada?".
 *
 * Mora em `User.deliveryConfig.formaFechada` = { forma, ate, motivo }. O
 * deliveryConfig é sempre MESCLADO (api/store-settings), então a chave não some
 * quando a loja salva outra coisa. Vale até `ate`: passou a hora, a forma volta
 * sozinha, sem cron — quem esquece de reabrir não fica sem entrega no dia seguinte.
 */
export type FormaDeCompra = "ENTREGA" | "RETIRADA";

export type FormaFechada = { forma: FormaDeCompra; ate: string; motivo?: string };

/** A forma fechada AGORA, ou null (nada fechado, ou o prazo já passou). */
export function formaFechadaAgora(deliveryConfig: unknown, agora = Date.now()): FormaFechada | null {
  const f = (deliveryConfig as any)?.formaFechada;
  if (!f || (f.forma !== "ENTREGA" && f.forma !== "RETIRADA")) return null;
  const ate = new Date(f.ate).getTime();
  if (!Number.isFinite(ate) || ate <= agora) return null;
  return { forma: f.forma, ate: String(f.ate), motivo: typeof f.motivo === "string" ? f.motivo : undefined };
}

/** "às 23:59" / "em 13/11 às 11:00" — no fuso de quem vê. */
export function textoDoAte(ateIso: string, timeZone?: string | null): string {
  const d = new Date(ateIso);
  const opc = { timeZone: timeZone || "America/Sao_Paulo" } as const;
  const dia = d.toLocaleDateString("pt-BR", { ...opc, day: "2-digit", month: "2-digit" });
  const hoje = new Date().toLocaleDateString("pt-BR", { ...opc, day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { ...opc, hour: "2-digit", minute: "2-digit" });
  return dia === hoje ? `até as ${hora}` : `até ${dia} às ${hora}`;
}
