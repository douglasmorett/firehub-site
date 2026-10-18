/**
 * CLUBE — as contas do painel da loja (Meu aplicativo › Clube). Puro, sem banco.
 *
 * O que a loja precisa ver para saber se o clube vale a pena (regra "produto
 * pago mostra valor"): quantos sócios entram e saem no mês, quanto caiu de
 * mensalidade no Asaas, quanto de desconto foi dado e, principalmente, se o
 * SÓCIO pede mais vezes e gasta mais que quem não é sócio.
 *
 * Valor e vendas pela régua (lib/relatorios/regua-da-venda.ts): o valor de todo
 * pedido que entra na venda; a venda conta uma vez (o acréscimo não abre outra).
 */
import { ticketMedio } from "@/lib/relatorios/regua-da-venda";

const c2 = (n: number) => Math.round(n * 100) / 100;

export type PedidoDoTelefone = { telefone: string; valor: number; abre: boolean };

export type LadoDaComparacao = {
  /** Clientes (telefones) com pelo menos uma venda no período. */
  clientes: number;
  vendas: number;
  valor: number;
  ticket: number;
  /** Vendas por cliente no período (frequência). */
  pedidosPorCliente: number;
  /** Valor por cliente no período. */
  valorPorCliente: number;
};

function lado(pedidos: PedidoDoTelefone[]): LadoDaComparacao {
  const telefones = new Set<string>();
  let vendas = 0;
  let valor = 0;
  for (const p of pedidos) {
    valor += p.valor;
    if (p.abre) {
      vendas++;
      telefones.add(p.telefone);
    }
  }
  const clientes = telefones.size;
  return {
    clientes,
    vendas,
    valor: c2(valor),
    ticket: ticketMedio(c2(valor), vendas),
    pedidosPorCliente: clientes ? Math.round((vendas / clientes) * 10) / 10 : 0,
    valorPorCliente: clientes ? c2(valor / clientes) : 0,
  };
}

/** Sócio × não sócio no período: frequência e ticket. `socios` = os 8 últimos dígitos dos telefones. */
export function socioXNaoSocio(pedidos: PedidoDoTelefone[], socios: Set<string>) {
  const deSocio = pedidos.filter((p) => socios.has(p.telefone));
  const deOutros = pedidos.filter((p) => !socios.has(p.telefone));
  const s = lado(deSocio);
  const n = lado(deOutros);
  const vezes = (a: number, b: number) => (a > 0 && b > 0 ? Math.round((a / b) * 10) / 10 : null);
  return {
    socios: s,
    naoSocios: n,
    /** Quantas vezes o sócio pede mais (null = sem base para comparar). */
    frequenciaVezes: vezes(s.pedidosPorCliente, n.pedidosPorCliente),
    /** Quanto o ticket do sócio é maior (ou menor), em %. */
    ticketDiferencaPct: s.ticket > 0 && n.ticket > 0 ? Math.round(((s.ticket - n.ticket) / n.ticket) * 1000) / 10 : null,
  };
}

export type SocioParaResumo = { situacao: "ativo" | "pendente" | "encerrado" | "nao_assinante"; desde: string | null; canceladoEm: string | null };

/**
 * O mês do clube: sócios ativos agora, novos e cancelamentos no mês, o que
 * entrou de mensalidade e o desconto dado. `saldo` = mensalidade líquida −
 * desconto: o clube se paga quando é positivo (o resto é venda a mais).
 */
export function resumoDoMes(o: {
  socios: SocioParaResumo[];
  inicioDoMes: Date;
  mensalidades: { quantas: number; bruto: number; liquido: number };
  descontoNoMes: number;
}) {
  const noMes = (iso: string | null) => !!iso && new Date(iso).getTime() >= o.inicioDoMes.getTime();
  return {
    ativos: o.socios.filter((s) => s.situacao === "ativo").length,
    semPagamento: o.socios.filter((s) => s.situacao === "pendente").length,
    novos: o.socios.filter((s) => noMes(s.desde)).length,
    cancelamentos: o.socios.filter((s) => noMes(s.canceladoEm)).length,
    mensalidadesPagas: o.mensalidades.quantas,
    receitaBruta: c2(o.mensalidades.bruto),
    receitaLiquida: c2(o.mensalidades.liquido),
    desconto: c2(o.descontoNoMes),
    saldo: c2(o.mensalidades.liquido - o.descontoNoMes),
  };
}
