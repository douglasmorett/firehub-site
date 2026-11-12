/**
 * O ícone da loja (favicon): a logo do lojista num quadrado PNG.
 *
 * Por que existe: quem busca a loja no Google via a chama do FireHub ao lado do
 * nome (Jerrajê, 31/10 e 11/11/2026 — o jerraje.com.br redireciona para
 * /lojas/jerraje). O Google tira o ícone do `<link rel="icon">` da página, e as
 * páginas da loja herdavam o do FireHub. Agora /loja/[slug] e /lojas/[slug]
 * apontam para cá (generateMetadata → icons).
 *
 * Rota e não `icon.tsx` na pasta da página: o layout raiz declara `icons`, e
 * com isso o Next ignora os ícones de arquivo das rotas filhas
 * (lib/metadata/resolve-metadata.js: só usa os de arquivo quando não há
 * `icons` resolvido).
 *
 * Fundo branco e margem pelo mesmo motivo do opengraph-image: logo de
 * restaurante costuma vir em JPEG com fundo branco chapado.
 * Sem logo (ou logo que o sharp não abre): a chama do FireHub, como antes.
 */
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { baixarImagemDaLoja } from "@/lib/imagem-da-loja";

export const runtime = "nodejs";

/** 192 é múltiplo de 48, como o Google pede para o favicon, e serve de ícone de atalho no celular. */
const LADO = 192;
const MIOLO = 168;

async function quadrado(imagem: Buffer): Promise<Buffer> {
  const dentro = await sharp(imagem).resize({ width: MIOLO, height: MIOLO, fit: "inside" }).toBuffer();
  return sharp({ create: { width: LADO, height: LADO, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: dentro, gravity: "centre" }])
    .png()
    .toBuffer();
}

function png(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let logo: string | null = null;
  try {
    const loja = await prisma.user.findUnique({ where: { slug }, select: { storeLogo: true } });
    logo = loja?.storeLogo ?? null;
  } catch {
    /* banco fora: fica a chama */
  }
  const bytes = logo ? await baixarImagemDaLoja(logo) : null;
  if (bytes) {
    try {
      return png(await quadrado(bytes));
    } catch {
      /* formato que o sharp não abre: fica a chama */
    }
  }
  return png(await quadrado(await readFile(path.join(process.cwd(), "public", "firehub-flame.png"))));
}
