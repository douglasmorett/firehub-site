/**
 * O RANKING DE ENTREGADORES — quem é o melhor motoboy do período, e por quê.
 *
 * Pedido do Douglas (24/10/2026), com o print do ranking de um concorrente:
 * "qual o melhor motoboy, o que ele concluiu, quantos cancelamentos com ele,
 * prazo médio de entrega, tempo de coleta, tempo que ele demora para voltar à
 * loja e pegar outro pedido depois que finaliza a rota — capricha". A mesma
 * conta abastece a aba Ranking da tela Motoboys e o relatório em
 * /store/relatorios/ranking-de-entregadores.
 *
 * SEM BANCO de propósito: a rota lê os pedidos e entrega aqui; o teste monta
 * pedidos à mão (scripts/teste-ranking-de-entregadores.ts).
 *
 * ── As medidas (todas por pedido do motoboy da loja no período) ─────────────
 *  - ENTREGAS: pedidos ENTREGUES por ele.
 *  - CANCELADOS COM ELE: cancelados depois de SAIR com ele (dispatchedAt antes
 *    do cancelamento) — a mesma régua do acerto ("cancelado com motoboy conta").
 *    Cancelado antes de sair não é dele.
 *  - CONCLUSÃO: entregas ÷ (entregas + cancelados com ele).
 *  - ENTREGA: da saída (dispatchedAt) à entrega (deliveredAt), pedido a pedido.
 *  - NO PRAZO: entregue até a previsão prometida ao cliente
 *    (lib/previsao-da-entrega.ts: o prazo do app ou criação + tempo da área).
 *    Pedido sem previsão fica fora da conta, não conta como no prazo.
 *  - COLETA: do pedido PRONTO (readyAt) até ele SAIR com o pedido. Só nos
 *    pedidos que a cozinha marcou pronto.
 *  - VOLTA: da ÚLTIMA entrega de uma viagem até ele PEGAR o próximo pedido
 *    (puxou pelo app ou saiu). É o "voltar à loja e pegar outro". Intervalo
 *    acima de VOLTA_MAXIMA_MIN é pausa ou fim do turno: não entra.
 *  - VIAGEM: os pedidos que saíram juntos — mesma rota, ou saída a menos de
 *    JUNTOS_MIN minutos da primeira da viagem.
 *
 * ── O score (0 a 100) ───────────────────────────────────────────────────────
 * Cada medida vira uma nota de 0 a 100 e o score é a média ponderada:
 *   conclusão 25 · no prazo 25 · entrega 20 · volta 20 · coleta 10.
 * Tempo vira nota CONTRA A EQUIPE: igual ou melhor que a mediana da equipe =
 * 100; o dobro da mediana = 0. Medida sem dado (loja sem previsão, cozinha que
 * não marca pronto) sai da média e o peso dela se divide entre as outras.
 * Quem fez menos de MINIMO_PARA_RANKING entregas aparece, mas sem posição.
 */
import { previsaoDaEntrega } from "@/lib/previsao-da-entrega";
import { naLoja } from "@/lib/relatorios/base";

export const JUNTOS_MIN = 5;
export const VOLTA_MAXIMA_MIN = 60;
/** Acima disto a medida é erro de carimbo (pedido esquecido aberto), não tempo de entrega. */
const TEMPO_MAXIMO_MIN = 180;
export const MINIMO_PARA_RANKING = 3;

export const PESOS = { conclusao: 25, prazo: 25, entrega: 20, volta: 20, coleta: 10 } as const;

type Instante = Date | string | null | undefined;

export type PedidoDoRanking = {
  id: string;
  motoboyId: string | null;
  status: string;
  createdAt: Instante;
  readyAt?: Instante;
  dispatchedAt?: Instante;
  deliveredAt?: Instante;
  cancelledAt?: Instante;
  motoboyPuxadoEm?: Instante;
  routeId?: string | null;
  scheduledDatetime?: Instante;
  tempoEntregaMin?: number | null;
  deliveryType?: string | null;
  deliveryDistance?: number | null;
  rating?: number | null;
};

export type LinhaDoRanking = {
  motoboyId: string;
  nome: string;
  /** 1, 2, 3… — nulo para quem não tem entregas suficientes. */
  posicao: number | null;
  score: number | null;
  entregas: number;
  canceladas: number;
  conclusaoPct: number | null;
  entregaMediaMin: number | null;
  entregaMedianaMin: number | null;
  noPrazoPct: number | null;
  comPrazo: number;
  noPrazo: number;
  atrasadas: number;
  atrasoMedioMin: number | null;
  coletaMedianaMin: number | null;
  coletas: number;
  voltaMedianaMin: number | null;
  voltas: number;
  viagens: number;
  pedidosPorViagem: number | null;
  km: number | null;
  dias: number;
  entregasPorDia: number | null;
  avaliacao: number | null;
  avaliacoes: number;
  /** As notas de cada medida (0–100), para a tela explicar o score. */
  notas: { conclusao: number | null; prazo: number | null; entrega: number | null; volta: number | null; coleta: number | null };
};

export type ResultadoDoRanking = {
  linhas: LinhaDoRanking[];
  equipe: {
    entregas: number;
    canceladas: number;
    conclusaoPct: number | null;
    entregaMedianaMin: number | null;
    noPrazoPct: number | null;
    coletaMedianaMin: number | null;
    voltaMedianaMin: number | null;
    viagens: number;
    pedidosPorViagem: number | null;
    motoboys: number;
  };
  /** Quem se destacou em cada medida (só entre os que têm posição). */
  destaques: { chave: string; titulo: string; motoboyId: string; nome: string; valor: string }[];
};

const ms = (v: Instante): number | null => {
  if (v == null || v === "") return null;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isFinite(t) ? t : null;
};
const minutos = (de: number | null, ate: number | null): number | null =>
  de == null || ate == null ? null : (ate - de) / 60_000;

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const media = (valores: number[]) => (valores.length ? valores.reduce((s, x) => s + x, 0) / valores.length : null);
const pct = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : null);
const um = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Tempo contra a equipe: até a mediana da equipe = 100; o dobro = 0. */
export function notaDeTempo(seu: number | null, daEquipe: number | null): number | null {
  if (seu == null || daEquipe == null) return null;
  if (daEquipe <= 0) return seu <= 0 ? 100 : 0;
  const r = seu / daEquipe;
  return Math.max(0, Math.min(100, (2 - r) * 100));
}

const ehEntregue = (p: PedidoDoRanking) => p.status === "ENTREGUE" || (ms(p.deliveredAt) != null && p.status !== "CANCELADO");

/** Cancelado depois de sair com ele — a régua do acerto (cancelado-com-motoboy-conta). */
function canceladoComEle(p: PedidoDoRanking): boolean {
  if (p.status !== "CANCELADO") return false;
  const saiu = ms(p.dispatchedAt);
  if (saiu == null) return false;
  const cancelou = ms(p.cancelledAt);
  return cancelou == null || saiu <= cancelou;
}

/** As viagens de um motoboy: pedidos que saíram juntos (mesma rota ou até JUNTOS_MIN da primeira). */
function viagensDe(pedidos: PedidoDoRanking[]): PedidoDoRanking[][] {
  const comSaida = pedidos.filter((p) => ms(p.dispatchedAt) != null).sort((a, b) => ms(a.dispatchedAt)! - ms(b.dispatchedAt)!);
  const viagens: PedidoDoRanking[][] = [];
  for (const p of comSaida) {
    const atual = viagens[viagens.length - 1];
    const saida = ms(p.dispatchedAt)!;
    const junto = atual && (
      (p.routeId && atual.some((q) => q.routeId === p.routeId)) ||
      saida - ms(atual[0].dispatchedAt)! <= JUNTOS_MIN * 60_000
    );
    if (junto) atual.push(p);
    else viagens.push([p]);
  }
  return viagens;
}

/** Quando ele pegou o pedido: puxou pelo app (se depois da viagem anterior) ou saiu. */
function quandoPegou(p: PedidoDoRanking, fimAnterior: number): number | null {
  const puxou = ms(p.motoboyPuxadoEm);
  const saiu = ms(p.dispatchedAt);
  if (puxou != null && puxou >= fimAnterior && (saiu == null || puxou <= saiu)) return puxou;
  return saiu;
}

type Bruto = Omit<LinhaDoRanking, "posicao" | "score" | "notas"> & { _entregas: number[]; _coletas: number[]; _voltas: number[] };

function medirMotoboy(motoboyId: string, nome: string, pedidos: PedidoDoRanking[], tz: string | null | undefined): Bruto {
  const entregues = pedidos.filter(ehEntregue);
  const canceladas = pedidos.filter(canceladoComEle).length;

  const tempos: number[] = [];
  const coletas: number[] = [];
  let comPrazo = 0;
  let noPrazo = 0;
  const atrasos: number[] = [];
  let km = 0;
  let temKm = false;
  const notasDoCliente: number[] = [];
  const dias = new Set<string>();

  for (const p of entregues) {
    const saiu = ms(p.dispatchedAt);
    const chegou = ms(p.deliveredAt);
    const t = minutos(saiu, chegou);
    if (t != null && t >= 0 && t <= TEMPO_MAXIMO_MIN) tempos.push(t);

    const c = minutos(ms(p.readyAt), saiu);
    if (c != null && c >= 0 && c <= TEMPO_MAXIMO_MIN) coletas.push(c);

    const previsao = previsaoDaEntrega({ createdAt: p.createdAt, scheduledDatetime: p.scheduledDatetime, tempoEntregaMin: p.tempoEntregaMin, deliveryType: p.deliveryType || "DELIVERY" });
    if (previsao?.tipo === "ENTREGA" && chegou != null) {
      comPrazo += 1;
      const atraso = (chegou - new Date(previsao.em).getTime()) / 60_000;
      if (atraso <= 0) noPrazo += 1;
      else atrasos.push(atraso);
    }

    if (typeof p.deliveryDistance === "number" && p.deliveryDistance > 0) { km += p.deliveryDistance; temKm = true; }
    if (typeof p.rating === "number" && p.rating > 0) notasDoCliente.push(p.rating);
    const quando = chegou ?? saiu ?? ms(p.createdAt);
    if (quando != null) dias.add(naLoja(new Date(quando), tz).dia);
  }

  // A volta: fim de uma viagem (a última entrega dela) → pegou o primeiro da seguinte.
  const viagens = viagensDe(pedidos.filter((p) => ehEntregue(p) || canceladoComEle(p)));
  const voltas: number[] = [];
  for (let i = 0; i + 1 < viagens.length; i++) {
    const fins = viagens[i].map((p) => ms(p.deliveredAt)).filter((x): x is number => x != null);
    if (fins.length === 0) continue;
    const fim = Math.max(...fins);
    const pegou = viagens[i + 1].map((p) => quandoPegou(p, fim)).filter((x): x is number => x != null);
    if (pegou.length === 0) continue;
    const v = minutos(fim, Math.min(...pegou));
    if (v != null && v >= 0 && v <= VOLTA_MAXIMA_MIN) voltas.push(v);
  }
  const viagensComEntrega = viagens.filter((v) => v.some(ehEntregue)).length;

  return {
    motoboyId, nome,
    entregas: entregues.length,
    canceladas,
    conclusaoPct: um(pct(entregues.length, entregues.length + canceladas)),
    entregaMediaMin: um(media(tempos)),
    entregaMedianaMin: um(mediana(tempos)),
    noPrazoPct: um(pct(noPrazo, comPrazo)),
    comPrazo,
    noPrazo,
    atrasadas: atrasos.length,
    atrasoMedioMin: um(media(atrasos)),
    coletaMedianaMin: um(mediana(coletas)),
    coletas: coletas.length,
    voltaMedianaMin: um(mediana(voltas)),
    voltas: voltas.length,
    viagens: viagensComEntrega,
    pedidosPorViagem: viagensComEntrega > 0 ? um(entregues.length / viagensComEntrega) : null,
    km: temKm ? um(km) : null,
    dias: dias.size,
    entregasPorDia: dias.size > 0 ? um(entregues.length / dias.size) : null,
    avaliacao: um(media(notasDoCliente)),
    avaliacoes: notasDoCliente.length,
    _entregas: tempos, _coletas: coletas, _voltas: voltas,
  };
}

const fmtMin = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`);

export function rankingDeEntregadores(
  pedidos: PedidoDoRanking[],
  motoboys: { id: string; name: string }[],
  tz: string | null | undefined,
): ResultadoDoRanking {
  const porMotoboy = new Map<string, PedidoDoRanking[]>();
  for (const p of pedidos) {
    if (!p.motoboyId) continue;
    const l = porMotoboy.get(p.motoboyId) || [];
    l.push(p);
    porMotoboy.set(p.motoboyId, l);
  }
  const nomes = new Map(motoboys.map((m) => [m.id, m.name]));
  const brutos = [...porMotoboy.entries()]
    .map(([id, l]) => medirMotoboy(id, nomes.get(id) || "Entregador removido", l, tz))
    .filter((b) => b.entregas > 0 || b.canceladas > 0);

  // A régua da equipe: a mediana de TODOS os pedidos, não a média das medianas.
  const eqEntrega = mediana(brutos.flatMap((b) => b._entregas));
  const eqColeta = mediana(brutos.flatMap((b) => b._coletas));
  const eqVolta = mediana(brutos.flatMap((b) => b._voltas));

  const linhas: LinhaDoRanking[] = brutos.map(({ _entregas, _coletas, _voltas, ...b }) => {
    const notas = {
      conclusao: b.conclusaoPct,
      prazo: b.noPrazoPct,
      entrega: notaDeTempo(b.entregaMedianaMin, eqEntrega),
      volta: notaDeTempo(b.voltaMedianaMin, eqVolta),
      coleta: notaDeTempo(b.coletaMedianaMin, eqColeta),
    };
    let soma = 0;
    let pesos = 0;
    for (const k of Object.keys(PESOS) as (keyof typeof PESOS)[]) {
      const n = notas[k];
      if (n == null) continue;
      soma += n * PESOS[k];
      pesos += PESOS[k];
    }
    const pontua = b.entregas >= MINIMO_PARA_RANKING && pesos > 0;
    return {
      ...b,
      posicao: null,
      score: pontua ? Math.round(soma / pesos) : null,
      notas: {
        conclusao: um(notas.conclusao), prazo: um(notas.prazo), entrega: um(notas.entrega),
        volta: um(notas.volta), coleta: um(notas.coleta),
      },
    };
  });

  // Empate no score: mais entregas na frente.
  linhas.sort((a, b) =>
    (b.score ?? -1) - (a.score ?? -1) || b.entregas - a.entregas || a.nome.localeCompare(b.nome, "pt-BR"));
  let posicao = 0;
  for (const l of linhas) if (l.score != null) l.posicao = ++posicao;

  const ranqueados = linhas.filter((l) => l.posicao != null);
  const melhor = (titulo: string, chave: string, valor: (l: LinhaDoRanking) => number | null, menorEhMelhor: boolean, texto: (l: LinhaDoRanking) => string) => {
    const comValor = ranqueados.filter((l) => valor(l) != null);
    if (comValor.length === 0) return null;
    const l = comValor.reduce((a, b) => {
      const va = valor(a)!; const vb = valor(b)!;
      if (va === vb) return a.entregas >= b.entregas ? a : b;
      return (menorEhMelhor ? vb < va : vb > va) ? b : a;
    });
    return { chave, titulo, motoboyId: l.motoboyId, nome: l.nome, valor: texto(l) };
  };
  const destaques = [
    melhor("Mais entregas", "entregas", (l) => l.entregas, false, (l) => `${l.entregas} entregas`),
    melhor("Mais pontual", "prazo", (l) => (l.comPrazo >= MINIMO_PARA_RANKING ? l.noPrazoPct : null), false, (l) => `${(l.noPrazoPct ?? 0).toLocaleString("pt-BR")}% no prazo`),
    melhor("Entrega mais rápida", "entrega", (l) => l.entregaMedianaMin, true, (l) => fmtMin(l.entregaMedianaMin)),
    melhor("Volta mais rápida", "volta", (l) => (l.voltas >= 2 ? l.voltaMedianaMin : null), true, (l) => fmtMin(l.voltaMedianaMin)),
  ].filter((d): d is NonNullable<typeof d> => d != null);

  const entregas = linhas.reduce((s, l) => s + l.entregas, 0);
  const canceladas = linhas.reduce((s, l) => s + l.canceladas, 0);
  const comPrazo = linhas.reduce((s, l) => s + l.comPrazo, 0);
  const noPrazo = linhas.reduce((s, l) => s + l.noPrazo, 0);
  const viagens = linhas.reduce((s, l) => s + l.viagens, 0);

  return {
    linhas,
    equipe: {
      entregas,
      canceladas,
      conclusaoPct: um(pct(entregas, entregas + canceladas)),
      entregaMedianaMin: um(eqEntrega),
      noPrazoPct: um(pct(noPrazo, comPrazo)),
      coletaMedianaMin: um(eqColeta),
      voltaMedianaMin: um(eqVolta),
      viagens,
      pedidosPorViagem: viagens > 0 ? um(entregas / viagens) : null,
      motoboys: linhas.length,
    },
    destaques,
  };
}
