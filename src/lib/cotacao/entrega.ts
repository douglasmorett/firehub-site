/**
 * Quando o fornecedor entrega e se o pedido fecha o mínimo dele. Puro.
 *
 * O cadastro do fornecedor diz os dias da semana em que ele entrega, o prazo
 * (quantos dias depois do pedido) e o horário limite (pedido depois dele conta
 * como do dia seguinte). A tela do pedido mostra "entrega terça, 10/11" para o
 * lojista saber se a mercadoria chega a tempo antes de mandar.
 */
import { NOMES_DOS_DIAS, horaValida, relogioDaLoja, somarDiasAoDia } from "./agenda";

export type RegraDeEntrega = {
  diasDeEntrega: number[];
  prazoEntregaDias: number | null;
  horarioLimite: string | null;
};

export type ProximaEntrega = { dia: string; diaDaSemana: number; texto: string };

const dataCurta = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/**
 * O primeiro dia de entrega para um pedido feito agora. Sem dias marcados,
 * qualquer dia serve; sem prazo, o dia seguinte (o costume do atacado).
 */
export function proximaEntrega(f: RegraDeEntrega, agora: Date, tz: string): ProximaEntrega {
  const r = relogioDaLoja(agora, tz);
  const limite = horaValida(f.horarioLimite);
  const passouDoLimite = limite ? r.minutos > Number(limite.slice(0, 2)) * 60 + Number(limite.slice(3)) : false;
  const prazo = Number.isFinite(Number(f.prazoEntregaDias)) && f.prazoEntregaDias !== null ? Math.max(0, Math.floor(Number(f.prazoEntregaDias))) : 1;
  const dias = (f.diasDeEntrega || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const inicio = prazo + (passouDoLimite ? 1 : 0);
  for (let n = inicio; n <= inicio + 7; n++) {
    const sem = (r.diaDaSemana + n) % 7;
    if (dias.length && !dias.includes(sem)) continue;
    const dia = somarDiasAoDia(r.dia, n);
    const quando = n === 0 ? "hoje" : n === 1 ? "amanhã" : NOMES_DOS_DIAS[sem];
    return { dia, diaDaSemana: sem, texto: `${quando}, ${dataCurta(dia)}` };
  }
  const dia = somarDiasAoDia(r.dia, inicio);
  return { dia, diaDaSemana: (r.diaDaSemana + inicio) % 7, texto: dataCurta(dia) };
}

/** Quanto falta para o pedido mínimo (0 = atingiu ou não tem mínimo). */
export function faltaParaOMinimo(total: number, pedidoMinimo: number | null | undefined): number {
  const min = Number(pedidoMinimo);
  if (!Number.isFinite(min) || min <= 0) return 0;
  return Math.max(0, Math.round((min - total) * 100) / 100);
}
