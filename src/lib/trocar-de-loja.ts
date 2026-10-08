/**
 * /src/lib/trocar-de-loja.ts
 *
 * Multiloja, lado do navegador: pôr a sessão numa loja do grupo, ou em
 * "Todas as Lojas". Usado pelo seletor "Suas Lojas" (StoreSelector) e pela
 * pergunta do /login (components/paineis/EscolhaDeLoja) — a mesma operação
 * nos dois lugares, para a regra não divergir.
 *
 * Trocar de loja troca a CONTA da sessão (lib/auth.ts, `trocarLoja`); "Todas"
 * põe a sessão na PRINCIPAL e marca a visão do grupo no cookie
 * (lib/loja-ativa.ts). O POST em /api/store/switch grava o cookie e a seleção
 * que o Assistente de impressão lê.
 */

export type LojaDoGrupo = {
  id: string;
  storeName: string | null;
  storeOpen: boolean;
  city: string | null;
  isPrimaryStore: boolean;
  ifoodConnected?: boolean;
};

export type GrupoDeLojas = { stores: LojaDoGrupo[]; activeStoreId: string; sessaoLojaId: string };

/** As lojas do acesso de quem está logado (/api/store/list). Nulo = sem sessão de loja. */
export async function buscarLojasDoGrupo(): Promise<GrupoDeLojas | null> {
  try {
    const r = await fetch("/api/store/list", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d?.stores) || d.stores.length === 0) return null;
    return {
      stores: d.stores,
      activeStoreId: d.activeStoreId || d.stores[0].id,
      sessaoLojaId: d.sessaoLojaId || d.activeStoreId || "",
    };
  } catch {
    return null;
  }
}

/** `escolha` = id de uma loja do grupo, ou "all" para Todas as Lojas. */
export async function trocarDeLoja(
  escolha: string,
  lojas: LojaDoGrupo[],
  sessaoLojaId: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const alvo = escolha === "all" ? (lojas.find((s) => s.isPrimaryStore)?.id || lojas[0]?.id) : escolha;
  if (!alvo) return { ok: false, erro: "Loja não encontrada." };
  try {
    if (alvo !== sessaoLojaId) {
      const { signIn } = await import("next-auth/react");
      const r = await signIn("credentials", { trocarLoja: alvo, redirect: false });
      if (!r || r.error || !r.ok) return { ok: false, erro: "Não consegui trocar de loja. Entre de novo e tente outra vez." };
    }
    await fetch("/api/store/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: escolha }),
    });
    return { ok: true };
  } catch {
    return { ok: false, erro: "Sem conexão — a loja não foi trocada." };
  }
}
