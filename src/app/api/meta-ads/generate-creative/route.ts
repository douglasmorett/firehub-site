/**
 * POST /api/meta-ads/generate-creative
 * Gera texto de anúncio otimizado usando IA (Gemini) e monta a grade de fotos
 * do cardápio que o lojista pode escolher como criativo.
 *
 * ── DUAS COISAS QUE ESTAVAM ERRADAS AQUI ────────────────────────────────────
 *
 * 1. A IA falhava em silêncio. Qualquer tropeço — chave ausente, cota, 4xx,
 *    JSON malformado, resposta truncada — caía no mesmo catch mudo e a rota
 *    respondia 200 com o texto de reserva. Como o corpo não dizia se a IA tinha
 *    rodado, a tela seguia afirmando "a IA já sugeriu um texto otimizado para
 *    você". O lojista publicava um template achando que era peça feita para a
 *    loja dele, e pagava mídia por isso. Agora a resposta traz `geradoPorIA`.
 *
 * 2. A grade oferecia fotos que a Meta não aceita. Esta é a aba PADRÃO da tela,
 *    e a foto escolhida ia crua para o `/adimages` — sem checagem de tamanho
 *    nenhuma, ao contrário das abas de upload e de IA. Foto de cardápio
 *    importada de CSV ou de marketplace costuma vir com 300–350 px, abaixo do
 *    mínimo que o próprio módulo define (lib/imagem-anuncio.ts). O lojista
 *    montava a campanha inteira e só descobria no Publicar, com o erro cru da
 *    Meta. Agora a foto pequena demais nem aparece para ser escolhida.
 */
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { segredoOpcional } from "@/lib/segredos";
import { LEGACY_PUBLIC_ROOT, UPLOADS_ROOT } from "@/lib/storage";

/**
 * Espelha MINIMO_ACEITAVEL de lib/imagem-anuncio.ts, que não é exportado.
 * Abaixo disso a Meta recusa (ou o anúncio sai borrado, que é pior: gasta).
 */
const MINIMO_ACEITAVEL = 400;

/** Quantas fotos são medidas antes de a grade ser cortada em 6. */
const CANDIDATAS_A_MEDIR = 12;

/**
 * Dimensões reais de uma imagem que está no nosso disco.
 *
 * Só mede o que é `/uploads/...`: buscar por HTTP uma URL vinda do banco seria
 * abrir o servidor para requisição a endereço arbitrário (o `imageUrl` chega
 * de importação de CSV, sem validação). URL que não dá para medir volta null e
 * a foto continua na grade — descartar o que não se conseguiu conferir tiraria
 * do lojista a única foto que ele tem.
 */
async function medirImagemLocal(imageUrl: string): Promise<{ largura: number; altura: number } | null> {
  if (!imageUrl.startsWith("/uploads/")) return null;

  const partes = imageUrl.slice("/uploads/".length).split("/").filter(Boolean);
  if (!partes.length) return null;

  for (const raiz of [UPLOADS_ROOT, LEGACY_PUBLIC_ROOT]) {
    const base = path.resolve(raiz);
    const alvo = path.resolve(base, ...partes);
    // O caminho vem do banco; sem esta trava um `..` gravado no imageUrl viraria
    // leitura de arquivo do servidor.
    if (alvo !== base && !alvo.startsWith(base + path.sep)) continue;

    try {
      const meta = await sharp(alvo).metadata();
      if (meta.width && meta.height) return { largura: meta.width, altura: meta.height };
    } catch {
      // Arquivo sumiu do disco ou não é imagem legível: tenta a outra raiz.
    }
  }

  return null;
}

/**
 * Extrai o JSON da resposta do modelo.
 *
 * O `JSON.parse` direto quebrava com qualquer sujeira em volta — cerca de
 * markdown, uma frase antes do objeto — e a falha virava a copy de reserva sem
 * ninguém saber. O conteúdo útil quase sempre está lá; é só recortar.
 */
function extrairJson(texto: string): any | null {
  const limpo = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  const user = await prisma.user.findUnique({ where: { id: franchiseeId } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Buscar produtos do cardápio e ordenar
  const allProducts = await (prisma as any).menuProduct.findMany({
    where: { franchiseeId, active: true },
    select: { name: true, price: true, category: true, imageUrl: true },
  });

  allProducts.sort((a: any, b: any) => {
    if (a.imageUrl && !b.imageUrl) return -1;
    if (!a.imageUrl && b.imageUrl) return 1;
    return (b.price || 0) - (a.price || 0);
  });

  const products = allProducts.slice(0, 6);

  const storeName = user.storeName ?? user.name ?? "Restaurante";
  const city = user.city ?? "";
  const productNames = products.map((p: any) => `${p.name} (R$${p.price})`).join(", ");

  // Gerar copy com Gemini.
  // A chave da loja tem prioridade sobre a global — é a mesma regra do chatbot
  // e da geração de imagem (lib/imagem-ia.ts). Ler só `process.env` deixava a
  // loja que paga a própria chave caindo no texto de reserva à toa.
  const apiKey =
    ((user.chatbotConfig as any)?.geminiApiKey as string | undefined)?.trim() ||
    segredoOpcional("GEMINI_API_KEY");

  let adCopy = `🍔 Peça agora em ${storeName}! Entrega rápida na sua região. Clique e aproveite!`;
  let adDescription = `Delivery ${storeName}${city ? ` em ${city}` : ""}. Cardápio completo com os melhores preços. Peça pelo nosso site!`;
  let geradoPorIA = false;

  if (apiKey) {
    try {
      const prompt = `Você é um copywriter especialista em anúncios de delivery de comida para Facebook/Instagram.

Gere um texto de anúncio focado em delivery local para o restaurante "${storeName}"${city ? ` em ${city}` : ""}.
Produtos em destaque: ${productNames || "diversos pratos deliciosos"}

Regras estritas:
- Mencione o nome do restaurante ("${storeName}").
- Destaque que é delivery com entrega rápida na região.
- Crie um senso de urgência (ex: "Bateu a fome?", "Não perca tempo", "Peça agora").
- Use emojis estrategicamente, sem excessos.
- Texto principal (adCopy): curto e impactante, no máximo 3 linhas.
- Descrição (adDescription): super curta, no máximo 1 linha para a área de botão/CTA.

Responda EXATAMENTE neste formato JSON (sem markdown, apenas o JSON puro):
{"adCopy": "texto principal aqui", "adDescription": "descrição curta aqui"}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              // Eram 300 tokens, e o gemini-2.5-flash raciocina por padrão
              // DESCONTANDO o raciocínio deste mesmo teto: o modelo gastava a
              // cota pensando e devolvia `finishReason: MAX_TOKENS` com `parts`
              // vazio — que é exatamente o caminho para a copy de reserva.
              // Escrever três linhas de anúncio não precisa de raciocínio.
              maxOutputTokens: 800,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          // Sem prazo, uma chamada pendurada trava o passo do criativo inteiro:
          // a tela dispara esta rota sozinha ao abrir e fica no "carregando".
          signal: AbortSignal.timeout(20_000),
        }
      );

      if (!res.ok) {
        const corpo = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} — ${corpo.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) {
        throw new Error(`resposta sem texto (finishReason ${data?.candidates?.[0]?.finishReason ?? "?"})`);
      }

      const parsed = extrairJson(text);
      if (!parsed?.adCopy) throw new Error("o modelo não devolveu adCopy");

      adCopy = String(parsed.adCopy);
      if (parsed.adDescription) adDescription = String(parsed.adDescription);
      geradoPorIA = true;
    } catch (err: any) {
      // O texto de reserva continua valendo — o lojista não fica sem anúncio.
      // Mas o log passa a dizer POR QUE falhou, e a resposta avisa a tela.
      console.error(
        `[MetaAds] copy da IA falhou (loja ${franchiseeId}): ${err?.message ?? err}`
      );
    }
  } else {
    console.warn(`[MetaAds] sem chave do Gemini: copy padrão para a loja ${franchiseeId}.`);
  }

  // ── Grade de fotos do cardápio ────────────────────────────────────────────
  // Mede mais candidatas do que cabe na grade para ainda sobrarem seis boas
  // depois de descartar as pequenas demais.
  const candidatas = allProducts.filter((p: any) => p.imageUrl).slice(0, CANDIDATAS_A_MEDIR);
  const medidas = await Promise.all(
    candidatas.map((p: any) => medirImagemLocal(String(p.imageUrl)))
  );

  const productImages: any[] = [];
  let fotosPequenas = 0;

  candidatas.forEach((p: any, i: number) => {
    const m = medidas[i];
    if (m && (m.largura < MINIMO_ACEITAVEL || m.altura < MINIMO_ACEITAVEL)) {
      fotosPequenas++;
      return;
    }
    if (productImages.length >= 6) return;
    productImages.push({
      name: p.name,
      imageUrl: p.imageUrl,
      price: p.price,
      largura: m?.largura ?? null,
      altura: m?.altura ?? null,
    });
  });

  return NextResponse.json({
    adCopy,
    adDescription,
    storeName,
    productImages,
    // `geradoPorIA: false` significa texto de reserva. A tela não pode dizer
    // que a IA personalizou quando ela não rodou.
    geradoPorIA,
    avisoCopy: geradoPorIA
      ? undefined
      : "Este é um texto padrão, não uma sugestão feita pela IA. Vale a pena editar antes de publicar.",
    fotosPequenas,
    // Só avisa quando o descarte de fato encurtou a escolha do lojista —
    // grade cheia com foto pequena sobrando é ruído, não informação.
    avisoImagens:
      fotosPequenas > 0 && productImages.length < 6
        ? `${fotosPequenas} foto(s) do seu cardápio são pequenas demais para anúncio ` +
          `(o mínimo é ${MINIMO_ACEITAVEL}×${MINIMO_ACEITAVEL} pixels) e não aparecem aqui. ` +
          `Envie uma foto do celular ou gere uma com IA.`
        : undefined,
  });
}
