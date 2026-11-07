/**
 * HISTÓRICO DAS CONTAGENS — o "Inventários" do SWFast: em cada contagem
 * fechada, o que o sistema dizia, o que foi contado e a DIFERENÇA em R$. Mais
 * o que o SWF não mostra: os insumos que mais SOMEM somando todas as
 * contagens do período (onde está o furo).
 *
 * A diferença é a do fechamento (lib/cmv/contagem-no-banco.ts): só o item
 * CONTADO tem diferença (o carregado não foi conferido), quantidade contada −
 * saldo do sistema na hora, × o custo congelado na contagem. Negativa = faltou
 * na prateleira (perda que ninguém lançou, porção maior que a ficha, desvio);
 * positiva = sobrou (entrada não lançada, ficha maior que a porção real).
 * Item sem custo tem a diferença em quantidade e fica fora do R$.
 *
 * Puro. Testado em scripts/teste-estoque-relatorios.ts.
 */
import { c2 } from "@/lib/relatorios/base";

export type ItemDaContagem = {
  stockItemId: string;
  nome: string;
  unidade: string;
  /** null = não contado. */
  contado: number | null;
  quantidade: number | null;
  origem: string | null;
  saldoSistema: number | null;
  custoUnitario: number | null;
};

export type ContagemFechadaComItens = {
  id: string;
  dia: string;
  tipo: string;
  valorTotal: number | null;
  itens: ItemDaContagem[];
};

export type DiferencaDoItem = { stockItemId: string; nome: string; unidade: string; sistema: number; contado: number; diferenca: number; valor: number | null };

export type LinhaDaContagem = {
  id: string;
  dia: string;
  tipo: string;
  valorTotal: number | null;
  contados: number;
  /** Itens contados com diferença. */
  comDiferenca: number;
  /** R$ que faltou (negativo) e que sobrou (positivo). */
  faltou: number;
  sobrou: number;
  liquido: number;
  semCusto: number;
  /** As diferenças, as maiores em R$ primeiro. */
  diferencas: DiferencaDoItem[];
};

export type InsumoQueSome = { stockItemId: string; nome: string; unidade: string; contagens: number; diferenca: number; valor: number | null };

const q3 = (n: number) => Math.round(n * 1000) / 1000;

export function diferencasDaContagem(c: ContagemFechadaComItens): LinhaDaContagem {
  const diferencas: DiferencaDoItem[] = [];
  let contados = 0, semCusto = 0, faltou = 0, sobrou = 0;
  for (const i of c.itens) {
    if (i.contado == null || String(i.origem || "").toUpperCase() !== "CONTADO") continue;
    contados++;
    if (i.saldoSistema == null) continue;
    const contado = Number(i.quantidade ?? i.contado);
    const diferenca = q3(contado - Number(i.saldoSistema));
    if (Math.abs(diferenca) < 1e-6) continue;
    const custo = i.custoUnitario != null && i.custoUnitario > 0 ? i.custoUnitario : null;
    const valor = custo != null ? c2(diferenca * custo) : null;
    if (valor == null) semCusto++;
    else if (valor < 0) faltou += valor;
    else sobrou += valor;
    diferencas.push({ stockItemId: i.stockItemId, nome: i.nome, unidade: i.unidade, sistema: q3(Number(i.saldoSistema)), contado: q3(contado), diferenca, valor });
  }
  diferencas.sort((a, b) => Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0) || Math.abs(b.diferenca) - Math.abs(a.diferenca));
  return {
    id: c.id, dia: c.dia, tipo: c.tipo, valorTotal: c.valorTotal, contados, comDiferenca: diferencas.length,
    faltou: c2(faltou), sobrou: c2(sobrou), liquido: c2(faltou + sobrou), semCusto, diferencas,
  };
}

export function historicoDeContagens(contagens: ContagemFechadaComItens[]) {
  const linhas = contagens.map(diferencasDaContagem).sort((a, b) => b.dia.localeCompare(a.dia));
  const porInsumo = new Map<string, InsumoQueSome & { comValor: boolean }>();
  for (const l of linhas) for (const d of l.diferencas) {
    let x = porInsumo.get(d.stockItemId);
    if (!x) { x = { stockItemId: d.stockItemId, nome: d.nome, unidade: d.unidade, contagens: 0, diferenca: 0, valor: 0, comValor: false }; porInsumo.set(d.stockItemId, x); }
    x.contagens++;
    x.diferenca = q3(x.diferenca + d.diferenca);
    if (d.valor != null) { x.valor = c2((x.valor || 0) + d.valor); x.comValor = true; }
  }
  // Os que mais SOMEM: a maior falta em R$ primeiro (sem custo, pela quantidade, no fim).
  const queSomem: InsumoQueSome[] = [...porInsumo.values()]
    .filter((x) => x.diferenca < 0)
    .map(({ comValor, ...x }) => ({ ...x, valor: comValor ? x.valor : null }))
    .sort((a, b) => (a.valor ?? 0) - (b.valor ?? 0) || a.diferenca - b.diferenca);
  return {
    contagens: linhas,
    queSomem,
    totais: {
      contagens: linhas.length,
      faltou: c2(linhas.reduce((s, l) => s + l.faltou, 0)),
      sobrou: c2(linhas.reduce((s, l) => s + l.sobrou, 0)),
      liquido: c2(linhas.reduce((s, l) => s + l.liquido, 0)),
    },
  };
}

export type ResultadoDoHistorico = ReturnType<typeof historicoDeContagens>;
