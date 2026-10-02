/**
 * Cashback de um telefone numa loja — a única parte do cashback que fala com o
 * banco. A regra mora em lib/cashback.ts.
 *
 * O telefone é a identidade, como na Trilha Premiada: o cardápio não tem
 * sessão de cliente, e /api/customer-order é rota pública. Por isso o corpo do
 * pedido só PEDE para usar o saldo; quanto existe e quanto pode ser usado é o
 * servidor que calcula aqui.
 */

import { prisma } from "./prisma";
import { gastoEm30Dias, lerCashback, saldoDoCashback, taxaDoCliente, type SaldoDoCashback } from "./cashback";

export type CashbackDoCliente = SaldoDoCashback & {
  /** % que o próximo pedido gera (com o bônus VIP, se houver). */
  taxa: number;
};

export async function cashbackDoCliente(
  franchiseeId: string,
  storeLoyalty: unknown,
  telefone: string,
  agora = new Date(),
): Promise<CashbackDoCliente | null> {
  const regra = lerCashback(storeLoyalty);
  if (!regra.ativo) return null;
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  // O telefone fica gravado como o cliente digitou: "(22) 99999-1234",
  // "22999991234", "+55 22 9…". Comparar texto ("contém os 8 últimos dígitos")
  // não acha o que tem hífen no meio — é preciso comparar só os DÍGITOS.
  const final = digitos.slice(-8);
  const doTelefone = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CustomerOrder"
    WHERE "franchiseeId" = ${franchiseeId}
      AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final}
    ORDER BY "createdAt" DESC
    LIMIT 500`;
  if (!doTelefone.length) return { saldo: 0, proximoVencimento: null, taxa: taxaDoCliente(regra, 0) };

  const pedidos = await prisma.customerOrder.findMany({
    where: { id: { in: doTelefone.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    // Os campos que lib/canal-do-pedido.ts precisa para saber se o pedido é do site.
    select: {
      id: true, status: true, source: true, deliveryType: true, totalAmount: true,
      createdAt: true, updatedAt: true, deliveredAt: true, cashbackEarned: true, cashbackUsed: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true,
    },
  });

  const saldo = saldoDoCashback(regra, pedidos, agora);
  return { ...saldo, taxa: taxaDoCliente(regra, gastoEm30Dias(pedidos, agora)) };
}
