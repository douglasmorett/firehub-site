/**
 * POST /api/meta-ads/gerar-imagem   { descricao }
 * GET  /api/meta-ads/gerar-imagem   → quanto resta da cota
 *
 * Gera imagem de anúncio com IA, respeitando a cota semanal do pacote.
 *
 * A cota existe por conta simples: cada imagem custa ~R$ 0,21 e o pacote é de
 * R$ 50/semana. Dez gerações custam ~R$ 2,10 (4% da receita). Sem teto, um
 * lojista indeciso clicando "gerar outra" cem vezes levaria ~R$ 21 — quase
 * metade da margem daquele cliente, e o botão convida exatamente a isso.
 *
 * A contagem é debitada só quando a imagem SAI. Falha de rede, recusa por
 * política ou chave ausente não consomem cota — cobrar por tentativa frustrada
 * é o tipo de coisa que faz o lojista desconfiar do produto.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveDataUrl } from "@/lib/storage";
import {
  gerarImagemDeAnuncio,
  semanaDeReferencia,
  COTA_SEMANAL_DE_IMAGENS,
} from "@/lib/imagem-ia";

export const dynamic = "force-dynamic";

type Loja = {
  id: string;
  storeName: string | null;
  chatbotConfig: any;
  metaIaGeracoesUsadas: number;
  metaIaSemanaReferencia: string | null;
};

/** Usos desta semana. Semana nova zera o contador. */
function usadasNestaSemana(loja: Loja, semana: string): number {
  return loja.metaIaSemanaReferencia === semana ? loja.metaIaGeracoesUsadas : 0;
}

async function carregarLoja(lojaId: string): Promise<Loja | null> {
  return prisma.user.findUnique({
    where: { id: lojaId },
    select: {
      id: true,
      storeName: true,
      chatbotConfig: true,
      metaIaGeracoesUsadas: true,
      metaIaSemanaReferencia: true,
    },
  }) as Promise<Loja | null>;
}

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const loja = await carregarLoja(lojaId);
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const semana = semanaDeReferencia();
  const usadas = usadasNestaSemana(loja, semana);

  return NextResponse.json({
    cotaSemanal: COTA_SEMANAL_DE_IMAGENS,
    usadas,
    restantes: Math.max(0, COTA_SEMANAL_DE_IMAGENS - usadas),
    semana,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const loja = await carregarLoja(lojaId);
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const semana = semanaDeReferencia();
  const usadas = usadasNestaSemana(loja, semana);

  if (usadas >= COTA_SEMANAL_DE_IMAGENS) {
    return NextResponse.json(
      {
        error: "cota_esgotada",
        mensagem:
          `Você já usou as ${COTA_SEMANAL_DE_IMAGENS} imagens desta semana. ` +
          `A cota volta na segunda-feira. Enquanto isso, use uma foto do seu cardápio ` +
          `ou envie uma imagem sua — essas não têm limite.`,
        cotaSemanal: COTA_SEMANAL_DE_IMAGENS,
        usadas,
        restantes: 0,
      },
      { status: 429 }
    );
  }

  const { descricao } = await req.json().catch(() => ({ descricao: "" }));
  const texto = String(descricao || "").trim().slice(0, 300);
  if (!texto) {
    return NextResponse.json(
      { error: "Descreva o que você quer na imagem (ex.: hambúrguer artesanal com fritas)." },
      { status: 400 }
    );
  }

  const chaveDaLoja = (loja.chatbotConfig as any)?.geminiApiKey ?? null;
  const gerado = await gerarImagemDeAnuncio(texto, loja.storeName || "Restaurante", chaveDaLoja);

  if (!gerado.ok) {
    const mensagens: Record<string, string> = {
      sem_chave: "A geração por IA não está configurada. Use uma foto do cardápio ou envie a sua.",
      recusado: "A IA não conseguiu criar esta imagem. Tente descrever de outro jeito.",
      erro: "Não consegui gerar a imagem agora. Tente novamente em instantes.",
    };
    console.warn(`[MetaAds IA] falha (${gerado.motivo}) loja ${lojaId}: ${gerado.detalhe ?? ""}`);
    // Não debita cota: tentativa frustrada não consome o pacote do lojista.
    return NextResponse.json({ error: gerado.motivo, mensagem: mensagens[gerado.motivo] }, { status: 502 });
  }

  const salvo = await saveDataUrl(gerado.imagem.dataUri, `meta-ads/${lojaId}`);

  // Débito só depois de a imagem existir de verdade.
  const atualizado = await prisma.user.update({
    where: { id: lojaId },
    data: {
      metaIaGeracoesUsadas: usadas + 1,
      metaIaSemanaReferencia: semana,
    },
    select: { metaIaGeracoesUsadas: true },
  });

  return NextResponse.json({
    url: salvo.url,
    cotaSemanal: COTA_SEMANAL_DE_IMAGENS,
    usadas: atualizado.metaIaGeracoesUsadas,
    restantes: Math.max(0, COTA_SEMANAL_DE_IMAGENS - atualizado.metaIaGeracoesUsadas),
  });
}
