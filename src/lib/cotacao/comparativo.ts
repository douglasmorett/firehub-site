/**
 * A PLANILHA COMPARATIVA — produto × fornecedor, com o mais barato marcado.
 * Puro: a rota monta as listas do banco e chama isto; o teste chama direto.
 *
 * Douglas, 07/11/2026: "trazer uma planilha comparativa de todos os
 * fornecedores daquele mesmo item, para ele poder comparar e comprar o mais
 * barato toda semana, todo dia."
 *
 * Regras:
 *  - o preço de um fornecedor para um produto é o ÚLTIMO confirmado; o
 *    anterior a ele dá a variação (subiu/caiu);
 *  - preço com mais de DIAS_PARA_PRECO_VELHO dias aparece, mas apagado, e só
 *    disputa o "mais barato" se ninguém tiver preço recente — tabela velha de
 *    um fornecedor não pode ganhar do preço de hoje de outro;
 *  - "precisa comprar" = ligado ao estoque, com saldo no mínimo ou abaixo.
 */

export type ProdutoDoComparativo = {
  id: string; nome: string; categoria: string | null; unidade: string; quantidadePadrao: number | null;
  /** Saldo e mínimo do insumo ligado (na unidade do insumo). */
  saldo: number | null; minimo: number | null; unidadeDoInsumo: string | null;
};
export type FornecedorDoComparativo = { id: string; nome: string; categorias: string[] };
export type PrecoDoComparativo = { fornecedorId: string; produtoId: string; preco: number; em: string; validade: string | null };

export type Celula = {
  preco: number; anterior: number | null; variacao: number | null; em: string; validade: string | null; velho: boolean;
};
export type LinhaDoComparativo = {
  produto: ProdutoDoComparativo;
  precos: Record<string, Celula>;
  menor: { fornecedorId: string; preco: number } | null;
  /** Quanto se economiza no mais barato contra o mais caro (recentes). */
  economia: number | null;
  precisaComprar: boolean;
};
export type ColunaDoComparativo = FornecedorDoComparativo & {
  ultimaAtualizacao: string | null;
  /** Na rodada atual: respondeu? Nulo = não foi pedido nesta rodada. */
  respondeu: boolean | null;
  itensComPreco: number;
};
export type Comparativo = { colunas: ColunaDoComparativo[]; linhas: LinhaDoComparativo[] };

export const DIAS_PARA_PRECO_VELHO = 14;
const DIA_MS = 24 * 60 * 60 * 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function montarComparativo(
  produtos: ProdutoDoComparativo[],
  fornecedores: FornecedorDoComparativo[],
  precos: PrecoDoComparativo[],
  rodada: { pedidosA: string[]; responderam: string[] } | null,
  agora: Date = new Date(),
): Comparativo {
  // Do mais novo para o mais velho: o primeiro de cada par é o atual, o segundo o anterior.
  const ordenados = [...precos].sort((a, b) => b.em.localeCompare(a.em));
  const porPar = new Map<string, PrecoDoComparativo[]>();
  for (const p of ordenados) {
    const k = `${p.produtoId}|${p.fornecedorId}`;
    const l = porPar.get(k);
    if (!l) porPar.set(k, [p]);
    else if (l.length < 2) l.push(p);
  }

  const linhas: LinhaDoComparativo[] = produtos.map((produto) => {
    const celulas: Record<string, Celula> = {};
    for (const f of fornecedores) {
      const par = porPar.get(`${produto.id}|${f.id}`);
      if (!par) continue;
      const [atual, anterior] = par;
      const velho = agora.getTime() - new Date(atual.em).getTime() > DIAS_PARA_PRECO_VELHO * DIA_MS;
      celulas[f.id] = {
        preco: atual.preco,
        anterior: anterior ? anterior.preco : null,
        variacao: anterior && anterior.preco > 0 ? Math.round(((atual.preco - anterior.preco) / anterior.preco) * 1000) / 1000 : null,
        em: atual.em,
        validade: atual.validade,
        velho,
      };
    }
    const todas = Object.entries(celulas);
    const recentes = todas.filter(([, c]) => !c.velho);
    const disputa = recentes.length ? recentes : todas;
    const ordem = [...disputa].sort((a, b) => a[1].preco - b[1].preco);
    const menor = ordem[0] ? { fornecedorId: ordem[0][0], preco: ordem[0][1].preco } : null;
    const economia = ordem.length >= 2 ? r2(ordem[ordem.length - 1][1].preco - ordem[0][1].preco) : null;
    const precisaComprar = produto.saldo !== null && produto.minimo !== null && produto.minimo > 0 && produto.saldo <= produto.minimo;
    return { produto, precos: celulas, menor, economia, precisaComprar };
  });

  const colunas: ColunaDoComparativo[] = fornecedores.map((f) => {
    let ultima: string | null = null;
    let itens = 0;
    for (const l of linhas) {
      const c = l.precos[f.id];
      if (!c) continue;
      itens++;
      if (!ultima || c.em > ultima) ultima = c.em;
    }
    const respondeu = rodada && rodada.pedidosA.includes(f.id) ? rodada.responderam.includes(f.id) : null;
    return { ...f, ultimaAtualizacao: ultima, respondeu, itensComPreco: itens };
  });

  return { colunas, linhas };
}

export type Variacao = { nome: string; de: number; para: number; variacao: number };

/**
 * O que mais caiu e mais subiu entre os preços que chegaram desde `desde` —
 * o miolo do resumo para o comprador.
 */
export function maioresVariacoes(c: Comparativo, desde: string, quantos = 3): { quedas: Variacao[]; altas: Variacao[] } {
  const todas: Variacao[] = [];
  for (const l of c.linhas) {
    for (const cel of Object.values(l.precos)) {
      if (cel.em < desde || cel.anterior === null || cel.variacao === null || cel.variacao === 0) continue;
      todas.push({ nome: l.produto.nome, de: cel.anterior, para: cel.preco, variacao: cel.variacao });
    }
  }
  const quedas = todas.filter((v) => v.variacao < 0).sort((a, b) => a.variacao - b.variacao).slice(0, quantos);
  const altas = todas.filter((v) => v.variacao > 0).sort((a, b) => b.variacao - a.variacao).slice(0, quantos);
  return { quedas, altas };
}

/** O fornecedor que um fornecedor atende para este produto (categorias vazias = tudo). */
export function fornecedorAtende(f: { categorias: string[] }, categoria: string | null): boolean {
  if (!f.categorias.length) return true;
  if (!categoria) return true;
  const c = categoria.trim().toLowerCase();
  return f.categorias.some((x) => x.trim().toLowerCase() === c);
}
