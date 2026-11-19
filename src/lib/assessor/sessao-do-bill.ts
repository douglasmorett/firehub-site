/**
 * A SESSÃO DO BILL — o Bill lê os relatórios pelas MESMAS rotas das telas
 * (api/store/relatorios/*), dentro do servidor, como se fosse quem conversa
 * com ele logado no painel. Os números saem iguais aos da tela, em qualquer
 * período (Douglas, 18/11/2026: "o Bill não libera relatório de dias
 * anteriores"; "ele tem que conseguir buscar no sistema qualquer coisa").
 *
 * `contextoDoRelatorio` (lib/relatorios/servidor.ts) procura esta sessão antes
 * da do navegador. Ela só existe dentro de `comoQuemConversa`, chamado pela
 * ferramenta do Bill: requisição de fora não tem como criá-la (não é cookie,
 * header nem parâmetro).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type SessaoDoBill = {
  /** Quem conversa: o dono (WhatsApp) ou quem está logado no painel. As permissões são as dele. */
  usuarioId: string;
  /** A loja da conversa: entra no lugar do cookie da loja ativa. */
  franchiseeId: string;
};

const guarda = new AsyncLocalStorage<SessaoDoBill>();

export function sessaoDoBill(): SessaoDoBill | null {
  return guarda.getStore() ?? null;
}

export function comoQuemConversa<T>(sessao: SessaoDoBill, fn: () => Promise<T>): Promise<T> {
  return guarda.run(sessao, fn);
}
