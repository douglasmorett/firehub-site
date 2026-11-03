/**
 * Mês a mês da aba Projeção do admin (lib/projecao-do-mes.ts lê o banco e chama
 * esta). Pedido do Douglas (03/11/2026): "enxergar mês a mês quanto a gente
 * bateu", o ano inteiro, cada mês contra o anterior. Teste sem banco:
 * scripts/teste-projecao-do-mes.ts.
 */
import { somarMeses } from "@/lib/projecao-de-crescimento-regras";

/** Venda pelo sistema num mês (a mesma régua do card "Vendas pelo sistema"). */
export type VendaNoMes = { mes: string; vendas: number; pedidos: number; lojas: number };
/** Ciclo de cobrança fechado: o boleto da mensalidade daquele mês (paga no mês seguinte). */
export type CicloNoMes = {
  mes: string; status: string; amountDue: number; amountPending: number;
  paidValue: number | null; asaasPaymentId: string | null;
};
export type LinhaDoMesAMes = {
  mes: string;
  /** fechado = mês passado; atual = até agora + o ritmo; futuro = sem número. */
  tipo: "fechado" | "atual" | "futuro";
  vendas: number; pedidos: number; lojasVendendo: number;
  /** Só no mês atual: onde as vendas e as transações devem fechar. */
  vendasPrevistas: number | null; pedidosPrevistos: number | null;
  /** Mensalidade do mês. Fechado: valor dos boletos (pago + em aberto). Atual: se todas pagarem. */
  mensalidade: number; recebido: number; emAberto: number; perdoadas: number;
  boletos: number; lojasPagas: number;
  /** Atual: a aposta (chance de cada boleto). */
  aposta: number | null;
  /** Contra o mês anterior (fração: 0,25 = +25%); null sem base. O mês atual compara pelo previsto. */
  variacao: { vendas: number | null; pedidos: number | null; mensalidade: number | null };
};

/** Quanto `atual` mudou sobre `anterior` (0,25 = +25%). Sem base, null. */
export function variacaoSobre(atual: number, anterior: number): number | null {
  return anterior > 0 ? atual / anterior - 1 : null;
}

/**
 * Os meses de janeiro do primeiro ano com venda ou boleto até dezembro do ano
 * atual. Boleto segue a leitura de "Boletos de <mês>": pago = PAID com boleto
 * no Asaas (PAID sem boleto é o "nada a cobrar"); em aberto = CLOSED com saldo;
 * perdoado à parte, fora do valor.
 */
export function montarMesAMes(e: {
  vendas: VendaNoMes[]; ciclos: CicloNoMes[]; mesAtual: string;
  atual: { vendasPrevistas: number; pedidosPrevistos: number; seTodas: number; aposta: number; boletos: number };
}): LinhaDoMesAMes[] {
  const meses = [...e.vendas.map((v) => v.mes), ...e.ciclos.map((c) => c.mes), e.mesAtual].sort();
  const primeiro = `${meses[0].slice(0, 4)}-01`;
  const ultimo = `${e.mesAtual.slice(0, 4)}-12`;
  const vendaDo = new Map(e.vendas.map((v) => [v.mes, v]));
  const r = (v: number) => Math.round(v * 100) / 100;

  const linhas: LinhaDoMesAMes[] = [];
  for (let mes = primeiro; mes <= ultimo; mes = somarMeses(mes, 1)) {
    const tipo = mes < e.mesAtual ? "fechado" : mes === e.mesAtual ? "atual" : "futuro";
    const v = vendaDo.get(mes);
    let recebido = 0, emAberto = 0, lojasPagas = 0, boletosEmAberto = 0, perdoadas = 0;
    for (const c of e.ciclos) {
      if (c.mes !== mes) continue;
      if (c.status === "PAID" && c.asaasPaymentId) { recebido += c.paidValue ?? c.amountDue; lojasPagas++; }
      else if (c.status === "CLOSED" && c.amountPending > 0) { emAberto += c.amountPending; boletosEmAberto++; }
      else if (c.status === "FORGIVEN") perdoadas++;
    }
    const atual = tipo === "atual";
    linhas.push({
      mes, tipo,
      vendas: r(v?.vendas || 0), pedidos: v?.pedidos || 0, lojasVendendo: v?.lojas || 0,
      vendasPrevistas: atual ? r(e.atual.vendasPrevistas) : null,
      pedidosPrevistos: atual ? e.atual.pedidosPrevistos : null,
      mensalidade: r(atual ? e.atual.seTodas : recebido + emAberto),
      recebido: r(recebido), emAberto: r(emAberto), perdoadas,
      boletos: atual ? e.atual.boletos : lojasPagas + boletosEmAberto, lojasPagas,
      aposta: atual ? r(e.atual.aposta) : null,
      variacao: { vendas: null, pedidos: null, mensalidade: null },
    });
  }
  // O mês atual entra na comparação pelo previsto: o "até agora" contra um mês
  // inteiro sempre pareceria queda.
  for (let i = 1; i < linhas.length; i++) {
    const a = linhas[i], b = linhas[i - 1];
    if (a.tipo === "futuro") continue;
    a.variacao = {
      vendas: variacaoSobre(a.vendasPrevistas ?? a.vendas, b.vendas),
      pedidos: variacaoSobre(a.pedidosPrevistos ?? a.pedidos, b.pedidos),
      mensalidade: variacaoSobre(a.mensalidade, b.mensalidade),
    };
  }
  return linhas;
}
