/**
 * "PEDIDO CANCELADO" no papel da cozinha.
 *
 * Ragnar Burguer (Fabiano, 24/10/2026): "avisar a cozinha dos cancelamentos".
 * O pedido cancelado só saía da tela do KDS, sem alerta, e a cozinha seguia
 * montando. O Douglas pediu como OPÇÃO POR IMPRESSORA
 * (`printers[].avisoDeCancelamento`), desligada por padrão: a loja marca a
 * impressora onde quer o papel.
 *
 * ── QUANDO SAI ──
 *
 * Só para o pedido que já estava na cozinha (comanda impressa ou entrou no
 * KDS) e foi cancelado até 60 min depois de entrar. Na Ragnar, em 23/10, uns
 * 30 pedidos foram cancelados de uma vez entre 1h e 3h, de 1h30 a 2h depois de
 * entrar — limpeza do quadro, não aviso para quem está na chapa. Sem o teto,
 * cada um seria um papel.
 *
 * ── POR QUE PrintRequest ──
 *
 * O papel nasce UMA vez, como impressão avulsa de id fixo
 * (`cancelamento_<pedido>`): duas consultas ao mesmo tempo não criam dois, e o
 * /ack já carimba PrintRequest pelo id. Sem coluna nova no pedido. O Assistente
 * 1.2.18+ imprime os blocos `textoRico` (tarja invertida no 1.2.19+); nenhuma
 * versão nova dele.
 */
import { blocosParaOAssistente, modeloPadrao, type Bloco } from "./comanda-modelo";
import type { ImpressoraConfigurada } from "./roteamento-de-impressao";

export const KIND_CANCELAMENTO = "CANCELAMENTO";

/** Cancelado depois disto não vira papel: a cozinha já não está com ele. */
export const TETO_DO_AVISO_MS = 60 * 60 * 1000;

export const idDoAvisoDeCancelamento = (pedidoId: string) => `cancelamento_${pedidoId}`;

export function impressorasDoAvisoDeCancelamento<T extends ImpressoraConfigurada>(printers: ReadonlyArray<T>): T[] {
  const nome = (p: T) => String(p?.name || "").trim();
  return printers.filter((p, i, todas) => p?.avisoDeCancelamento === true && nome(p) && todas.findIndex((q) => nome(q) === nome(p)) === i);
}

type PedidoCancelado = {
  createdAt: Date | string;
  cancelledAt?: Date | string | null;
  printedAt?: Date | string | null;
  printedNaChegadaAt?: Date | string | null;
  kdsStage?: string | null;
};

/** O pedido já estava na cozinha e o cancelamento veio a tempo de alguém parar de fazer. */
export function pedidoPedeAvisoDeCancelamento(p: PedidoCancelado): boolean {
  if (!p.cancelledAt) return false;
  const chegouNaCozinha = !!p.printedAt || !!p.printedNaChegadaAt || !!p.kdsStage;
  if (!chegouNaCozinha) return false;
  const depois = new Date(p.cancelledAt).getTime() - new Date(p.createdAt).getTime();
  return Number.isFinite(depois) && depois <= TETO_DO_AVISO_MS;
}

const hora = (d: Date | string) =>
  new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** A comanda da cozinha (número, canal, cliente, itens) entre duas tarjas "PEDIDO CANCELADO". */
export function blocosDoAvisoDeCancelamento(p: { cancelledAt?: Date | string | null; cancelReason?: string | null }): Bloco[] {
  const motivo = String(p.cancelReason || "").trim();
  const tarja: Bloco = {
    tipo: "textoRico",
    ligado: true,
    linhas: [
      { partes: [{ texto: "*** PEDIDO CANCELADO ***" }], negrito: true, invertido: true, alinhamento: "centro", tamanho: 2 },
      { partes: [{ texto: "NAO PREPARAR / NAO ENVIAR" }], negrito: true, alinhamento: "centro" },
      ...(p.cancelledAt ? [{ partes: [{ texto: `Cancelado as ${hora(p.cancelledAt)}` }], alinhamento: "centro" as const }] : []),
      ...(motivo ? [{ partes: [{ texto: `Motivo: ${motivo.slice(0, 120)}` }], alinhamento: "centro" as const }] : []),
    ],
  };
  return [tarja, { tipo: "separador", ligado: true }, ...blocosParaOAssistente(modeloPadrao().cozinha), { tipo: "separador", ligado: true }, tarja];
}
