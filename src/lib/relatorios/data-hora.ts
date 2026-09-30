/**
 * O relatório "Vendas por dia e hora" — o mapa de calor da semana da Saipos:
 * em que dia e em que hora a loja vende, com as respostas prontas em cima
 * ("Melhor horário: 19h–20h", "Melhor dia: sexta").
 *
 * Puro (sem banco): recebe os pedidos já filtrados por lib/relatorios/servidor.ts
 * e devolve as matrizes. Testado em scripts/teste-data-hora.ts.
 *
 * ── A linha é o DIA OPERACIONAL, a coluna é a HORA DO RELÓGIO ───────────────
 *
 * O pedido da 1h da manhã de sábado é da SEXTA à noite: o dia vira às 5h, como
 * no caixa e em todo relatório (lib/relatorios/base.ts, `naLoja`). Com o dia
 * do calendário, a madrugada da pizzaria aparecia como "sábado 1h" e o sábado
 * ganhava as vendas da sexta — o "melhor dia" mudava de lugar sem ninguém ter
 * vendido nada diferente. A coluna continua sendo a hora que o relógio da
 * loja marcava (0 a 23), porque "às 23h" e "à 1h" é o que o lojista fala; só
 * a ORDEM das colunas começa às 5h (5h, 6h, …, 23h, 0h, …, 4h), para a noite
 * de sexta ficar inteira na linha da sexta, sem pular para o começo da tabela.
 *
 * ── Média por dia da semana, não soma ───────────────────────────────────────
 *
 * Um período com 3 sextas e 4 sábados somaria um sábado a mais: o sábado
 * "ganharia" só por aparecer mais vezes. Cada casa do mapa é a MÉDIA por
 * ocorrência daquele dia da semana naquela hora (o total também sai, para
 * quem quer conferir). O divisor conta só as horas que JÁ CHEGARAM: com o
 * período terminando hoje às 15h, a quinta de hoje entra no divisor das 5h às
 * 15h e fica de fora das 16h em diante — senão a quinta de hoje, ainda sem o
 * jantar, puxava a média de toda quinta para baixo. Pelo mesmo motivo a
 * média do DIA é a soma das médias das horas (um "dia típico"), e não o total
 * do dia ÷ número de dias: com o período fechado as duas contas dão o mesmo
 * número; com hoje pela metade, só a primeira não mente. E o divisor começa
 * no primeiro pedido da loja: dia em que ela ainda não vendia pelo FireHub
 * não é dia fraco.
 *
 * Quando hoje é a ÚNICA vez do dia da semana no período, esse dia fica SEM
 * média até fechar: as horas que ainda não chegaram não têm média, e somá-las
 * como zero desenhava o dia como o pior da semana. Foi o "7 dias" consultado
 * numa quinta ao meio-dia (24/09/2026, NIK): quinta = 0 contra 60 a 109 nos
 * outros dias — era só a hora do almoço. O mesmo vale para o "dia médio" do
 * período que é só hoje.
 *
 * ── O que entra: a régua única ──────────────────────────────────────────────
 *
 * Valor e vendas seguem lib/relatorios/regua-da-venda.ts — a MESMA régua do
 * Vendas por período, do Faturamento por dia e do Formas de pagamento:
 *
 * - Venda é o que não é cancelado nem intenção (STATUS_FORA_DA_VENDA), nem
 *   valor impossível. O servidor já filtra; a conta confere de novo.
 * - VALOR = `totalAmount` do pedido (o que o cliente pagou, com a taxa de
 *   entrega e já com o desconto), na hora em que o PEDIDO foi feito —
 *   inclusive cada lançamento de mesa, na hora dele.
 * - VENDAS (a métrica que era "Pedidos") = atendimentos: o pedido é uma venda;
 *   a mesa com sessão é UMA venda, na hora do PRIMEIRO lançamento. A pergunta
 *   do relatório é "quando o cliente chega": a mesa que sentou às 20h e pediu
 *   a sobremesa às 21h30 é um cliente das 20h — e a sobremesa foi vendida às
 *   21h30. Contar cada rodada faria o salão parecer três vezes mais
 *   movimentado que o delivery na mesma hora. O nome da métrica virou
 *   "Vendas" porque é o mesmo número do cartão "Vendas" dos outros relatórios.
 * - Itens = soma das quantidades das linhas do pedido (o combo é 1 item, a
 *   pizza meio a meio é 1 item), na hora do pedido; quantidade ≤ 0 (item
 *   tirado na edição) não conta — a regra do Itens vendidos.
 * - Pagamento não entra nesta conta: o pedido pago metade no Pix e metade no
 *   cartão é UMA venda, na hora em que foi feita.
 *
 * Até 24/09/2026 o valor da mesa era o consumo "cobrado": o lançado vezes um
 * fator (pago − serviço − gorjeta) ÷ lançado, com teto 1 por causa do troco.
 * Era a única tela que abatia o desconto da mesa do valor, e o total dela não
 * batia com nenhuma outra: Pastel da Paulista, 09–16/09/2026, R$ 34.535,14
 * aqui contra R$ 34.660,54 no Vendas por período. Agora o valor é o lançado,
 * e o desconto no fechamento é informação à parte, no Vendas por período e no
 * Faturamento por dia, pelo dia em que a mesa fechou. (O Cupons e descontos
 * ainda o conta no dia dos lançamentos e o abate do "vendas" dele — ver
 * "Quem ainda não segue a régua" em regua-da-venda.ts.)
 *
 * O lançamento "MESA" antigo, sem sessão (deliveryType MESA pelo PDV — 109 dos
 * 393 pedidos da NIK em 17–23/09/2026), não tem como ser agrupado: cada um é
 * uma venda, como os outros pedidos. O acréscimo (parentOrderId) soma valor e
 * itens na hora em que foi lançado, mas não é venda nova quando o pai está no
 * período (a régua explica o caso do pai fora dele).
 */
import { HORA_DA_VIRADA, NOMES_DOS_DIAS, c2, fmtDia, fmtQtd, fmtReais, naLoja } from "@/lib/relatorios/base";
import { atendimentosDaVenda, entraNaVenda, type ItemDaRegua } from "@/lib/relatorios/regua-da-venda";
import { PALETA } from "@/lib/paleta-brasa";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type PedidoParaDataHora = {
  id: string;
  createdAt: Date | string;
  status: string;
  totalAmount: number;
  tableSessionId?: string | null;
  parentOrderId?: string | null;
  /** Soma das quantidades dos itens do pedido. */
  itens: number;
  /** Preço e quantidade das linhas — só para a régua do valor impossível (≥ R$ 1 milhão). Opcional. */
  items?: ItemDaRegua[] | null;
};

export type OpcoesDaConta = {
  tz: string;
  /** Primeiro e último dia operacional do período ("YYYY-MM-DD"). */
  de: string;
  ate: string;
  /**
   * Onde a loja está AGORA (`naLoja(new Date(), tz)`): as horas que ainda não
   * chegaram não entram no divisor. Nulo = o período inteiro já passou (testes).
   */
  agora?: { dia: string; hora: number } | null;
  /**
   * O dia operacional do PRIMEIRO pedido da loja (qualquer status, qualquer
   * canal). Os dias antes dele não entram no divisor: a loja ainda não vendia
   * pelo FireHub. Nulo = a loja já vendia antes do período.
   */
  inicioDasVendas?: string | null;
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

/**
 * A chave "pedidos" ficou (é a da URL e da resposta), mas a métrica é VENDAS —
 * atendimentos, a mesa uma vez —, o mesmo número do cartão "Vendas" do Vendas
 * por período e do Faturamento por dia. Chamada de "Pedidos" aqui, ela dizia
 * 494 onde o Vendas por período dizia 635 pedidos (Pastel da Paulista,
 * 09–16/09/2026): a mesma palavra para dois números.
 */
export type Metrica = "pedidos" | "valor" | "itens";
export const METRICAS: Metrica[] = ["pedidos", "valor", "itens"];
export const ROTULO_DA_METRICA: Record<Metrica, string> = { pedidos: "Vendas", valor: "Valor", itens: "Itens" };

/** Segunda a quinta × sexta a domingo — o corte da Saipos para as barras por hora. */
export const DIAS_DE_SEMANA = [1, 2, 3, 4];
export const DIAS_DE_FIM_DE_SEMANA = [5, 6, 0];
/** As linhas do mapa: segunda primeiro, o fim de semana junto no fim. */
export const ORDEM_DOS_DIAS = [1, 2, 3, 4, 5, 6, 0];
/** As colunas do mapa: o expediente começa às 5h e a madrugada fica no fim da linha. */
export const ORDEM_DAS_HORAS = Array.from({ length: 24 }, (_, i) => (i + HORA_DA_VIRADA) % 24);

export type Respostas = {
  /** parteDoDia nulo = não há dia médio ainda (o período é só hoje, em andamento). */
  melhorHora: { hora: number; media: number; parteDoDia: number | null } | null;
  melhorDia: { dia: number; media: number; dias: number; acimaDaMedia: number } | null;
  /** A hora mais fraca entre as horas em que a loja costuma vender. */
  horaMaisParada: { hora: number; media: number; frequencia: number } | null;
  /** A casa mais forte do mapa: o dia e a hora. */
  pico: { dia: number; hora: number; media: number } | null;
  /** O pico de cada metade da semana, para as barras por hora. */
  picoSemana: { hora: number; media: number } | null;
  picoFimDeSemana: { hora: number; media: number } | null;
};

export type SerieDaMetrica = {
  /** Soma no período. */
  total: number;
  /**
   * Um dia típico: a soma das médias das horas. Nulo quando alguma hora ainda
   * não aconteceu em dia nenhum do período (o período é só hoje, em andamento).
   */
  mediaPorDia: number | null;
  /**
   * [diaSemana 0=dom][hora 0-23]. Média null = aquela hora daquele dia da
   * semana não aconteceu no período (o dia não houve, ou é hoje e a hora não chegou).
   */
  mapa: { media: (number | null)[][]; total: number[][] };
  /** [diaSemana]. Média null = o dia não houve, ou só houve hoje, ainda em andamento (`diaEmAndamento`). */
  porDia: { media: (number | null)[]; total: number[] };
  /** [hora 0-23]: média por dia (todos, seg–qui, sex–dom) e total. */
  porHora: { todos: (number | null)[]; semana: (number | null)[]; fimDeSemana: (number | null)[]; total: number[] };
  respostas: Respostas;
};

export type ResultadoDataHora = {
  ordemDosDias: number[];
  ordemDasHoras: number[];
  /** [diaSemana]: quantos dias daquele dia da semana entraram no período (já começados). */
  diasPorSemana: number[];
  /** Dias operacionais do período que já começaram. */
  dias: number;
  /** O período inclui hoje, ainda em andamento. */
  hojeEmAndamento: boolean;
  /** A loja começou a vender DENTRO do período, neste dia; os dias antes ficaram fora da média. */
  inicioDasVendas: string | null;
  /**
   * A loja só fez o primeiro pedido DEPOIS do fim do período, neste dia:
   * nenhum dia do período conta. Sem isso, a planilha de janeiro/2025 da NIK
   * (que entrou em 05/09/2026) dizia "31 dias → 0 dias" sem dizer por quê.
   */
  vendasComecaramDepois: string | null;
  /**
   * O dia da semana de HOJE quando hoje é a única vez dele no período: esse
   * dia fica sem média (porDia.media nulo) até fechar. Nulo nos outros casos.
   */
  diaEmAndamento: number | null;
  /** [hora]: em que fração dos dias a loja vendeu naquela hora (0 a 1). */
  frequencia: number[];
  /** As horas em que a loja costuma vender — onde se procura o "horário mais parado". */
  expediente: number[];
  /** Mesas com sessão: quantas mesas e quantos lançamentos viraram atendimento. */
  mesas: { sessoes: number; lancamentos: number };
  /** Todos os lançamentos (pedidos) que entraram — o número da lista do Vendas por período. */
  lancamentos: number;
  metricas: Record<Metrica, SerieDaMetrica>;
};

// ── A CONTA ─────────────────────────────────────────────────────────────────

/** Posição da hora no expediente: 5h = 0, 23h = 18, 4h = 23. */
export const ordemDaHora = (h: number) => (h - HORA_DA_VIRADA + 24) % 24;

const diaDaSemanaDe = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();

function proximoDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const matriz = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

/** Um pedido já no relógio: o valor e os itens dele, e se ele abre uma venda. */
type Lancamento = { instante: Date; vendas: number; valor: number; itens: number };

/**
 * Os pedidos pela régua única: cada um na hora em que foi feito, com o valor
 * e os itens dele; a venda conta só no pedido que a abre (o comum, o 1º
 * lançamento da mesa — `atendimentosDaVenda`). Sem fator de mesa no valor.
 */
function lancamentosDe(pedidos: PedidoParaDataHora[]) {
  const validos = pedidos.filter((p) => entraNaVenda(p) && !Number.isNaN(new Date(p.createdAt).getTime()));
  const at = atendimentosDaVenda(validos);
  const saida: Lancamento[] = validos.map((p) => ({
    instante: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt),
    vendas: at.abre.has(p.id) ? 1 : 0,
    valor: Number(p.totalAmount) || 0,
    itens: Number(p.itens) || 0,
  }));
  return { lancamentos: saida, mesas: { sessoes: at.mesas, lancamentos: at.lancamentosDeMesa } };
}

const argMax = <T>(lista: T[], medida: (x: T) => number | null): T | null => {
  let melhor: T | null = null, valor = -Infinity;
  for (const x of lista) { const v = medida(x); if (v !== null && v > valor) { valor = v; melhor = x; } }
  return melhor;
};
const argMin = <T>(lista: T[], medida: (x: T) => number | null): T | null => {
  let melhor: T | null = null, valor = Infinity;
  for (const x of lista) { const v = medida(x); if (v !== null && v < valor) { valor = v; melhor = x; } }
  return melhor;
};

/**
 * A hora está no expediente quando a loja vendeu nela em pelo menos METADE
 * da frequência da hora mais constante. É relativo de propósito: a pizzaria
 * que vende das 18h às 23h todo dia tem essas horas perto de 100% e a das
 * 17h (um pedido cedo de vez em quando) fica de fora; a loja pequena, com
 * 10 pedidos por dia espalhados, não tem hora nenhuma com 100%, e um corte
 * fixo ("vendeu em 80% dos dias") deixaria o expediente dela vazio.
 *
 * Não se usa o horário cadastrado (User.storeHours): ele é o do cardápio do
 * site, nasce 18h–23h para quem nunca mexeu (store-hours.ts, defaultHours) e
 * não diz quando o iFood ou o salão abrem. O movimento é o que aconteceu.
 */
export const CORTE_DO_EXPEDIENTE = 0.5;

/**
 * Duas casas, sem zerar o que vendeu. Uma venda às 15h em 395 dias é 0,0025
 * por dia: o c2 dava 0, e a coluna das 15h aparecia (teve venda) com a casa
 * em branco. O positivo pequeno demais para duas casas guarda dois algarismos.
 */
export const arredondarMedia = (v: number) => (v > 0 && c2(v) === 0 ? Number(v.toPrecision(2)) : c2(v));

/**
 * O relatório. `pedidos` já vêm filtrados por período, tipo de venda, canal,
 * marca e horário (lib/relatorios/servidor.ts).
 */
export function vendasPorDiaEHora(pedidos: PedidoParaDataHora[], opcoes: OpcoesDaConta): ResultadoDataHora {
  // As vendas se contam DENTRO do período: a mesa que começou antes dele é
  // venda no seu primeiro lançamento de dentro (a régua única).
  const doPeriodo = pedidos.filter((p) => {
    const t = new Date(p.createdAt);
    if (Number.isNaN(t.getTime())) return false;
    const dia = naLoja(t, opcoes.tz).dia;
    return dia >= opcoes.de && dia <= opcoes.ate;
  });
  const { lancamentos, mesas } = lancamentosDe(doPeriodo);

  // ── O divisor: quantas vezes cada (dia da semana, hora) aconteceu ──
  const ocorrencias = matriz();
  const diasPorSemana = new Array<number>(7).fill(0);
  const agora = opcoes.agora ?? null;
  const jaComecou = (dia: string, hora: number) =>
    !agora || dia < agora.dia || (dia === agora.dia && ordemDaHora(hora) <= ordemDaHora(agora.hora));
  // A loja que entrou no FireHub no meio do período: a NIK fez o primeiro
  // pedido em 05/09/2026, e "30 dias" em 24/09 começava em 26/08 — dez dias
  // sem loja no divisor, e desiguais (5 quartas no divisor, 3 com a loja no
  // ar, contra 4 sábados e 3 no ar). A média de cada dia caía por um motivo
  // que não era venda, e o "melhor dia" mudava de lugar.
  const inicio = opcoes.inicioDasVendas && opcoes.inicioDasVendas > opcoes.de ? opcoes.inicioDasVendas : null;
  let dias = 0;
  for (let d = opcoes.de, guarda = 0; d <= opcoes.ate && guarda < 800; d = proximoDia(d), guarda++) {
    if (inicio && d < inicio) continue;
    const w = diaDaSemanaDe(d);
    let contou = false;
    for (let h = 0; h < 24; h++) {
      if (!jaComecou(d, h)) continue;
      ocorrencias[w][h]++;
      contou = true;
    }
    if (contou) { diasPorSemana[w]++; dias++; }
  }
  // Só hoje pode estar pela metade; se ele é a única vez do seu dia da semana
  // no período, alguma hora desse dia ainda tem zero ocorrência.
  const diaEmAndamento = ORDEM_DOS_DIAS.find((w) => diasPorSemana[w] > 0 && ocorrencias[w].some((n) => n === 0)) ?? null;

  // ── As somas ──
  const totais: Record<Metrica, number[][]> = { pedidos: matriz(), valor: matriz(), itens: matriz() };
  const diasComVenda = new Map<number, Set<string>>();
  for (const a of lancamentos) {
    const onde = naLoja(a.instante, opcoes.tz);
    totais.pedidos[onde.diaSemana][onde.hora] += a.vendas;
    totais.valor[onde.diaSemana][onde.hora] += a.valor;
    totais.itens[onde.diaSemana][onde.hora] += a.itens;
    let s = diasComVenda.get(onde.hora);
    if (!s) { s = new Set(); diasComVenda.set(onde.hora, s); }
    s.add(onde.dia);
  }

  // ── O expediente, pela frequência de venda em cada hora ──
  const frequencia = Array.from({ length: 24 }, (_, h) => {
    const vezes = ocorrencias.reduce((soma, linha) => soma + linha[h], 0);
    return vezes > 0 ? Math.min(1, (diasComVenda.get(h)?.size || 0) / vezes) : 0;
  });
  const maisConstante = Math.max(0, ...frequencia);
  const expediente = ORDEM_DAS_HORAS.filter((h) => maisConstante > 0 && frequencia[h] > 0 && frequencia[h] >= maisConstante * CORTE_DO_EXPEDIENTE);

  const serie = (m: Metrica): SerieDaMetrica => {
    const total = totais[m];
    const divide = (soma: number, n: number): number | null => (n > 0 ? soma / n : soma > 0 ? soma : null);

    const media = total.map((linha, w) => linha.map((v, h) => divide(v, ocorrencias[w][h])));
    // A média do dia é a soma das médias das horas, e só existe quando TODAS
    // as horas daquele dia da semana já aconteceram pelo menos uma vez. Se o
    // único dia dele no período é hoje, as horas que não chegaram não têm
    // média, e somar essas horas como zero dava "quinta = 0" ao meio-dia.
    const mediaDoDia = (w: number): number | null => {
      if (w === diaEmAndamento) return null;
      return diasPorSemana[w] > 0 || total[w].some((v) => v > 0) ? media[w].reduce<number>((s, v) => s + (v ?? 0), 0) : null;
    };
    const porDiaMedia = Array.from({ length: 7 }, (_, w) => mediaDoDia(w));
    const porDiaTotal = total.map((linha) => linha.reduce((s, v) => s + v, 0));

    const mediaDasHoras = (grupo: number[]) => Array.from({ length: 24 }, (_, h) =>
      divide(grupo.reduce((s, w) => s + total[w][h], 0), grupo.reduce((s, w) => s + ocorrencias[w][h], 0)));
    const todos = mediaDasHoras([0, 1, 2, 3, 4, 5, 6]);
    const semana = mediaDasHoras(DIAS_DE_SEMANA);
    const fimDeSemana = mediaDasHoras(DIAS_DE_FIM_DE_SEMANA);
    const porHoraTotal = Array.from({ length: 24 }, (_, h) => total.reduce((s, linha) => s + linha[h], 0));

    const somaTotal = porDiaTotal.reduce((s, v) => s + v, 0);
    // O dia médio, pela mesma regra: hora sem nenhuma ocorrência (o período é
    // só hoje e ela não chegou) deixa o dia médio sem resposta, e não zerado.
    const mediaPorDia = todos.some((v) => v === null) ? null : todos.reduce<number>((s, v) => s + (v ?? 0), 0);

    // ── As respostas prontas (empate: a hora mais cedo no expediente, o dia mais cedo na semana) ──
    const positivo = (v: number | null) => (v !== null && v > 0 ? v : null);
    const hMelhor = argMax(ORDEM_DAS_HORAS, (h) => positivo(todos[h]));
    const wMelhor = argMax(ORDEM_DOS_DIAS, (w) => positivo(porDiaMedia[w]));
    const hParada = expediente.length >= 2 ? argMin(expediente, (h) => todos[h] ?? 0) : null;
    const casas = ORDEM_DOS_DIAS.flatMap((w) => ORDEM_DAS_HORAS.map((h) => [w, h] as const));
    const casaPico = argMax(casas, ([w, h]) => positivo(media[w][h]));
    const hSemana = argMax(ORDEM_DAS_HORAS, (h) => positivo(semana[h]));
    const hFds = argMax(ORDEM_DAS_HORAS, (h) => positivo(fimDeSemana[h]));

    const r2 = (v: number | null) => (v === null ? null : arredondarMedia(v));
    return {
      total: c2(somaTotal),
      mediaPorDia: r2(mediaPorDia),
      mapa: { media: media.map((l) => l.map(r2)), total: total.map((l) => l.map(c2)) },
      porDia: { media: porDiaMedia.map(r2), total: porDiaTotal.map(c2) },
      porHora: { todos: todos.map(r2), semana: semana.map(r2), fimDeSemana: fimDeSemana.map(r2), total: porHoraTotal.map(c2) },
      respostas: {
        melhorHora: hMelhor === null ? null : {
          hora: hMelhor, media: arredondarMedia(todos[hMelhor]!),
          parteDoDia: mediaPorDia !== null && mediaPorDia > 0 ? Math.round((todos[hMelhor]! / mediaPorDia) * 1000) / 1000 : null,
        },
        melhorDia: wMelhor === null ? null : {
          dia: wMelhor, media: arredondarMedia(porDiaMedia[wMelhor]!), dias: diasPorSemana[wMelhor],
          acimaDaMedia: mediaPorDia !== null && mediaPorDia > 0 ? Math.round((porDiaMedia[wMelhor]! / mediaPorDia - 1) * 1000) / 1000 : 0,
        },
        horaMaisParada: hParada === null ? null : { hora: hParada, media: arredondarMedia(todos[hParada] ?? 0), frequencia: Math.round(frequencia[hParada] * 1000) / 1000 },
        pico: casaPico === null ? null : { dia: casaPico[0], hora: casaPico[1], media: arredondarMedia(media[casaPico[0]][casaPico[1]]!) },
        picoSemana: hSemana === null ? null : { hora: hSemana, media: arredondarMedia(semana[hSemana]!) },
        picoFimDeSemana: hFds === null ? null : { hora: hFds, media: arredondarMedia(fimDeSemana[hFds]!) },
      },
    };
  };

  return {
    ordemDosDias: ORDEM_DOS_DIAS,
    ordemDasHoras: ORDEM_DAS_HORAS,
    diasPorSemana,
    dias,
    hojeEmAndamento: Boolean(agora && agora.dia >= opcoes.de && agora.dia <= opcoes.ate),
    inicioDasVendas: inicio && inicio <= opcoes.ate ? inicio : null,
    vendasComecaramDepois: opcoes.inicioDasVendas && opcoes.inicioDasVendas > opcoes.ate ? opcoes.inicioDasVendas : null,
    diaEmAndamento,
    frequencia: frequencia.map((f) => Math.round(f * 1000) / 1000),
    expediente,
    mesas,
    lancamentos: lancamentos.length,
    metricas: { pedidos: serie("pedidos"), valor: serie("valor"), itens: serie("itens") },
  };
}

// ── TEXTO (a tela e a planilha falam igual) ─────────────────────────────────

/** "19h–20h". */
export function rotuloDaHora(h: number): string {
  return `${h}h–${(h + 1) % 24}h`;
}

/** "sexta", "sábado". */
export const nomeDoDia = (w: number) => NOMES_DOS_DIAS[w].toLowerCase();

/** "da sexta", "do sábado" — sábado e domingo são masculinos. */
export const doDia = (w: number) => `${w === 0 || w === 6 ? "do" : "da"} ${nomeDoDia(w)}`;

/** "1 sexta", "3 sextas". */
export const quantosDias = (w: number, n: number) => `${n} ${nomeDoDia(w)}${n === 1 ? "" : "s"}`;

/**
 * Uma casa decimal, sem zerar o que vendeu. Um pedido às 15h em 30 dias é
 * 0,03 pedido por dia: arredondado, a linha "Dia médio" mostrava "0" numa
 * coluna que só aparecia porque teve venda. O positivo pequeno demais para
 * uma casa vira "<0,1".
 */
function umaCasa(v: number): string {
  const n = Math.round(v * 10) / 10;
  return n === 0 && v > 0 ? "<0,1" : fmtQtd(n);
}

/** O número de uma barra ou margem: "13,1", "<0,1", "R$ 875,87". */
export function numeroDaMetrica(m: Metrica, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (m === "valor") return v > 0 && v < 0.005 ? `< ${fmtReais(0.01)}` : fmtReais(v);
  return umaCasa(v);
}

/** O número da métrica por extenso: "12,3 vendas", "R$ 1.234,50", "45 itens", "menos de 0,1 venda". */
export function textoDaMetrica(m: Metrica, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (m === "valor") return numeroDaMetrica(m, v);
  const n = Math.round(v * 10) / 10;
  if (n === 0 && v > 0) return `menos de 0,1 ${m === "pedidos" ? "venda" : "item"}`;
  const palavra = m === "pedidos" ? (n === 1 ? "venda" : "vendas") : (n === 1 ? "item" : "itens");
  return `${fmtQtd(n)} ${palavra}`;
}

/** O número curto de uma casa do mapa: "3,2", "12", "847", "1,2 mil", "<0,1", "<1" (R$). */
export function numeroCurto(m: Metrica, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  if (m === "valor") {
    if (v >= 1000) return `${(Math.round(v / 100) / 10).toLocaleString("pt-BR")} mil`;
    const reais = Math.round(v);
    return reais === 0 && v > 0 ? "<1" : reais.toLocaleString("pt-BR");
  }
  return v >= 10 ? fmtQtd(Math.round(v)) : umaCasa(v);
}

/**
 * O teto de uma faixa da legenda do mapa: "12", "3,5", "0,035", "R$ 850",
 * "R$ 3,46". Abaixo de 1 (pedidos, itens) ou de R$ 0,01, dois algarismos —
 * senão a loja que vende pouco num período longo lia "até 0" nas seis faixas.
 */
export function tetoDaFaixa(m: Metrica, x: number): string {
  const doisAlgarismos = (n: number) => Number(n.toPrecision(2)).toLocaleString("pt-BR", { maximumFractionDigits: 8 });
  if (m === "valor") {
    if (x >= 10) return fmtReais(Math.round(x)).replace(/,00$/, "");
    return x >= 0.005 ? fmtReais(x) : `R$ ${doisAlgarismos(x)}`;
  }
  if (x >= 10) return fmtQtd(Math.round(x));
  return x >= 1 ? fmtQtd(Math.round(x * 10) / 10) : doisAlgarismos(x);
}

/** "a quinta", "o sábado". */
const oDia = (w: number) => `${w === 0 || w === 6 ? "o" : "a"} ${nomeDoDia(w)}`;

/** Por que um dia da semana está sem média (a tela e a planilha dizem igual). */
export function avisoDoDiaEmAndamento(w: number): string {
  return `Hoje é ${w === 0 || w === 6 ? "o único" : "a única"} ${nomeDoDia(w)} do período e ainda está em andamento: ` +
    `${oDia(w)} fica sem média do dia até ele fechar (as horas que ainda não chegaram não contam como zero).`;
}

/** Por que o período não tem nenhum dia: a loja ainda não vendia pelo FireHub. */
export function avisoAntesDasVendas(dia: string): string {
  return `A loja só começou a vender pelo FireHub em ${fmtDia(dia)}, depois deste período: não há venda nem média para mostrar.`;
}

// ── AS CORES DO MAPA (são da tela; moram aqui para o teste medir o contraste) ─

/**
 * Tons de brasa, do quase nada ao pico — uma cor só, clareando para o fundo
 * (escala sequencial). Seis faixas iguais de 0 ao maior valor do mapa: faixa
 * é mais fácil de ler na legenda do que um degradê contínuo.
 */
export const RAMPA_DO_MAPA = [PALETA.brasaClaro, PALETA.brasaBorda, "#F39667", PALETA.brasa, PALETA.marca, PALETA.brasaTinta];
/** A partir desta faixa o número vai em branco (contraste ≥ 4,5 com o fundo). */
export const FAIXA_TEXTO_CLARO = 4;

/** A faixa da casa (0 a 5); -1 = sem venda. */
export function faixaDe(v: number | null | undefined, max: number): number {
  if (!v || v <= 0 || max <= 0) return -1;
  return Math.min(RAMPA_DO_MAPA.length - 1, Math.max(0, Math.ceil((v / max) * RAMPA_DO_MAPA.length) - 1));
}

/** A cor do número dentro da casa. */
export const corDoTexto = (faixa: number) => (faixa >= FAIXA_TEXTO_CLARO ? "#FFFFFF" : PALETA.carvao);

/**
 * A cor do anel que marca o pico. O pico é a maior casa do mapa, então cai
 * sempre na faixa mais escura (brasaTinta): o anel carvão de antes tinha
 * 2,4:1 de contraste com ela e sumia, abaixo do 3:1 que um marcador gráfico
 * pede (WCAG 1.4.11). Nas faixas escuras o anel é branco (7,3:1); nas claras, carvão.
 */
export const corDoAnelDoPico = (faixa: number) => (faixa >= FAIXA_TEXTO_CLARO ? "#FFFFFF" : PALETA.carvao);

export type FraseDaResposta ={ chave: keyof Respostas; pergunta: string; resposta: string; detalhe: string };

/** As respostas prontas em frase — o topo da tela e a aba "Resumo" da planilha. */
export function frasesDasRespostas(serie: SerieDaMetrica, m: Metrica): FraseDaResposta[] {
  const r = serie.respostas;
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const saida: FraseDaResposta[] = [];
  if (r.melhorHora) saida.push({
    chave: "melhorHora", pergunta: "Melhor horário", resposta: rotuloDaHora(r.melhorHora.hora),
    detalhe: `${textoDaMetrica(m, r.melhorHora.media)} por dia nessa hora` +
      (r.melhorHora.parteDoDia !== null ? ` — ${pct(r.melhorHora.parteDoDia)} do dia` : ""),
  });
  if (r.melhorDia) saida.push({
    chave: "melhorDia", pergunta: "Melhor dia", resposta: NOMES_DOS_DIAS[r.melhorDia.dia],
    detalhe: `${textoDaMetrica(m, r.melhorDia.media)} por ${nomeDoDia(r.melhorDia.dia)}` +
      (r.melhorDia.acimaDaMedia > 0 ? `, ${pct(r.melhorDia.acimaDaMedia)} acima de um dia médio` : "") +
      ` (${quantosDias(r.melhorDia.dia, r.melhorDia.dias)} no período)`,
  });
  if (r.horaMaisParada) saida.push({
    chave: "horaMaisParada", pergunta: "Horário mais parado", resposta: rotuloDaHora(r.horaMaisParada.hora),
    detalhe: `${textoDaMetrica(m, r.horaMaisParada.media)} por dia — a mais fraca entre as horas em que a loja costuma vender` +
      (r.horaMaisParada.frequencia < 0.95 ? ` (vendeu nessa hora em ${pct(r.horaMaisParada.frequencia)} dos dias)` : ""),
  });
  if (r.pico) saida.push({
    chave: "pico", pergunta: "Pico da semana", resposta: `${NOMES_DOS_DIAS[r.pico.dia]}, ${rotuloDaHora(r.pico.hora)}`,
    detalhe: `${textoDaMetrica(m, r.pico.media)} em média nessa hora ${doDia(r.pico.dia)}`,
  });
  return saida;
}
