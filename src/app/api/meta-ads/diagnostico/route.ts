/**
 * GET /api/meta-ads/diagnostico
 *
 * Mostra TODAS as contas de anúncio que o token da loja alcança, por qual
 * caminho cada uma apareceu, e qual delas o FireHub escolheria hoje.
 *
 * Existe porque o modo de falha mais caro deste módulo é mudo: a loja conecta,
 * o FireHub grava uma conta que não veicula, e a tela diz "sua conta está
 * desativada" — sem dizer que existe outra conta boa que ele nem enxergou.
 * Aconteceu na conta do dono em 28/08/2026: `/me/adaccounts` devolvia só uma
 * conta encerrada (status 101), enquanto a conta em uso, com histórico de
 * veiculação, estava sob o Business Manager e só aparece pelo caminho de
 * negócios.
 *
 * Nenhum segredo sai daqui: o token nunca é ecoado.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listarTodasAsContasDeAnuncio, escolherMelhorContaDeAnuncios } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

/** Tradução dos códigos que a Meta usa em account_status. */
const SIGNIFICADO: Record<number, string> = {
  1: "ATIVA — veicula",
  2: "DESATIVADA",
  3: "PENDÊNCIA DE PAGAMENTO",
  7: "EM ANÁLISE DE RISCO",
  8: "AGUARDANDO ACERTO",
  9: "PERÍODO DE CARÊNCIA",
  100: "EM ENCERRAMENTO",
  101: "ENCERRADA",
};

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaId = (session?.user as any)?.id as string | undefined;
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { metaFbAccessToken: true, metaAdAccountId: true, metaFbPageId: true, metaAdsEnabled: true },
  });

  if (!loja?.metaFbAccessToken) {
    return NextResponse.json({
      conectado: false,
      diagnostico: "Nenhum token do Facebook salvo — a loja ainda não conectou.",
    });
  }

  const { contas, porCaminho, erros } = await listarTodasAsContasDeAnuncio(loja.metaFbAccessToken);
  const melhor = escolherMelhorContaDeAnuncios(contas);

  return NextResponse.json({
    conectado: true,
    contaSalvaHoje: loja.metaAdAccountId,
    contaQueSeriaEscolhidaAgora: melhor?.id ?? null,
    precisaReconectar: Boolean(melhor?.id && melhor.id !== loja.metaAdAccountId),
    paginaSalva: loja.metaFbPageId,
    totalDeContas: contas.length,
    contas: contas.map((c: any) => ({
      id: c.id,
      nome: c.name,
      status: c.account_status,
      significado: SIGNIFICADO[Number(c.account_status)] ?? `código ${c.account_status}`,
      moeda: c.currency,
      temFormaDePagamento: Boolean(c.funding_source) || Boolean(c.funding_source_details?.id),
      apareceuEm: porCaminho[c.id] ?? "?",
      ehAEscolhida: c.id === melhor?.id,
      ehASalva: c.id === loja.metaAdAccountId,
    })),
    errosDeConsulta: erros,
  });
}
