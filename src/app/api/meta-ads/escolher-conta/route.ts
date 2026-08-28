/**
 * POST /api/meta-ads/escolher-conta
 *
 * Troca a conta de anúncios que o FireHub usa para esta loja.
 *
 * Existe porque escolher sozinho não basta: o lojista pode ter várias contas
 * ATIVAS (a pessoal, a da agência antiga, a do outro negócio) e só ele sabe
 * qual é a que tem o cartão certo e o histórico que ele quer aproveitar. Sem
 * esta troca, o FireHub cravava uma por ranking e o dinheiro do anúncio podia
 * sair da conta errada — o tipo de erro que só aparece na fatura.
 *
 * A conta escolhida é conferida contra a lista REAL que o token alcança: id
 * mandado pelo navegador nunca vira destino de dinheiro sem essa checagem.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  listarTodasAsContasDeAnuncio,
  verificarProntidaoDaConta,
  descobrirPixelDaConta,
} from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { adAccountId } = await req.json().catch(() => ({}));
  if (!adAccountId || typeof adAccountId !== "string") {
    return NextResponse.json({ error: "Informe a conta de anúncios." }, { status: 400 });
  }

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { metaFbAccessToken: true, metaPixelId: true },
  });
  if (!loja?.metaFbAccessToken) {
    return NextResponse.json(
      { error: "Conecte o Facebook antes de escolher a conta de anúncios." },
      { status: 400 }
    );
  }

  // A conta TEM que estar entre as que este token alcança. Sem esta conferência,
  // um id qualquer mandado pelo navegador viraria a conta que gasta o dinheiro.
  const { contas } = await listarTodasAsContasDeAnuncio(loja.metaFbAccessToken);
  const escolhida = contas.find((c: any) => c?.id === adAccountId);
  if (!escolhida) {
    return NextResponse.json(
      { error: "Esta conta de anúncios não pertence à conta do Facebook conectada." },
      { status: 403 }
    );
  }

  // Avisa, mas não impede: a conta pode estar em análise e voltar sozinha, e
  // travar aqui deixaria o lojista sem saída num caso que se resolve em horas.
  const prontidao = await verificarProntidaoDaConta(adAccountId, loja.metaFbAccessToken);

  // O pixel é da conta — trocou de conta, o pixel de antes não vale mais. Só
  // sobrescreve se achar um novo, para não apagar o que o lojista configurou.
  const pixel = await descobrirPixelDaConta(adAccountId, loja.metaFbAccessToken);

  await prisma.user.update({
    where: { id: lojaId },
    data: {
      metaAdAccountId: adAccountId,
      metaAdsEnabled: true,
      ...(pixel?.id ? { metaPixelId: pixel.id } : {}),
    },
  });

  return NextResponse.json({
    success: true,
    adAccountId,
    nome: escolhida.name || adAccountId,
    pronta: prontidao.pronta,
    aviso: prontidao.pronta
      ? undefined
      : "Conta trocada, mas ela ainda não consegue veicular: " +
        (prontidao.motivo === "sem_forma_de_pagamento"
          ? "falta cadastrar forma de pagamento no painel do Facebook."
          : `situação da conta no Facebook (${prontidao.detalhe || prontidao.motivo}).`),
    pixel: pixel?.id ?? null,
  });
}
