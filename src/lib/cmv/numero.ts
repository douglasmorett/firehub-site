/**
 * Número digitado por gente, no jeito brasileiro e no do teclado em inglês.
 *
 *   "2,5"       → 2.5     vírgula é decimal
 *   "1.250,75"  → 1250.75 ponto é milhar quando há vírgula
 *   "2.100"     → 2100    ponto em grupos de 3, sem vírgula: milhar (salário)
 *   "2.5"       → 2.5     ponto sozinho, sem grupo de 3: decimal (teclado em inglês)
 *   "R$ 42,00"  → 42
 *
 * Tirar todo ponto às cegas transformava 2.5 kg em 25 kg; deixar todo ponto
 * transformava um salário de 2.100 em R$ 2,10. Vazio ou ilegível: NaN.
 */
export function lerNumeroBr(v: unknown): number {
  if (typeof v === "number") return v;
  let t = String(v ?? "").trim().replace(/[R$\s]/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t);
}
