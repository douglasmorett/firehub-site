/**
 * Os números e os textos do robô no MODO DONO e do alerta de PEDIDO ATRASADO —
 * puros (sem banco), para src/lib/painel-do-dono.ts, a rota
 * /api/cron/pedidos-atrasados e o teste (scripts/teste-painel-do-dono.ts).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Auditoria de 11/10/2026 (Ragnar Burger, domingo 01h30):
 *
 *   robô:       "hoje" R$ 1.103,86 · 23 pedidos · ticket R$ 47,99 · IFOOD 18, PRESENCIAL 5
 *   Relatórios: o turno R$ 14.642,88 · 243 vendas · ticket R$ 60,26
 *
 * O "hoje" do robô começava à meia-noite (à 1h30 o dono perguntava "quanto
 * vendi hoje?" e ouvia só a madrugada); só o CANCELADO saía da conta (o
 * rascunho do robô e o totem sem pagamento entravam); a mesa de três rodadas
 * eram três "pedidos" (ticket baixo); e o canal ia com o código cru do banco —
 * PRESENCIAL junta o balcão e a mesa.
 *
 * Agora o robô lê o DIA DE OPERAÇÃO (desde as 5h, no fuso da loja) pelo
 * `resumoDeVendas` do "Vendas por período": o mesmo valor, as mesmas vendas
 * (a mesa conta uma vez), o mesmo ticket e os mesmos nomes de canal.
 *
 * E o alerta de atraso contava a MESA aberta: o lançamento de mesa nasce
 * ACEITO e só vira ENTREGUE quando a conta fecha — Map Grill, Quiosque e
 * Pizzaria lá casa receberam 11 alertas de "pedido atrasado" por mesa com
 * gente comendo (08–09/10/2026). A retirada usava o prazo da ENTREGA e a frase
 * "Nenhum deles saiu para entrega". Agora mesa não entra, a retirada tem o
 * prazo do cartão do painel (40 min) e a frase dela.
 */
import { origemDaVenda } from "@/lib/origem-da-venda";
import { naLoja, fmtDia } from "@/lib/relatorios/base";
import { resumoDeVendas, nomeDoCanal, type PedidoParaVendas } from "@/lib/relatorios/vendas";
import { PRAZO_PADRAO_RETIRADA_MIN } from "@/lib/relatorios/tempos";

// ── DINHEIRO E HORA ─────────────────────────────────────────────────────────

/** "R$ 14.642,88" — com o milhar, sem o espaço inseparável do toLocaleString de moeda. */
export function reaisEmTexto(v: number): string {
  return `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Hora local da loja, para o dono ler "20:15" e não um UTC qualquer. */
export function horaLocal(data: Date, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit", minute: "2-digit",
      timeZone: timezone || "America/Sao_Paulo",
    }).format(data);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(data);
  }
}

// ── AS VENDAS DO DIA ────────────────────────────────────────────────────────

export type LinhaDoDono = { nome: string; vendas: number; lancamentos: number; valor: number };

export type VendasDoDiaDoDono = {
  /** O dia de operação ("YYYY-MM-DD") e o instante em que começou (as 5h). */
  dia: string;
  desde: Date;
  /** Valor vendido: o "Valor vendido" do Vendas por período. */
  valor: number;
  /** Vendas (atendimentos): a mesa conta uma vez. */
  vendas: number;
  /** Lançamentos: cada pedido que é venda (cada rodada de mesa é um). */
  lancamentos: number;
  ticket: number;
  cancelados: { pedidos: number; valor: number };
  /** Rascunho do robô e pedido esperando pagamento: fora de toda conta. */
  naoConcluidos: number;
  porCanal: LinhaDoDono[];
  porTipo: LinhaDoDono[];
};

/**
 * As vendas do dia de operação, pelo `resumoDeVendas` dos Relatórios. Os
 * pedidos chegam com cancelados e rascunhos (cada um cai na sua situação lá).
 */
export function vendasDoDiaDoDono(pedidos: PedidoParaVendas[], dia: string, desde: Date): VendasDoDiaDoDono {
  const r = resumoDeVendas(pedidos);
  return {
    dia,
    desde,
    valor: r.totalPedidos,
    vendas: r.atendimentos,
    lancamentos: r.pedidos,
    ticket: r.ticketMedio,
    cancelados: r.cancelados,
    naoConcluidos: r.naoConcluidos.pedidos,
    porCanal: r.porCanal.map((c) => ({ nome: nomeDoCanal(c.canal, false), vendas: c.vendas, lancamentos: c.pedidos, valor: c.valor })),
    porTipo: r.porTipo.map((t) => ({ nome: t.rotulo, vendas: t.vendas, lancamentos: t.pedidos, valor: t.valor })),
  };
}

/** "iFood 150 vendas (R$ 9.000,00), Mesa 30 vendas — 95 lançamentos (R$ 4.000,00)" */
export function linhasEmTexto(linhas: LinhaDoDono[]): string {
  if (linhas.length === 0) return "nenhuma venda";
  return linhas
    .map((l) => `${l.nome} ${l.vendas} ${l.vendas === 1 ? "venda" : "vendas"}${l.lancamentos !== l.vendas ? ` — ${l.lancamentos} lançamentos` : ""} (${reaisEmTexto(l.valor)})`)
    .join(", ");
}

/** "desde 05:00 de sábado, 10/10" — o começo do dia de operação, no relógio da loja. */
export function inicioDoDiaEmTexto(v: Pick<VendasDoDiaDoDono, "dia" | "desde">, tz?: string | null): string {
  const semana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][naLoja(v.desde, tz).diaSemana];
  return `desde ${horaLocal(v.desde, tz)} de ${semana}, ${fmtDia(v.dia).slice(0, 5)}`;
}

// ── O PEDIDO ATRASADO ───────────────────────────────────────────────────────

export type TipoDoAtraso = "ENTREGA" | "RETIRADA";

/** O que decide o tipo do atraso (as colunas de `origemDaVenda`). */
export type PedidoParaAtraso = {
  tableSessionId?: string | null;
  deliveryType?: string | null;
  source?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  status?: string | null;
};

/**
 * ENTREGA, RETIRADA (retirada, balcão e totem: o cliente espera NA loja) ou
 * nulo para a MESA — que não tem prazo: o lançamento fica "Aceito" enquanto a
 * conta está aberta, e isso é gente comendo, não atraso (a mesma regra do
 * cartão do painel e do relatório de Tempos).
 */
export function tipoDoAtraso(p: PedidoParaAtraso): TipoDoAtraso | null {
  const origem = origemDaVenda(p);
  if (origem === "MESA") return null;
  return origem === "DELIVERY" ? "ENTREGA" : "RETIRADA";
}

/** O prazo, em minutos: o da área de entrega mais longa na entrega; o do cartão do painel (40 min) na retirada. */
export function prazoDoAtraso(tipo: TipoDoAtraso, prazoDeEntregaMin: number): number {
  return tipo === "ENTREGA" ? prazoDeEntregaMin : PRAZO_PADRAO_RETIRADA_MIN;
}

/** "ainda não saiu para entrega" / "ainda não ficou pronto para retirada". */
export function situacaoDoAtraso(tipo: TipoDoAtraso): string {
  return tipo === "ENTREGA" ? "ainda não saiu para entrega" : "ainda não ficou pronto para retirada";
}

/**
 * O fecho da mensagem de atraso. Era sempre "Nenhum deles saiu para entrega
 * ainda." — inclusive para o pedido de retirada, que não sai para entrega
 * nenhuma.
 */
export function rodapeDosAtrasados(tipos: TipoDoAtraso[]): string {
  const entregas = tipos.filter((t) => t === "ENTREGA").length;
  const retiradas = tipos.length - entregas;
  if (retiradas === 0) return entregas === 1 ? "Ele ainda não saiu para entrega." : "Nenhum deles saiu para entrega ainda.";
  if (entregas === 0) return retiradas === 1 ? "Ele ainda não ficou pronto para o cliente retirar." : "Nenhum deles ficou pronto para retirada ainda.";
  return `${entregas === 1 ? "O de entrega ainda não saiu" : "Os de entrega ainda não saíram"} e ${retiradas === 1 ? "o de retirada ainda não ficou pronto" : "os de retirada ainda não ficaram prontos"}.`;
}

export type AtrasadoNaMensagem = {
  numero: string;
  cliente: string;
  entrouEm: Date;
  prazoMin: number;
  minutosDeVida: number;
  minutosDeAtraso: number;
  tipo: TipoDoAtraso;
};

/** No máximo isso de pedido listado; o resto vira "+ N pedido(s)". */
export const MAX_NA_MENSAGEM = 8;

/** A mensagem de WhatsApp do alerta "pedido atrasado" (rota /api/cron/pedidos-atrasados). */
export function mensagemDosAtrasados(nomeDaLoja: string | null | undefined, novos: AtrasadoNaMensagem[], timezone?: string | null): string {
  const listados = novos.slice(0, MAX_NA_MENSAGEM);
  const linhas = listados.map(
    (p) =>
      `• *${p.numero}* — ${p.cliente} · ${p.tipo === "ENTREGA" ? "entrega" : "retirada"}\n` +
      `  entrou ${horaLocal(p.entrouEm, timezone)} · prazo ${p.prazoMin} min · ` +
      `já são ${p.minutosDeVida} min (*${p.minutosDeAtraso} min além do prazo*)`
  );
  const sobra = novos.length - listados.length;
  return (
    `⏰ *${novos.length === 1 ? "Pedido atrasado" : `${novos.length} pedidos atrasados`}* — ` +
    `${nomeDaLoja || "sua loja"}\n\n` +
    linhas.join("\n") +
    (sobra > 0 ? `\n\n+ ${sobra} pedido(s) também atrasado(s).` : "") +
    `\n\n${rodapeDosAtrasados(novos.map((p) => p.tipo))}`
  );
}
