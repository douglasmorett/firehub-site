/**
 * GET /api/store/indique-e-ganhe
 * O cartão "Indique e ganhe" da aba Mensalidade: o link da conta, o saldo de
 * créditos, o progresso para a isenção e a lista das lojas indicadas.
 *
 * A loja sai de lib/financeiro/contexto.ts, a mesma da aba Mensalidade (o
 * funcionário com acesso ao Financeiro vê o programa da loja, não o dele).
 * Filial mostra o programa da CONTA: o link, o crédito e a isenção moram na
 * loja principal (lib/indique-e-ganhe.ts, "a conta é a unidade").
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";
import {
  contaDaLoja,
  INDICADOS_PARA_ISENCAO,
  linkDeIndicacao,
  mensagemDeWhatsApp,
  VALOR_DO_CREDITO,
} from "@/lib/indique-e-ganhe";
import { indicacoesParaATela, indiqueEGanheDaLoja } from "@/lib/indique-e-ganhe-no-banco";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });

  const loja = await prisma.user.findUnique({ where: { id: r.valor.donoId }, select: { id: true, accountGroupId: true } });
  if (!loja) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  const principal = await prisma.user.findUnique({
    where: { id: contaDaLoja(loja) },
    select: { id: true, slug: true, storeName: true },
  });
  if (!principal) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  const [resumo, indicacoes] = await Promise.all([
    indiqueEGanheDaLoja({ id: principal.id, accountGroupId: null }),
    indicacoesParaATela(principal.id),
  ]);
  const link = linkDeIndicacao(principal);
  return NextResponse.json({
    link,
    mensagem: mensagemDeWhatsApp(link),
    valorDoCredito: VALOR_DO_CREDITO,
    indicadosParaIsencao: INDICADOS_PARA_ISENCAO,
    /** Na filial: o nome da loja principal, onde o crédito e a isenção valem. */
    lojaPrincipal: principal.id === loja.id ? null : principal.storeName,
    saldo: resumo.saldo,
    ativosPagantes: resumo.ativosPagantes,
    isenta: resumo.isenta,
    indicacoes,
  });
}
