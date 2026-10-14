/**
 * ENTRADA OU RETIRADA ESQUECIDA, LANÇADA NUM CAIXA JÁ FECHADO.
 *
 * Pedido do Victor na Pizzaria 17 (14/10/2026): esqueceram de lançar a
 * sangria de ontem e o caixa ficou com uma falta que não aconteceu. A opção
 * escolhida foi a retirada contar NAQUELE caixa e corrigir o fechamento dele —
 * e não virar uma retirada do caixa de hoje, que não tem nada com isso.
 *
 * As regras são as da correção de contagem (lib/edicao-do-caixa.ts):
 *
 *   1. O LANÇAMENTO É UMA MOVIMENTAÇÃO COMO AS OUTRAS (CashMovement daquele
 *      caixa), e por isso o papel, a 2ª via e o PDF já o somam. O que marca
 *      que foi depois é a hora: criado depois do `closedAt` do caixa. Com o
 *      caixa aberto não dá para lançar num caixa fechado, então a hora basta.
 *   2. O ESPERADO MUDA SÓ PELA PARCELA DA MOVIMENTAÇÃO. É a régua do turno
 *      (lib/esperado-do-turno.ts: entrada soma no dinheiro e no total,
 *      retirada tira dos dois) aplicada ao esperado GRAVADO — reapurar os
 *      pedidos mudaria o caixa encerrado se alguém mexeu num pedido depois.
 *      O contado não muda; a diferença sai da mesma conta do fechamento.
 *   3. NADA SOME. Lançar e excluir gravam o antes e o depois em
 *      CashSessionEdicao, com quem, quando e o motivo — o Histórico mostra.
 *   4. QUEM LANÇA é quem pode corrigir caixa fechado (`editar_caixa`).
 *
 * Puro, sem banco: a rota (api/cash-session/lancamento-tardio), a tela e o
 * teste (scripts/teste-lancamento-tardio-do-caixa.ts) leem daqui.
 */
import { FORMAS_DA_CONFERENCIA, type ChaveDaConferencia } from "@/lib/conferencia-do-caixa";
import { aplicarCorrecao, retratoDoContado, type RetratoDoContado } from "@/lib/edicao-do-caixa";

export type TipoDoLancamento = "ENTRADA" | "SAIDA";

/** O que o lançamento tardio mexe: o contado de sempre e, agora, o esperado em dinheiro e o total. */
export type RetratoComEsperado = RetratoDoContado & {
  expectedCash: number | null;
  expectedTotal: number | null;
};

/** O que fica no `depois` do registro, para o Histórico dizer o que foi lançado ou excluído. */
export type LancamentoRegistrado = {
  acao: "LANCOU" | "EXCLUIU";
  movimentoId: string;
  tipo: TipoDoLancamento;
  valor: number;
  descricao: string | null;
};

const c2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function retratoComEsperado(s: Record<string, unknown>): RetratoComEsperado {
  return { ...retratoDoContado(s), expectedCash: num(s.expectedCash), expectedTotal: num(s.expectedTotal) };
}

/**
 * Lançado depois do fechamento? A movimentação do caixa aberto nasce antes do
 * `closedAt` (a rota de sangria só lança em caixa aberto); a esquecida, depois.
 */
export function lancadoDepoisDoFechamento(criadoEm: Date | string, fechadoEm: Date | string | null | undefined): boolean {
  if (!fechadoEm) return false;
  return new Date(criadoEm).getTime() > new Date(fechadoEm).getTime();
}

/** Quanto o lançamento mexe no dinheiro esperado: entrada soma, retirada tira; excluir desfaz. */
export function efeitoNoEsperado(tipo: TipoDoLancamento, valor: number, acao: "LANCAR" | "EXCLUIR"): number {
  const sinal = (tipo === "ENTRADA" ? 1 : -1) * (acao === "LANCAR" ? 1 : -1);
  return c2(sinal * Math.abs(valor));
}

/**
 * O caixa depois de lançar (ou excluir) a movimentação esquecida.
 *
 * O esperado em dinheiro e o total andam o efeito da movimentação; a
 * diferença é refeita pela correção de contagem (`aplicarCorrecao`) com o
 * contado como está — a mesma conta do fechamento. O caixa sem conferência
 * (diferença nula: ninguém contou, ou encerrado ao abrir outro) continua sem:
 * não há contado para comparar, e a nota dele ("encerrado automaticamente…")
 * fica como foi escrita.
 */
export function recalcularComLancamento(
  s: Record<string, unknown>,
  lancamento: { tipo: TipoDoLancamento; valor: number },
  acao: "LANCAR" | "EXCLUIR",
): RetratoComEsperado {
  const efeito = efeitoNoEsperado(lancamento.tipo, lancamento.valor, acao);
  const expectedCash = c2((num(s.expectedCash) ?? 0) + efeito);
  const expectedTotal = c2((num(s.expectedTotal) ?? 0) + efeito);
  const antes = retratoDoContado(s);
  if (antes.difference == null) return { ...antes, expectedCash, expectedTotal };

  const contado = {} as Record<ChaveDaConferencia, unknown>;
  for (const f of FORMAS_DA_CONFERENCIA) contado[f.chave] = num(s[f.contado]);
  const depois = aplicarCorrecao({ ...s, expectedCash }, contado, null);
  return { ...depois, expectedCash, expectedTotal };
}

/**
 * "Retirada (sangria) de R$ 50,00 lançada depois do fechamento: pagar o gás" —
 * o motivo do registro, para o "Ver como estava antes" dizer o que mudou.
 */
export function motivoDoRegistro(l: Pick<LancamentoRegistrado, "acao" | "tipo" | "valor" | "descricao">, motivoDaExclusao?: string | null): string {
  const nome = l.tipo === "ENTRADA" ? "Entrada (suprimento)" : "Retirada (sangria)";
  const valor = `R$ ${Math.abs(l.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (l.acao === "LANCOU") return `${nome} de ${valor} lançada depois do fechamento: ${l.descricao || "sem motivo"}`;
  return `Excluída a ${nome.toLowerCase()} de ${valor} lançada depois do fechamento (${l.descricao || "sem motivo"})` +
    (motivoDaExclusao ? `: ${motivoDaExclusao}` : "");
}

/**
 * "50,00", "50.00", "1.234,50", "150.50" → número. A mesma leitura da sangria
 * do caixa aberto (api/cash-session/movimentacao): com vírgula, ela é o
 * decimal; sem vírgula, o ponto só é milhar quando o grupo final tem três
 * dígitos — "150.50" não pode virar R$ 15.050,00.
 */
export function lerValorEmReais(bruto: unknown): number {
  if (typeof bruto === "number") return bruto;
  const limpo = String(bruto ?? "").trim().replace(/[^\d.,]/g, "");
  if (!limpo) return NaN;
  if (limpo.includes(",")) return Number(limpo.replace(/\./g, "").replace(",", "."));
  const partes = limpo.split(".");
  if (partes.length === 1) return Number(limpo);
  const ultimo = partes[partes.length - 1];
  if (partes.length > 2 || ultimo.length === 3) return Number(partes.join(""));
  return Number(partes.slice(0, -1).join("") + "." + ultimo);
}
