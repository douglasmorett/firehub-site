/**
 * GET /api/meta-ads/status
 *
 * Diz, em uma chamada, se a loja consegue anunciar AGORA — e, se não consegue,
 * exatamente o que falta e onde resolver.
 *
 * Existe porque o passo que mais trava é invisível: a conta de anúncios pode
 * estar conectada, com token válido, e mesmo assim não veicular por não ter
 * forma de pagamento. Foi o caso da própria conta do dono quando isto foi
 * escrito (fundos R$ 0,00, nenhum cartão). Sem este aviso, o lojista monta o
 * criativo inteiro, publica, e o anúncio simplesmente não roda.
 *
 * Adicionar cartão ou saldo NÃO é possível pela API — a Meta só permite pela
 * interface do Ads Manager. Por isso a resposta traz `linkParaResolver`: o
 * lojista vai lá UMA vez e volta.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  verificarProntidaoDaConta,
  linkDeCobrancaDoMeta,
  linkDeRecargaDoMeta,
  lerCarteiraDaConta,
} from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

const EXPLICACAO: Record<string, string> = {
  sem_forma_de_pagamento:
    "Sua conta de anúncios ainda não tem forma de pagamento. O Facebook exige que o cartão " +
    "seja cadastrado no painel deles — é rápido, e só precisa ser feito uma vez.",
  conta_desativada:
    "Sua conta de anúncios está desativada no Facebook. Isso costuma ser cobrança pendente " +
    "ou revisão de política. Resolva no painel do Facebook para voltar a anunciar.",
  conta_nao_encontrada:
    "Não conseguimos acessar sua conta de anúncios. Reconecte o Facebook para renovar a permissão.",
  erro: "Não conseguimos falar com o Facebook agora. Tente de novo em alguns instantes.",
};

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: {
      metaFbAccessToken: true,
      metaAdAccountId: true,
      metaFbPageId: true,
      metaAdsEnabled: true,
    },
  });

  if (!loja?.metaFbAccessToken || !loja.metaAdAccountId) {
    return NextResponse.json({
      conectado: false,
      pronto: false,
      proximoPasso: "conectar_facebook",
      mensagem: "Conecte sua conta do Facebook para começar a anunciar.",
    });
  }

  const prontidao = await verificarProntidaoDaConta(loja.metaAdAccountId, loja.metaFbAccessToken);

  if (!prontidao.pronta) {
    return NextResponse.json({
      conectado: true,
      pronto: false,
      proximoPasso: prontidao.motivo,
      mensagem: EXPLICACAO[prontidao.motivo || "erro"] ?? EXPLICACAO.erro,
      linkParaResolver: linkDeCobrancaDoMeta(loja.metaAdAccountId),
      detalheTecnico: prontidao.detalhe,
      moeda: prontidao.moeda,
    });
  }

  // Página do Facebook é obrigatória para o criativo: o anúncio é publicado
  // "por" uma página. Sem ela a criação do criativo falha.
  if (!loja.metaFbPageId) {
    return NextResponse.json({
      conectado: true,
      pronto: false,
      proximoPasso: "sem_pagina",
      mensagem:
        "Sua conta não tem uma Página do Facebook vinculada. O anúncio precisa ser publicado " +
        "por uma Página — crie uma para o seu restaurante e reconecte.",
      moeda: prontidao.moeda,
    });
  }

  // Carteira: o lojista vê crédito e gasto sem sair do FireHub.
  // Recarregar continua sendo no painel do Meta (não há API), por isso vai
  // junto o link — e o aviso de que com CARTÃO ele nunca mais precisa voltar lá.
  const carteira = await lerCarteiraDaConta(loja.metaAdAccountId, loja.metaFbAccessToken);

  const precisaRecarregar =
    carteira != null &&
    !carteira.cobrancaAutomatica &&
    carteira.saldoDisponivel != null &&
    carteira.saldoDisponivel <= 0;

  return NextResponse.json({
    conectado: true,
    pronto: !precisaRecarregar,
    proximoPasso: precisaRecarregar ? "sem_saldo" : undefined,
    mensagem: precisaRecarregar
      ? "Sua conta está no modo saldo pré-pago e está zerada — os anúncios não vão rodar. " +
        "Adicione saldo, ou cadastre um cartão para o Facebook cobrar automaticamente e você " +
        "não precisar recarregar nunca mais."
      : "Tudo certo. Sua conta está pronta para veicular anúncios.",
    moeda: prontidao.moeda,
    carteira,
    linkParaRecarregar: linkDeRecargaDoMeta(loja.metaAdAccountId),
  });
}
