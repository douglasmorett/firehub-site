/**
 * SANGRIAS, RETIRADAS E SUPRIMENTOS DO PERÍODO — cada dinheiro que saiu ou
 * entrou na gaveta no meio do turno, com quem lançou, o motivo e o caixa. O
 * SWFast lista por data, operador e motivo; no FireHub elas só apareciam
 * dentro de cada caixa do Histórico (lib/movimentacoes-do-caixa.ts).
 *
 * As mesmas regras de lá: ENTRADA é suprimento/reforço de troco; o que não é
 * ENTRADA é retirada (sangria para o cofre, pagamento pelo caixa) — o mesmo
 * critério do dinheiro esperado do fechamento. O valor é sempre positivo; o
 * sinal é do tipo. O lançado no Histórico DEPOIS de o caixa fechar (a sangria
 * esquecida) vem marcado: a hora é a do lançamento, não a do dinheiro.
 *
 * O dia é o dia operacional do lançamento (vira às 5h, no fuso da loja).
 * O motivo é o texto que o operador digitou, agrupado sem diferença de
 * maiúscula e espaço; sem texto, "(sem motivo)" — o campo é opcional de propósito.
 *
 * Puro: a rota busca.
 */
import { naLoja } from "@/lib/relatorios/base";
import { cent, reais } from "@/lib/relatorios/regua-da-venda";

export type MovimentoParaRelatorio = {
  id: string;
  tipo: string;
  valor: number;
  descricao: string | null;
  /** Nome (ou e-mail) de quem lançou. */
  quem: string | null;
  em: Date | string;
  caixaId: string;
  /** Quem responde pelo caixa (diferencas-de-caixa.ts, operadorDoCaixa). */
  operadorDoCaixa: string;
  depoisDoFechamento: boolean;
};

export type LinhaDoMovimento = Omit<MovimentoParaRelatorio, "em" | "tipo"> & { tipo: "ENTRADA" | "SAIDA"; em: string; dia: string; hora: string };

type Soma = { quantidade: number; valor: number };
export type ResultadoDasSangrias = {
  lista: LinhaDoMovimento[];
  total: { suprimentos: Soma; retiradas: Soma; saldo: number };
  porQuem: { quem: string; suprimentos: Soma; retiradas: Soma }[];
  porMotivo: { motivo: string; tipo: "ENTRADA" | "SAIDA"; quantidade: number; valor: number }[];
  porDia: { dia: string; suprimentos: Soma; retiradas: Soma }[];
};

const SEM_MOTIVO = "(sem motivo)";
const SEM_NOME = "Não identificado";

export function sangriasESuprimentos(movs: MovimentoParaRelatorio[], tz: string | null | undefined): ResultadoDasSangrias {
  const zero = () => ({ q: 0, c: 0 });
  const tot = { e: zero(), s: zero() };
  const porQuem = new Map<string, { nome: string; e: { q: number; c: number }; s: { q: number; c: number } }>();
  const porMotivo = new Map<string, { motivo: string; tipo: "ENTRADA" | "SAIDA"; q: number; c: number }>();
  const porDia = new Map<string, { e: { q: number; c: number }; s: { q: number; c: number } }>();
  const lista: LinhaDoMovimento[] = [];

  for (const m of movs) {
    const tipo: "ENTRADA" | "SAIDA" = m.tipo === "ENTRADA" ? "ENTRADA" : "SAIDA";
    const c = Math.abs(cent(m.valor));
    if (!c) continue;
    const local = naLoja(m.em, tz);
    const quem = String(m.quem || "").trim() || SEM_NOME;
    const motivo = String(m.descricao || "").replace(/\s+/g, " ").trim();

    const somar = (x: { q: number; c: number }) => { x.q++; x.c += c; };
    somar(tipo === "ENTRADA" ? tot.e : tot.s);
    const kq = quem.toLowerCase();
    if (!porQuem.has(kq)) porQuem.set(kq, { nome: quem, e: zero(), s: zero() });
    somar(tipo === "ENTRADA" ? porQuem.get(kq)!.e : porQuem.get(kq)!.s);
    const km = `${tipo}|${(motivo || SEM_MOTIVO).toLowerCase()}`;
    if (!porMotivo.has(km)) porMotivo.set(km, { motivo: motivo || SEM_MOTIVO, tipo, q: 0, c: 0 });
    somar(porMotivo.get(km)!);
    if (!porDia.has(local.dia)) porDia.set(local.dia, { e: zero(), s: zero() });
    somar(tipo === "ENTRADA" ? porDia.get(local.dia)!.e : porDia.get(local.dia)!.s);

    lista.push({
      ...m, tipo, valor: reais(c), em: new Date(m.em).toISOString(), dia: local.dia,
      hora: `${String(local.hora).padStart(2, "0")}:${String(local.minutos % 60).padStart(2, "0")}`,
    });
  }

  const soma = (x: { q: number; c: number }): Soma => ({ quantidade: x.q, valor: reais(x.c) });
  lista.sort((a, b) => b.em.localeCompare(a.em));
  return {
    lista,
    total: { suprimentos: soma(tot.e), retiradas: soma(tot.s), saldo: reais(tot.e.c - tot.s.c) },
    porQuem: [...porQuem.values()].map((x) => ({ quem: x.nome, suprimentos: soma(x.e), retiradas: soma(x.s) })).sort((a, b) => b.retiradas.valor - a.retiradas.valor),
    porMotivo: [...porMotivo.values()].map((x) => ({ motivo: x.motivo, tipo: x.tipo, quantidade: x.q, valor: reais(x.c) })).sort((a, b) => b.valor - a.valor),
    porDia: [...porDia.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([dia, x]) => ({ dia, suprimentos: soma(x.e), retiradas: soma(x.s) })),
  };
}
