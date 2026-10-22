/**
 * As chamadas do app ao FireHub com o token do app (Bearer). Falha nunca é
 * silenciosa: vira um ErroDaApi com a mensagem que vai para a tela.
 */
import { API_URL } from "./config";

export class ErroDaApi extends Error {
  constructor(
    message: string,
    /** "rede": não chegou ao servidor. "sessao": precisa entrar de novo. */
    readonly tipo: "rede" | "sessao" | "servidor" | "recusado",
    readonly status: number,
  ) {
    super(message);
  }
}

export async function chamar<T = any>(
  caminho: string,
  opcoes: { metodo?: "GET" | "POST" | "DELETE"; corpo?: unknown; token?: string | null; limite?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opcoes.corpo !== undefined) headers["Content-Type"] = "application/json";
  if (opcoes.token) headers.Authorization = `Bearer ${opcoes.token}`;

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.limite ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method: opcoes.metodo ?? "GET",
      headers,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: controle.signal,
    });
  } catch {
    throw new ErroDaApi("Sem conexão com a internet.", "rede", 0);
  } finally {
    clearTimeout(relogio);
  }
  const dados = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (res.ok) return dados as T;
  const mensagem = String(dados?.error || `Erro ${res.status} no servidor.`);
  if (res.status === 401) throw new ErroDaApi(mensagem, "sessao", 401);
  if (res.status >= 500) throw new ErroDaApi(mensagem, "servidor", res.status);
  throw new ErroDaApi(mensagem, "recusado", res.status);
}
