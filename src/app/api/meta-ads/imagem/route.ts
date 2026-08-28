/**
 * POST /api/meta-ads/imagem
 * Recebe a imagem que o lojista enviou e devolve uma URL pública para o anúncio.
 *
 * ── POR QUE ISTO PRECISA EXISTIR ────────────────────────────────────────────
 * A tela transformava o arquivo em data URI (`FileReader.readAsDataURL`) e
 * mandava isso como `adImageUrl`. Só que a Meta BAIXA a imagem para criar o
 * criativo (`POST /act_X/adimages` com `url`) — e `data:image/jpeg;base64,...`
 * não é endereço que ela consiga buscar. O upload nunca funcionaria; o anúncio
 * sairia sem imagem ou a criação falharia.
 *
 * Aqui o arquivo é gravado no storage do FireHub e devolvido como URL http
 * de verdade, que a Meta alcança.
 *
 * A imagem também é padronizada em 1080×1080: é o formato de feed do
 * Facebook/Instagram, e a Meta recusa imagem abaixo do mínimo. Foto de cardápio
 * costuma vir pequena ou em proporção esquisita, e o lojista não tem como saber
 * disso antes de a campanha ser recusada.
 *
 * ── POR QUE A GRAVAÇÃO É FEITA AQUI, E NÃO POR saveUploadedFile ─────────────
 * Porque a padronização acima era desfeita na linha seguinte. `saveUploadedFile`
 * chama `otimizarImagem` (lib/storage.ts), feita para foto de cardápio:
 * `.resize(900,900).webp({quality:82})`, e ela fica com o resultado sempre que
 * ele for menor — e um WebP q82 de 900² é SEMPRE menor que um JPEG q88 de
 * 1080². Ou seja: o módulo prometia 1080×1080 JPEG no comentário e entregava
 * 900×900 WebP na Meta, num endpoint cuja documentação recomenda JPG/PNG e
 * 1080 de lado. Promessa que o código não cumpre é pior que promessa nenhuma:
 * ninguém vai procurar o defeito no lugar que "já está resolvido".
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { UPLOADS_ROOT } from "@/lib/storage";
import { prepararImagemDeAnuncio } from "@/lib/imagem-anuncio";

export const dynamic = "force-dynamic";

/**
 * Teto de entrada. Existe explicitamente porque `saveUploadedFile` saiu do
 * caminho e ele era quem barrava arquivo gigante — sem isto, um envio de 60 MB
 * iria inteiro para o sharp e derrubaria a memória do container.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Grava os bytes já preparados e devolve a URL pública.
 *
 * Segurança preservada mesmo sem a conferência de magic number do storage: o
 * que se grava aqui NÃO é o arquivo do lojista, é a saída do encoder JPEG do
 * sharp. Um .html renomeado para .png não chega até aqui — o sharp recusa
 * antes, em `prepararImagemDeAnuncio`.
 *
 * A pasta é `marketing/<loja>` porque a intenção original (`meta-ads/<loja>`)
 * nunca funcionou: `sanitizeFolder` só aceita a lista fechada de lib/storage.ts
 * e devolve "produtos" calado para qualquer outra coisa — todo criativo de
 * anúncio ia parar misturado com as fotos de cardápio de todas as lojas.
 */
async function gravarCriativo(bytes: Buffer, lojaId: string): Promise<string> {
  const loja = lojaId.replace(/[^a-zA-Z0-9_-]/g, "") || "sem-loja";
  const nome = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-anuncio.jpg`;
  const destino = path.join(UPLOADS_ROOT, "marketing", loja);

  await mkdir(destino, { recursive: true });
  await writeFile(path.join(destino, nome), bytes);

  return `/uploads/marketing/${loja}/${nome}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const form = await req.formData();
    const arquivo = form.get("imagem");
    if (!(arquivo instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo de imagem." }, { status: 400 });
    }
    if (arquivo.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            `Esta imagem tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB e o limite é 8 MB. ` +
            `Tire uma foto em qualidade menor ou use uma foto do seu cardápio.`,
        },
        { status: 400 }
      );
    }

    const quadrada = await prepararImagemDeAnuncio(arquivo);
    const bytes = Buffer.from(await quadrada.arrayBuffer());
    const url = await gravarCriativo(bytes, lojaId);

    return NextResponse.json({ url, tamanho: bytes.length });
  } catch (err: any) {
    console.error("[MetaAds imagem]", err);
    return NextResponse.json(
      { error: err?.message || "Não foi possível processar a imagem." },
      { status: 400 }
    );
  }
}
