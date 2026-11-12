/**
 * Os bytes de uma imagem da loja (logo, banner), venha ela de onde vier.
 * Usado pela prévia do link (app/loja/[slug]/opengraph-image.tsx) e pelo
 * ícone da loja (app/api/icone-da-loja/[slug]).
 *
 * Logo enviada pelo painel é um caminho `/uploads/...`, servido por uma rota
 * que lê do disco (app/uploads/[...path]) — aqui o disco é lido direto, sem dar
 * a volta pela rede. Loja antiga ainda pode ter URL absoluta do tempo do Vercel
 * Blob; essa vem por fetch.
 */
import { readFile } from "fs/promises";
import path from "path";
import { LEGACY_PUBLIC_ROOT, trazerDoBucket, UPLOADS_ROOT } from "@/lib/storage";

export async function baixarImagemDaLoja(url: string): Promise<Buffer | null> {
  try {
    if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
    // Só o que está sob /uploads, e sem "..": esta função recebe valor do banco,
    // e um caminho torto viraria leitura de arquivo do servidor.
    const relativo = url.replace(/^\/+uploads\/+/, "");
    if (!url.startsWith("/uploads/") || relativo.split("/").some((p) => p === "..")) return null;
    for (const raiz of [UPLOADS_ROOT, LEGACY_PUBLIC_ROOT]) {
      const base = path.resolve(raiz);
      const alvo = path.resolve(base, relativo);
      if (alvo !== base && !alvo.startsWith(base + path.sep)) continue;
      try {
        return await readFile(alvo);
      } catch {
        /* tenta a próxima raiz */
      }
    }
    // Logo enviada pela outra instância (duas atrás do balanceador): do bucket.
    const trazido = await trazerDoBucket(relativo);
    return trazido ? await readFile(trazido) : null;
  } catch {
    return null;
  }
}

/**
 * O `icons` do metadata das páginas da loja (/loja/[slug], /lojas/[slug]):
 * a logo do lojista servida por app/api/icone-da-loja/[slug].
 */
export function iconesDaLoja(slug: string) {
  const url = `/api/icone-da-loja/${encodeURIComponent(slug)}`;
  return { icon: [{ url, type: "image/png", sizes: "192x192" }], apple: [{ url, sizes: "192x192" }] };
}
