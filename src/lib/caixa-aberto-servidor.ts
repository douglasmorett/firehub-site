import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MENSAGEM_CAIXA_FECHADO, ERRO_CAIXA_FECHADO } from "@/lib/caixa-aberto";

/**
 * A consulta ao banco da trava de caixa (lib/caixa-aberto.ts tem o porquê).
 *
 * Mora separado porque aquele arquivo é importado pela tela do PDV, que é
 * componente de cliente — o prisma aqui dentro iria junto para o navegador.
 */

/**
 * Tem caixa aberto nesta loja?
 *
 * Falha de banco devolve `true` de propósito: a trava existe para proteger o
 * fechamento, não para parar a operação. Se a consulta cair, recusar toda
 * venda do balcão seria trocar um furo de caixa por uma loja parada — e a
 * loja parada é o prejuízo maior e imediato.
 */
export async function caixaEstaAberto(franchiseeId: string): Promise<boolean> {
  try {
    const aberto = await prisma.cashSession.findFirst({
      where: { franchiseeId, status: "OPEN" },
      select: { id: true },
    });
    return Boolean(aberto);
  } catch (err) {
    console.error("[Caixa] não consegui conferir se está aberto:", (err as any)?.code || err);
    return true;
  }
}

/**
 * A recusa pronta quando o caixa está fechado, ou `null` para seguir.
 *
 * Existe para as rotas de MESA não repetirem o mesmo bloco quatro vezes — e,
 * pior, não repetirem com mensagens ligeiramente diferentes. O garçom que tenta
 * abrir a mesa e o que tenta fechar a conta leem a mesma frase.
 *
 * O caixa da mesa é o da LOJA: quem abre é o painel, não o garçom. Por isso a
 * mensagem manda "avise quem abre o caixa" em vez de mandar ele abrir — o
 * garçom logado pelo link não tem essa tela.
 */
export async function recusaSeCaixaFechado(
  franchiseeId: string,
  ondeEstava: "abrir a mesa" | "lançar o item" | "fechar a conta" | "registrar o pagamento",
): Promise<NextResponse | null> {
  if (await caixaEstaAberto(franchiseeId)) return null;
  return NextResponse.json(
    {
      error: `${MENSAGEM_CAIXA_FECHADO} (Não deu para ${ondeEstava}.)`,
      codigo: ERRO_CAIXA_FECHADO,
    },
    { status: 409 },
  );
}
