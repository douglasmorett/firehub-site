/**
 * Acerto de entregadores — o RELATÓRIO da equipe de entrega, por cima da conta
 * do acerto.
 *
 * A tela Motoboys → Relatório é a ferramenta do dia a dia: um motoboy, as
 * entregas dele, troca de pagamento, "Ver pedido". Este relatório é a visão da
 * equipe inteira no período: quanto a loja paga, quanto custa cada entrega,
 * quem rodou mais, em que dia e em que horário a equipe trabalha — e o saldo do
 * acerto de cada um (o que a loja paga menos o dinheiro que está com ele).
 *
 * ── Uma conta só ────────────────────────────────────────────────────────────
 * Os números de cada motoboy vêm PRONTOS de lib/relatorio-do-entregador.ts
 * (`montarRelatorioDosEntregadores`), a mesma função da tela Motoboys e do app
 * do entregador. Aqui só se soma, se divide e se agrupa: se o relatório e a
 * tela Motoboys mostrarem valores diferentes para o mesmo período, o erro é
 * daqui, nunca uma segunda régua.
 *
 * Esta lib não importa nada do servidor: recebe o resultado já montado.
 */
import { c2, naLoja } from "@/lib/relatorios/base";

/** O que a conta lê de cada motoboy (o formato de `montarRelatorioDosEntregadores`). */
export type MotoboyDoAcerto = {
  motoboy: {
    id: string;
    name: string;
    paymentType?: string | null;
    dailyRate?: number | null;
    active?: boolean | null;
    usandoTaxaDoCliente?: boolean;
    entregasSemDistancia?: number;
  };
  stats: {
    totalDeliveries: number;
    entreguesCount: number;
    emAndamentoCount: number;
    canceladasComCorridaCount: number;
    canceladasSemCorridaCount: number;
    valorDosPedidos: number;
    totalDistance: number;
    uniqueDays: number;
    cashCollectedSum: number;
    changeGivenSum: number;
    cardPosTotal: number;
    pixTotal: number;
    onlineTotal: number;
    fiadoTotal: number;
    naoIdentificadoTotal: number;
    naoIdentificadoCount: number;
    dailyTotal: number;
    feeTotal: number;
    totalWithDaily: number;
    lancheDescontado: number;
  };
  fiado?: { saldoEmAberto?: number; [k: string]: unknown } | null;
  entregasDoApp?: { qtd: number };
  composicao?: { origem: string; rotulo: string; qtd: number; valor: number; [k: string]: unknown }[];
  orders: {
    id: string;
    createdAt: Date | string;
    corrida?: boolean;
    cancelado?: boolean;
    ganhoDoMotoboy: number;
    totalAmount?: number | null;
    deliveryDistance?: number | null;
    cashToDeliver?: number;
    [k: string]: unknown;
  }[];
};

export const ROTULO_DO_TIPO_DE_PAGAMENTO: Record<string, string> = {
  PER_DELIVERY: "Por entrega",
  DAILY_RATE: "Diária fixa",
  BOTH: "Diária + entrega",
  DAILY_PLUS_FEE: "Diária + taxa do pedido",
  PER_KM: "Por km",
  FAIXA_KM: "Diária + valor por km",
};

export type LinhaDoMotoboy = {
  id: string;
  nome: string;
  loja: string;
  tipo: string;
  ativo: boolean;
  dias: number;
  entregas: number;
  entregues: number;
  naRua: number;
  canceladasComCorrida: number;
  canceladasSemCorrida: number;
  km: number;
  /** Valor dos pedidos que ele levou (não cancelados). */
  valorLevado: number;
  diaria: number;
  porEntrega: number;
  lanche: number;
  /** Diária + entregas − lanche acima do combinado: o "Total a pagar" da tela Motoboys. */
  aPagar: number;
  /** O dinheiro que ele recebeu na porta e devolve à loja (pedidos + troco levado). */
  dinheiroComEle: number;
  trocoLevado: number;
  /** aPagar − dinheiroComEle: positivo = a loja paga; negativo = ele devolve. */
  saldo: number;
  maquininha: number;
  pix: number;
  online: number;
  fiadoDosPedidos: number;
  naoIdentificado: number;
  naoIdentificadoQtd: number;
  custoPorEntrega: number | null;
  entregasPorDia: number | null;
  kmPorEntrega: number | null;
  /** Participação nas entregas da equipe, em %. */
  pctDasEntregas: number;
  semDistancia: number;
  usandoTaxaDoCliente: boolean;
  entregasDoApp: number;
  fiadoEmAberto: number;
  composicao: { rotulo: string; qtd: number; valor: number }[];
};

export type DiaDoAcerto = {
  dia: string;
  entregas: number;
  /** Ganho por entrega + diária de quem trabalhou no dia (o lanche não entra no dia). */
  custo: number;
  motoboys: number;
  porMotoboy: { nome: string; entregas: number }[];
};

export type HoraDoAcerto = {
  hora: number;
  entregas: number;
  /** Média de entregas nessa hora por dia trabalhado. */
  mediaPorDia: number;
  /** Média de motoboys com entrega nessa hora, nos dias em que houve entrega nela. */
  motoboysNaHora: number;
};

export type TotaisDoAcerto = {
  entregas: number;
  aPagar: number;
  custoPorEntrega: number | null;
  km: number;
  valorLevado: number;
  /** Quanto do valor levado vira pagamento da equipe, em %. */
  pesoNoValor: number | null;
  dinheiroComEles: number;
  saldo: number;
  diaria: number;
  porEntrega: number;
  lanche: number;
  motoboysComEntrega: number;
  diasComEntrega: number;
};

export type ResultadoDoAcerto = {
  linhas: LinhaDoMotoboy[];
  /** Cadastrados sem nenhuma entrega no período. */
  semEntrega: { nome: string; loja: string; ativo: boolean }[];
  total: TotaisDoAcerto;
  dias: DiaDoAcerto[];
  horas: HoraDoAcerto[];
  /** Avisos para conferir antes de pagar. */
  avisos: { tom: "atencao" | "grave"; texto: string }[];
};

const div = (a: number, b: number) => (b ? a / b : null);

export function totaisDoAcerto(linhas: Pick<LinhaDoMotoboy, "entregas" | "aPagar" | "km" | "valorLevado" | "dinheiroComEle" | "saldo" | "diaria" | "porEntrega" | "lanche">[], diasComEntrega: number): TotaisDoAcerto {
  const s = (f: (l: (typeof linhas)[number]) => number) => c2(linhas.reduce((t, l) => t + f(l), 0));
  const entregas = linhas.reduce((t, l) => t + l.entregas, 0);
  const aPagar = s((l) => l.aPagar);
  const valorLevado = s((l) => l.valorLevado);
  return {
    entregas,
    aPagar,
    custoPorEntrega: div(aPagar, entregas),
    km: Math.round(linhas.reduce((t, l) => t + l.km, 0) * 10) / 10,
    valorLevado,
    pesoNoValor: valorLevado ? (aPagar / valorLevado) * 100 : null,
    dinheiroComEles: s((l) => l.dinheiroComEle),
    saldo: s((l) => l.saldo),
    diaria: s((l) => l.diaria),
    porEntrega: s((l) => l.porEntrega),
    lanche: s((l) => l.lanche),
    motoboysComEntrega: linhas.filter((l) => l.entregas > 0).length,
    diasComEntrega,
  };
}

/**
 * Soma o acerto de cada loja (`porLoja`: o nome da loja e o `report` de
 * `montarRelatorioDosEntregadores`) no relatório da equipe.
 */
export function acertoDaEquipe(porLoja: { loja: string; report: MotoboyDoAcerto[] }[], tz: string): ResultadoDoAcerto {
  const linhas: LinhaDoMotoboy[] = [];
  const semEntrega: ResultadoDoAcerto["semEntrega"] = [];
  const dias = new Map<string, { entregas: number; ganho: number; porMotoboy: Map<string, { nome: string; entregas: number; diaria: number }> }>();
  // hora → dia → motoboys com entrega naquela hora daquele dia
  const horas = new Map<number, { entregas: number; dias: Map<string, Set<string>> }>();

  for (const { loja, report } of porLoja) {
    for (const r of report) {
      const s = r.stats;
      const corridas = r.orders.filter((o) => o.corrida !== false);
      const temAlgo = s.totalDeliveries > 0 || s.canceladasSemCorridaCount > 0 || (r.entregasDoApp?.qtd || 0) > 0;
      if (!temAlgo) {
        semEntrega.push({ nome: r.motoboy.name, loja, ativo: r.motoboy.active !== false });
        continue;
      }

      // A diária de cada dia trabalhado, igual à do acerto: um valor por expediente.
      const diariaDoDia = s.uniqueDays ? s.dailyTotal / s.uniqueDays : 0;
      for (const o of corridas) {
        const { dia, hora } = naLoja(o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt), tz);
        const d = dias.get(dia) || { entregas: 0, ganho: 0, porMotoboy: new Map() };
        d.entregas++;
        d.ganho += Number(o.ganhoDoMotoboy) || 0;
        const m = d.porMotoboy.get(r.motoboy.id) || { nome: r.motoboy.name, entregas: 0, diaria: diariaDoDia };
        m.entregas++;
        d.porMotoboy.set(r.motoboy.id, m);
        dias.set(dia, d);

        const h = horas.get(hora) || { entregas: 0, dias: new Map() };
        h.entregas++;
        const quem = h.dias.get(dia) || new Set<string>();
        quem.add(r.motoboy.id);
        h.dias.set(dia, quem);
        horas.set(hora, h);
      }

      const aPagar = c2(s.totalWithDaily);
      const dinheiroComEle = c2(s.cashCollectedSum);
      linhas.push({
        id: r.motoboy.id,
        nome: r.motoboy.name,
        loja,
        tipo: ROTULO_DO_TIPO_DE_PAGAMENTO[r.motoboy.paymentType || ""] || r.motoboy.paymentType || "—",
        ativo: r.motoboy.active !== false,
        dias: s.uniqueDays,
        entregas: s.totalDeliveries,
        entregues: s.entreguesCount,
        naRua: s.emAndamentoCount,
        canceladasComCorrida: s.canceladasComCorridaCount,
        canceladasSemCorrida: s.canceladasSemCorridaCount,
        km: Math.round((s.totalDistance || 0) * 10) / 10,
        valorLevado: c2(s.valorDosPedidos),
        diaria: c2(s.dailyTotal),
        porEntrega: c2(s.feeTotal),
        lanche: c2(s.lancheDescontado || 0),
        aPagar,
        dinheiroComEle,
        trocoLevado: c2(s.changeGivenSum),
        saldo: c2(aPagar - dinheiroComEle),
        maquininha: c2(s.cardPosTotal),
        pix: c2(s.pixTotal),
        online: c2(s.onlineTotal),
        fiadoDosPedidos: c2(s.fiadoTotal),
        naoIdentificado: c2(s.naoIdentificadoTotal),
        naoIdentificadoQtd: s.naoIdentificadoCount,
        custoPorEntrega: div(aPagar, s.totalDeliveries),
        entregasPorDia: div(s.totalDeliveries, s.uniqueDays),
        kmPorEntrega: s.totalDistance ? div(s.totalDistance, s.totalDeliveries) : null,
        pctDasEntregas: 0,
        semDistancia: r.motoboy.entregasSemDistancia || 0,
        usandoTaxaDoCliente: Boolean(r.motoboy.usandoTaxaDoCliente),
        entregasDoApp: r.entregasDoApp?.qtd || 0,
        fiadoEmAberto: c2(Number(r.fiado?.saldoEmAberto) || 0),
        composicao: (r.composicao || []).map((c) => ({ rotulo: c.rotulo, qtd: c.qtd, valor: c.valor })),
      });
    }
  }

  const totalDeEntregas = linhas.reduce((t, l) => t + l.entregas, 0);
  for (const l of linhas) l.pctDasEntregas = totalDeEntregas ? (l.entregas / totalDeEntregas) * 100 : 0;
  linhas.sort((a, b) => b.entregas - a.entregas || b.aPagar - a.aPagar || a.nome.localeCompare(b.nome, "pt-BR"));

  const listaDeDias: DiaDoAcerto[] = [...dias.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, d]) => {
      const porMotoboy = [...d.porMotoboy.values()];
      return {
        dia,
        entregas: d.entregas,
        custo: c2(d.ganho + porMotoboy.reduce((t, m) => t + m.diaria, 0)),
        motoboys: porMotoboy.length,
        porMotoboy: porMotoboy.map((m) => ({ nome: m.nome, entregas: m.entregas })).sort((a, b) => b.entregas - a.entregas),
      };
    });

  const diasComEntrega = listaDeDias.length;
  // Da primeira à última hora com entrega, na ordem do expediente (que começa
  // às 5h), com as horas vazias no meio: o buraco da tarde é informação.
  const posicao = (hora: number) => (hora + 24 - 5) % 24;
  const posicoes = [...horas.keys()].map(posicao);
  const listaDeHoras: HoraDoAcerto[] = (posicoes.length ? Array.from({ length: Math.max(...posicoes) - Math.min(...posicoes) + 1 }, (_, i) => (Math.min(...posicoes) + i + 5) % 24) : [])
    .map((hora) => {
      const h = horas.get(hora) || { entregas: 0, dias: new Map<string, Set<string>>() };
      const diasNaHora = [...h.dias.values()];
      return {
        hora,
        entregas: h.entregas,
        mediaPorDia: diasComEntrega ? h.entregas / diasComEntrega : 0,
        motoboysNaHora: diasNaHora.length ? diasNaHora.reduce((t, s) => t + s.size, 0) / diasNaHora.length : 0,
      };
    });

  const avisos: ResultadoDoAcerto["avisos"] = [];
  for (const l of linhas) {
    if (l.semDistancia) avisos.push({ tom: "grave", texto: `${l.nome}: ${l.semDistancia} entrega${l.semDistancia === 1 ? "" : "s"} sem distância medida, que entra${l.semDistancia === 1 ? "" : "m"} como R$ 0,00 no acerto por km.` });
    if (l.usandoTaxaDoCliente) avisos.push({ tom: "atencao", texto: `${l.nome}: sem valor por entrega cadastrado — o acerto usou a taxa que o cliente pagou.` });
    if (l.naRua) avisos.push({ tom: "atencao", texto: `${l.nome}: ${l.naRua} entrega${l.naRua === 1 ? " ainda está" : "s ainda estão"} na rua ou em preparo — o valor pode mudar até fechar.` });
    if (l.naoIdentificadoQtd) avisos.push({ tom: "atencao", texto: `${l.nome}: ${l.naoIdentificadoQtd} pagamento${l.naoIdentificadoQtd === 1 ? "" : "s"} sem forma identificada — confira antes de cobrar o dinheiro.` });
    if (l.entregasDoApp) avisos.push({ tom: "atencao", texto: `${l.nome}: ${l.entregasDoApp} pedido${l.entregasDoApp === 1 ? "" : "s"} marcado${l.entregasDoApp === 1 ? "" : "s"} com ele, mas levado${l.entregasDoApp === 1 ? "" : "s"} pelo entregador do app — fora do acerto.` });
  }

  return { linhas, semEntrega, total: totaisDoAcerto(linhas, diasComEntrega), dias: listaDeDias, horas: listaDeHoras, avisos };
}
