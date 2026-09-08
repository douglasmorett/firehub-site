/**
 * /src/lib/pedido-cobranca.ts
 *
 * O pedido salvo tem que dizer o MESMO que o boleto que o cliente recebe.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 *
 * Medido em produção em 08/09/2026, na Icebox: o pedido #45LQ83 estava gravado
 * com R$ 2.286,00 (massa de esfirra a R$ 200,00 o pacote) e a cobrança emitida
 * no Asaas era de R$ 2.461,00 (a mesma massa a R$ 235,00 — o preço novo). O
 * mesmo no #MXESYD: R$ 2.236,00 no pedido, R$ 2.446,00 no boleto. O cliente
 * abria o painel, via um valor, e recebia um boleto com outro.
 *
 * O checkout daqui não produz essa diferença: ele calcula UM número e usa o
 * mesmo para o pedido, para os itens e para a cobrança. A divergência aparece
 * quando a cobrança é gerada/refeita DEPOIS, com o preço do catálogo já
 * atualizado — inclusive pelo portal antigo, que ainda escreve neste banco.
 *
 * Em vez de tentar impedir todo caminho que possa mexer na cobrança (há um
 * fora deste código), a regra passa a ser a única que o cliente consegue
 * conferir sozinho: **o boleto manda**. Se a cobrança em aberto diz outro
 * valor, o pedido é acertado por ele.
 *
 * Quando os preços de hoje explicam exatamente o valor cobrado, os itens são
 * reprecificados junto — assim a soma das linhas bate com o total, e o cliente
 * vê ONDE mudou. Quando não explicam, só o total é acertado e a tela mostra a
 * diferença como um ajuste, em vez de exibir uma conta que não fecha.
 *
 * Só toca em pedido AGUARDANDO PAGAMENTO: pedido pago é histórico e não se
 * reescreve.
 */
import { prisma } from "@/lib/prisma";
import { getAsaasKey } from "@/lib/asaas";

export type AjusteDeCobranca = {
  /** Valor que o cliente vai pagar, segundo a cobrança em aberto. */
  cobrado: number;
  /** Quanto o pedido subiu (ou caiu) ao ser acertado pelo boleto. */
  diferenca: number;
  /** true quando os preços de hoje explicam o valor cobrado item a item. */
  itensReprecificados: boolean;
};

type PedidoParaConferir = {
  id: string;
  status: string;
  totalAmount: number;
  asaasPaymentId: string | null;
  items: { id: string; quantity: number; price: number; productId: string }[];
};

/** Memória curta: a mesma cobrança é consultada por várias telas seguidas. */
const cache = new Map<string, { valor: number | null; ate: number }>();
const VALIDADE_MS = 60_000;

async function valorDaCobranca(paymentId: string): Promise<number | null> {
  const agora = Date.now();
  const guardado = cache.get(paymentId);
  if (guardado && guardado.ate > agora) return guardado.valor;

  const chave = getAsaasKey();
  if (!chave) return null;
  const base = chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";

  let valor: number | null = null;
  try {
    const r = await fetch(`${base}/payments/${paymentId}`, {
      headers: { access_token: chave, "User-Agent": "firehub/1.0" },
      cache: "no-store",
    });
    if (r.ok) {
      const d = await r.json();
      // Cobrança apagada/estornada não manda no pedido.
      const viva = d?.status && !["DELETED", "REFUNDED", "REFUND_REQUESTED"].includes(d.status);
      const n = Number(d?.value);
      if (viva && Number.isFinite(n) && n > 0) valor = n;
    }
  } catch {
    // Asaas fora do ar não pode derrubar a tela de pedidos: segue com o gravado.
  }
  cache.set(paymentId, { valor, ate: agora + VALIDADE_MS });
  return valor;
}

/**
 * Acerta os pedidos em aberto pelo valor do boleto e devolve o que mudou,
 * por id de pedido. Nunca lança: qualquer tropeço deixa o pedido como está.
 */
export async function sincronizarComCobranca(
  pedidos: PedidoParaConferir[],
): Promise<Record<string, AjusteDeCobranca>> {
  const ajustes: Record<string, AjusteDeCobranca> = {};

  const emAberto = pedidos.filter(
    (p) => p.status === "PENDING_PAYMENT" && p.asaasPaymentId && p.items?.length > 0,
  );
  if (emAberto.length === 0) return ajustes;

  for (const pedido of emAberto) {
    try {
      const cobrado = await valorDaCobranca(pedido.asaasPaymentId!);
      if (cobrado === null) continue;

      const diferenca = Number((cobrado - pedido.totalAmount).toFixed(2));
      if (Math.abs(diferenca) < 0.01) continue;

      // Os preços de hoje explicam o valor cobrado?
      const produtos = await prisma.product.findMany({
        where: { id: { in: pedido.items.map((i) => i.productId) } },
        select: { id: true, price: true },
      });
      const precoHoje = new Map(produtos.map((p) => [p.id, p.price]));
      const somaComPrecosDeHoje = pedido.items.reduce(
        (s, i) => s + (precoHoje.get(i.productId) ?? i.price) * i.quantity,
        0,
      );
      const explicaItemAItem = Math.abs(somaComPrecosDeHoje - cobrado) < 0.01;

      await prisma.$transaction([
        ...(explicaItemAItem
          ? pedido.items
              .filter((i) => (precoHoje.get(i.productId) ?? i.price) !== i.price)
              .map((i) =>
                prisma.orderItem.update({
                  where: { id: i.id },
                  data: { price: precoHoje.get(i.productId)! },
                }),
              )
          : []),
        prisma.order.update({ where: { id: pedido.id }, data: { totalAmount: cobrado } }),
      ]);

      ajustes[pedido.id] = { cobrado, diferenca, itensReprecificados: explicaItemAItem };
      console.log(
        `[pedido-cobranca] #${pedido.id.slice(-6).toUpperCase()} acertado pelo boleto: ` +
          `R$ ${pedido.totalAmount.toFixed(2)} → R$ ${cobrado.toFixed(2)}` +
          (explicaItemAItem ? " (itens reprecificados)" : " (ajuste no total)"),
      );
    } catch (e: any) {
      console.error(`[pedido-cobranca] falha ao acertar ${pedido.id}:`, e?.message);
    }
  }

  return ajustes;
}
