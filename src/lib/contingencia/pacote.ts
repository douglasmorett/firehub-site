/**
 * O PACOTE do computador da loja (Modo Contingência): os arquivos do PRÓPRIO
 * deploy que está no ar — o FireHub (server.js, .next, node_modules) e o
 * supervisor —, listados por hash e ASSINADOS no build
 * (scripts/contingencia/assinar-pacote.mjs, com a chave que só existe no
 * segredo do GitHub).
 *
 * Esta lib só serve o que o build gerou: `contingencia/pacote.json` (a lista,
 * exatamente os bytes assinados) e `contingencia/pacote.assinatura`. O
 * Assistente confere a assinatura com a chave pública embutida nele antes de
 * baixar qualquer arquivo, e o sha256 de cada arquivo depois. Lista sem
 * assinatura (build sem o segredo) não é aceita por nenhum Assistente.
 *
 * Servir o pacote daqui garante que o computador roda exatamente a versão da
 * nuvem: a cópia, a subida e as telas falam a mesma língua.
 */
import fs from "node:fs";
import path from "node:path";

export type ArquivoDoPacote = { caminho: string; hash: string; tamanho: number };
export type PacoteAssinado = { conteudo: string; assinatura: string | null };

const RAIZ = process.cwd();

let emCache: { assinado: PacoteAssinado; porHash: Map<string, string> } | null | undefined;

/** O pacote desta versão, como o build gerou; `null` se esta imagem não tem pacote. */
export function pacoteDaVersao(): { assinado: PacoteAssinado; porHash: Map<string, string> } | null {
  if (emCache !== undefined) return emCache;
  try {
    const conteudo = fs.readFileSync(path.join(/*turbopackIgnore: true*/ RAIZ, "contingencia", "pacote.json"), "utf8");
    let assinatura: string | null = null;
    try {
      assinatura = fs.readFileSync(path.join(/*turbopackIgnore: true*/ RAIZ, "contingencia", "pacote.assinatura"), "utf8").trim() || null;
    } catch {
      /* build sem o segredo */
    }
    const lista = JSON.parse(conteudo) as { arquivos: ArquivoDoPacote[] };
    const porHash = new Map<string, string>();
    for (const a of lista.arquivos || []) {
      if (!/^[0-9a-f]{64}$/.test(a.hash) || porHash.has(a.hash)) continue;
      const cheio = path.resolve(/*turbopackIgnore: true*/ RAIZ, a.caminho);
      if (cheio.startsWith(path.resolve(/*turbopackIgnore: true*/ RAIZ) + path.sep)) porHash.set(a.hash, cheio);
    }
    emCache = { assinado: { conteudo, assinatura }, porHash };
  } catch {
    emCache = null;
  }
  return emCache;
}
