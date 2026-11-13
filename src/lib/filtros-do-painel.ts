/**
 * Os filtros do quadro de Pedidos ficam onde a loja deixou.
 *
 * O horário (De / Até) e o filtro "Pedidos" (Delivery, Retirada, Balcão, Mesa)
 * moravam só na memória da tela: ir ao PDV, às Mesas ou ao Caixa e voltar,
 * dar F5, ou o navegador recarregar a aba parada, e tudo voltava ao padrão —
 * o dia inteiro, com o almoço misturado ao jantar (Thalyta/Garagem Burger,
 * 13/11/2026: "deixar os filtros de horários fixos"). Agora ficam gravados
 * neste aparelho, por loja, até alguém mudar.
 *
 * Do período fica só o HORÁRIO: a data volta sempre para o dia de operação de
 * hoje (das 5h às 5h, como o caixa e os Relatórios). Gravar a data deixaria o
 * quadro de amanhã olhando para ontem.
 */
import { corrigirPeriodo } from "./periodo-do-quadro";

export type TiposDoPainel = { delivery: boolean; retirada: boolean; balcao: boolean; mesa: boolean };
export type FiltrosSalvos = { horaDe?: string; horaAte?: string; tipos?: TiposDoPainel };

export const chaveDosFiltros = (lojaId: string) => `firehub:filtros-do-painel:${lojaId}`;

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIPOS = ["delivery", "retirada", "balcao", "mesa"] as const;

const somarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Dia de operação em que "AAAA-MM-DDTHH:mm" cai (o dia vira às 5h). */
export const diaDeOperacaoDe = (momento: string) =>
  momento.slice(11, 16) < "05:00" ? somarDias(momento.slice(0, 10), -1) : momento.slice(0, 10);

/** Lê o que foi gravado. Lixo, campo faltando ou tudo desmarcado = padrão. */
export function lerFiltrosSalvos(texto: string | null | undefined): FiltrosSalvos {
  if (!texto) return {};
  try {
    const j = JSON.parse(texto);
    const salvos: FiltrosSalvos = {};
    if (HORA.test(j?.horaDe) && HORA.test(j?.horaAte)) {
      salvos.horaDe = j.horaDe;
      salvos.horaAte = j.horaAte;
    }
    const t = j?.tipos;
    // Tudo desmarcado esconderia todos os pedidos depois do F5: não vale.
    if (t && TIPOS.every(k => typeof t[k] === "boolean") && TIPOS.some(k => t[k])) {
      salvos.tipos = { delivery: t.delivery, retirada: t.retirada, balcao: t.balcao, mesa: t.mesa };
    }
    return salvos;
  } catch {
    return {};
  }
}

/**
 * O horário de um período que cabe num dia de operação só ("13/11 18:00 →
 * 14/11 02:00" dá 18:00–02:00). Período de vários dias não tem horário a
 * guardar: devolve null.
 */
export function horasDoPeriodo(de: string, ate: string): { horaDe: string; horaAte: string } | null {
  if (!de || !ate || de >= ate) return null;
  if (diaDeOperacaoDe(de) !== diaDeOperacaoDe(ate)) return null;
  return { horaDe: de.slice(11, 16), horaAte: ate.slice(11, 16) };
}

/** O horário guardado posto no dia de operação `dia` (madrugada = dia seguinte). */
export function periodoNasHoras(dia: string, horaDe: string, horaAte: string): { de: string; ate: string } {
  const noDia = (h: string) => (h < "05:00" ? `${somarDias(dia, 1)}T${h}` : `${dia}T${h}`);
  return corrigirPeriodo(noDia(horaDe), noDia(horaAte), "ate");
}

/**
 * "Saiu para Entrega" só ocupa espaço quando o filtro inclui Delivery. Com só
 * Retirada/Balcão/Mesa ela sai da tela (Garagem Burger, 13/11/2026) — a não
 * ser que tenha pedido nela: pedido escondido atrás de coluna sumida é pior
 * que uma coluna a mais (a retirada pronta no KDS vira SAIU_ENTREGA quando a
 * coluna Prontos está desligada).
 */
export const mostrarSaiuParaEntrega = (tipos: TiposDoPainel, pedidosNaColuna: number) =>
  tipos.delivery || pedidosNaColuna > 0;
