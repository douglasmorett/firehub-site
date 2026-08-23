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
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { saveUploadedFile } from "@/lib/storage";
import { prepararImagemDeAnuncio } from "@/lib/imagem-anuncio";

export const dynamic = "force-dynamic";

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

    const quadrada = await prepararImagemDeAnuncio(arquivo);
    const salvo = await saveUploadedFile(quadrada, `meta-ads/${lojaId}`);

    return NextResponse.json({ url: salvo.url, tamanho: salvo.size });
  } catch (err: any) {
    console.error("[MetaAds imagem]", err);
    return NextResponse.json(
      { error: err?.message || "Não foi possível processar a imagem." },
      { status: 400 }
    );
  }
}
