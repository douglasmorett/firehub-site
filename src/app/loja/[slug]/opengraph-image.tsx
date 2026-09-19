/**
 * A imagem que aparece quando alguém manda o link da loja no WhatsApp.
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────────
 *
 * Mandar `firehubfood.com.br/loja/<slug>` no WhatsApp mostrava a chama do
 * FireHub e o texto "FireHub — Tudo que o seu restaurante precisa em um só
 * lugar". A página da loja declarava só `title` e `description`; sem `openGraph`
 * próprio, o Next herda o do layout raiz — que é a propaganda do FireHub. E como
 * não havia `og:image` em lugar nenhum, o WhatsApp caía no ícone do site.
 *
 * Ou seja: o lojista divulgava o cardápio DELE e quem aparecia era o nosso
 * anúncio. Queixa do dono em 18/09/2026.
 *
 * ── POR QUE CONVERTER A IMAGEM ──────────────────────────────────────────────
 *
 * A logo do lojista é gravada em WebP (lib/storage.ts), e o WhatsApp não
 * desenha WebP na prévia de link — apontar `og:image` direto para o arquivo
 * daria prévia sem imagem, que é o mesmo problema com outra cara. Aqui o sharp
 * devolve JPEG, que todo cliente entende.
 *
 * A convenção de arquivo do Next (opengraph-image) tem prioridade sobre o
 * `openGraph` do metadata e já injeta `og:image` com URL absoluta, tipo e
 * dimensões. O retorno pode ser qualquer Response — não precisa ser
 * `ImageResponse`, e é por isso que dá para entregar o buffer do sharp.
 */
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { LEGACY_PUBLIC_ROOT, UPLOADS_ROOT } from "@/lib/storage";

export const runtime = "nodejs";
/** A logo muda raramente; o WhatsApp cacheia a prévia por muito mais que isso. */
export const revalidate = 3600;

/** 1200x630 é a proporção que o WhatsApp, o Facebook e o iMessage esperam. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";
export const alt = "Cardápio online";

/**
 * Fundo BRANCO, e isto não é escolha de gosto: quase toda logo de restaurante
 * vem em JPEG com fundo branco chapado. Sobre qualquer outra cor, esse fundo
 * aparece como um retângulo branco no meio do card — testado com a logo da R&D
 * Pizzaria sobre cinza-claro. Em branco ele some, e logo com transparência
 * também fica bem.
 */
const FUNDO = { r: 255, g: 255, b: 255 };
/** A logo ocupa quase o card inteiro, com margem para não encostar nas bordas. */
const MIOLO = { width: 1000, height: 540 };

/**
 * Os bytes da imagem, venha ela de onde vier.
 *
 * Logo enviada pelo painel é um caminho `/uploads/...`, servido por uma rota
 * que lê do disco (app/uploads/[...path]) — aqui o disco é lido direto, sem dar
 * a volta pela rede. Loja antiga ainda pode ter URL absoluta do tempo do Vercel
 * Blob; essa vem por fetch.
 */
async function baixar(url: string): Promise<Buffer | null> {
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
    return null;
  } catch {
    return null;
  }
}

/** O card com a logo centralizada. */
async function cardComLogo(logo: Buffer): Promise<Buffer> {
  const dentro = await sharp(logo)
    .resize({ ...MIOLO, fit: "inside", withoutEnlargement: false })
    .toBuffer();
  return sharp({ create: { ...size, channels: 3, background: FUNDO } })
    .composite([{ input: dentro, gravity: "centre" }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let loja: { storeLogo: string | null; storeBanner: string | null } | null = null;
  try {
    loja = await prisma.user.findUnique({
      where: { slug },
      select: { storeLogo: true, storeBanner: true },
    });
  } catch {
    /* banco fora: cai no fallback abaixo, a prévia nunca quebra */
  }

  // A LOGO primeiro: é a marca que o lojista divulga. O banner entra só como
  // segunda opção — ele é foto de fachada ou de prato, e nem toda loja tem.
  const logo = loja?.storeLogo ? await baixar(loja.storeLogo) : null;
  if (logo) {
    try {
      return new Response(new Uint8Array(await cardComLogo(logo)), {
        headers: { "Content-Type": contentType },
      });
    } catch {
      /* arquivo corrompido ou formato que o sharp não abre: segue para o banner */
    }
  }

  const banner = loja?.storeBanner ? await baixar(loja.storeBanner) : null;
  if (banner) {
    try {
      // Banner é imagem larga: preenche o card inteiro, sem tarja.
      const cheio = await sharp(banner)
        .resize({ ...size, fit: "cover", position: "centre" })
        .jpeg({ quality: 85 })
        .toBuffer();
      return new Response(new Uint8Array(cheio), { headers: { "Content-Type": contentType } });
    } catch {
      /* idem: cai no fallback */
    }
  }

  // Loja sem logo e sem banner fica com a chama do FireHub — o mesmo que
  // aparecia antes desta mudança, agora em JPEG e no tamanho certo.
  try {
    const chama = await readFile(path.join(process.cwd(), "public", "firehub-flame.png"));
    return new Response(new Uint8Array(await cardComLogo(chama)), {
      headers: { "Content-Type": contentType },
    });
  } catch {
    const liso = await sharp({ create: { ...size, channels: 3, background: FUNDO } })
      .jpeg({ quality: 85 })
      .toBuffer();
    return new Response(new Uint8Array(liso), { headers: { "Content-Type": contentType } });
  }
}
