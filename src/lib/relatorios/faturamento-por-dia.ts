/**
 * O relatório "Faturamento por dia" — uma linha por DIA OPERACIONAL do período,
 * inclusive o dia sem venda (com zero), como o da Saipos.
 *
 * Colunas: data, dia da semana, vendas, valor das vendas, acumulado corrido,
 * ticket médio, total dos itens, taxa de entrega, outros, descontos e
 * cancelados (quantidade e valor) — e, quando o período tem, o desconto dado
 * no fechamento da mesa, à parte. Embaixo, TOTAL e MÉDIA por dia; em volta, o
 * melhor e o pior dia, a comparação com o período anterior e, quando a loja
 * tem, a meta de faturamento do mês.
 *
 * ── A régua única ───────────────────────────────────────────────────────────
 *
 * Valor, vendas e ticket seguem lib/relatorios/regua-da-venda.ts — a MESMA
 * régua do Vendas por período, do Dia e hora e do Formas de pagamento:
 *
 * - VALOR DAS VENDAS = Σ `totalAmount` dos pedidos que são venda, no dia
 *   (operacional) em que o PEDIDO foi feito — inclusive o lançamento de mesa,
 *   aberta ou fechada.
 * - VENDAS = atendimentos: o pedido sem mesa é uma venda; a mesa é UMA venda,
 *   no dia do seu primeiro lançamento dentro do período. Ticket = valor ÷ vendas.
 * - Taxa de serviço e gorjeta: das mesas FECHADAS no período, num total à
 *   parte (são do garçom).
 * - Desconto dado no fechamento da mesa: coluna à parte, informativa, no dia
 *   em que a mesa fechou. NÃO entra na coluna Descontos nem sai do valor.
 *
 * Até 24/09/2026 este relatório contava a mesa como UMA venda no dia do
 * FECHAMENTO, pelo valor min(consumo, pago − serviço − gorjeta), com a
 * diferença na coluna Descontos. Cada decisão tinha motivo, e o resultado era
 * um número que nenhum outro relatório repetia: Pastel da Paulista, 09 a
 * 16/09/2026, R$ 34.631,14 e 495 vendas aqui contra R$ 34.660,54 no Vendas por
 * período e 494 no Dia e hora, e total dos itens de R$ 33.681,50 contra
 * R$ 33.585,50 do Itens vendidos. O lojista que confere um relatório contra
 * o outro acha diferença e para de confiar nos dois.
 *
 * O TROCO não mexe no valor vendido: ele só existe no `totalPaid` da sessão (a
 * baixa grava a nota que o cliente entregou — Pastel da Paulista, 60 dias até
 * 24/09/2026: 21 mesas pagas a mais, R$ 374,86), e o valor é a soma dos
 * pedidos. Quem precisa tirar o troco é o Formas de pagamento, do Dinheiro.
 * A mesa aberta também não espera fechar: o lançado é vendido, e a tela avisa
 * quanto do valor está em mesas ainda abertas.
 *
 * ── O que a Saipos não faz e este faz ───────────────────────────────────────
 *
 * - A LINHA FECHA: Itens + Entrega − Descontos + Outros = Valor das vendas.
 *   "Outros" é o que o app cobrou do cliente além dos itens e da entrega — a
 *   taxa de serviço do iFood (R$ 0,99 a R$ 2,49 por pedido; na NIK, de 17 a
 *   23/09/2026, 167 dos 168 pedidos do iFood tinham essa diferença). Sem essa
 *   coluna o lojista soma as colunas, não bate com o total e conclui que o
 *   relatório está errado. A MÉDIA fecha do mesmo jeito (ver `faturamentoPorDia`).
 * - "Hoje" ainda não acabou: entra no total, mas não na MÉDIA nem no PIOR DIA
 *   — às 15h todo dia é o pior dia. A média é dos dias que já fecharam.
 * - O pior dia é o pior dia COM venda: dia zerado é loja fechada (a segunda
 *   da pizzaria), não um dia ruim. O zero continua na tabela e na média.
 * - Filtro "Dias da semana": só as sextas, por exemplo — e a comparação é com
 *   o MESMO NÚMERO de sextas (`periodoDeComparacao`).
 *
 * ── O que entra ─────────────────────────────────────────────────────────────
 *
 * VALOR DAS VENDAS é o `totalAmount` do pedido: o que o cliente pagou, com a
 * entrega e já sem o desconto (inclusive o cupom bancado pelo iFood/99 — quem
 * bancou cada desconto está no relatório "Cupons e descontos"). É a mesma
 * régua da "Receita Bruta" do Financeiro (DRE), onde mora a meta: lá também é
 * Σ `totalAmount`. Na NIK, "Este mês" em 24/09/2026 deu R$ 44.491,36 nos dois.
 * O cupom da plataforma NÃO é somado de volta: com ele o valor subiria para
 * R$ 48.376,74 e deixaria de bater com o DRE, com "Vendas por período" e com
 * "Data e hora". (O `totalAmount + discountIfood` que aparece no DREClient é
 * só do extrato do gateway e da base da mensalidade, e o campo nem chega à
 * tela. No caixa, o cupom só entra na linha do repasse do pago online.) Venda é o que
 * não está em STATUS_FORA_DA_VENDA (lib/relatorios/base.ts): cancelado, pedido
 * do totem esperando pagamento e rascunho do robô ficam de fora. O cancelado
 * aparece na coluna própria, no dia em que o pedido foi feito; a intenção
 * (totem sem pagar, rascunho) não aparece em lugar nenhum — não é venda nem
 * cancelamento.
 *
 * Puro: recebe pedidos e mesas já buscados e filtrados
 * (api/store/relatorios/faturamento-por-dia) e devolve os números prontos.
 * Testado em scripts/teste-faturamento-por-dia.ts.
 */
import { c2, diasNoPeriodo, naLoja, somarDias } from "@/lib/relatorios/base";
import {
  atendimentosDaVenda, cent, descontoNoFechamento, entraNaVenda, reais, servicoDasMesas, situacaoDoPedido, temValorImpossivel, totalDosItens,
  type MesaFechada, type ServicoDasMesas,
} from "@/lib/relatorios/regua-da-venda";

/** A régua do valor impossível mora na régua única; continua saindo daqui para quem já a importava. */
export { VALOR_IMPOSSIVEL } from "@/lib/relatorios/regua-da-venda";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type ItemParaFaturamento = { quantity: number | null; price: number | null };

export type PedidoParaFaturamento = {
  id: string;
  createdAt: Date | string;
  status: string;
  totalAmount: number | null;
  deliveryFee?: number | null;
  discountTotal?: number | null;
  /** A parte da loja e a da plataforma: quando somam mais que `discountTotal`, vale a soma (a régua do Vendas por período). */
  discountMerchant?: number | null;
  discountIfood?: number | null;
  tableSessionId?: string | null;
  /** O acréscimo não é venda nova quando o pai está no período (lib/relatorios/regua-da-venda.ts). */
  parentOrderId?: string | null;
  /** Ausente = os itens não foram buscados (período anterior): o total dos itens fica "não sei". */
  items?: ItemParaFaturamento[] | null;
};

/**
 * O desconto do pedido: o gravado, ou loja + plataforma quando as partes
 * somam mais — o total de `descontoDoPedido` do Vendas por período, sem
 * precisar saber quem bancou (aqui não importa, e o detalhe do 99Food antigo
 * não é buscado).
 */
function descontoDoPedido(p: PedidoParaFaturamento): number {
  const total = Math.max(0, cent(p.discountTotal));
  if (p.discountMerchant == null && p.discountIfood == null) return total;
  return Math.max(total, Math.max(0, cent(p.discountMerchant)) + Math.max(0, cent(p.discountIfood)));
}

// ── O QUE SAI ───────────────────────────────────────────────────────────────

/**
 * "fechado" = o dia já acabou; "hoje" = ainda vendendo; "futuro" = não chegou;
 * "antes" = antes do 1º pedido da loja no FireHub. A NIK fez o primeiro pedido
 * em 05/09/2026: "Este mês" em setembro punha 01 a 04 como dias de venda zero,
 * e a média caía de R$ 2.341,65 para R$ 1.934,41 por dias em que a loja nem
 * estava no sistema. O dia "antes" continua na tabela (com zero), mas fica
 * fora da média — a mesma régua de lib/relatorios/data-hora.ts.
 */
export type EstadoDoDia = "antes" | "fechado" | "hoje" | "futuro";

export type DiaDoFaturamento = {
  dia: string;
  /** 0 = domingo. */
  diaSemana: number;
  estado: EstadoDoDia;
  /** Vendas (atendimentos) que COMEÇARAM no dia: a mesa conta no dia do 1º lançamento. */
  vendas: number;
  /** Das vendas, quantas são contas de mesa. */
  mesas: number;
  /** Pedidos que são venda (cada rodada de mesa é um). */
  lancamentos: number;
  valor: number;
  /** Acumulado corrido dos dias mostrados. null nos dias que ainda não chegaram. */
  acumulado: number | null;
  ticketMedio: number | null;
  /** null = não sei (itens não buscados). */
  itens: number | null;
  entrega: number;
  descontos: number;
  /** Valor − (itens + entrega − descontos): a taxa de serviço do app e ajustes. */
  outros: number | null;
  /** Desconto dado ao fechar as mesas fechadas NESTE dia — à parte, não sai do valor. */
  descontoNaMesa: number;
  canceladosQtd: number;
  canceladosValor: number;
};

export type SomaDosDias = {
  vendas: number;
  mesas: number;
  lancamentos: number;
  valor: number;
  ticketMedio: number | null;
  itens: number | null;
  entrega: number;
  descontos: number;
  outros: number | null;
  descontoNaMesa: number;
  canceladosQtd: number;
  canceladosValor: number;
};

export type DiaDeDestaque = { dia: string; diaSemana: number; valor: number; vendas: number };

export type ResultadoDoFaturamento = {
  dias: DiaDoFaturamento[];
  total: SomaDosDias;
  /**
   * A média por dia, coluna a coluna. `base` diz quais dias entram: os que
   * já fecharam (o normal) ou só hoje (período de um dia, o de hoje).
   */
  media: SomaDosDias & { dias: number; base: "fechados" | "hoje" | "nenhum" };
  /** Média só dos dias que tiveram venda — a "média de dia aberto". */
  mediaDiasComVenda: number | null;
  diasComVenda: number;
  melhorDia: DiaDeDestaque | null;
  /** Entre os dias JÁ FECHADOS com venda, nunca o melhor dia, nem empatado com ele. */
  piorDia: DiaDeDestaque | null;
  /** Taxa de serviço + gorjeta das mesas fechadas no período: do garçom, fora do valor. */
  servicoDasMesas: number;
  /** O detalhe das mesas fechadas nos dias mostrados: taxa, gorjeta, desconto no fechamento. */
  mesasFechadas: ServicoDasMesas;
  /** Os dias da semana do filtro (0 = domingo). Vazio = todos. */
  diasDaSemana: number[];
  /** Pedidos deixados fora das somas por valor impossível (≥ VALOR_IMPOSSIVEL). */
  valoresImpossiveis: number;
};

export type EntradaDoFaturamento = {
  de: string;
  ate: string;
  tz: string;
  /** "Hoje" no dia operacional da loja: separa o dia que ainda está aberto. */
  hoje: string;
  /** Dia operacional do 1º pedido da loja (qualquer status). Os dias antes dele ficam fora da média. */
  primeiroDia?: string | null;
  /** 0 = domingo. Vazio = todos. */
  diasDaSemana?: number[];
  /** Pedidos do período, com os cancelados (que têm coluna própria). */
  pedidos: PedidoParaFaturamento[];
  /** Mesas FECHADAS no período, já filtradas (lib/relatorios/mesas-do-periodo.ts): serviço, gorjeta e desconto. */
  mesas?: MesaFechada[];
};

/** "0,5,6" → [0, 5, 6]. Os sete marcados é o mesmo que nenhum: todos. */
export function lerDiasDaSemana(bruto: string | null | undefined): number[] {
  const dias = [...new Set(String(bruto || "").split(",").map((s) => s.trim()).filter((s) => /^[0-6]$/.test(s)).map(Number))].sort((a, b) => a - b);
  return dias.length === 7 ? [] : dias;
}

function diaDaSemanaDe(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

/** Um dia (ou uma soma de dias) em centavos, antes de virar reais. */
type Centavos = {
  vendas: number; mesas: number; lancamentos: number;
  valor: number; itens: number | null; entrega: number; descontos: number; descontoNaMesa: number;
  canceladosQtd: number; canceladosValor: number;
};

const zerado = (): Centavos => ({ vendas: 0, mesas: 0, lancamentos: 0, valor: 0, itens: 0, entrega: 0, descontos: 0, descontoNaMesa: 0, canceladosQtd: 0, canceladosValor: 0 });

function somarCentavos(dias: Centavos[]): Centavos {
  const s = zerado();
  for (const d of dias) {
    s.vendas += d.vendas; s.mesas += d.mesas; s.lancamentos += d.lancamentos;
    s.valor += d.valor; s.entrega += d.entrega; s.descontos += d.descontos; s.descontoNaMesa += d.descontoNaMesa;
    s.canceladosQtd += d.canceladosQtd; s.canceladosValor += d.canceladosValor;
    s.itens = s.itens === null || d.itens === null ? null : s.itens + d.itens;
  }
  return s;
}

/**
 * Centavos → a linha em reais. "Outros" sai da conta da própria linha, em
 * centavos inteiros: por isso Itens + Entrega − Descontos + Outros = Valor
 * fecha no centavo em todo dia e no total.
 */
function emReais(s: Centavos): SomaDosDias {
  return {
    vendas: s.vendas,
    mesas: s.mesas,
    lancamentos: s.lancamentos,
    valor: reais(s.valor),
    ticketMedio: s.vendas > 0 ? reais(Math.round(s.valor / s.vendas)) : null,
    itens: s.itens === null ? null : reais(s.itens),
    entrega: reais(s.entrega),
    descontos: reais(s.descontos),
    outros: s.itens === null ? null : reais(s.valor - (s.itens + s.entrega - s.descontos)),
    descontoNaMesa: reais(s.descontoNaMesa),
    canceladosQtd: s.canceladosQtd,
    canceladosValor: reais(s.canceladosValor),
  };
}

const destaque = (d: DiaDoFaturamento): DiaDeDestaque => ({ dia: d.dia, diaSemana: d.diaSemana, valor: d.valor, vendas: d.vendas });

/** O relatório. Pedidos e mesas já vêm filtrados por loja, janela, tipo, canal, marca e horário. */
export function faturamentoPorDia(e: EntradaDoFaturamento): ResultadoDoFaturamento {
  const filtroDias = new Set(e.diasDaSemana || []);
  const mapa = new Map<string, Centavos & { dia: string; diaSemana: number; estado: EstadoDoDia }>();
  const n = Math.max(0, diasNoPeriodo(e.de, e.ate));
  for (let i = 0; i < n; i++) {
    const dia = somarDias(e.de, i);
    const diaSemana = diaDaSemanaDe(dia);
    if (filtroDias.size && !filtroDias.has(diaSemana)) continue;
    mapa.set(dia, {
      dia, diaSemana,
      estado: dia > e.hoje ? "futuro" : e.primeiroDia && dia < e.primeiroDia ? "antes" : dia === e.hoje ? "hoje" : "fechado",
      ...zerado(),
    });
  }

  // O recorte: só os pedidos dos dias mostrados (o filtro de dia da semana
  // tira os outros). As vendas se contam DENTRO dele — uma mesa que começou
  // num dia desmarcado e continuou num marcado é venda no marcado.
  const diaDe = new Map<string, string>();
  const noRecorte = e.pedidos.filter((p) => {
    const dia = naLoja(p.createdAt, e.tz).dia;
    diaDe.set(p.id, dia);
    return mapa.has(dia);
  });
  const at = atendimentosDaVenda(noRecorte);

  let valoresImpossiveis = 0;
  for (const p of noRecorte) {
    const d = mapa.get(diaDe.get(p.id) as string)!;
    if (temValorImpossivel(p)) { valoresImpossiveis++; continue; }
    const situacao = situacaoDoPedido(p.status);
    if (situacao === "cancelado") { d.canceladosQtd++; d.canceladosValor += cent(p.totalAmount); continue; }
    if (situacao !== "venda") continue; // totem sem pagamento, rascunho do robô: nem venda, nem cancelamento
    d.lancamentos++;
    if (at.abre.has(p.id)) { d.vendas++; if (p.tableSessionId) d.mesas++; }
    d.valor += cent(p.totalAmount);
    if (!Array.isArray(p.items)) d.itens = null;
    else if (d.itens !== null) d.itens += cent(totalDosItens(p));
    d.entrega += cent(p.deliveryFee);
    d.descontos += descontoDoPedido(p);
  }

  // Mesas fechadas: o desconto no fechamento, no dia em que fechou (à parte),
  // e o serviço e a gorjeta das que fecharam nos dias mostrados.
  const mesasDosDias = (e.mesas || []).filter((m) => m.fechadaEm && mapa.has(naLoja(m.fechadaEm, e.tz).dia));
  for (const m of mesasDosDias) mapa.get(naLoja(m.fechadaEm as Date | string, e.tz).dia)!.descontoNaMesa += cent(descontoNoFechamento(m));
  const mesasFechadas = servicoDasMesas(mesasDosDias);

  let acumulado = 0;
  const dias: DiaDoFaturamento[] = [...mapa.values()].map((a) => {
    const futuro = a.estado === "futuro";
    if (!futuro) acumulado += a.valor;
    return { dia: a.dia, diaSemana: a.diaSemana, estado: a.estado, acumulado: futuro ? null : reais(acumulado), ...emReais(a) };
  });
  const centavosDe = new Map([...mapa.values()].map((a) => [a.dia, a]));

  const passados = dias.filter((d) => d.estado !== "futuro");
  const fechados = dias.filter((d) => d.estado === "fechado");
  // A média é dos dias que já fecharam. Só quando o período é "hoje" (nenhum
  // dia fechado) a média é o próprio hoje — senão a tela mostraria zero.
  const passadosNaLoja = passados.filter((d) => d.estado !== "antes");
  const baseDaMedia = fechados.length ? fechados : passadosNaLoja;
  const soma = somarCentavos(baseDaMedia.map((d) => centavosDe.get(d.dia)!));
  const k = baseDaMedia.length;
  const porDia = (c: number) => (k ? Math.round(c / k) : 0);
  const fracao = (q: number) => (k ? Math.round((q / k) * 100) / 100 : 0);
  // A MÉDIA também fecha: valor, itens, entrega e descontos são médias
  // arredondadas cada uma no seu centavo, e "Outros" sai da mesma equação da
  // linha (valor − itens − entrega + descontos). Dividir o Outros do total por
  // k dava uma linha que não fechava por 1 centavo — NIK, "Este mês" em
  // 24/09/2026 (19 dias fechados): 2.585,01 + 194,65 − 473,84 + 35,84 =
  // 2.341,66 contra a média de R$ 2.341,65. O arredondamento das quatro médias
  // fica no Outros (35,83), e a linha fecha.
  const mValor = porDia(soma.valor), mItens = soma.itens === null ? null : porDia(soma.itens);
  const mEntrega = porDia(soma.entrega), mDescontos = porDia(soma.descontos);
  const media: ResultadoDoFaturamento["media"] = {
    dias: k,
    base: fechados.length ? "fechados" : passadosNaLoja.length ? "hoje" : "nenhum",
    vendas: fracao(soma.vendas),
    mesas: fracao(soma.mesas),
    lancamentos: fracao(soma.lancamentos),
    valor: reais(mValor),
    ticketMedio: soma.vendas > 0 ? reais(Math.round(soma.valor / soma.vendas)) : null,
    itens: mItens === null ? null : reais(mItens),
    entrega: reais(mEntrega),
    descontos: reais(mDescontos),
    outros: mItens === null ? null : reais(mValor - (mItens + mEntrega - mDescontos)),
    descontoNaMesa: reais(porDia(soma.descontoNaMesa)),
    canceladosQtd: fracao(soma.canceladosQtd),
    canceladosValor: reais(porDia(soma.canceladosValor)),
  };

  // "Com venda" = teve lançamento. Pela régua um dia pode ter valor sem venda
  // NOVA (a mesa que abriu às 04h50 e lançou de novo às 05h10 é venda do dia
  // anterior) — e esse dia não é "loja fechada".
  const teveVenda = (d: DiaDoFaturamento) => d.lancamentos > 0;
  const comVenda = baseDaMedia.filter(teveVenda);
  // Melhor dia: qualquer dia que já começou (hoje pode já ter batido os outros).
  const melhor = passados.filter(teveVenda).reduce<DiaDoFaturamento | null>((m, d) => (!m || d.valor > m.valor ? d : m), null);
  // Pior dia: só entre os fechados com venda — hoje ainda está enchendo, e o
  // dia zerado é a loja fechada, não um dia ruim. E NUNCA o próprio melhor
  // dia: com os dias fechados empatados, os dois "reduce" paravam no mesmo
  // (o primeiro), e a tela mostrava "▲ Melhor dia" e "▼ Pior dia" na mesma
  // data (achado da revisão de 24/09/2026). O pior tem de ser outro dia e
  // valer MENOS que o melhor — empate no topo não tem pior, e com um dia só
  // também não.
  const fechadosComVenda = fechados.filter(teveVenda);
  const candidatoAPior = fechadosComVenda.length >= 2
    ? fechadosComVenda.filter((d) => d.dia !== melhor?.dia).reduce<DiaDoFaturamento | null>((m, d) => (!m || d.valor < m.valor ? d : m), null)
    : null;
  const pior = candidatoAPior && melhor && candidatoAPior.valor < melhor.valor ? candidatoAPior : null;

  return {
    dias,
    total: emReais(somarCentavos(passados.map((d) => centavosDe.get(d.dia)!))),
    media,
    mediaDiasComVenda: comVenda.length ? reais(Math.round(comVenda.reduce((s, d) => s + centavosDe.get(d.dia)!.valor, 0) / comVenda.length)) : null,
    diasComVenda: passados.filter(teveVenda).length,
    melhorDia: melhor ? destaque(melhor) : null,
    piorDia: pior ? destaque(pior) : null,
    servicoDasMesas: c2(mesasFechadas.taxa + mesasFechadas.gorjeta),
    mesasFechadas,
    diasDaSemana: [...filtroDias].sort((a, b) => a - b),
    valoresImpossiveis,
  };
}

// ── MESAS AINDA ABERTAS ─────────────────────────────────────────────────────

/**
 * Quanto do valor das vendas está em mesas AINDA ABERTAS — o aviso "N mesas
 * ainda abertas, com R$ X lançados no período — já estão no valor das
 * vendas". `abertas` são as contas OPEN/CLOSING (a rota pergunta ao banco).
 *
 * Usa o MESMO recorte do valor (`faturamentoPorDia`): o período e, com o
 * filtro de dias da semana, só os dias marcados. Até a revisão de 24/09/2026 a
 * rota somava a janela inteira: com "só as sextas" e uma mesa aberta que
 * lançou na quarta, o aviso dizia que o consumo da quarta "já está no valor",
 * e a tabela — que só tem sextas — não o tinha.
 */
export function consumoDasMesasAbertas(e: {
  de: string; ate: string; tz: string; diasDaSemana?: number[]; pedidos: PedidoParaFaturamento[]; abertas: Iterable<string>;
}): { quantidade: number; consumo: number } | null {
  const abertas = new Set(e.abertas);
  const filtroDias = new Set(e.diasDaSemana || []);
  const contas = new Set<string>();
  let c = 0;
  for (const p of e.pedidos) {
    if (!p.tableSessionId || !abertas.has(p.tableSessionId) || !entraNaVenda(p)) continue;
    const dia = naLoja(p.createdAt, e.tz).dia;
    if (dia < e.de || dia > e.ate || (filtroDias.size && !filtroDias.has(diaDaSemanaDe(dia)))) continue;
    contas.add(p.tableSessionId);
    c += cent(p.totalAmount);
  }
  return contas.size ? { quantidade: contas.size, consumo: reais(c) } : null;
}

// ── COMPARAÇÃO COM O PERÍODO ANTERIOR ───────────────────────────────────────

/**
 * O período com que este se compara, e quantos dias ele recua.
 *
 * - Sem filtro de dia da semana: os n dias logo antes (`periodoAnterior`, a
 *   régua de todo relatório).
 * - Com filtro: n dias antes pode ter OUTRA quantidade de cada dia da semana.
 *   Quinta 17 a sábado 26/09/2026 (10 dias) tem 2 sextas; os 10 dias antes
 *   (07 a 16/09) têm uma — e "só as sextas" comparava duas sextas com uma e
 *   dizia "↑ 100%". O anterior recua então em SEMANAS INTEIRAS (o menor
 *   múltiplo de 7 que não encosta no período): 03 a 12/09, com as mesmas duas
 *   sextas. Deslocar uma janela em 7k dias mantém a quantidade de cada dia da
 *   semana, sempre.
 */
export function periodoDeComparacao(de: string, ate: string, diasDaSemana: number[] = []): { de: string; ate: string; recuo: number; semanas: number | null } {
  const n = Math.max(1, diasNoPeriodo(de, ate));
  const semanas = diasDaSemana.length ? Math.ceil(n / 7) : null;
  const recuo = semanas ? semanas * 7 : n;
  return { de: somarDias(de, -recuo), ate: somarDias(ate, -recuo), recuo, semanas };
}

export type Comparacao = { atual: number; anterior: number; variacao: number | null };

export type ComparacaoDosPeriodos = {
  de: string;
  ate: string;
  total: Comparacao;
  vendas: Comparacao;
  media: Comparacao;
  ticketMedio: Comparacao;
  melhorDia: { atual: DiaDeDestaque | null; anterior: DiaDeDestaque | null; variacao: number | null };
};

/** Variação em fração (0,12 = +12%). null quando não há base para comparar. */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 10000) / 10000;
}

const comparar = (atual: number, anterior: number): Comparacao => ({ atual, anterior, variacao: variacao(atual, anterior) });

/**
 * Este período contra o anterior (`periodoDeComparacao`, com o mesmo filtro de
 * dias da semana). A média compara média com média — o período com hoje pela
 * metade não perde para o anterior só porque o dia ainda não acabou.
 */
export function compararPeriodos(atual: ResultadoDoFaturamento, anterior: ResultadoDoFaturamento, periodo: { de: string; ate: string }): ComparacaoDosPeriodos {
  return {
    de: periodo.de,
    ate: periodo.ate,
    total: comparar(atual.total.valor, anterior.total.valor),
    vendas: comparar(atual.total.vendas, anterior.total.vendas),
    media: comparar(atual.media.valor, anterior.media.valor),
    ticketMedio: comparar(atual.total.ticketMedio ?? 0, anterior.total.ticketMedio ?? 0),
    melhorDia: {
      atual: atual.melhorDia,
      anterior: anterior.melhorDia,
      variacao: atual.melhorDia && anterior.melhorDia ? variacao(atual.melhorDia.valor, anterior.melhorDia.valor) : null,
    },
  };
}

// ── META DO MÊS ─────────────────────────────────────────────────────────────

/**
 * A meta de faturamento MENSAL da loja, em reais, ou null. Mora em
 * `User.financialGoals.faturamento` (formato documentado no schema:
 * { faturamento, margemLiquida, cmvPct, pedidos, ticketMedio }, gravado por
 * api/store/financial-goals). Aceita número ou texto ("25000", "25.000,00",
 * "25.000", "R$ 25.000").
 * É comparada com o Valor das vendas, que é a mesma régua da Receita Bruta do
 * DRE (ver o cabeçalho). Somar aqui o cupom da plataforma mediria a meta do
 * Financeiro por uma régua que o próprio Financeiro não usa.
 *
 * O texto é lido no formato BRASILEIRO: vírgula é decimal e ponto é milhar.
 * Antes, "25.000" (sem vírgula) ia direto para Number() e virava 25 — a meta
 * de vinte e cinco mil reais aparecia "batida" com R$ 25 vendidos. O ponto só
 * é decimal quando não pode ser milhar ("25000.5": não há grupo de três
 * dígitos depois dele).
 */
export function lerMetaDeFaturamento(goals: unknown): number | null {
  if (!goals || typeof goals !== "object" || Array.isArray(goals)) return null;
  const bruto = (goals as Record<string, unknown>).faturamento;
  let v: number;
  if (typeof bruto === "number") v = bruto;
  else if (typeof bruto === "string") {
    const t = bruto.replace(/[^\d.,-]/g, "");
    if (t.includes(",")) v = Number(t.replace(/\./g, "").replace(",", "."));
    // "25.000", "1.250.000": grupos de três dígitos depois de cada ponto — é milhar.
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) v = Number(t.replace(/\./g, ""));
    else v = Number(t);
  } else return null;
  return Number.isFinite(v) && v > 0 ? c2(v) : null;
}

/** "inicio-do-mes" = nenhum dia fechado ainda: não há ritmo para projetar. */
export type SituacaoDaMeta = "batida" | "no-ritmo" | "abaixo-do-ritmo" | "nao-batida" | "inicio-do-mes";

export type ProgressoDaMeta = {
  meta: number;
  /** "YYYY-MM". */
  mes: string;
  /** Até que dia o acumulado foi somado. */
  ateODia: string;
  diasDoMes: number;
  acumulado: number;
  /** Fração da meta (0,8 = 80%). */
  pct: number;
  /** A meta proporcional aos dias que já fecharam — onde "deveria" estar. */
  esperadoAteAgora: number;
  /** No ritmo dos dias fechados, onde o mês termina. null sem dia fechado. */
  projecao: number | null;
  faltam: number;
  /** Dias que ainda dá para vender, contando hoje quando ele está aberto. */
  diasRestantes: number;
  /** Quanto por dia, nos dias restantes, para bater a meta. */
  porDiaParaBater: number | null;
  mesEncerrado: boolean;
  situacao: SituacaoDaMeta;
};

export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0, 12)).toISOString().slice(0, 10);
}

/**
 * Até que dia a meta do mês de `ate` pode ser medida, ou null quando o
 * período não diz nada sobre o mês. A meta é do MÊS, e só faz sentido contra:
 *
 * - o mês corrente até hoje (o período termina hoje, ou depois — o futuro
 *   ainda não vendeu nada e não entra);
 * - um mês inteiro que já acabou (o período termina no último dia dele).
 *
 * "De 01 a 10/08" visto em setembro não diz se agosto bateu a meta: mostrar
 * "faltam R$ X em 21 dias" para um mês encerrado seria inventar.
 */
export function limiteDaMeta(ate: string, hoje: string): string | null {
  const mes = ate.slice(0, 7);
  const primeiro = `${mes}-01`;
  const ultimo = ultimoDiaDoMes(mes);
  const limite = ate > hoje ? hoje : ate;
  if (limite < primeiro) return null; // o mês ainda não começou
  if (limite === hoje || limite === ultimo) return limite;
  return null;
}

/**
 * O acumulado do mês de `ate` contra a meta mensal, ou null quando o período
 * não permite medir (ver `limiteDaMeta`). `dias` são os dias do mês, do dia 1
 * em diante, com o valor vendido; os de fora do mês são ignorados.
 */
export function progressoDaMeta(e: { meta: number; ate: string; hoje: string; dias: Array<{ dia: string; valor: number }> }): ProgressoDaMeta | null {
  const limite = limiteDaMeta(e.ate, e.hoje);
  if (!limite) return null;
  const mes = e.ate.slice(0, 7);
  const primeiro = `${mes}-01`;
  const ultimo = ultimoDiaDoMes(mes);
  const diasDoMes = Number(ultimo.slice(8, 10));
  const valorDe = new Map<string, number>();
  for (const d of e.dias) if (d.dia >= primeiro && d.dia <= limite) valorDe.set(d.dia, (valorDe.get(d.dia) || 0) + d.valor);
  const acumulado = c2([...valorDe.values()].reduce((s, v) => s + v, 0));

  // Hoje, quando está no período, ainda não acabou: conta no acumulado, mas o
  // ritmo (a projeção) vem só dos dias que já fecharam.
  const hojeAberto = limite === e.hoje;
  const ultimoFechado = hojeAberto ? somarDias(e.hoje, -1) : limite;
  const diasFechados = ultimoFechado < primeiro ? 0 : Number(ultimoFechado.slice(8, 10));
  const acumuladoFechado = [...valorDe.entries()].filter(([d]) => d <= ultimoFechado).reduce((s, [, v]) => s + v, 0);
  const mesEncerrado = limite === ultimo && !hojeAberto;

  const faltam = c2(Math.max(0, e.meta - acumulado));
  // Os dias que ainda dá para vender: os que não fecharam, hoje incluído.
  const diasRestantes = mesEncerrado ? 0 : diasDoMes - diasFechados;
  const projecao = mesEncerrado ? acumulado : diasFechados > 0 ? c2((acumuladoFechado / diasFechados) * diasDoMes) : null;
  const situacao: SituacaoDaMeta = acumulado >= e.meta ? "batida"
    : mesEncerrado ? "nao-batida"
    : projecao === null ? "inicio-do-mes"
    : projecao >= e.meta ? "no-ritmo" : "abaixo-do-ritmo";

  return {
    meta: e.meta,
    mes,
    ateODia: limite,
    diasDoMes,
    acumulado,
    pct: Math.round((acumulado / e.meta) * 10000) / 10000,
    esperadoAteAgora: c2((e.meta * diasFechados) / diasDoMes),
    projecao,
    faltam,
    diasRestantes,
    porDiaParaBater: faltam > 0 && diasRestantes > 0 ? c2(faltam / diasRestantes) : null,
    mesEncerrado,
    situacao,
  };
}
