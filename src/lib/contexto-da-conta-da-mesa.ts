import { descontoDoCorpo, type DescontoManual } from "@/lib/desconto-manual";

export type ContextoDaContaDaMesa = { taxa: number; gorjeta: number; desconto: DescontoManual | null };

/** Contexto canônico da cobrança, calculado/validado pelo servidor na criação. */
export function lerContextoDaConta(bruto: unknown): ContextoDaContaDaMesa | null {
  if (!bruto || typeof bruto !== "object") return null;
  const c = bruto as Record<string, unknown>;
  if (typeof c.taxa !== "number" || !Number.isFinite(c.taxa) || c.taxa < 0 || c.taxa > 100
    || typeof c.gorjeta !== "number" || !Number.isFinite(c.gorjeta) || c.gorjeta < 0) return null;
  return { taxa: c.taxa, gorjeta: c.gorjeta, desconto: descontoDoCorpo(c.desconto) };
}
