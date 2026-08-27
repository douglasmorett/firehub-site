/**
 * GET /uploads/<pasta>/<arquivo>
 * Serve as imagens enviadas pelos lojistas: logo, banner e foto de produto.
 *
 * ─── Por que esta rota existe ──────────────────────────────────────────────
 * O Next só serve `public/` para os arquivos que já estavam lá quando o
 * servidor subiu. Um upload feito com o site no ar é gravado no disco
 * normalmente, mas responde 404 até o próximo restart.
 *
 * Verificado em produção em 23/08/2026: a logo da Brasa Burguer estava em
 * /app/public/uploads/lojas, com 25.940 bytes e permissão de leitura, e o
 * próprio `wget http://127.0.0.1:3000/uploads/...` de dentro do container
 * devolvia 404. Não era proxy, nem Cloudflare, nem permissão. A logo da Pastel
 * da Paulista respondia 200 apenas porque veio dentro da imagem do último
 * deploy — foi por isso que "reenviar depois do deploy" parecia resolver.
 *
 * Aqui o arquivo é lido do disco a cada request, então aparece na hora em que
 * o lojista envia, sem depender de restart.
 */
import { readFile, stat } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { LEGACY_PUBLIC_ROOT, UPLOADS_ROOT } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

/**
 * Resolve o caminho dentro da raiz e recusa qualquer coisa que escape dela.
 * Sem isto, `/uploads/../../etc/passwd` viraria leitura de arquivo do servidor.
 */
function resolverDentroDe(raiz: string, partes: string[]): string | null {
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, ...partes);
  return alvo === base || alvo.startsWith(base + path.sep) ? alvo : null;
}

async function arquivoLegivel(caminho: string): Promise<boolean> {
  try {
    return (await stat(caminho)).isFile();
  } catch {
    return false;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: partes } = await params;
  if (!partes?.length) {
    return NextResponse.json({ error: "Arquivo não informado" }, { status: 404 });
  }

  const ext = path.extname(partes[partes.length - 1]).toLowerCase();
  const tipo = TIPOS[ext];
  if (!tipo) {
    // Só os formatos que o upload aceita. Serve de trava extra caso alguém
    // consiga gravar outra coisa na pasta: aqui nunca vira download executável.
    return NextResponse.json({ error: "Tipo de arquivo não suportado" }, { status: 404 });
  }

  // Raiz nova (volume persistente) primeiro; public/uploads fica como legado,
  // para as imagens que foram enviadas antes desta mudança continuarem no ar.
  for (const raiz of [UPLOADS_ROOT, LEGACY_PUBLIC_ROOT]) {
    const caminho = resolverDentroDe(raiz, partes);
    if (!caminho || !(await arquivoLegivel(caminho))) continue;

    const conteudo = await readFile(caminho);
    return new NextResponse(new Uint8Array(conteudo), {
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(conteudo.length),
        // O nome carrega timestamp + hash aleatório, então nunca é reaproveitado:
        // pode cachear para sempre sem risco de servir imagem velha.
        "Cache-Control": "public, max-age=31536000, immutable",
        // Sem isto, o navegador podia "adivinhar" o tipo real do arquivo e
        // executar como HTML/JS algo enviado como imagem — XSS servido do
        // NOSSO domínio, com acesso à sessão de quem abrisse.
        "X-Content-Type-Options": "nosniff",
        // Arquivo enviado por usuário nunca é renderizado como página: abre
        // como recurso ou baixa, nunca como documento com scripts.
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  }

  return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
}
