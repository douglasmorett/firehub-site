/**
 * MARGEM E MARKUP POR PRODUTO VENDIDO — o "CMV por produto" do SWFast, com a
 * ENGENHARIA DE CARDÁPIO por cima: quais produtos são estrela, quais vendem
 * muito e dão pouco, quais dão bom lucro e ninguém pede, e quais repensar.
 *
 * ── As contas ───────────────────────────────────────────────────────────────
 *
 *   - valor  = Σ preço × quantidade dos itens (a régua do Itens vendidos, sem
 *     taxa de entrega);
 *   - custo  = a ficha técnica × o custo do insumo NO DIA da venda
 *     (lib/financeiro/custo-pela-ficha.ts, `custoDoItem`), ou o custo
 *     digitado no produto;
 *   - margem = valor − custo; margem un. = preço médio − custo médio;
 *   - markup = preço ÷ custo (2,5 = vende por 2,5 vezes o que custa);
 *   - % do faturamento = valor do produto ÷ valor de todos os itens.
 *
 * REGRA DA CASA: lucro só com custo cadastrado. Produto sem ficha aparece
 * como "sem custo" — nunca com margem de 100%. Produto com parte das vendas
 * sem custo (o combo cuja opção escolhida não tem ficha) tem a margem medida
 * só nas vendas com custo, e a linha diz quantas foram.
 *
 * ── A matriz (Kasavana & Smith, o método clássico) ─────────────────────────
 *
 * Só entre os produtos COM custo:
 *   - popular  = a fatia nas quantidades vendidas ≥ 70% da fatia média
 *     (com 20 produtos, a média é 5%; popular é quem tem 3,5% ou mais);
 *   - margem alta = margem unitária ≥ a margem unitária média ponderada pelas
 *     vendas (o lucro médio por item vendido).
 * Estrela (popular, margem alta) · Vaca leiteira (popular, margem baixa) ·
 * Quebra-cabeça (pouco pedido, margem alta) · Abacaxi (pouco pedido, margem
 * baixa).
 *
 * Puro. Testado em scripts/teste-margem-por-produto.ts.
 */
import { c2 } from "@/lib/relatorios/base";

export type Quadrante = "estrela" | "vaca" | "quebraCabeca" | "abacaxi";

export const QUADRANTES: Record<Quadrante, { rotulo: string; emoji: string; oQueE: string; oQueFazer: string }> = {
  estrela: {
    rotulo: "Estrela", emoji: "⭐",
    oQueE: "Vende muito e deixa bom lucro em cada venda.",
    oQueFazer: "Mantenha a receita e o padrão, deixe em destaque no cardápio e nunca deixe faltar.",
  },
  vaca: {
    rotulo: "Vaca leiteira", emoji: "🐄",
    oQueE: "Vende muito, mas sobra pouco em cada venda.",
    oQueFazer: "Suba o preço aos poucos (R$ 1 a R$ 2) ou baixe o custo da receita (porção, embalagem, fornecedor).",
  },
  quebraCabeca: {
    rotulo: "Quebra-cabeça", emoji: "🧩",
    oQueE: "Deixa bom lucro, mas pouca gente pede.",
    oQueFazer: "Divulgue: foto melhor, destaque no cardápio, sugestão do atendente, entrada num combo.",
  },
  abacaxi: {
    rotulo: "Abacaxi", emoji: "🍍",
    oQueE: "Vende pouco e sobra pouco.",
    oQueFazer: "Repense a receita e o preço, ou tire do cardápio para simplificar a cozinha.",
  },
};

export type ItemComCusto = {
  /** Chave do produto (o nome normalizado): o mesmo produto do balcão e do iFood vira uma linha. */
  chave: string;
  nome: string;
  quantidade: number;
  valor: number;
  /** Custo do item inteiro; null = sem custo. */
  custo: number | null;
  /** O que falta para ter custo (ficha, insumo sem custo, opção sem ficha). */
  faltas?: string[];
};

export type LinhaDeProduto = {
  chave: string;
  nome: string;
  quantidade: number;
  valor: number;
  precoMedio: number;
  /** % do valor de todos os itens vendidos. */
  pctDoFaturamento: number;
  /** As vendas com custo (a base da margem). */
  quantidadeComCusto: number;
  valorComCusto: number;
  /** null = nenhuma venda com custo: "sem custo". */
  custoTotal: number | null;
  custoUnitario: number | null;
  margemUnitaria: number | null;
  margemTotal: number | null;
  /** margem ÷ preço, 0 a 100. */
  margemPct: number | null;
  /** preço ÷ custo. */
  markup: number | null;
  quadrante: Quadrante | null;
  /** Os motivos de não ter custo (os primeiros). */
  faltas: string[];
};

export type ResultadoDaMargem = {
  produtos: LinhaDeProduto[];
  totais: {
    valor: number;
    quantidade: number;
    /** Só das vendas com custo. */
    valorComCusto: number;
    custo: number;
    margem: number;
    margemPct: number | null;
    /** % do valor vendido que tem custo. */
    coberturaPct: number | null;
    produtosSemCusto: number;
  };
  matriz: {
    /** O corte de popularidade, em % das quantidades. */
    corteDePopularidadePct: number | null;
    /** A margem unitária média (o corte de margem). */
    margemMedia: number | null;
    contagem: Record<Quadrante, number>;
  };
};

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : null);

export function margemPorProduto(itens: ItemComCusto[]): ResultadoDaMargem {
  type Acc = { chave: string; nome: string; quantidade: number; valor: number; qc: number; vc: number; custo: number; faltas: Set<string> };
  const porProduto = new Map<string, Acc>();
  for (const i of itens) {
    const q = Number(i.quantidade) || 0;
    if (!(q > 0)) continue;
    let a = porProduto.get(i.chave);
    if (!a) { a = { chave: i.chave, nome: i.nome, quantidade: 0, valor: 0, qc: 0, vc: 0, custo: 0, faltas: new Set() }; porProduto.set(i.chave, a); }
    a.quantidade += q;
    a.valor += Number(i.valor) || 0;
    if (i.custo != null && Number.isFinite(i.custo)) { a.qc += q; a.vc += Number(i.valor) || 0; a.custo += i.custo; }
    else for (const f of i.faltas || []) a.faltas.add(f);
  }
  const valorTotal = [...porProduto.values()].reduce((s, a) => s + a.valor, 0);

  const produtos: LinhaDeProduto[] = [...porProduto.values()].map((a) => {
    const temCusto = a.qc > 0;
    const precoComCusto = temCusto ? a.vc / a.qc : 0;
    const custoUnit = temCusto ? a.custo / a.qc : null;
    return {
      chave: a.chave, nome: a.nome,
      quantidade: Math.round(a.quantidade * 1000) / 1000,
      valor: c2(a.valor),
      precoMedio: c2(a.quantidade > 0 ? a.valor / a.quantidade : 0),
      pctDoFaturamento: pct(a.valor, valorTotal) ?? 0,
      quantidadeComCusto: Math.round(a.qc * 1000) / 1000,
      valorComCusto: c2(a.vc),
      custoTotal: temCusto ? c2(a.custo) : null,
      custoUnitario: custoUnit == null ? null : c2(custoUnit),
      margemUnitaria: custoUnit == null ? null : c2(precoComCusto - custoUnit),
      margemTotal: temCusto ? c2(a.vc - a.custo) : null,
      margemPct: temCusto ? pct(a.vc - a.custo, a.vc) : null,
      // Custo zero (item com ficha de insumos fora do CMV) não tem markup.
      markup: temCusto && a.custo > 0 ? Math.round((a.vc / a.custo) * 100) / 100 : null,
      quadrante: null,
      faltas: [...a.faltas].slice(0, 3),
    };
  });

  // ── A matriz, só com quem tem custo ──
  const comCusto = produtos.filter((p) => p.margemUnitaria != null && p.quantidadeComCusto > 0);
  const qtdComCusto = comCusto.reduce((s, p) => s + p.quantidadeComCusto, 0);
  const corte = comCusto.length ? (0.7 / comCusto.length) * 100 : null;
  const margemMedia = qtdComCusto > 0 ? comCusto.reduce((s, p) => s + (p.margemUnitaria as number) * p.quantidadeComCusto, 0) / qtdComCusto : null;
  const contagem: Record<Quadrante, number> = { estrela: 0, vaca: 0, quebraCabeca: 0, abacaxi: 0 };
  if (corte != null && margemMedia != null && comCusto.length >= 2) {
    for (const p of comCusto) {
      const popular = (p.quantidadeComCusto / qtdComCusto) * 100 >= corte;
      const lucra = (p.margemUnitaria as number) >= margemMedia - 1e-9;
      p.quadrante = popular ? (lucra ? "estrela" : "vaca") : (lucra ? "quebraCabeca" : "abacaxi");
      contagem[p.quadrante]++;
    }
  }

  produtos.sort((a, b) => (b.margemTotal ?? -Infinity) - (a.margemTotal ?? -Infinity) || b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));
  const valorComCusto = produtos.reduce((s, p) => s + p.valorComCusto, 0);
  const custo = produtos.reduce((s, p) => s + (p.custoTotal || 0), 0);
  return {
    produtos,
    totais: {
      valor: c2(valorTotal),
      quantidade: Math.round(produtos.reduce((s, p) => s + p.quantidade, 0) * 1000) / 1000,
      valorComCusto: c2(valorComCusto),
      custo: c2(custo),
      margem: c2(valorComCusto - custo),
      margemPct: custo > 0 ? pct(valorComCusto - custo, valorComCusto) : null,
      coberturaPct: pct(valorComCusto, valorTotal),
      produtosSemCusto: produtos.filter((p) => p.custoTotal == null).length,
    },
    matriz: {
      corteDePopularidadePct: corte == null ? null : Math.round(corte * 100) / 100,
      margemMedia: margemMedia == null ? null : c2(margemMedia),
      contagem,
    },
  };
}
