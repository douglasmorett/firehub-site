/**
 * A RÉGUA ÚNICA DE VENDA — o que todo relatório chama de "valor vendido",
 * "vendas", "ticket médio", "taxa de serviço" e "desconto na mesa", num lugar
 * só, puro, para nenhum relatório montar a própria.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 24/09/2026 os relatórios davam números diferentes para a mesma semana.
 * Pastel da Paulista (a loja das mesas com conta), 09 a 16/09/2026:
 *
 *     Vendas por período   R$ 34.660,54   635 "pedidos"   itens R$ 33.585,50
 *     Faturamento por dia  R$ 34.631,14   495 vendas      itens R$ 33.681,50
 *     Dia e hora           R$ 34.535,14   494 pedidos
 *     Itens vendidos                                      itens R$ 33.585,50
 *
 * Cada relatório tinha uma boa razão para o seu jeito de contar a mesa — pelos
 * pedidos, pela conta fechada com min(consumo, pago), por um fator de desconto
 * da sessão —, e as quatro juntas eram a pior resposta possível: o lojista que
 * abre dois relatórios e acha dois números para a mesma semana para de confiar
 * nos dois. Decisão do dono do produto, 24/09/2026:
 *
 * 1. VALOR VENDIDO = Σ `totalAmount` dos pedidos na régua de venda
 *    (lib/relatorios/servidor.ts, pedidosDoRelatorio), pela data e hora do
 *    PEDIDO (dia operacional), INCLUSIVE o lançamento de mesa — mesa aberta ou
 *    fechada. Nada de min(consumo, pago) nem de fator no valor: o pedido é o
 *    que tem itens, e só assim o total dos itens bate com o Itens vendidos.
 * 2. VENDAS (atendimentos) = pedido sem mesa + 1 por mesa (TableSession) com
 *    lançamento no período. A mesa conta UMA vez, no dia e na hora do seu
 *    PRIMEIRO lançamento dentro do período (`atendimentosDaVenda`). Uma mesa
 *    de três rodadas são três lançamentos e UMA venda: contadas como três, o
 *    ticket da mesa de R$ 150 virava três de R$ 50. Ticket médio = valor
 *    vendido ÷ vendas. Os lançamentos (pedidos) aparecem como detalhe.
 * 3. TAXA DE SERVIÇO e GORJETA não moram no pedido: moram na sessão, gravadas
 *    no fechamento. Entram pelas mesas FECHADAS no período (closedAt), sempre
 *    À PARTE do valor vendido (`servicoDasMesas`) — são do garçom.
 * 4. O DESCONTO DADO NO FECHAMENTO da mesa também não mora no pedido: sai de
 *    consumo − (pago − serviço − gorjeta) (`descontoNoFechamento`). É À PARTE e
 *    informativo, "não abatido do valor vendido", pelo closedAt. É um PISO: o
 *    troco deixado na mesa esconde parte dele.
 * 5. Pagamentos (relatório Formas de pagamento) continuam vindo das baixas
 *    reais — a mesa pela TableSession.paymentMethods no fechamento. A ponte de
 *    lá explica a diferença para o valor vendido.
 *
 * O troco não mexe em nada disto: ele só existe no `totalPaid` da sessão (a
 * baixa grava a nota que o cliente entregou), e o valor vendido é a soma dos
 * pedidos. Quem precisa tirá-lo é o relatório de pagamentos, do Dinheiro.
 *
 * ── Quem segue a régua ──────────────────────────────────────────────────────
 *
 * Todas as telas de relatório, inclusive o Cupons e descontos e o Painel
 * (/store/relatorios/painel). O Cupons e descontos (lib/relatorios/descontos.ts)
 * usa a MESMA fórmula do desconto na mesa (`descontoDaMesa` =
 * `descontoNoFechamento`, conferido em scripts/teste-vendas.ts) e as mesas
 * FECHADAS no período (`mesasFechadasDoPeriodo`, regra 4): a mesa de cortesia
 * da Pastel da Paulista, lançada em 11/09/2026 e fechada em 13/09, entra no
 * dia 13 nos dois, e o desconto total de 13/09 dá R$ 286,49 em ambos. O Painel
 * conta vendas e ticket por `atendimentosDaVenda`/`ticketMedio` daqui.
 * scripts/conferir-relatorios-batem.mjs confere que os totais batem.
 *
 * ── Acréscimo ───────────────────────────────────────────────────────────────
 *
 * O acréscimo (parentOrderId — a Coca a mais no pedido do iFood) é o mesmo
 * cliente: soma no valor, mas não abre venda nova quando o pedido-pai está no
 * mesmo recorte. Com o pai FORA do recorte (outro dia, outro filtro), ele é a
 * única presença do cliente ali e conta como venda — a mesma lógica da mesa,
 * que conta no primeiro lançamento DENTRO do período. Em 24/09/2026 há um
 * acréscimo em produção (20/09/2026, 04h11), e num dia operacional diferente
 * do pai: com a regra "acréscimo nunca é venda", aquele dia teria valor sem
 * venda nenhuma.
 *
 * Testado em scripts/teste-vendas.ts, teste-faturamento-por-dia.ts,
 * teste-data-hora.ts e teste-formas-de-pagamento.ts — cada um confere a sua
 * conta contra esta. scripts/conferir-relatorios-batem.mjs confere os
 * relatórios entre si, no banco de verdade.
 */
import { ehCancelado } from "@/lib/relatorios/base";

// ── DINHEIRO, EM CENTAVOS ───────────────────────────────────────────────────
// Somar 400 pedidos em float deixa R$ 0,01 de sobra aqui e ali, e a conta
// "itens + taxas − descontos = total" deixa de fechar no centavo.

export const cent = (v: unknown) => Math.round((Number(v) || 0) * 100);
export const reais = (c: number) => Math.round(c) / 100;

/** Ticket médio: valor ÷ vendas, em centavos inteiros. Sem venda, zero. */
export const ticketMedio = (valor: number, vendas: number) => (vendas > 0 ? reais(Math.round((valor * 100) / vendas)) : 0);

// ── SITUAÇÃO DO PEDIDO ──────────────────────────────────────────────────────

export type Situacao = "venda" | "cancelado" | "naoConcluido";

const NAO_CONCLUIDOS = new Set(["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"]);

/**
 * Venda, cancelado ou não concluído. Não concluído é o rascunho que o robô do
 * WhatsApp monta enquanto conversa (CRIANDO_IA) e o pedido do totem ou do Pix
 * antes de o pagamento cair (AGUARDANDO_PAGAMENTO): nenhum dos dois chegou a
 * ser pedido, então também não foi cancelado. É o complemento de
 * STATUS_FORA_DA_VENDA (lib/relatorios/base.ts).
 */
export function situacaoDoPedido(status: string | null | undefined): Situacao {
  const s = String(status || "").toUpperCase();
  if (ehCancelado(s)) return "cancelado";
  if (NAO_CONCLUIDOS.has(s)) return "naoConcluido";
  return "venda";
}

// ── ITENS ───────────────────────────────────────────────────────────────────

export type ItemDaRegua = { quantity?: number | null; price?: number | null };

/**
 * Total dos itens do pedido: preço × quantidade, cada item arredondado ao
 * centavo — a regra do Itens vendidos (quantidade ≤ 0 é item tirado na
 * edição e não conta). O Faturamento por dia somava a quantidade negativa e
 * contava a mesa pelas contas fechadas: R$ 33.681,50 contra R$ 33.585,50 do
 * Itens vendidos na mesma semana (Pastel da Paulista, 09–16/09/2026).
 */
export function totalDosItens(p: { items?: ItemDaRegua[] | null }): number {
  let c = 0;
  for (const i of p.items || []) {
    const q = Number(i.quantity) || 0;
    if (q <= 0) continue;
    c += Math.round((Number(i.price) || 0) * q * 100);
  }
  return reais(c);
}

/** Quantas unidades de item o pedido tem (quantidade ≤ 0 não conta). */
export function quantidadeDeItens(p: { items?: ItemDaRegua[] | null }): number {
  let n = 0;
  for (const i of p.items || []) { const q = Number(i.quantity) || 0; if (q > 0) n += q; }
  return n;
}

// ── VALOR IMPOSSÍVEL ────────────────────────────────────────────────────────

/**
 * Pedido de R$ 1 milhão ou mais não é venda, é erro de cadastro ou teste. Há
 * um de verdade: o #112 do site da Pastel da Paulista (13/09/2026, cancelado),
 * com item de R$ 100.000.000.000.000.000 — em centavos ele passa do maior
 * inteiro exato do JavaScript e os outros valores sumiam da soma. Fica FORA de
 * todas as somas e contagens e é contado à parte, para a tela avisar.
 */
export const VALOR_IMPOSSIVEL = 1_000_000;

/** Total ou itens ≥ R$ 1 milhão. Sem os itens (o relatório não os buscou), só o total decide. */
export function temValorImpossivel(p: { totalAmount?: number | null; items?: ItemDaRegua[] | null }): boolean {
  if (!(Math.abs(Number(p.totalAmount) || 0) < VALOR_IMPOSSIVEL)) return true;
  let itens = 0;
  for (const i of p.items || []) { const q = Number(i.quantity) || 0; if (q > 0) itens += (Number(i.price) || 0) * q; }
  return !(Math.abs(itens) < VALOR_IMPOSSIVEL);
}

/** O pedido entra no valor vendido? Venda (nem cancelado, nem intenção) e valor possível. */
export function entraNaVenda(p: { status?: string | null; totalAmount?: number | null; items?: ItemDaRegua[] | null }): boolean {
  return situacaoDoPedido(p.status) === "venda" && !temValorImpossivel(p);
}

// ── VENDAS (ATENDIMENTOS) ───────────────────────────────────────────────────

export type PedidoDaRegua = {
  id: string;
  createdAt: Date | string;
  status?: string | null;
  totalAmount?: number | null;
  tableSessionId?: string | null;
  parentOrderId?: string | null;
  items?: ItemDaRegua[] | null;
};

export type AtendimentosDaVenda = {
  /** Vendas: pedido sem mesa + 1 por mesa com lançamento no recorte. */
  vendas: number;
  /** Das vendas, quantas são contas de mesa (sessões). */
  mesas: number;
  /** Pedidos que entram no valor vendido (cada rodada de mesa é um). */
  lancamentos: number;
  /** Dos lançamentos, quantos são de mesa com sessão. */
  lancamentosDeMesa: number;
  /**
   * Os ids dos pedidos que ABREM uma venda: o pedido comum, o primeiro
   * lançamento de cada mesa e o acréscimo cujo pai está fora do recorte. É a
   * venda no dia e na hora dele — o relatório por dia ou por hora conta
   * `abre.has(id)` onde o pedido cai.
   */
  abre: Set<string>;
};

const instante = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * As vendas de um recorte de pedidos (já filtrado por período, tipo, canal,
 * marca e horário). Só conta o que entra na venda (`entraNaVenda`): quem
 * chama pode mandar os cancelados junto.
 *
 * A mesa com sessão é UMA venda, aberta pelo lançamento mais antigo do recorte
 * (empate: o menor id, para a conta não mudar de uma consulta para outra). O
 * lançamento de mesa antigo, sem sessão (deliveryType MESA pelo PDV — todos os
 * da NIK), não tem como ser agrupado: cada um é uma venda.
 */
export function atendimentosDaVenda(pedidos: PedidoDaRegua[]): AtendimentosDaVenda {
  const validos = pedidos.filter(entraNaVenda);
  const porId = new Map(validos.map((p) => [p.id, p]));

  /** A venda a que o pedido pertence: a mesa, o pai (se está no recorte) ou ele mesmo. */
  const chaveDe = (p: PedidoDaRegua): string => {
    let atual = p;
    // A guarda só existe para um ciclo de parentOrderId que o banco não devia ter.
    for (let guarda = 0; guarda < 20; guarda++) {
      if (atual.tableSessionId) return `s:${atual.tableSessionId}`;
      const pai = atual.parentOrderId ? porId.get(atual.parentOrderId) : undefined;
      if (!pai) return `p:${atual.id}`;
      atual = pai;
    }
    return `p:${p.id}`;
  };

  const primeiro = new Map<string, PedidoDaRegua>();
  let lancamentosDeMesa = 0;
  for (const p of validos) {
    if (p.tableSessionId) lancamentosDeMesa++;
    const chave = chaveDe(p);
    const atual = primeiro.get(chave);
    if (!atual || instante(p.createdAt) < instante(atual.createdAt) || (instante(p.createdAt) === instante(atual.createdAt) && p.id < atual.id)) {
      primeiro.set(chave, p);
    }
  }
  const mesas = [...primeiro.keys()].filter((k) => k.startsWith("s:")).length;
  return {
    vendas: primeiro.size,
    mesas,
    lancamentos: validos.length,
    lancamentosDeMesa,
    abre: new Set([...primeiro.values()].map((p) => p.id)),
  };
}

// ── MESAS FECHADAS: SERVIÇO, GORJETA E DESCONTO NO FECHAMENTO ───────────────

/**
 * Uma mesa FECHADA no período, já filtrada pelos filtros do relatório
 * (lib/relatorios/mesas-do-periodo.ts). Com `fechadaEm`, `pago` e `pedidos`
 * (TODOS os pedidos da conta, de qualquer dia), dá para deduzir o desconto
 * dado no fechamento (`descontoNoFechamento`).
 */
export type MesaFechada = {
  id: string;
  serviceFee?: number | null;
  waiterTip?: number | null;
  fechadaEm?: Date | string | null;
  /** TableSession.totalPaid — inclui o troco (a baixa grava a nota entregue). */
  pago?: number | null;
  pedidos?: { status?: string | null; totalAmount?: number | null; discountTotal?: number | null }[];
};

/** Desde quando o fechamento da mesa aceita desconto (commit 85ef5c3f) — a data do relatório Descontos. */
export const DESCONTO_NA_MESA_DESDE = "2026-09-13T03:00:00.000Z";

/**
 * O desconto dado ao fechar a conta da mesa, em reais. É informação à parte:
 * NÃO é abatido do valor vendido (regra 4 do topo).
 *
 * - Fechada desde 13/09/2026: consumo − (pago − taxa de serviço − gorjeta).
 *   Antes disso a mesa não tinha desconto, e diferença era conta mal fechada
 *   (antes de 24/08 fechava com qualquer valor). Pedido da conta que já traz
 *   desconto próprio zera a dedução, para não contar duas vezes. Sem o pago
 *   gravado, não há o que deduzir. Caso real: Pastel da Paulista, mesa
 *   fechada em 13/09/2026 com R$ 125,40 de consumo e nada pago (cortesia).
 * - Conta antiga com taxa de serviço NEGATIVA (Pastel da Paulista, 05/09/2026:
 *   −R$ 48,91): era assim que se dava desconto antes. Numa mesa recente as duas
 *   leituras dão o mesmo dinheiro — vale a maior, nunca a soma.
 * - Nunca mais que o consumo (quando os pedidos da conta vieram) e só acima de
 *   1 centavo, no valor final. São as duas travas de `descontoDaMesa` do
 *   relatório Descontos: desconto maior que a conta não existe (o fechamento
 *   não deixa: lib/desconto-manual.ts para na conta), e pago abaixo de taxa +
 *   gorjeta é dado torto, não desconto. Até a revisão de 24/09/2026 esta
 *   função não tinha as duas travas — a MESMA palavra "desconto na mesa" com
 *   duas fórmulas. Nas 571 mesas fechadas em produção em 24/09/2026 as duas
 *   davam o mesmo número; a diferença só aparecia em dado torto, e agora nem aí.
 *
 * É um PISO: o troco deixado na mesa entra no pago e esconde parte do desconto.
 */
export function descontoNoFechamento(m: MesaFechada): number {
  // A conta em reais, arredondada só no fim — a mesma ordem de `descontoDaMesa`,
  // para as duas darem o mesmo centavo (a taxa é gravada sem arredondar: 6,359).
  const taxa = Number(m.serviceFee) || 0;
  const pelaTaxa = taxa < 0 ? -taxa : 0;
  const validos = (m.pedidos || []).filter((o) => situacaoDoPedido(o.status) === "venda" && !temValorImpossivel(o));
  const consumo = validos.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
  let pelaConta = 0;
  const fechada = m.fechadaEm ? new Date(m.fechadaEm).getTime() : NaN;
  if (fechada >= Date.parse(DESCONTO_NA_MESA_DESDE) && m.pago != null && m.pedidos && !validos.some((o) => (Number(o.discountTotal) || 0) > 0)) {
    pelaConta = consumo - ((Number(m.pago) || 0) - Math.max(0, taxa) - Math.max(0, Number(m.waiterTip) || 0));
  }
  let valor = Math.max(pelaTaxa, pelaConta);
  if (m.pedidos) valor = Math.min(consumo, valor);
  const c = cent(valor);
  return c > 1 ? reais(c) : 0;
}

export type ServicoDasMesas = {
  /** Taxa de serviço (só a positiva: a negativa é desconto). */
  taxa: number;
  gorjeta: number;
  /** Mesas fechadas no período (com ou sem taxa). */
  mesas: number;
  /** Desconto dado no fechamento, à parte — nunca abatido do valor vendido. */
  descontoNaMesa: number;
  mesasComDesconto: number;
};

/**
 * Serviço, gorjeta e desconto no fechamento das mesas FECHADAS no período.
 *
 * A taxa de serviço é gravada sem arredondar (10% de R$ 63,59 = 6,359).
 * Soma-se crua e arredonda-se no fim, como o relatório de mesas e o acerto do
 * garçom (api/store/mesas/relatorio). Arredondar mesa a mesa dá outro número,
 * e a diferença cresce com o período: Pastel da Paulista, 09–16/09/2026,
 * R$ 1.594,42 crua × 1.594,44 mesa a mesa; 01–24/09 só Mesa, 2.457,44 ×
 * 2.457,48. É ESTA soma que todo relatório mostra como "taxa de serviço" —
 * inclusive o Formas de pagamento, que antes somava mesa a mesa e mostrava os
 * 4 centavos a mais; lá a diferença para o que cada conta cobrou fica numa
 * linha própria da ponte. A taxa NEGATIVA (conta antiga, era o desconto) vai
 * para o desconto no fechamento.
 */
export function servicoDasMesas(mesas: MesaFechada[]): ServicoDasMesas {
  let servico = 0, gorjeta = 0, cDesconto = 0, mesasComDesconto = 0;
  for (const m of mesas) {
    const taxa = Number(m.serviceFee) || 0;
    if (taxa >= 0) servico += taxa;
    gorjeta += Math.max(0, Number(m.waiterTip) || 0);
    const desconto = cent(descontoNoFechamento(m));
    if (desconto > 0) { cDesconto += desconto; mesasComDesconto++; }
  }
  return {
    taxa: reais(Math.round(servico * 100)),
    gorjeta: reais(Math.round(gorjeta * 100)),
    mesas: mesas.length,
    descontoNaMesa: reais(cDesconto),
    mesasComDesconto,
  };
}

// ── COMPARAÇÃO COM O PERÍODO ANTERIOR ───────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A janela do período anterior cortada no MESMO horário de agora, quando o
 * período chega até hoje (hoje ainda está vendendo). `recuo` é quantos dias o
 * anterior está para trás (o tamanho do período, ou semanas inteiras com o
 * filtro de dia da semana do Faturamento por dia).
 *
 * Comparar o hoje pela metade com o ontem inteiro dava "↓ 100%" todo
 * meio-dia. O Faturamento por dia já cortava; o Vendas por período não, e a
 * MESMA métrica no MESMO filtro saía com duas variações. Medido na NIK em
 * 24/09/2026, às 14h39: no período "Hoje", o Vendas comparava 0 vendas e R$ 0
 * com o 23/09 inteiro (98 vendas, R$ 6.475,28 — "↓ 100%" em vermelho),
 * enquanto o Faturamento comparava com o 23/09 até as 14h39 (0 e R$ 0, sem
 * variação). Nos 7 dias (18–24/09), o anterior do Vendas tinha 225 vendas e
 * R$ 12.542,43; o do Faturamento, 202 e R$ 11.212,55. Os dois cortam aqui.
 */
export function anteriorAteEsteHorario<J extends { inicio: Date; fim: Date }>(
  janela: J,
  e: { ate: string; hoje: string; recuo: number; agora?: number },
): { janela: J; ateEsteHorario: boolean } {
  const ateEsteHorario = e.ate >= e.hoje;
  if (!ateEsteHorario) return { janela, ateEsteHorario };
  const corte = (e.agora ?? Date.now()) - e.recuo * DIA_MS;
  return { janela: { ...janela, fim: new Date(Math.min(janela.fim.getTime(), corte)) }, ateEsteHorario };
}
