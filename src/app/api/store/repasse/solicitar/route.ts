import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/repasse/solicitar — DESLIGADA.
 *
 * A implementação anterior não solicitava saque nenhum. Ela montava um objeto
 * em memória (`SAQ-<timestamp>`), dava um console.log e respondia ao lojista
 * "Solicitação de saque realizada com sucesso! O valor será transferido para a
 * chave Pix cadastrada". Nada era gravado no banco e nenhuma transferência era
 * ordenada.
 *
 * A validação de saldo também estava com a guarda invertida:
 *
 *     if (withdrawAmount > saldoDisponivel && saldoDisponivel > 0) { ...recusa }
 *
 * Com saldo ZERO a segunda condição é falsa e a checagem inteira é pulada, ou
 * seja, qualquer valor era aceito. E hoje todas as lojas têm saldo zero: em
 * 4.562 pedidos do sistema inteiro, nenhum tem `gatewayProvider` nem
 * `paymentPaidAt` — nunca houve uma transação online de verdade.
 *
 * O saldo que aparecia no painel era calculado somando pedidos pelo NOME da
 * forma de pagamento, sem exigir pagamento confirmado; entravam inclusive
 * pedidos em AGUARDANDO_PAGAMENTO. Isso foi corrigido em DREClient.tsx.
 *
 * Esta rota volta quando existir:
 *   1. livro-razão de lançamentos imutáveis por loja (crédito de venda, taxa,
 *      estorno, débito de saque), com o saldo sendo a soma deles;
 *   2. ordem de transferência real no provedor de pagamento;
 *   3. trava de um único saque em andamento por loja, garantida pelo banco.
 *
 * Enquanto isso, 503 — prometer transferência que não acontece é pior do que
 * não ter o botão.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: "Solicitação de saque temporariamente indisponível.",
      detalhe:
        "O repasse automático está sendo implementado. Nenhum saque foi perdido: " +
        "as solicitações anteriores não chegaram a ser registradas em lugar nenhum. " +
        "Em caso de dúvida, fale com o suporte.",
    },
    { status: 503 }
  );
}
