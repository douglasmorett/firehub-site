/**
 * lib/anotaai/status.ts — leva a mudança de status feita na loja de volta ao Anota AI.
 *
 * Molde de lib/cardapioweb/status.ts, com as mesmas regras:
 *
 *   1. CANAL decide, nunca a presença de `openDeliveryOrderId`: o Anota AI
 *      entra ANTES do "senão é JotaJá" em todas as rotas de status, e
 *      `ehPedidoAnotaAi` também reconhece o id (`anotaai_…`).
 *   2. Falha ao avisar o Anota AI nunca derruba a operação da loja: vira erro
 *      na resposta, log e ação PENDENTE que o polling repete.
 *   3. Teto de tempo: a tela do atendente não trava se o Anota AI demorar.
 *   4. ESCADA a partir do `check` REAL de lá (o status no Anota AI só avança e
 *      recusa pulo inválido): aceitar → pronto → finalizar. O Anota AI não tem
 *      "saiu para entrega" — o "pronto" deles já é "pronto para entrega".
 *   5. Com aviso anterior na fila, o novo entra ATRÁS dele.
 *   6. Servidor sem credencial (canal desligado) não chama nada.
 */
import { anotaAiConfigurado, acaoNoPedidoAnotaAi, buscarPedidoAnotaAi, type AcaoAnotaAi } from "./api";
import { lojaAnotaAiAtiva } from "./lojas";
import { lerIdDoPedidoAnotaAi } from "./id-do-pedido";
import { registrarAcaoPendente, temAcaoPendente } from "./acoes-pendentes";
import { RANK_DO_FIREHUB, checkDo } from "./traducao";

type PedidoParaCanal = { source?: string | null; openDeliveryChannel?: string | null; openDeliveryOrderId?: string | null };

export function ehPedidoAnotaAi(pedido: PedidoParaCanal | null | undefined): boolean {
  if (!pedido?.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  if (canal === "ANOTAAI" || String(pedido.source || "").toUpperCase().trim() === "ANOTAAI") return true;
  return /^anotaai_/.test(String(pedido.openDeliveryOrderId));
}

const maiusc = (v: unknown) => String(v ?? "").trim().toUpperCase();

/** Onde o pedido deve estar no Anota AI, deduzido do status do FireHub — só quando não deu para ler o real. */
export function checkEstimado(statusDoFireHub: string | null | undefined): number {
  const r = RANK_DO_FIREHUB[maiusc(statusDoFireHub)] ?? 0;
  if (r >= 9) return 4;
  if (r >= 5) return 3;
  if (r >= 3) return 2;
  if (r >= 1) return 1;
  return 0;
}

/**
 * Os passos, na ordem, para levar o pedido do `check` atual até o equivalente
 * de `alvo` (status do FireHub). Puro.
 *
 *   ACEITO / PREPARANDO     → accept
 *   PRONTO / SAIU_ENTREGA   → + ready
 *   ENTREGUE                → + finalize
 *
 * Agendado aceito (-2) só anda sozinho para a produção (1) no horário: antes
 * disso, "pronto" e "finalizar" seriam recusados — não manda.
 */
export function passosDaEscadaAnotaAi(p: { alvo: string; check: number }): AcaoAnotaAi[] {
  const para = RANK_DO_FIREHUB[maiusc(p.alvo)];
  if (para === undefined || para >= 9) return [];
  let c = p.check;
  if (![0, 1, 2, -2].includes(c)) return [];
  const passos: AcaoAnotaAi[] = [];
  if (para >= 1 && c === 0) {
    passos.push("accept");
    c = 1;
  }
  if (c === -2) return passos;
  if (para >= 3 && c === 1) {
    passos.push("ready");
    c = 2;
  }
  if (para >= 5 && (c === 1 || c === 2)) passos.push("finalize");
  return passos;
}

export type ResultadoSyncAnotaAi = { ok: boolean; ignorado?: boolean; acoes: string[]; erros: string[]; pendentes: string[] };

type PedidoParaSincronizar = { openDeliveryOrderId: string; franchiseeId: string; status?: string | null };

/** Leva `novoStatus` (do FireHub) ao Anota AI. NUNCA lança (regra 2). */
export async function sincronizarAnotaAi(
  pedido: PedidoParaSincronizar,
  novoStatus: string,
  opts: { motivo?: string; limiteMs?: number } = {},
): Promise<ResultadoSyncAnotaAi> {
  try {
    return await sincronizar(pedido, novoStatus, opts);
  } catch (e: any) {
    console.error(`[Anota AI Sync] ❌ ${pedido?.openDeliveryOrderId} → ${novoStatus}:`, e?.message);
    return { ok: false, acoes: [], erros: [`erro interno: ${e?.message || e}`], pendentes: [] };
  }
}

async function sincronizar(pedido: PedidoParaSincronizar, novoStatus: string, opts: { motivo?: string; limiteMs?: number }): Promise<ResultadoSyncAnotaAi> {
  const acoes: string[] = [];
  const erros: string[] = [];
  const pendentes: string[] = [];
  const id = lerIdDoPedidoAnotaAi(pedido.openDeliveryOrderId);
  if (!id) return { ok: true, ignorado: true, acoes, erros: ["id do pedido do Anota AI ilegível — nada foi enviado"], pendentes };
  if (!anotaAiConfigurado()) return { ok: true, ignorado: true, acoes, erros: ["Anota AI não configurado no servidor"], pendentes };
  const loja = await lojaAnotaAiAtiva(id.pageId);
  if (!loja) return { ok: false, ignorado: true, acoes, erros: ["a loja do Anota AI deste pedido está desligada no FireHub — nada foi enviado"], pendentes };
  // O token é um só (do parceiro) e a página sai do id gravado no pedido: só
  // age se a página for da MESMA conta do pedido — senão um id copiado
  // aceitaria ou cancelaria o pedido de outro restaurante.
  if (loja.franchiseeId !== pedido.franchiseeId) {
    console.warn(`[Anota AI Sync] ⛔ ${pedido.openDeliveryOrderId}: a página ${id.pageId} é da conta ${loja.franchiseeId}, o pedido é da ${pedido.franchiseeId} — nada enviado`);
    return { ok: false, ignorado: true, acoes, erros: ["a loja do Anota AI deste pedido não é desta conta — nada foi enviado"], pendentes };
  }

  const pedidoId = pedido.openDeliveryOrderId;
  const prazo = Date.now() + (opts.limiteMs ?? 12_000);
  const naFila = await temAcaoPendente(pedidoId);
  let travado = naFila;
  let parar = false;

  const enviar = async (acao: AcaoAnotaAi, corpo?: unknown) => {
    if (parar) return;
    if (travado) {
      await registrarAcaoPendente(pedidoId, acao, corpo, naFila ? "na fila atrás de um aviso anterior" : "passo anterior falhou");
      pendentes.push(acao);
      return;
    }
    if (Date.now() > prazo) {
      erros.push(`${acao}: não enviado — o Anota AI demorou mais que o limite desta operação`);
      await registrarAcaoPendente(pedidoId, acao, corpo, "tempo esgotado");
      pendentes.push(acao);
      travado = true;
      return;
    }
    const r = await acaoNoPedidoAnotaAi(id.pageId, acao, id.orderId, corpo);
    if (r.ok) {
      acoes.push(acao);
      return;
    }
    erros.push(`${acao}: ${r.erro}`);
    if (r.repetir) {
      await registrarAcaoPendente(pedidoId, acao, corpo, r.erro || "");
      pendentes.push(acao);
      travado = true;
    } else {
      parar = true;
    }
  };

  const alvo = maiusc(novoStatus);
  if (alvo === "CANCELADO") {
    // Cancelar não espera a fila: o cliente precisa saber agora. O Anota AI
    // recusa estorno online acima de R$ 400 ou de mais de 4 h — o erro volta
    // para a tela com o texto deles.
    travado = false;
    await enviar("cancel", { justification: (opts.motivo || "Cancelado pela loja").slice(0, 250) });
    return { ok: erros.length === 0, acoes, erros, pendentes };
  }
  if (RANK_DO_FIREHUB[alvo] === undefined) return { ok: true, ignorado: true, acoes, erros, pendentes };

  let check: number | null = null;
  if (!naFila) {
    const r = await buscarPedidoAnotaAi(id.pageId, id.orderId);
    if (r.ok && r.dados && typeof r.dados === "object") check = checkDo(r.dados);
  }
  if (check !== null && [4, 5, 41, 42, -4].includes(check)) return { ok: false, acoes, erros: ["o pedido está CANCELADO/NEGADO no Anota AI"], pendentes };
  const passos = passosDaEscadaAnotaAi({ alvo, check: check ?? checkEstimado(pedido.status) });
  for (const passo of passos) await enviar(passo);
  return { ok: erros.length === 0, acoes, erros, pendentes };
}
