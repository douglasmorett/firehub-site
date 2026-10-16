/**
 * O HTTP da Foody Delivery API v1.2 (e da Voe Delivery, mesmo sistema).
 *
 * Só rede, sem banco: quem grava é lib/foody-no-banco.ts. Toda chamada leva o
 * token DA LOJA, no header `Authorization` cru — a doc não mostra prefixo.
 * `FOODY_API_BASE` aponta para uma Foody falsa em teste; em produção é a base
 * oficial.
 *
 * Limites da Foody: 100 req/min em POST e PUT (429 com EC_B010 quando passa)
 * e consulta de atualizações no máximo a cada 30 s. Nada aqui repete sozinho:
 * quem chama decide (o acompanhamento roda a cada minuto, a chamada manual é
 * um clique).
 */
import type { PedidoFoody, StatusFoody } from "@/lib/foody-delivery";

const BASE_OFICIAL = "https://app.foodydelivery.com/rest/1.2";
const ESPERA_MS = 15_000;

export function baseDaFoody(): string {
  const teste = (process.env.FOODY_API_BASE || "").trim();
  return (teste || BASE_OFICIAL).replace(/\/$/, "");
}

export type RespostaFoody<T = any> = { ok: boolean; status: number; dados: T | null; erro: string | null };

function mensagemDeErro(dados: any, status: number): string {
  const texto = typeof dados === "string" ? dados : dados?.message || dados?.error || dados?.errorMessage || dados?.description;
  const codigo = dados?.code || dados?.errorCode;
  if (status === 401 || status === 403) {
    if (codigo === "E25" || /cancel/i.test(String(texto || ""))) {
      return "A Foody não deixou cancelar (o motoboy já está com o pedido ou ele já foi concluído). Cancele pelo painel da Foody.";
    }
    return "A Foody recusou o token. Copie de novo em Menu ➡ Minha Conta ➡ APIs e Hooks e cole aqui.";
  }
  if (status === 429) return "A Foody pediu para esperar (muitas chamadas em 1 minuto). Tente de novo em instantes.";
  if (status === 404) return "A Foody não encontrou este pedido.";
  if (texto) return `Foody: ${String(texto).slice(0, 200)}${codigo ? ` (${codigo})` : ""}`;
  return `A Foody respondeu com erro ${status}.`;
}

export async function foody<T = any>(
  token: string,
  metodo: "GET" | "POST" | "PUT",
  caminho: string,
  corpo?: unknown,
): Promise<RespostaFoody<T>> {
  const corte = new AbortController();
  const relogio = setTimeout(() => corte.abort(), ESPERA_MS);
  try {
    const r = await fetch(`${baseDaFoody()}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: token,
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json",
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: corte.signal,
      cache: "no-store",
    });
    const texto = await r.text();
    let dados: any = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto || null; }
    return { ok: r.ok, status: r.status, dados: r.ok ? dados : null, erro: r.ok ? null : mensagemDeErro(dados, r.status) };
  } catch (err: any) {
    const tempo = err?.name === "AbortError";
    return { ok: false, status: 0, dados: null, erro: tempo ? "A Foody não respondeu a tempo (15 s)." : `Sem conexão com a Foody: ${err?.message || err}` };
  } finally {
    clearTimeout(relogio);
  }
}

export const criarEntrega = (token: string, pedido: PedidoFoody) => foody(token, "POST", "/orders", pedido);
export const lerEntrega = (token: string, uid: string) => foody(token, "GET", `/orders/${encodeURIComponent(uid)}`);
export const mudarStatusDaEntrega = (token: string, uid: string, status: Extract<StatusFoody, "ready" | "closed" | "cancelled">) =>
  foody(token, "PUT", `/orders/updatestatus/${encodeURIComponent(uid)}`, { status });
export const conferirAtualizacoes = (token: string, uids: string[]) => foody<any[]>(token, "POST", "/orders/checkupdates", uids);

/** Lista os pedidos de um intervalo (datas no formato da Foody). Até 500 por chamada. */
export const listarEntregas = (token: string, inicio: string, fim: string) =>
  foody<any[]>(token, "GET", `/orders?startDate=${encodeURIComponent(inicio)}&endDate=${encodeURIComponent(fim)}`);
