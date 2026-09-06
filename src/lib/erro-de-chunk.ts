/**
 * /src/lib/erro-de-chunk.ts
 *
 * "Failed to load chunk /_next/static/chunks/….js" — o erro que aparece para o
 * lojista TODA VEZ que um deploy sai com a aba dele aberta.
 *
 * Por que acontece: o Next divide a tela em pedaços com hash no nome. A aba
 * que já estava aberta guarda o índice do build ANTIGO; o deploy troca os
 * arquivos e os nomes antigos deixam de existir. Aí o primeiro clique que
 * precisa de um pedaço ainda não baixado bate num 404 — confirmado em
 * 05/09/2026: o chunk que a tela de Integrações pediu respondia 404 no
 * servidor, enquanto a rota carregava normalmente numa aba nova.
 *
 * Por que o "Tentar novamente" não resolvia: `reset()` do Next remonta o MESMO
 * componente, que pede o MESMO arquivo inexistente. O lojista clicava, via o
 * mesmo erro, e a única saída era um F5 que ninguém dizia para ele dar.
 *
 * A cura é recarregar a página, que busca o índice novo. Com trava: se
 * recarregar não resolveu (build de verdade quebrado, cache de CDN servindo
 * HTML velho), o segundo erro em menos de 30 s NÃO recarrega — senão a tela
 * entra em laço e o lojista fica preso num piscar de olhos infinito, que é
 * pior que a mensagem de erro.
 */

const CHAVE = "firehub_recarga_por_chunk";
const JANELA_MS = 30_000;

/** O erro é "meu JavaScript sumiu do servidor" e não um bug da aplicação? */
export function ehErroDeChunk(erro: unknown): boolean {
  const e = erro as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === "ChunkLoadError") return true;
  return /failed to load chunk|loading chunk \S+ failed|loading css chunk|dynamically imported module|importing a module script failed/i.test(
    String(e.message || "")
  );
}

/**
 * Recarrega uma vez para pegar o build novo. Devolve `true` quando a recarga
 * foi disparada — quem chama deve mostrar "atualizando" em vez do erro cru.
 */
export function recarregarParaBuildNovo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE) || 0);
    if (ultima && Date.now() - ultima < JANELA_MS) return false;
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // Aba anônima com storage bloqueado: sem trava não dá para arriscar laço.
    return false;
  }
  window.location.reload();
  return true;
}
