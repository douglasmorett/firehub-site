/**
 * /src/lib/ifood-http.ts
 *
 * Uma chamada ao iFood, feita do jeito que a homologação cobra.
 *
 * Os critérios dos módulos Merchant, Catalog e Logistics pedem as mesmas três
 * coisas em texto quase idêntico: repetir com backoff exponencial quando o erro
 * é do servidor, NUNCA repetir quando o erro é nosso (4xx), e esperar o
 * Retry-After quando o iFood devolve 429. O analista força esses casos durante
 * a avaliação, então isso não é zelo — é item de checklist.
 *
 * O retorno carrega o status HTTP porque a tela precisa exibi-lo: eles querem
 * ver 201 na criação da pausa, 204 na remoção e 202 nas ações de entrega.
 */
import type { ContextoIfood, OrigemToken } from "./ifood-token";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

export type RespostaIfood<T = any> = {
  ok: boolean;
  status: number;
  /** Corpo já convertido quando é JSON; null em 204 e afins. */
  data: T | null;
  /** Corpo cru, para quando a resposta não é JSON. */
  texto: string;
  /** Quantas tentativas foram feitas (1 = acertou de primeira). */
  tentativas: number;
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Erros que vale a pena repetir. 4xx é problema nosso: repetir só piora. */
function deveRepetir(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Quanto esperar antes da próxima tentativa. */
function espera(status: number, headers: Headers, tentativa: number) {
  if (status === 429) {
    const retryAfter = Number(headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 30_000);
  }
  // 400ms, 800ms, 1600ms — com um tanto de aleatório para não sincronizar
  // várias lojas batendo no mesmo instante.
  return Math.min(400 * 2 ** (tentativa - 1), 8_000) + Math.floor(Math.random() * 250);
}

export async function chamarIfood<T = any>(
  token: string,
  path: string,
  init: RequestInit & { tentativasMax?: number } = {},
): Promise<RespostaIfood<T>> {
  // `fetch` não reclama de "Bearer null" — a chamada sai, o iFood devolve 401 e
  // o motivo real (não tinha token) se perde. Melhor falhar aqui, com nome.
  if (typeof token !== "string" || token.length === 0) {
    return {
      ok: false, status: 0, data: null, tentativas: 0,
      texto: "Sem token do iFood para esta chamada.",
    };
  }

  const { tentativasMax = 3, ...opcoes } = init;
  let tentativa = 0;
  let ultima: RespostaIfood<T> | null = null;

  while (tentativa < tentativasMax) {
    tentativa++;
    let res: Response;
    try {
      res = await fetch(`${IFOOD_BASE}${path}`, {
        ...opcoes,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...((opcoes.headers as Record<string, string>) ?? {}),
        },
      });
    } catch (e: any) {
      // Rede caiu no meio: conta como falha repetível.
      ultima = { ok: false, status: 0, data: null, texto: e?.message ?? "falha de rede", tentativas: tentativa };
      if (tentativa < tentativasMax) {
        await dormir(espera(0, new Headers(), tentativa));
        continue;
      }
      return ultima;
    }

    const texto = await res.text().catch(() => "");
    let data: T | null = null;
    if (texto) {
      try { data = JSON.parse(texto) as T; } catch { data = null; }
    }

    ultima = { ok: res.ok, status: res.status, data, texto, tentativas: tentativa };

    if (res.ok || !deveRepetir(res.status) || tentativa >= tentativasMax) return ultima;

    console.warn(`[iFood] ${res.status} em ${path} — tentativa ${tentativa}/${tentativasMax}`);
    await dormir(espera(res.status, res.headers, tentativa));
  }

  return ultima!;
}

/**
 * A mesma chamada, mas percorrendo as credenciais do contexto.
 *
 * Diante de 401 ou 403, troca de credencial e repete. É seguro porque nesses
 * dois casos o iFood recusou antes de fazer qualquer coisa — não há risco de
 * duplicar uma pausa ou um item. Qualquer outro status é resposta final: um 409
 * com o token certo continua sendo 409 com o token errado.
 *
 * `origem` volta junto porque é isso que diz por qual aplicativo a requisição
 * saiu — a informação que a homologação exige que bata com o client_id
 * declarado no chamado.
 */
export async function chamarComContexto<T = any>(
  ctx: ContextoIfood,
  path: string,
  init?: RequestInit,
): Promise<RespostaIfood<T> & { origem: OrigemToken | null }> {
  let ultima: (RespostaIfood<T> & { origem: OrigemToken | null }) | null = null;

  for (let i = 0; i < ctx.credenciais.length; i++) {
    const cred = ctx.credenciais[i];
    const r = await chamarIfood<T>(cred.token, path, init);
    ultima = { ...r, origem: cred.origem };

    const recusou = r.status === 401 || r.status === 403;
    if (!recusou || i === ctx.credenciais.length - 1) return ultima;

    console.warn(
      `[iFood] ${path}: ${r.status} com token "${cred.origem}" — tentando "${ctx.credenciais[i + 1].origem}"`,
    );
  }

  return ultima ?? {
    ok: false, status: 0, data: null, texto: "Nenhuma credencial disponível.",
    tentativas: 0, origem: null,
  };
}

/**
 * Traduz o erro do iFood para uma frase que o lojista entende.
 * Os critérios cobram "mensagens compreensíveis ao usuário, sem falhas silenciosas".
 */
export function mensagemDeErro(r: RespostaIfood): string {
  const detalhe =
    (r.data as any)?.error?.message ||
    (r.data as any)?.message ||
    (Array.isArray((r.data as any)?.details) ? (r.data as any).details[0]?.message : null) ||
    "";

  switch (r.status) {
    case 0:   return "Não foi possível falar com o iFood. Verifique a conexão e tente de novo.";
    case 400: return detalhe ? `O iFood recusou os dados: ${detalhe}` : "O iFood recusou os dados enviados.";
    case 401: return "A autorização do iFood expirou. Reconecte a loja em Integrações.";
    case 403: return "Este aplicativo não tem permissão para esta loja ou para este módulo no iFood.";
    case 404: return "O iFood não encontrou este recurso.";
    case 409: return detalhe || "Já existe um registro em conflito com este.";
    case 422: return detalhe || "O iFood não aceitou este valor.";
    case 429: return "Muitas chamadas seguidas ao iFood. Aguarde alguns segundos.";
    default:
      if (r.status >= 500) return "O iFood está instável no momento. Tente novamente em instantes.";
      return detalhe || `Erro ${r.status} ao falar com o iFood.`;
  }
}
