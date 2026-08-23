/**
 * /src/lib/imagem-anuncio.ts
 *
 * Padroniza a imagem que vai virar anúncio.
 *
 * A Meta recusa criativo com imagem muito pequena, e o feed do Facebook e do
 * Instagram é quadrado (1080×1080). Foto de cardápio quase nunca vem assim —
 * vem retangular, às vezes com 300px de largura. Sem passar por aqui, o lojista
 * monta a campanha inteira e ela é reprovada depois, sem ele entender por quê.
 *
 * O enquadramento usa `cover`: preenche o quadrado inteiro e corta o excesso,
 * em vez de deformar o prato ou deixar tarja preta. Para foto de comida, cortar
 * um pouco das bordas é bem menos ruim do que esticar.
 */
import sharp from "sharp";

/** Lado do quadrado do feed. É também o tamanho recomendado pela Meta. */
export const LADO_DO_ANUNCIO = 1080;

/** Menor lado aceitável na origem. Abaixo disso, ampliar só gera borrão. */
const MINIMO_ACEITAVEL = 400;

export async function prepararImagemDeAnuncio(entrada: File): Promise<File> {
  const bruto = Buffer.from(await entrada.arrayBuffer());

  const meta = await sharp(bruto).metadata();
  const largura = meta.width ?? 0;
  const altura = meta.height ?? 0;

  if (largura < MINIMO_ACEITAVEL || altura < MINIMO_ACEITAVEL) {
    throw new Error(
      `Esta imagem é pequena demais para anúncio (${largura}×${altura}). ` +
      `Use uma foto com pelo menos ${MINIMO_ACEITAVEL}×${MINIMO_ACEITAVEL} pixels — ` +
      `ampliar uma foto pequena deixa o anúncio borrado.`
    );
  }

  const saida = await sharp(bruto)
    .resize(LADO_DO_ANUNCIO, LADO_DO_ANUNCIO, { fit: "cover", position: "attention" })
    .jpeg({ quality: 88 })
    .toBuffer();

  // JPEG de propósito: é o que a Meta aceita sem ressalva para criativo, e
  // evita o caso de PNG com transparência virar fundo preto no anúncio.
  return new File([new Uint8Array(saida)], "anuncio.jpg", { type: "image/jpeg" });
}

/** Baixa uma imagem por URL (foto do cardápio) e devolve pronta para anúncio. */
export async function prepararImagemDeUrl(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não consegui baixar a imagem (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tipo = res.headers.get("content-type") || "image/jpeg";
  return prepararImagemDeAnuncio(
    new File([new Uint8Array(buf)], "origem", { type: tipo })
  );
}
