/**
 * PRONTO E PRIORIDADE EM LOTE, PELA ROTEIRIZAÇÃO.
 *
 * Pedido do Douglas (21/10/2026): quem despacha vê no mapa que três pedidos
 * podem ir juntos e quer, de uma vez, dar os três por prontos ou mandar os
 * três para a frente da cozinha — "só um aviso e faz tudo de uma vez". Cada
 * pedido continua indo pelo SEU caminho (o pronto pelo PUT /api/kds, a
 * prioridade pelo PATCH /api/store/orders/[id]/prioridade); aqui fica só o
 * que não depende de React: ler a resposta de cada um e montar o aviso único.
 *
 * Testado em scripts/teste-prioridade-pelo-mapa.ts.
 */
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";

export type AcaoDoLote = "pronto" | "prioridade";

export type ResultadoDoPedido = { id: string; numero: string; ok: boolean; motivo?: string };

export type ResumoDoLote = {
  tipo: "ok" | "atencao" | "erro";
  titulo: string;
  detalhe?: string;
  /** Os ids cujo palpite otimista tem de ser desfeito. */
  falharam: string[];
};

/**
 * Pedido que já acabou (entregue/encerrado) ou foi cancelado não tem mais
 * cozinha: prioridade nele só mentiria na tela. O PATCH recusa com 409.
 */
export function podePedirPrioridade(status: string | null | undefined): boolean {
  const s = String(status || "").toUpperCase().trim();
  return !(STATUS_FINALIZADOS as readonly string[]).includes(s) && !(STATUS_CANCELADOS as readonly string[]).includes(s);
}

/**
 * A resposta de UM pedido do lote. O pronto devolve 200 com
 * `precisaConfirmar` quando ainda há item na produção (api/kds, Ragnar
 * 18/10/2026) — a baixa NÃO foi gravada, então conta como falha. O lote manda
 * `forcar: true` e isso não deveria acontecer; se acontecer, o lojista vê.
 */
export function lerRespostaDoLote(httpOk: boolean, corpo: any): { ok: boolean; motivo?: string } {
  if (corpo?.precisaConfirmar) return { ok: false, motivo: "ainda tem item na produção" };
  if (!httpOk || corpo?.success === false) return { ok: false, motivo: String(corpo?.error || "sem resposta do servidor") };
  return { ok: true };
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** O aviso único do lote: "3 pedidos marcados como prontos" ou "2 de 3: o #27 falhou (motivo)". */
export function resumoDoLote(acao: AcaoDoLote, resultados: ResultadoDoPedido[]): ResumoDoLote {
  const total = resultados.length;
  const certos = resultados.filter((r) => r.ok).length;
  const ruins = resultados.filter((r) => !r.ok);
  const falharam = ruins.map((r) => r.id);

  if (ruins.length === 0) {
    return {
      tipo: "ok",
      titulo:
        acao === "pronto"
          ? `${total} ${plural(total, "pedido marcado como pronto", "pedidos marcados como prontos")}`
          : `Prioridade pedida no KDS para ${total} ${plural(total, "pedido", "pedidos")}`,
      falharam,
    };
  }

  const quais = ruins.map((r) => `o #${r.numero} falhou${r.motivo ? ` (${r.motivo})` : ""}`).join("; ");
  if (certos === 0) {
    return {
      tipo: "erro",
      titulo: acao === "pronto" ? "Nenhum pedido foi marcado como pronto" : "A prioridade não foi pedida",
      detalhe: quais.charAt(0).toUpperCase() + quais.slice(1),
      falharam,
    };
  }
  return { tipo: "atencao", titulo: `${certos} de ${total}: ${quais}`, falharam };
}

/** Tira do palpite otimista só os ids que falharam; os outros esperam o poll confirmar. */
export function tirarDoPalpite<T>(palpites: Record<string, T>, ids: string[]): Record<string, T> {
  if (!ids.some((id) => id in palpites)) return palpites;
  const proximo = { ...palpites };
  for (const id of ids) delete proximo[id];
  return proximo;
}
