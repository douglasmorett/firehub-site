/**
 * lib/aiqfome/status.ts — leva a mudança de status feita na loja de volta ao aiqfome.
 *
 * Molde de lib/cardapioweb/status.ts, com as regras pagas caro nos outros canais:
 *
 *   1. CANAL decide, nunca a presença de `openDeliveryOrderId`. As rotas de
 *      status mandavam todo pedido com esse campo para o JotaJá; o aiqfome
 *      entra ANTES do "senão é JotaJá" em todas elas — e `ehPedidoAiqfome`
 *      também reconhece o id (`aiqfome_…`).
 *   2. Falha ao avisar o aiqfome nunca derruba a operação da loja: vira erro
 *      na resposta, log e uma ação PENDENTE que o polling repete.
 *   3. ESCADA a partir do estado REAL de lá (uma leitura do pedido) e só os
 *      passos que faltam, na ordem: lido (mark-as-read = o aceite) → pronto
 *      (mark-as-ready) → entregue (mark-as-delivered). Sem a leitura, a escada
 *      sai do status do FireHub.
 *   4. A V2 NÃO cancela pedido de restaurante e não tem "despachar": cancelar
 *      aqui não chama nada e devolve o aviso para a loja cancelar também no
 *      Geraldo; "saiu para entrega" só garante o "pronto" lá.
 *   5. Entrega pelo aiqentrega (motoboy do aiqfome): quem marca entregue é ele.
 *   6. Canal sem credencial no servidor não chama nada.
 */
import { aiqfomeConfigurada, acaoNoPedidoAQ, buscarPedidoAQ, type AcaoAQ } from "./api";
import { instalacaoAtiva } from "./instalacoes";
import { lerIdDoPedidoAQ } from "./id-do-pedido";
import { registrarAcaoPendente, temAcaoPendente } from "./acoes-pendentes";
import { RANK_DO_FIREHUB } from "./traducao";

type PedidoParaCanal = { source?: string | null; openDeliveryChannel?: string | null; openDeliveryOrderId?: string | null };

export function ehPedidoAiqfome(pedido: PedidoParaCanal | null | undefined): boolean {
  if (!pedido?.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  if (canal === "AIQFOME" || String(pedido.source || "").toUpperCase().trim() === "AIQFOME") return true;
  return /^aiqfome_/.test(String(pedido.openDeliveryOrderId));
}

/** O que a loja precisa ler quando cancela um pedido do aiqfome no FireHub. */
export const AVISO_DO_CANCELAMENTO =
  "O aiqfome não deixa cancelar pelo sistema: cancele também no Geraldo (portal do aiqfome), senão o cliente continua esperando.";

const maiusc = (v: unknown) => String(v ?? "").trim().toUpperCase();

export type SinaisAQ = { lido: boolean; pronto: boolean; entregue: boolean; cancelado?: boolean };

/** Onde o pedido deve estar lá, deduzido do status do FireHub (quando não deu para ler). */
export function sinaisEstimados(statusDoFireHub: string | null | undefined): SinaisAQ {
  const r = RANK_DO_FIREHUB[maiusc(statusDoFireHub)] ?? 0;
  return { lido: r >= 1, pronto: r >= 3 && r < 9, entregue: r >= 5 && r < 9 };
}

/**
 * Os passos, na ordem, para levar o pedido até o equivalente de `alvo`. Puro.
 *
 *   ACEITO/PREPARANDO → mark-as-read
 *   PRONTO/SAIU       → + mark-as-ready
 *   ENTREGUE          → + mark-as-delivered (não no aiqentrega)
 */
export function passosDaEscada(p: { alvo: string; sinais: SinaisAQ; entregaDaLoja: boolean }): AcaoAQ[] {
  const para = RANK_DO_FIREHUB[maiusc(p.alvo)];
  if (para === undefined || para >= 9 || p.sinais.cancelado) return [];
  const passos: AcaoAQ[] = [];
  if (para >= 1 && !p.sinais.lido) passos.push("mark-as-read");
  if (para >= 3 && !p.sinais.pronto) passos.push("mark-as-ready");
  if (para >= 5 && !p.sinais.entregue && p.entregaDaLoja) passos.push("mark-as-delivered");
  return passos;
}

export type ResultadoSyncAQ = { ok: boolean; ignorado?: boolean; acoes: string[]; erros: string[]; pendentes: string[]; aviso?: string };

type PedidoParaSincronizar = { openDeliveryOrderId: string; franchiseeId: string; status?: string | null; deliveryBy?: string | null; deliveryType?: string | null; notes?: string | null };

/** Leva `novoStatus` (do FireHub) ao aiqfome. NUNCA lança (regra 2). */
export async function sincronizarAiqfome(pedido: PedidoParaSincronizar, novoStatus: string, opts: { limiteMs?: number } = {}): Promise<ResultadoSyncAQ> {
  try {
    return await sincronizar(pedido, novoStatus, opts);
  } catch (e: any) {
    console.error(`[aiqfome Sync] ❌ ${pedido?.openDeliveryOrderId} → ${novoStatus}:`, e?.message);
    return { ok: false, acoes: [], erros: [`erro interno: ${e?.message || e}`], pendentes: [] };
  }
}

async function sincronizar(pedido: PedidoParaSincronizar, novoStatus: string, opts: { limiteMs?: number }): Promise<ResultadoSyncAQ> {
  const acoes: string[] = [];
  const erros: string[] = [];
  const pendentes: string[] = [];
  const alvo = maiusc(novoStatus);
  // Cancelar não depende de credencial nem de rede: não há o que chamar.
  if (alvo === "CANCELADO") return { ok: true, ignorado: true, acoes, erros, pendentes, aviso: AVISO_DO_CANCELAMENTO };

  const id = lerIdDoPedidoAQ(pedido.openDeliveryOrderId);
  if (!id) return { ok: true, ignorado: true, acoes, erros: ["id do pedido do aiqfome ilegível — nada foi enviado"], pendentes };
  if (!aiqfomeConfigurada()) return { ok: true, ignorado: true, acoes, erros: ["aiqfome não configurado no servidor"], pendentes };
  if (RANK_DO_FIREHUB[alvo] === undefined) return { ok: true, ignorado: true, acoes, erros, pendentes };
  const inst = await instalacaoAtiva(id.storeId);
  if (!inst) return { ok: false, ignorado: true, acoes, erros: ["a loja do aiqfome deste pedido está desligada no FireHub — nada foi enviado"], pendentes };
  // A loja do aiqfome sai do id gravado no pedido: só age se a instalação for
  // da MESMA conta do pedido — senão um id copiado mexeria no pedido de outra loja.
  if (inst.franchiseeId !== pedido.franchiseeId) {
    console.warn(`[aiqfome Sync] ⛔ ${pedido.openDeliveryOrderId}: a loja ${id.storeId} do aiqfome é da conta ${inst.franchiseeId}, o pedido é da ${pedido.franchiseeId} — nada enviado`);
    return { ok: false, ignorado: true, acoes, erros: ["a loja do aiqfome deste pedido não é desta conta — nada foi enviado"], pendentes };
  }

  const pedidoId = pedido.openDeliveryOrderId;
  const prazo = Date.now() + (opts.limiteMs ?? 12_000);
  const naFila = await temAcaoPendente(pedidoId);
  let travado = naFila;
  let parar = false;

  const enviar = async (acao: AcaoAQ) => {
    if (parar) return;
    if (travado) {
      await registrarAcaoPendente(pedidoId, acao, naFila ? "na fila atrás de um aviso anterior" : "passo anterior falhou");
      pendentes.push(acao);
      return;
    }
    if (Date.now() > prazo) {
      erros.push(`${acao}: não enviado — o aiqfome demorou mais que o limite desta operação`);
      await registrarAcaoPendente(pedidoId, acao, "tempo esgotado");
      pendentes.push(acao);
      travado = true;
      return;
    }
    const r = await acaoNoPedidoAQ(inst, acao, id.orderId);
    if (r.ok) {
      acoes.push(r.jaEstava ? `${acao} (já estava)` : acao);
      return;
    }
    erros.push(`${acao}: ${r.erro}`);
    if (r.repetir) {
      await registrarAcaoPendente(pedidoId, acao, r.erro || "");
      pendentes.push(acao);
      travado = true;
    } else {
      parar = true;
    }
  };

  let sinais: SinaisAQ | null = null;
  if (!naFila) {
    const r = await buscarPedidoAQ(inst, id.orderId);
    if (r.ok && r.dados && typeof r.dados === "object") {
      sinais = { lido: r.dados.is_read === true || r.dados.is_in_separation === true, pronto: r.dados.is_ready === true, entregue: r.dados.is_delivered === true, cancelado: r.dados.is_cancelled === true };
    } else if (r.status === 404) {
      return { ok: false, acoes, erros: ["o pedido não existe no aiqfome (404)"], pendentes };
    }
  }
  if (sinais?.cancelado) return { ok: false, acoes, erros: ["o pedido está CANCELADO no aiqfome"], pendentes };
  const entregaDaLoja = maiusc(pedido.deliveryBy || "MERCHANT") === "MERCHANT";
  const passos = passosDaEscada({ alvo, sinais: sinais ?? sinaisEstimados(pedido.status), entregaDaLoja });
  for (const passo of passos) await enviar(passo);
  return { ok: erros.length === 0, acoes, erros, pendentes };
}
