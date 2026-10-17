/**
 * lib/cardapioweb/status.ts — leva a mudança de status feita na loja de volta ao CardápioWeb.
 *
 * Molde de lib/keeta/status.ts, com as regras pagas caro nos outros canais:
 *
 *   1. CANAL decide, nunca a presença de `openDeliveryOrderId`. As cinco rotas
 *      de status mandavam todo pedido com esse campo para o JotaJá; cada canal
 *      novo teve de ser excluído à mão (99, Brendi, Wabiz, Keeta). O
 *      CardápioWeb entra ANTES do "senão é JotaJá" em todas elas — e
 *      `ehPedidoCardapioWeb` também reconhece o id (`cardapioweb_…`), para
 *      que nem um pedido gravado sem o canal caia na API do JotaJá.
 *   2. Falha ao avisar o CardápioWeb nunca derruba a operação da loja: vira
 *      erro na resposta, log e uma ação PENDENTE que o polling repete.
 *   3. Teto de tempo: a tela do atendente não trava se o CardápioWeb demorar.
 *   4. ESCADA a partir do status REAL de lá: antes de subir, lê o pedido no
 *      CardápioWeb (uma chamada) e manda só os passos que faltam, na ordem
 *      (aceitar → iniciar o agendado → pronto → despachar → entregue →
 *      finalizar). Pulando um passo o CardápioWeb recusa o seguinte com 4003,
 *      e as transições exatas só existem numa imagem da doc. Sem a leitura
 *      (limite, rede), a escada sai do status do FireHub, e 4002/4003 contam
 *      como "já estava".
 *   5. Com aviso anterior na fila, o novo entra ATRÁS dele: `prepared` não
 *      passa na frente do `confirm` que ainda não foi.
 *   6. Ambiente sem credencial (canal desligado) não chama nada.
 */
import { ambienteConfigurado, acaoNoPedidoCW, buscarPedidoCW, type AcaoCW } from "./api";
import { instalacaoAtiva } from "./instalacoes";
import { lerIdDoPedidoCW } from "./id-do-pedido";
import { registrarAcaoPendente, temAcaoPendente } from "./acoes-pendentes";
import { RANK_DO_FIREHUB } from "./traducao";

type PedidoParaCanal = { source?: string | null; openDeliveryChannel?: string | null; openDeliveryOrderId?: string | null };

export function ehPedidoCardapioWeb(pedido: PedidoParaCanal | null | undefined): boolean {
  if (!pedido?.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  if (canal === "CARDAPIOWEB" || String(pedido.source || "").toUpperCase().trim() === "CARDAPIOWEB") return true;
  return /^cardapioweb_/.test(String(pedido.openDeliveryOrderId));
}

const minusc = (v: unknown) => String(v ?? "").trim().toLowerCase();
const maiusc = (v: unknown) => String(v ?? "").trim().toUpperCase();

/**
 * Onde o pedido deve estar no CardápioWeb, deduzido do status do FireHub —
 * só quando não deu para ler o status real. Retirada pronta no FireHub é
 * `waiting_to_catch` lá (pronto + despachado).
 */
export function statusCWEstimado(statusDoFireHub: string | null | undefined, retirada: boolean, agendado: boolean): string {
  const r = RANK_DO_FIREHUB[maiusc(statusDoFireHub)] ?? 0;
  if (r >= 9) return "canceled";
  if (r >= 5) return "closed";
  if (r >= 4) return retirada ? "waiting_to_catch" : "released";
  if (r >= 3) return retirada ? "waiting_to_catch" : "ready";
  if (r >= 2) return "confirmed";
  if (r >= 1) return agendado ? "scheduled_confirmed" : "confirmed";
  return "waiting_confirmation";
}

/**
 * Os passos, na ordem, para levar o pedido de `statusCW` até o equivalente de
 * `alvo` (status do FireHub). Puro.
 *
 *   ACEITO        → confirm (o agendado vai para scheduled_confirmed sozinho)
 *   PREPARANDO    → + start_preparation, só no agendado
 *   PRONTO        → + prepared; na RETIRADA, + dispatch (waiting_to_catch)
 *   SAIU_ENTREGA  → + dispatch (released), só na entrega da LOJA
 *   ENTREGUE      → + delivered (só entrega da loja) + finalize
 *
 * Entrega pelo entregador de outra empresa (iFood Sob Demanda, Foody) não
 * despacha nem entrega daqui — quem move é ela; o finalize vai igual.
 */
export function passosDaEscada(p: { alvo: string; statusCW: string; retirada: boolean; agendado: boolean; entregaDaLoja: boolean }): AcaoCW[] {
  const para = RANK_DO_FIREHUB[maiusc(p.alvo)];
  if (para === undefined || para >= 9) return [];
  let s = minusc(p.statusCW);
  if (["canceled", "canceling", "closed", "pending_payment", "pending_online_payment"].includes(s)) return [];
  const passos: AcaoCW[] = [];
  if (para >= 1 && s === "waiting_confirmation") {
    passos.push("confirm");
    s = p.agendado ? "scheduled_confirmed" : "confirmed";
  }
  if (para >= 2 && s === "scheduled_confirmed") {
    passos.push("start_preparation");
    s = "confirmed";
  }
  if (para >= 3 && s === "confirmed") {
    passos.push("prepared");
    s = "ready";
  }
  const despacha = p.retirada ? para >= 3 : para >= 4 && p.entregaDaLoja;
  if (despacha && s === "ready") {
    passos.push("dispatch");
    s = p.retirada ? "waiting_to_catch" : "released";
  }
  if (para >= 5 && !p.retirada && p.entregaDaLoja && s === "released") {
    passos.push("delivered");
    s = "delivered";
  }
  if (para >= 5) passos.push("finalize");
  return passos;
}

export type ResultadoSyncCW = { ok: boolean; ignorado?: boolean; acoes: string[]; erros: string[]; pendentes: string[] };

type PedidoParaSincronizar = { openDeliveryOrderId: string; franchiseeId: string; status?: string | null; deliveryBy?: string | null; deliveryType?: string | null; notes?: string | null };

/**
 * Leva `novoStatus` (do FireHub) ao CardápioWeb. NUNCA lança: banco fora ou
 * erro inesperado viram `erros` — a rota de status grava a mudança da loja
 * mesmo assim (regra 2).
 */
export async function sincronizarCardapioWeb(
  pedido: PedidoParaSincronizar,
  novoStatus: string,
  opts: { motivo?: string; limiteMs?: number } = {},
): Promise<ResultadoSyncCW> {
  try {
    return await sincronizar(pedido, novoStatus, opts);
  } catch (e: any) {
    console.error(`[CardápioWeb Sync] ❌ ${pedido?.openDeliveryOrderId} → ${novoStatus}:`, e?.message);
    return { ok: false, acoes: [], erros: [`erro interno: ${e?.message || e}`], pendentes: [] };
  }
}

async function sincronizar(pedido: PedidoParaSincronizar, novoStatus: string, opts: { motivo?: string; limiteMs?: number }): Promise<ResultadoSyncCW> {
  const acoes: string[] = [];
  const erros: string[] = [];
  const pendentes: string[] = [];
  const id = lerIdDoPedidoCW(pedido.openDeliveryOrderId);
  if (!id) return { ok: true, ignorado: true, acoes, erros: ["id do pedido do CardápioWeb ilegível — nada foi enviado"], pendentes };
  if (!ambienteConfigurado(id.ambiente)) return { ok: true, ignorado: true, acoes, erros: [`CardápioWeb (${id.ambiente}) não configurado no servidor`], pendentes };
  const inst = await instalacaoAtiva(id.ambiente, id.companyId);
  if (!inst) return { ok: false, ignorado: true, acoes, erros: ["a loja do CardápioWeb deste pedido está desligada no FireHub — nada foi enviado"], pendentes };

  const pedidoId = pedido.openDeliveryOrderId;
  const prazo = Date.now() + (opts.limiteMs ?? 12_000);
  const naFila = await temAcaoPendente(pedidoId);
  let travado = naFila; // daqui em diante tudo vai para a fila, em ordem
  let parar = false;

  const enviar = async (acao: AcaoCW, corpo?: unknown) => {
    if (parar) return;
    if (travado) {
      await registrarAcaoPendente(pedidoId, acao, corpo, naFila ? "na fila atrás de um aviso anterior" : "passo anterior falhou");
      pendentes.push(acao);
      return;
    }
    if (Date.now() > prazo) {
      erros.push(`${acao}: não enviado — o CardápioWeb demorou mais que o limite desta operação`);
      await registrarAcaoPendente(pedidoId, acao, corpo, "tempo esgotado");
      pendentes.push(acao);
      travado = true;
      return;
    }
    const r = await acaoNoPedidoCW(inst, acao, id.orderId, corpo);
    if (r.ok) {
      acoes.push(r.jaEstava ? `${acao} (já estava)` : acao);
      return;
    }
    erros.push(`${acao}: ${r.erro}`);
    if (r.repetir) {
      // 429/5xx/rede: este e os passos seguintes vão para a fila, em ordem.
      await registrarAcaoPendente(pedidoId, acao, corpo, r.erro || "");
      pendentes.push(acao);
      travado = true;
    } else {
      // Recusa de regra (404, 403…): repetir não muda nada, e o passo
      // seguinte seria recusado também.
      parar = true;
    }
  };

  const alvo = maiusc(novoStatus);
  if (alvo === "CANCELADO") {
    // Cancelar não espera a fila: o cliente precisa saber agora, e o que
    // estava na fila antes passa a voltar 4002 ("já estava") e se resolve.
    travado = false;
    await enviar("cancel", { cancellation_reason: (opts.motivo || "Cancelado pela loja").slice(0, 250) });
    return { ok: erros.length === 0, acoes, erros, pendentes };
  }
  if (RANK_DO_FIREHUB[alvo] === undefined) return { ok: true, ignorado: true, acoes, erros, pendentes };

  let retirada = maiusc(pedido.deliveryType || "DELIVERY") !== "DELIVERY";
  let agendado = /📅 AGENDADO/.test(String(pedido.notes || ""));
  let statusCW: string | null = null;
  if (!naFila) {
    const r = await buscarPedidoCW(inst, id.orderId);
    if (r.ok && r.dados && typeof r.dados === "object") {
      statusCW = minusc(r.dados.status) || null;
      if (r.dados.order_type) retirada = minusc(r.dados.order_type) !== "delivery";
      if (r.dados.order_timing) agendado = minusc(r.dados.order_timing) === "scheduled";
    } else if (r.status === 404) {
      return { ok: false, acoes, erros: ["o pedido não existe no CardápioWeb (404)"], pendentes };
    }
  }
  if (statusCW === "canceled") return { ok: false, acoes, erros: ["o pedido está CANCELADO no CardápioWeb"], pendentes };
  const entregaDaLoja = maiusc(pedido.deliveryBy || "MERCHANT") === "MERCHANT";
  const passos = passosDaEscada({
    alvo,
    statusCW: statusCW ?? statusCWEstimado(pedido.status, retirada, agendado),
    retirada,
    agendado,
    entregaDaLoja,
  });
  for (const passo of passos) await enviar(passo);
  return { ok: erros.length === 0, acoes, erros, pendentes };
}
