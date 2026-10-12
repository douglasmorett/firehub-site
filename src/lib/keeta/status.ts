/**
 * lib/keeta/status.ts — leva a mudança de status feita na loja de volta à Keeta.
 *
 * Molde de brendi-status.ts, com as regras pagas caro nos outros canais:
 *
 *   1. CANAL decide, nunca a presença de `openDeliveryOrderId`. As cinco rotas
 *      de status mandavam todo pedido com esse campo para o JotaJá; cada canal
 *      novo precisou ser excluído à mão (99, Brendi, Wabiz). A Keeta entra
 *      ANTES do "senão é JotaJá" em todas elas.
 *   2. Falha ao avisar a Keeta nunca derruba a operação da loja: vira erro na
 *      resposta, log e — o que faltava no iFood (dispatch 403 calado,
 *      03/10/2026) — uma ação PENDENTE que o polling repete.
 *   3. Teto de tempo entre chamadas: a tela do atendente não trava se a Keeta
 *      estiver lenta.
 *   4. Escada: status pulado manda as etapas anteriores (confirm que faltou é
 *      pedido cancelado pelo app).
 *   5. Pedido sem credencial da Keeta (canal desligado) não chama nada.
 */
import { keetaConfigurada, acaoNoPedidoKeeta, type ResultadoKeeta } from "./api";
import { registrarAcaoPendente } from "./acoes-pendentes";

export function ehPedidoKeeta(pedido: { source?: string | null; openDeliveryChannel?: string | null; openDeliveryOrderId?: string | null }): boolean {
  if (!pedido?.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  return canal === "KEETA" || String(pedido.source || "").toUpperCase().trim() === "KEETA";
}

/** O id da Keeta, sem o prefixo do banco (`keeta_<id>`). */
export function idNaKeeta(openDeliveryOrderId: string): string {
  return String(openDeliveryOrderId).replace(/^keeta_/, "").replace(/_recovered$/, "");
}

const RANK: Record<string, number> = {
  NOVO: 0,
  PENDENTE: 0,
  ACEITO: 1,
  CONFIRMADO: 1,
  PREPARANDO: 2,
  EM_PREPARO: 2,
  PRONTO: 3,
  SAIU_ENTREGA: 4,
  SAIU_PARA_ENTREGA: 4,
  ENTREGUE: 5,
  FINALIZADO: 5,
};

export type ResultadoSyncKeeta = { ok: boolean; ignorado?: boolean; acoes: string[]; erros: string[] };

/**
 * ACEITO       → confirm
 * PRONTO       → readyForPickup (retirada: cliente avisado; entregador Keeta: chamado)
 * SAIU_ENTREGA → dispatch       (só entrega da LOJA — com o entregador da Keeta quem despacha é ela)
 * ENTREGUE     → delivered      (só entrega da LOJA)
 * CANCELADO    → requestCancellation
 *
 * "Em preparo" não tem chamada no contrato da Keeta: o confirm já diz que a
 * cozinha começou.
 */
export async function sincronizarKeeta(
  pedido: { openDeliveryOrderId: string; franchiseeId: string; status?: string | null; deliveryBy?: string | null; deliveryType?: string | null },
  novoStatus: string,
  opts: { motivo?: string; codigoDoMotivo?: string; limiteMs?: number } = {},
): Promise<ResultadoSyncKeeta> {
  const acoes: string[] = [];
  const erros: string[] = [];
  if (!keetaConfigurada()) return { ok: true, ignorado: true, acoes, erros: ["Keeta não configurada no servidor"] };

  const id = idNaKeeta(pedido.openDeliveryOrderId);
  const prazo = Date.now() + (opts.limiteMs ?? 12_000);
  const entregaDaLoja = String(pedido.deliveryBy || "MERCHANT").toUpperCase() === "MERCHANT" && String(pedido.deliveryType || "DELIVERY") === "DELIVERY";

  const enviar = async (acao: Parameters<typeof acaoNoPedidoKeeta>[1], corpo?: unknown) => {
    if (Date.now() > prazo) {
      erros.push(`${acao}: não enviado — Keeta demorou mais que o limite desta operação`);
      await registrarAcaoPendente(pedido.openDeliveryOrderId, acao, corpo, "tempo esgotado");
      return false;
    }
    const r: ResultadoKeeta = await acaoNoPedidoKeeta(pedido.franchiseeId, acao, id, corpo);
    if (r.ok) {
      acoes.push(acao);
      return true;
    }
    erros.push(`${acao}: ${r.erro}`);
    // Recusa definitiva (4xx que não é limite) não adianta repetir; o resto vai
    // para a fila que o polling repete.
    if (r.repetir) await registrarAcaoPendente(pedido.openDeliveryOrderId, acao, corpo, r.erro || "");
    return false;
  };

  const alvo = String(novoStatus || "").toUpperCase();
  if (alvo === "CANCELADO") {
    await enviar("requestCancellation", {
      reason: opts.motivo || "Cancelado pela loja",
      code: opts.codigoDoMotivo || "SYSTEMIC_ISSUES",
      mode: "AUTO",
    });
    return { ok: erros.length === 0, acoes, erros };
  }

  const de = RANK[String(pedido.status || "").toUpperCase()] ?? 0;
  const para = RANK[alvo];
  if (para === undefined) return { ok: true, ignorado: true, acoes, erros };

  // A escada sobe a partir do que a Keeta já sabe. Status anterior perdido cai
  // no rank 0 e reenvia tudo: confirm repetido custa uma chamada.
  if (para >= 1 && de < 1) await enviar("confirm");
  if (para >= 3 && de < 3) await enviar("readyForPickup");
  if (para >= 4 && de < 4 && entregaDaLoja) await enviar("dispatch");
  if (para >= 5 && entregaDaLoja) await enviar("delivered");

  return { ok: erros.length === 0, acoes, erros };
}
