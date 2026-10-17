/**
 * O HISTÓRICO DE MESAS — as contas fechadas no dia (ou no período), mesa a
 * mesa, com a forma de pagamento de cada uma e, ao clicar, o que foi pedido.
 *
 * Pedido do Allan (Delicias de Casa, 17/10/2026), aprovado pelo dono: "Em
 * Mesas, ter um relatório de venda de mesa: abertura, fechamento, número da
 * mesa, valor, uma lista do que foi vendido no dia, ao clicar o máximo de
 * detalhes." Até aqui, mesa fechada sumia da tela de Mesas e virava rodadas
 * soltas em Pedidos, cada uma "N/A" (ver lib/pagamento-da-mesa-no-pedido.ts).
 *
 * ── Os números são os do Relatório de Mesas ─────────────────────────────────
 *
 * Nenhuma conta nova mora aqui. A mesa é a das contas FECHADAS no período, pelo
 * `closedAt`, no dia operacional da loja (vira às 5h, fuso do dono —
 * `janelaDoPeriodo`), como o topo do Relatório de Mesas (Garçons):
 *
 *   - consumo, taxa, gorjeta, desconto e total da conta de cada mesa saem de
 *     `contaDaMesa` (lib/relatorios/relatorio-de-mesas.ts, régua única): o
 *     consumo é a soma dos pedidos da conta que são venda, SEM troco, e o
 *     desconto aparece à parte;
 *   - o resumo do topo sai de `mesasFechadasDoRelatorio`, a MESMA função do
 *     Relatório de Mesas — "Consumo nas mesas" de lá = "Consumo" daqui, no
 *     centavo, e a soma das linhas fecha com o resumo
 *     (scripts/teste-historico-de-mesas.ts);
 *   - a mesa conta UMA vez, por mais rodadas que tenha; as rodadas aparecem
 *     como detalhe;
 *   - a forma de pagamento sai de `baixasDaConta`
 *     (lib/relatorios/formas-de-pagamento.ts): as baixas da conta, já SEM o
 *     troco, que sai do dinheiro — a mesa de R$ 7,00 paga com nota de R$ 100
 *     é "Dinheiro R$ 7,00 · troco R$ 93,00", e o Dinheiro das mesas aqui é o
 *     mesmo das mesas no Formas de pagamento.
 *
 * Puro: a rota (api/store/mesas/historico) busca, aqui só se conta.
 */
import { calcularContaDaMesa, nomeDaLinhaDaConta, type ItemDaMesaParaConta } from "@/lib/conta-da-mesa";
import { emCentavos, lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { naLoja } from "@/lib/relatorios/base";
import { baixasDaConta, FORMAS, rotuloDaForma, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import { cent, reais, situacaoDoPedido, temValorImpossivel, ticketMedio } from "@/lib/relatorios/regua-da-venda";
import { consumoDaConta, contaDaMesa, mesasFechadasDoRelatorio, type MesasFechadas } from "@/lib/relatorios/relatorio-de-mesas";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type ItemDoHistorico = ItemDaMesaParaConta & { notes?: string | null };

export type PedidoDoHistorico = {
  id: string;
  status: string;
  totalAmount: number;
  discountTotal?: number | null;
  dailyOrderNumber?: number | null;
  createdAt?: Date | string | null;
  items?: ItemDoHistorico[];
};

/** Uma conta de mesa FECHADA, com TODOS os pedidos dela (de qualquer dia). */
export type SessaoDoHistorico = {
  id: string;
  mesa: { numero: number; nome: string | null };
  cliente?: string | null;
  waiterId?: string | null;
  garcom?: string | null;
  abertaEm: Date | string;
  fechadaEm: Date | string;
  fechadaPor?: string | null;
  serviceFee?: number | null;
  waiterTip?: number | null;
  totalPaid?: number | null;
  /** TableSession.paymentMethods, cru. */
  paymentMethods?: unknown;
  pedidos: PedidoDoHistorico[];
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type FormaDaLinha = { chave: ChaveDaForma; forma: string; valor: number };

export type LinhaDoHistorico = {
  id: string;
  mesa: { numero: number; nome: string | null };
  cliente: string | null;
  garcom: string;
  /** Hora no relógio da loja ("19:42"), com o dia quando não é o do fechamento. */
  abertura: string;
  fechamento: string;
  /** O dia operacional do fechamento ("YYYY-MM-DD", vira às 5h): a tela agrupa por ele no período de vários dias. */
  dia: string;
  /** ISO, para ordenar e para o detalhe. */
  abertaEm: string;
  fechadaEm: string;
  /** Minutos entre abrir e fechar a conta. */
  permanenciaMin: number;
  fechadaPor: string | null;
  /** Rodadas (pedidos) que são venda — a mesa é UMA venda, isto é detalhe. */
  rodadas: number;
  consumo: number;
  desconto: number;
  taxa: number;
  gorjeta: number;
  /** consumo − desconto + taxa + gorjeta: o que a conta cobrou, sem troco. */
  totalDaConta: number;
  /** As formas como a conta pagou, já sem o troco (`baixasDaConta`). */
  pagamentos: FormaDaLinha[];
  troco: number;
  /** "paga" | "liberada" (fechou sem pagamento, ex.: liberada sem consumo). */
  situacao: "paga" | "liberada";
};

export type ItemVendidoNasMesas = { nome: string; quantidade: number; valor: number };

export type ResumoDoHistorico = Pick<MesasFechadas, "fechadas" | "consumo" | "taxaServico" | "gorjetas" | "descontoNoFechamento" | "mesasComDesconto"> & {
  /** Σ total da conta das mesas (consumo − desconto + taxa + gorjeta). */
  totalDasContas: number;
  ticketMedio: number;
  troco: number;
  porForma: { chave: ChaveDaForma; rotulo: string; valor: number; mesas: number }[];
};

export type HistoricoDeMesas = {
  resumo: ResumoDoHistorico;
  mesas: LinhaDoHistorico[];
  /** O que saiu nas mesas do período, por produto — o "lista do que foi vendido no dia". */
  itens: ItemVendidoNasMesas[];
};

// ── HORA NA LOJA ────────────────────────────────────────────────────────────

function partes(instante: Date | string, tz: string | null | undefined) {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => f.find((p) => p.type === t)?.value || "";
  return { dia: `${v("day")}/${v("month")}`, hora: `${v("hour")}:${v("minute")}` };
}

/**
 * "19:42" no relógio da loja; "16/10 23:10" quando o instante é de outro dia
 * do calendário que o de referência (a mesa aberta ontem e fechada hoje).
 */
export function horaNaLoja(instante: Date | string, tz: string | null | undefined, referencia?: Date | string): string {
  const p = partes(instante, tz);
  if (!referencia) return p.hora;
  const r = partes(referencia, tz);
  return r.dia === p.dia ? p.hora : `${p.dia} ${p.hora}`;
}

// ── A LINHA DE UMA MESA ─────────────────────────────────────────────────────

const ehVenda = (o: PedidoDoHistorico) => situacaoDoPedido(o.status) === "venda" && !temValorImpossivel(o);
const nomeDoGarcom = (s: SessaoDoHistorico) => s.garcom?.trim() || "Sem garçom";

/** As baixas da conta sem o troco, agrupadas pelo texto da forma (duas de "Dinheiro" viram uma). */
function pagamentosDaConta(s: SessaoDoHistorico): { pagamentos: FormaDaLinha[]; troco: number } {
  const consumo = cent(consumoDaConta(s.pedidos));
  const { baixas, troco } = baixasDaConta({
    pagamentos: s.paymentMethods,
    totalPago: s.totalPaid,
    servico: emCentavos(s.serviceFee || 0),
    gorjeta: emCentavos(s.waiterTip || 0),
    consumo,
  });
  const ordem: string[] = [];
  const somas = new Map<string, { chave: ChaveDaForma; forma: string; centavos: number }>();
  for (const b of baixas) {
    if (b.centavos <= 0) continue;
    const k = b.texto.toLocaleLowerCase("pt-BR");
    const atual = somas.get(k);
    if (atual) atual.centavos += b.centavos;
    else { somas.set(k, { chave: b.forma, forma: b.texto, centavos: b.centavos }); ordem.push(k); }
  }
  return {
    pagamentos: ordem.map((k) => { const x = somas.get(k)!; return { chave: x.chave, forma: x.forma, valor: reais(x.centavos) }; }),
    troco: reais(troco),
  };
}

export function linhaDoHistorico(s: SessaoDoHistorico, tz: string | null | undefined): LinhaDoHistorico {
  const conta = contaDaMesa({ id: s.id, serviceFee: s.serviceFee, waiterTip: s.waiterTip, fechadaEm: s.fechadaEm, pago: s.totalPaid, pedidos: s.pedidos });
  const { pagamentos, troco } = pagamentosDaConta(s);
  const aberta = new Date(s.abertaEm);
  const fechada = new Date(s.fechadaEm);
  return {
    id: s.id,
    mesa: s.mesa,
    cliente: s.cliente?.trim() || null,
    garcom: nomeDoGarcom(s),
    abertura: horaNaLoja(aberta, tz, fechada),
    fechamento: horaNaLoja(fechada, tz),
    dia: naLoja(fechada, tz).dia,
    abertaEm: aberta.toISOString(),
    fechadaEm: fechada.toISOString(),
    permanenciaMin: Math.max(0, Math.round((fechada.getTime() - aberta.getTime()) / 60000)),
    fechadaPor: s.fechadaPor?.trim() || null,
    rodadas: s.pedidos.filter(ehVenda).length,
    consumo: conta.consumo,
    desconto: conta.desconto,
    taxa: conta.taxa,
    gorjeta: conta.gorjeta,
    totalDaConta: conta.totalDaConta,
    pagamentos,
    troco,
    situacao: pagamentos.length > 0 ? "paga" : "liberada",
  };
}

// ── O HISTÓRICO DO PERÍODO ──────────────────────────────────────────────────

/**
 * As mesas fechadas no período, da mais recente para a mais antiga, com o
 * resumo e os itens. As sessões já vêm filtradas pela janela (a rota busca
 * pelo `closedAt` dentro de `janelaDoPeriodo`).
 */
export function historicoDeMesas(sessoes: SessaoDoHistorico[], tz: string | null | undefined): HistoricoDeMesas {
  const mesas = sessoes.map((s) => linhaDoHistorico(s, tz)).sort((a, b) => b.fechadaEm.localeCompare(a.fechadaEm));

  // O topo pela MESMA função do Relatório de Mesas: os dois mostram o mesmo número.
  const fechadas = mesasFechadasDoRelatorio(sessoes.map((s) => ({
    id: s.id, waiterId: s.waiterId, garcom: s.garcom, serviceFee: s.serviceFee, waiterTip: s.waiterTip,
    fechadaEm: s.fechadaEm, pago: s.totalPaid, pedidos: s.pedidos,
  })));

  const porForma = new Map<ChaveDaForma, { centavos: number; mesas: Set<string> }>();
  let totalDasContas = 0, troco = 0;
  for (const m of mesas) {
    totalDasContas += cent(m.totalDaConta);
    troco += cent(m.troco);
    for (const p of m.pagamentos) {
      const f = porForma.get(p.chave) ?? { centavos: 0, mesas: new Set<string>() };
      f.centavos += cent(p.valor);
      f.mesas.add(m.id);
      porForma.set(p.chave, f);
    }
  }

  // O que foi vendido: os itens das rodadas que são venda, por nome. Quem
  // quiser categoria, opções e meia pizza tem o Itens vendidos (Relatórios),
  // filtrando Mesa; aqui é a lista do dia que o dono confere com a cozinha.
  const itens = new Map<string, { nome: string; q: number; c: number }>();
  for (const s of sessoes) {
    for (const o of s.pedidos) {
      if (!ehVenda(o)) continue;
      for (const it of o.items || []) {
        const nome = String(it.productName || it.menuProduct?.name || "Item").replace(/\s+/g, " ").trim();
        const k = nome.toLocaleLowerCase("pt-BR");
        const atual = itens.get(k) ?? { nome, q: 0, c: 0 };
        const q = Number(it.quantity) || 1;
        atual.q += q;
        atual.c += emCentavos((Number(it.price) || 0) * q);
        itens.set(k, atual);
      }
    }
  }

  return {
    resumo: {
      fechadas: fechadas.fechadas,
      consumo: fechadas.consumo,
      taxaServico: fechadas.taxaServico,
      gorjetas: fechadas.gorjetas,
      descontoNoFechamento: fechadas.descontoNoFechamento,
      mesasComDesconto: fechadas.mesasComDesconto,
      totalDasContas: reais(totalDasContas),
      ticketMedio: ticketMedio(fechadas.consumo, fechadas.fechadas),
      troco: reais(troco),
      // Na ordem do fechamento de caixa, só as formas que apareceram.
      porForma: FORMAS.filter((f) => porForma.has(f.chave)).map((f) => ({
        chave: f.chave, rotulo: rotuloDaForma(f.chave), valor: reais(porForma.get(f.chave)!.centavos), mesas: porForma.get(f.chave)!.mesas.size,
      })),
    },
    mesas,
    itens: [...itens.values()]
      .map((x) => ({ nome: x.nome, quantidade: x.q, valor: reais(x.c) }))
      .sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR")),
  };
}

// ── O DETALHE DE UMA MESA (ao clicar) ───────────────────────────────────────

export type BaixaDoDetalhe = { forma: string; valor: number; hora: string; por: string | null; pessoa: string | null };

export type PedidoDoDetalhe = {
  id: string;
  numero: number | null;
  hora: string;
  cancelado: boolean;
  total: number;
  itens: { nome: string; quantidade: number; valor: number; pessoa: string | null; obs: string | null }[];
};

export type DetalheDaMesa = LinhaDoHistorico & {
  /** As rodadas, na ordem em que foram lançadas — a cancelada aparece riscada, fora da conta. */
  pedidos: PedidoDoDetalhe[];
  /** Cada baixa como foi registrada (a nota entregue, antes do troco), com hora e quem lançou. */
  baixas: BaixaDoDetalhe[];
  /** O consumo de cada pessoa, quando a conta foi separada por pessoa. */
  pessoas: { id: string; nome: string; consumo: number }[];
  observacao: string | null;
};

/**
 * O "máximo de detalhes" de uma conta: a linha do histórico, as rodadas com os
 * itens (com as escolhas do combo no nome, como na conta impressa), cada baixa
 * com hora e quem lançou, e o consumo por pessoa quando a mesa foi dividida.
 */
export function detalheDaMesa(
  s: SessaoDoHistorico & { pessoas?: { id: string; name: string }[]; observacao?: string | null },
  tz: string | null | undefined,
): DetalheDaMesa {
  const linha = linhaDoHistorico(s, tz);
  const pessoas = s.pessoas || [];
  const nomeDaPessoa = new Map(pessoas.map((p) => [p.id, p.name]));
  const fechada = new Date(s.fechadaEm);
  const pedidos = [...s.pedidos]
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .map((o) => ({
      id: o.id,
      numero: o.dailyOrderNumber ?? null,
      hora: o.createdAt ? horaNaLoja(o.createdAt, tz, fechada) : "",
      cancelado: situacaoDoPedido(o.status) !== "venda",
      total: reais(cent(o.totalAmount)),
      itens: (o.items || []).map((it) => ({
        nome: nomeDaLinhaDaConta(it),
        quantidade: Number(it.quantity) || 1,
        valor: reais(emCentavos((Number(it.price) || 0) * (Number(it.quantity) || 1))),
        pessoa: it.tableGuestId ? nomeDaPessoa.get(it.tableGuestId) || null : null,
        obs: it.notes?.trim() || null,
      })),
    }));
  // O consumo por pessoa pela conta da mesa (lib/conta-da-mesa.ts) — o mesmo
  // rateio da tela de fechamento; sem pessoas cadastradas, não há o que dividir.
  const porPessoa = pessoas.length > 0
    ? calcularContaDaMesa(
        {
          table: { number: s.mesa.numero, label: s.mesa.nome },
          orders: s.pedidos.map((o) => ({ status: o.status, totalAmount: o.totalAmount, dailyOrderNumber: o.dailyOrderNumber ?? null, items: o.items || [] })),
          waiterTip: 0,
        },
        pessoas, 0, 0,
      ).pessoas.map((p) => ({ id: p.id, nome: p.nome, consumo: p.consumo }))
    : [];
  return {
    ...linha,
    pedidos,
    baixas: lerPagamentos(s.paymentMethods).map((b) => ({
      forma: b.method,
      valor: b.amount,
      hora: b.at ? horaNaLoja(b.at, tz, fechada) : "",
      por: b.por,
      pessoa: b.guestName,
    })),
    pessoas: porPessoa,
    observacao: s.observacao?.trim() || null,
  };
}
