/**
 * A PLANILHA DO PDV ANTIGO → produtos do FireHub. O mercado exporta o cadastro
 * do sistema que usa hoje (milhares de itens) e a tela mapeia as colunas:
 * código de barras, descrição, preço, unidade, NCM, CEST, estoque, custo,
 * categoria. Aqui: a sugestão do mapeamento pelo cabeçalho e a leitura de
 * cada linha (números em formato brasileiro, NCM/CEST/EAN só dígitos).
 *
 * Puro: a tela mostra a prévia com as mesmas funções que o servidor aplica.
 */
import { eanValido } from "../etiqueta";

export const CAMPOS_DA_PLANILHA = [
  { campo: "codigo", nome: "Código de barras (EAN)", obrigatorio: false },
  { campo: "descricao", nome: "Descrição", obrigatorio: true },
  { campo: "preco", nome: "Preço de venda", obrigatorio: false },
  { campo: "unidade", nome: "Unidade (UN/KG)", obrigatorio: false },
  { campo: "ncm", nome: "NCM", obrigatorio: false },
  { campo: "cest", nome: "CEST", obrigatorio: false },
  { campo: "estoque", nome: "Estoque", obrigatorio: false },
  { campo: "custo", nome: "Custo", obrigatorio: false },
  { campo: "categoria", nome: "Categoria / grupo", obrigatorio: false },
  { campo: "plu", nome: "Código da balança (PLU)", obrigatorio: false },
] as const;

export type CampoDaPlanilha = (typeof CAMPOS_DA_PLANILHA)[number]["campo"];
/** campo → índice da coluna (ou -1 = não tem). */
export type Mapeamento = Record<CampoDaPlanilha, number>;

const PISTAS: Record<CampoDaPlanilha, RegExp> = {
  codigo: /(c[oó]d.*barra|^ean|gtin|barras|^c[oó]digo$|^cod$|cod\.?\s*barra)/i,
  descricao: /(descri|^nome|produto$|^produto)/i,
  preco: /(pre[cç]o.*venda|^pre[cç]o|^venda|^valor|pv$|vl.*venda|pre[cç]o\s*unit)/i,
  unidade: /(^un|unid|^und|medida)/i,
  ncm: /ncm/i,
  cest: /cest/i,
  estoque: /(estoque|saldo|qtd|quantidade)/i,
  custo: /(custo|compra)/i,
  categoria: /(categoria|grupo|se[cç][aã]o|departamento|fam[ií]lia)/i,
  plu: /(plu|balan[cç]a|c[oó]d.*interno)/i,
};

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function sugerirMapeamento(cabecalho: string[]): Mapeamento {
  const usado = new Set<number>();
  const mapa = {} as Mapeamento;
  // A ordem importa: "preço de custo" é custo, não preço de venda.
  const ordem: CampoDaPlanilha[] = ["ncm", "cest", "custo", "plu", "codigo", "descricao", "preco", "unidade", "estoque", "categoria"];
  for (const campo of ordem) {
    let achou = -1;
    cabecalho.forEach((h, i) => {
      if (achou >= 0 || usado.has(i)) return;
      const t = sem(h);
      if (campo === "preco" && /custo|compra/i.test(t)) return;
      if (PISTAS[campo].test(t)) achou = i;
    });
    if (achou >= 0) usado.add(achou);
    mapa[campo] = achou;
  }
  return mapa;
}

/** "1.234,56" · "1234.56" · "R$ 12,90" · "12,9" → 12.9. Nulo se não é número. */
export function numeroBrasileiro(texto: string | undefined | null): number | null {
  let t = String(texto ?? "").replace(/[R$\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const soDigitos = (t: string | undefined | null) => String(t ?? "").replace(/\D/g, "");

export function unidadeDoTexto(t: string | undefined | null): "UN" | "KG" {
  const u = sem(String(t ?? "")).toUpperCase();
  return /^(KG|KGS|QUILO|KILO|K)$/.test(u) ? "KG" : "UN";
}

export type LinhaImportada = {
  linha: number;
  codigos: string[];
  descricao: string;
  precoCentavos: number | null;
  unidade: "UN" | "KG";
  ncm: string | null;
  cest: string | null;
  estoque: number | null;
  custoCentavos: number | null;
  categoria: string | null;
  plu: string | null;
  avisos: string[];
};

/**
 * Lê as linhas com o mapeamento. `primeiraLinhaECabecalho` pula a linha 0.
 * Linha sem descrição é descartada (com aviso no resumo); o resto entra com
 * os avisos do que não deu para ler (EAN com dígito errado, NCM curto…).
 */
export function lerLinhasDaPlanilha(linhas: string[][], mapa: Mapeamento, primeiraLinhaECabecalho = true): { itens: LinhaImportada[]; descartadas: number } {
  const col = (l: string[], campo: CampoDaPlanilha) => (mapa[campo] >= 0 ? String(l[mapa[campo]] ?? "").trim() : "");
  const itens: LinhaImportada[] = [];
  let descartadas = 0;
  linhas.forEach((l, i) => {
    if (primeiraLinhaECabecalho && i === 0) return;
    const descricao = col(l, "descricao").replace(/\s+/g, " ").slice(0, 120);
    if (descricao.length < 2) { descartadas++; return; }
    const avisos: string[] = [];
    // Uma célula pode trazer mais de um código ("789..., 789...").
    const codigos = col(l, "codigo").split(/[,;|/\s]+/).map(soDigitos).filter(Boolean);
    const validos: string[] = [];
    for (const c of codigos) {
      if (c.length >= 8 && eanValido(c)) validos.push(c);
      else if (c.length >= 8) avisos.push(`EAN ${c} com dígito verificador errado (ignorado)`);
      else if (c.length > 0) validos.push(c); // código interno curto: vale como código do caixa
    }
    const preco = numeroBrasileiro(col(l, "preco"));
    const custo = numeroBrasileiro(col(l, "custo"));
    const ncm = soDigitos(col(l, "ncm"));
    if (ncm && ncm.length !== 8) avisos.push(`NCM "${col(l, "ncm")}" não tem 8 dígitos (ignorado)`);
    const cest = soDigitos(col(l, "cest"));
    if (cest && cest.length !== 7) avisos.push(`CEST "${col(l, "cest")}" não tem 7 dígitos (ignorado)`);
    const estoque = numeroBrasileiro(col(l, "estoque"));
    const plu = soDigitos(col(l, "plu"));
    itens.push({
      linha: i + 1,
      codigos: [...new Set(validos)],
      descricao,
      precoCentavos: preco != null && preco > 0 ? Math.round(preco * 100) : null,
      unidade: unidadeDoTexto(col(l, "unidade")),
      ncm: ncm.length === 8 ? ncm : null,
      cest: cest.length === 7 ? cest : null,
      estoque: estoque != null ? estoque : null,
      custoCentavos: custo != null && custo > 0 ? Math.round(custo * 100) : null,
      categoria: col(l, "categoria").slice(0, 60) || null,
      plu: plu ? String(Number(plu)) : null,
      avisos,
    });
  });
  return { itens, descartadas };
}
