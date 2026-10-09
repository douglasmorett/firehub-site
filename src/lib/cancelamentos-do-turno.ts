/**
 * /src/lib/cancelamentos-do-turno.ts
 *
 * O que a loja CANCELOU no turno, para a conferência do fechamento do caixa:
 * os ITENS tirados de pedidos que continuaram valendo (mesa, edição do pedido)
 * e, para os pedidos cancelados inteiros, quem cancelou.
 *
 * Pizzaria 17 (Antonio, 09/10/2026): "se a menina do caixa tiver que cancelar
 * algum item de alguma mesa, ou alguma bebida, ela já coloca o motivo, para
 * que, quando for fechar o caixa, estejam todas as observações que eu preciso
 * ver na conferência do fechamento". O papel só listava o pedido cancelado
 * inteiro; o item tirado da mesa era apagado sem rastro nenhum.
 *
 * A fonte é o rastro do pedido (`CustomerOrder.editHistory`, RegistroDeEdicao
 * em lib/edicao-de-pedido.ts): desde 09/10/2026 a edição que tira item grava
 * `itensRetirados` e `motivo`. Registro antigo, sem `itensRetirados`, não
 * entra — não dá para dizer o valor do item sem ele.
 *
 * Puro (sem Prisma): esperado-do-turno.ts busca, isto decide. O teste
 * (scripts/teste-motivo-do-cancelamento.ts) prova sem banco.
 */
import type { RegistroDeEdicao } from "./edicao-de-pedido";

export type ItemCanceladoNoTurno = {
  /** Quando o item foi tirado (ISO) — não quando o pedido nasceu. */
  hora: string;
  /** "#12", ou vazio. */
  numero: string;
  /** "Mesa 4", "Delivery", "Balcão"… o que o caixa reconhece. */
  onde: string;
  quem: string;
  /** "2x Coca-Cola Lata". */
  item: string;
  valor: number;
  motivo: string | null;
};

type PedidoComRastro = {
  dailyOrderNumber?: number | string | null;
  status?: string | null;
  editHistory?: unknown;
  /** Rótulo de onde o pedido está ("Mesa 4"); quem chama decide. */
  onde?: string | null;
};

const centavos = (n: number) => Math.round(n * 100) / 100;

function registros(editHistory: unknown): RegistroDeEdicao[] {
  return Array.isArray(editHistory) ? (editHistory as RegistroDeEdicao[]).filter((r) => r && typeof r === "object") : [];
}

/**
 * Os itens tirados no turno, um por linha, em ordem de hora.
 *
 * Só REMOVEU/MUDOU_QTD com `itensRetirados`: o cancelamento do pedido inteiro
 * (CANCELOU) já sai na lista de cancelados — repetir os itens dele aqui
 * contaria o mesmo dinheiro duas vezes. O corte feito pelo APP
 * (CANCELAMENTO_PARCIAL) também não é da loja e tem aviso próprio.
 */
export function itensCanceladosNoTurno(
  pedidos: PedidoComRastro[],
  janela: { de: Date; ate?: Date | null }
): ItemCanceladoNoTurno[] {
  const de = janela.de.getTime();
  const ate = janela.ate ? janela.ate.getTime() : Infinity;
  const saida: ItemCanceladoNoTurno[] = [];
  for (const p of pedidos || []) {
    for (const r of registros(p.editHistory)) {
      if (r.acao !== "REMOVEU" && r.acao !== "MUDOU_QTD") continue;
      if (!Array.isArray(r.itensRetirados) || r.itensRetirados.length === 0) continue;
      const quando = new Date(r.quando).getTime();
      if (!Number.isFinite(quando) || quando < de || quando > ate) continue;
      for (const it of r.itensRetirados) {
        const qtd = Math.max(1, Math.round(Number(it?.quantidade) || 1));
        saida.push({
          hora: new Date(quando).toISOString(),
          numero: p.dailyOrderNumber != null && p.dailyOrderNumber !== "" ? `#${p.dailyOrderNumber}` : "",
          onde: String(p.onde || "").trim(),
          quem: String(r.quem || "").trim() || "loja",
          item: `${qtd}x ${String(it?.nome || "item").trim() || "item"}`,
          valor: centavos(Number(it?.valor) || 0),
          motivo: typeof r.motivo === "string" && r.motivo.trim() ? r.motivo.trim() : null,
        });
      }
    }
  }
  return saida.sort((a, b) => a.hora.localeCompare(b.hora));
}

/**
 * Quem cancelou o pedido inteiro, pelo rastro: o último CANCELOU com nome.
 * `null` = cancelamento sem rastro (o do parceiro, o antigo) — o papel segue
 * com o "pela loja"/"pelo cliente" de sempre.
 */
export function quemCancelouPeloRastro(editHistory: unknown): string | null {
  const lista = registros(editHistory).filter((r) => r.acao === "CANCELOU" && String(r.quem || "").trim());
  return lista.length > 0 ? String(lista[lista.length - 1].quem).trim() : null;
}
