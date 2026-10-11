/**
 * O fechamento de uma contagem de estoque: que quantidade vale para cada item
 * e quanto ela vale em R$.
 *
 * ── As três origens da quantidade ──────────────────────────────────────────
 *
 *   CONTADO    alguém contou. É o caso de todo item numa contagem COMPLETA e
 *              dos itens marcados "contar todo dia" na RÁPIDA.
 *   CARREGADO  não foi contado hoje (contagem rápida): vale a quantidade da
 *              última contagem fechada + o que entrou e saiu desde então pelos
 *              lançamentos (compras, entradas e saídas à mão, perdas). A venda
 *              não entra: ela sai pela ficha técnica, que é estimativa, e o
 *              CMV aqui é o real. O consumo desse item aparece no dia em que
 *              ele for contado (na próxima completa).
 *   SISTEMA    nunca foi contado: vale o saldo do sistema (nunca negativo).
 *
 * ── O ajuste ────────────────────────────────────────────────────────────────
 *
 * Fechada a contagem, o saldo do sistema passa a ser o contado: a diferença
 * vira uma movimentação "AJUSTE". Só para o CONTADO, porque os outros não
 * trouxeram informação nova.
 *
 * Puro. A rota de fechar (api/store/estoque/contagens/[id]/fechar) busca e grava.
 */
import type { CustoNoDia } from "@/lib/cmv/custo-do-insumo";

export type OrigemDaQuantidade = "CONTADO" | "CARREGADO" | "SISTEMA";

export type ItemDaContagem = {
  stockItemId: string;
  nome: string;
  unidade: string;
  /** O que foi contado. Nulo = não contado. */
  contado: number | null;
  /** O saldo do sistema agora. */
  saldoSistema: number;
};

export type LinhaDoFechamento = {
  stockItemId: string;
  nome: string;
  unidade: string;
  contado: number | null;
  quantidade: number;
  origem: OrigemDaQuantidade;
  custoUnitario: number | null;
  valor: number;
  saldoSistema: number;
  /** contado − saldo do sistema. Só no CONTADO; zero nos outros. */
  ajuste: number;
};

export type Fechamento = {
  linhas: LinhaDoFechamento[];
  /** Σ valor dos itens que entram no CMV. */
  valorTotal: number;
  contados: number;
  carregados: number;
  peloSistema: number;
  /** Itens com quantidade e sem custo: entram com R$ 0 e a tela avisa. */
  semCusto: string[];
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param anterior  quantidade final de cada item na última contagem FECHADA
 *                  antes desta (null se esta é a primeira).
 * @param movimentoDesde  Σ das movimentações de cada item depois daquela
 *                  contagem até agora, sem venda e sem ajuste de contagem.
 */
export function fecharContagem(e: {
  itens: ItemDaContagem[];
  anterior: Map<string, number> | null;
  movimentoDesde: Map<string, number>;
  custos: Map<string, CustoNoDia>;
  /** Itens fora do CMV (limpeza, gás): contados, mas fora do valor total. */
  foraDoCmv?: Set<string>;
}): Fechamento {
  const linhas: LinhaDoFechamento[] = [];
  const semCusto: string[] = [];
  let valorTotal = 0, contados = 0, carregados = 0, peloSistema = 0;

  for (const it of e.itens) {
    let quantidade: number;
    let origem: OrigemDaQuantidade;
    const contado = it.contado != null && Number.isFinite(Number(it.contado)) ? Math.max(0, Number(it.contado)) : null;

    if (contado != null) {
      quantidade = contado;
      origem = "CONTADO";
      contados++;
    } else if (e.anterior && e.anterior.has(it.stockItemId)) {
      quantidade = Math.max(0, (e.anterior.get(it.stockItemId) || 0) + (e.movimentoDesde.get(it.stockItemId) || 0));
      origem = "CARREGADO";
      carregados++;
    } else {
      quantidade = Math.max(0, Number(it.saldoSistema) || 0);
      origem = "SISTEMA";
      peloSistema++;
    }

    const custo = e.custos.get(it.stockItemId)?.custo ?? null;
    if (custo == null && quantidade > 0) semCusto.push(it.nome);
    const valor = custo != null ? r2(quantidade * custo) : 0;
    if (!e.foraDoCmv?.has(it.stockItemId)) valorTotal += valor;

    linhas.push({
      stockItemId: it.stockItemId,
      nome: it.nome,
      unidade: it.unidade,
      contado,
      quantidade: r6(quantidade),
      origem,
      custoUnitario: custo,
      valor,
      saldoSistema: r6(Number(it.saldoSistema) || 0),
      ajuste: origem === "CONTADO" ? r6(quantidade - (Number(it.saldoSistema) || 0)) : 0,
    });
  }

  return { linhas, valorTotal: r2(valorTotal), contados, carregados, peloSistema, semCusto };
}

/**
 * O movimento que conta para o item CARREGADO: tudo menos a venda (SALE), a
 * devolução da venda cancelada (INPUT com "cancel id:") e o ajuste de outra
 * contagem. A devolução casa com a venda, e as duas são estimativa pela ficha.
 */
export function entraNoCarregado(t: { type: string; notes?: string | null }): boolean {
  const tipo = String(t.type || "").toUpperCase();
  if (tipo === "SALE" || tipo === "AJUSTE") return false;
  if (tipo === "INPUT" && String(t.notes || "").includes("cancel id:")) return false;
  return true;
}
