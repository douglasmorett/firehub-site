import { motivoParaNaoCopiar, tituloNormalizado, type PerguntaParaCopiar, type ProdutoParaCopiar } from "@/lib/copiar-pergunta";

export type OpcaoDaBase = {
  menuProductId: string; additionalPrice: number; additionalPriceSalao: number | null;
  additionalPriceDelivery: number | null; additionalPriceTotem: number | null;
  promoAdditionalPrice: number | null; maxPerItem: number | null; optionNote: string | null;
  precoPorEscolha: unknown; sortOrder: number;
};
const numero = (v: unknown) => v == null || v === "" ? null : Number(v);
const estavel = (v: any): any => Array.isArray(v) ? v.map(estavel) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, estavel(v[k])])) : v;

/** Identidade das opções e seus valores, sem confundir regras próprias do produto.
 * Preços/canais/promoções diferentes ficam em bases separadas, mesmo com nome igual.
 */
export function opcoesDaBase(grupo: PerguntaParaCopiar): OpcaoDaBase[] {
  return [...(grupo.items || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((i, sortOrder) => ({
      menuProductId: String(i.menuProductId || i.menuProduct?.id || ""),
      additionalPrice: Number(i.additionalPrice) || 0,
      additionalPriceSalao: numero(i.additionalPriceSalao), additionalPriceDelivery: numero(i.additionalPriceDelivery),
      additionalPriceTotem: numero(i.additionalPriceTotem), promoAdditionalPrice: numero(i.promoAdditionalPrice),
      maxPerItem: numero(i.maxPerItem), optionNote: i.optionNote ?? null,
      precoPorEscolha: estavel(i.precoPorEscolha ?? null), sortOrder,
    }));
}

export type GrupoNaBase = { produto: ProdutoParaCopiar; grupo: PerguntaParaCopiar & { id: string } };
export type BaseDeComplementos = { chave: string; titulo: string; membros: GrupoNaBase[]; revisao: string; editavel: boolean; motivo: string | null };

export function basesDeComplementos(produtos: ProdutoParaCopiar[]): BaseDeComplementos[] {
  const mapa = new Map<string, BaseDeComplementos>();
  for (const produto of produtos) for (const bruto of produto.comboGroups || []) {
    if (!bruto.id) continue;
    const grupo = bruto as PerguntaParaCopiar & { id: string };
    const motivo = motivoParaNaoCopiar(grupo, produto);
    const chave = JSON.stringify([produto.franchiseeId, tituloNormalizado(grupo.title), grupo.priceRule ?? null, opcoesDaBase(grupo), motivo ? grupo.id : null]);
    let base = mapa.get(chave);
    if (!base) { base = { chave, titulo: String(grupo.title || "Pergunta"), membros: [], revisao: "", editavel: !motivo, motivo }; mapa.set(chave, base); }
    base.membros.push({ produto, grupo });
  }
  return [...mapa.values()].map(base => ({ ...base, revisao: JSON.stringify(base.membros.map(m => [m.produto.id, m.grupo.id, m.grupo.title, m.grupo.minQty ?? null, m.grupo.maxQty, m.grupo.sortOrder ?? 0, base.chave]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))) }));
}

export function problemaDasOpcoes(opcoes: OpcaoDaBase[]): string | null {
  if (!opcoes.length || opcoes.length > 150) return "Escolha de 1 a 150 opções.";
  if (new Set(opcoes.map(i => i.menuProductId)).size !== opcoes.length || opcoes.some(i => !i.menuProductId)) return "Não repita a mesma opção.";
  for (const i of opcoes) {
    for (const k of ["additionalPrice", "additionalPriceSalao", "additionalPriceDelivery", "additionalPriceTotem", "promoAdditionalPrice"] as const) {
      if (i[k] != null && (!Number.isFinite(i[k]) || Number(i[k]) < 0 || Number(i[k]) > 999999)) return "Informe preços válidos, maiores ou iguais a zero.";
    }
  }
  return null;
}
