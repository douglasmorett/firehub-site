import { margemDaFicha, margemBaixa } from "./analise";

export type CustoDoIngrediente = { custo: number | null; faltando: string[]; foraDoCmv: boolean };
export type CustosDosIngredientes = Record<string, CustoDoIngrediente>;

export function correspondeBusca(texto: string, busca: string) {
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  const alvo = normalizar(texto);
  return normalizar(busca).split(/\s+/).every((termo) => alvo.includes(termo));
}

/** Prévia com os mesmos custos do servidor, sem transformar custo ausente em zero. */
export function resumirFicha(
  linhas: { stockItemId: string; quantityConsumed: string | number }[],
  custos: CustosDosIngredientes,
  preco: number,
  teto: number,
) {
  let total = 0;
  const faltas: string[] = [];
  const preenchidas = linhas.filter((l) => l.stockItemId || String(l.quantityConsumed).trim());
  for (const l of preenchidas) {
    const q = Number(String(l.quantityConsumed).replace(",", "."));
    if (!l.stockItemId || !Number.isFinite(q) || q <= 0) { faltas.push("Complete o ingrediente e a quantidade"); continue; }
    const c = custos[l.stockItemId];
    if (c?.custo == null) { faltas.push(...(c?.faltando.length ? c.faltando : ["Ingrediente sem custo"])); continue; }
    total += q * c.custo;
  }
  const custo = preenchidas.length && !faltas.length ? Math.round(total * 100) / 100 : null;
  const margem = margemDaFicha(preco, custo);
  return { custo, margem: margem?.margem ?? null, cmvPct: margem?.cmvPct ?? null,
    margemBaixa: margemBaixa(margem, teto),
    falta: !preenchidas.length ? "Sem ficha técnica" : faltas.length ? `Custo incompleto: ${[...new Set(faltas)].join(", ")}` : null };
}
