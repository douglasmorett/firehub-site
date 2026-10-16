/**
 * src/lib/pedidos-do-inicio.ts
 *
 * Os pedidos que a tela Início (/store) desenha — a página e
 * /api/store/inicio leem daqui, para o período carregado depois ter
 * exatamente o mesmo formato do que veio com a tela.
 *
 * ── Por que não são mais 90 dias ────────────────────────────────────────────
 *
 * A Início carregava 90 dias de pedidos com TODAS as colunas (o QR do Pix em
 * base64, o fiscalInfo, o histórico de edição…) a cada abertura. Medido em
 * 01/10/2026 na Hakim Centro: 7.110 pedidos e 23,5 MB saindo do banco, e a
 * tela levava 4,2 s para responder ao clique — para filtros (Hoje, Ontem,
 * 7 dias, Mês) que usam no máximo o mês corrente ou as duas últimas semanas.
 * Naquele dia, 840 pedidos.
 *
 * Agora a tela vem com `inicioDaJanela()` em diante e só as colunas que o
 * painel mostra. "Período" que começa antes disso busca o resto pela API, e
 * só quando alguém pede.
 *
 * ── As colunas da régua (11/10/2026) ────────────────────────────────────────
 *
 * A tela passou a contar pela régua única de venda (src/lib/numeros-do-inicio.ts):
 * a mesa (`tableSessionId`) e o acréscimo (`parentOrderId`) para as vendas e
 * o ticket; o totem e o canal para o tipo de venda; o pagamento dividido e o
 * carimbo de pago online para a forma de pagamento. Sem elas, a mesa de três
 * rodadas eram três "pedidos" e o Pix pago no app do iFood era Pix da loja.
 */

import { prisma } from "@/lib/prisma";
import { SEM_REPOSICAO } from "@/lib/relatorios/sem-reposicao";
import { nomeDoItem } from "@/lib/nome-do-item";
import { hojeNaLoja, somarDias } from "@/lib/relatorios/base";
import { inicioDoDiaOperacional, MAIOR_PERIODO_EM_DIAS, type PedidoDaTelaInicio } from "@/lib/numeros-do-inicio";

export { MAIOR_PERIODO_EM_DIAS };

/**
 * Desde quando a Início vem carregada: o começo do dia de operação do dia 1º
 * do mês ou de 13 dias atrás, o que vier antes — no fuso da loja, que vira às
 * 5h. 13 dias porque o "7 dias" (hoje e os 6 anteriores) se compara com os 7
 * de antes. O "Mês" comparado com os dias de antes do dia 1º busca o resto
 * pela API, quando alguém o escolhe.
 */
export function inicioDaJanela(agora = new Date(), tz?: string | null): Date {
  const hoje = hojeNaLoja(tz, agora);
  const doMes = inicioDoDiaOperacional(`${hoje.slice(0, 7)}-01`, tz);
  const dasDuasSemanas = inicioDoDiaOperacional(somarDias(hoje, -13), tz);
  return new Date(Math.min(doMes.getTime(), dasDuasSemanas.getTime()));
}

export type PedidoDoInicio = PedidoDaTelaInicio;

/**
 * Pedidos de uma loja (ou de todas, para o ADMIN com `franchiseeId` nulo)
 * desde `desde` (e até `ate`, se vier), mais novos primeiro.
 */
export async function pedidosDoInicio({
  franchiseeId,
  desde,
  ate,
}: {
  /** Uma loja; várias (o grupo, em "Todas as Lojas" — lib/loja-ativa.ts); ou null = todas da plataforma (ADMIN). */
  franchiseeId: string | string[] | null;
  desde: Date;
  ate?: Date;
}): Promise<PedidoDoInicio[]> {
  const varias = Array.isArray(franchiseeId) && franchiseeId.length > 1;
  const comLoja = franchiseeId === null || varias;
  const pedidos = await prisma.customerOrder.findMany({
    where: {
      ...(Array.isArray(franchiseeId)
        ? { franchiseeId: { in: franchiseeId } }
        : franchiseeId ? { franchiseeId } : {}),
      createdAt: ate ? { gte: desde, lte: ate } : { gte: desde },
      // Reposição (faltou item / troca) não é venda: fora dos números da Início.
      ...SEM_REPOSICAO,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, franchiseeId: true, totalAmount: true, status: true, deliveryType: true,
      paymentMethod: true, paymentMethods: true, paymentPaidAt: true, gatewayProvider: true,
      customerName: true, customerPhone: true, customerAddress: true, customerLatLng: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true, openDeliveryChannel: true,
      source: true, notes: true, createdAt: true, dailyOrderNumber: true,
      tableSessionId: true, parentOrderId: true, totemLicenseId: true,
      franchisee: comLoja ? { select: { name: true, storeName: true, slug: true } } : undefined,
      items: {
        select: {
          id: true, quantity: true, price: true, productName: true, comboSelections: true,
          menuProduct: { select: { name: true, cost: true } },
        },
      },
    },
  });

  return pedidos.map((o: any) => ({
    id: o.id,
    franchiseeId: o.franchiseeId,
    totalAmount: o.totalAmount,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod || undefined,
    // O dividido do balcão: a forma de pagamento entra pela parte de cada um.
    paymentMethods: o.paymentMethods ?? undefined,
    // Pago online (site/gateway): `foiPagoOnline` lê estes dois.
    paymentPaidAt: o.paymentPaidAt ? o.paymentPaidAt.toISOString() : undefined,
    gatewayProvider: o.gatewayProvider || undefined,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerAddress: o.customerAddress || undefined,
    // O ponto que o parceiro mandou com o pedido: o mapa de calor usa
    // direto, sem gastar uma busca de endereço. Ver StoreDashboardMap.
    customerLatLng: o.customerLatLng || undefined,
    ifoodOrderId: o.ifoodOrderId || undefined,
    ifoodReference: o.ifoodReference || undefined,
    openDeliveryOrderId: o.openDeliveryOrderId || undefined,
    openDeliveryReference: o.openDeliveryReference || undefined,
    openDeliveryChannel: o.openDeliveryChannel || undefined,
    source: o.source || undefined,
    notes: o.notes || undefined,
    createdAt: o.createdAt.toISOString(),
    dailyOrderNumber: o.dailyOrderNumber ?? undefined,
    // A mesa conta uma vez; o acréscimo não é venda nova (régua única).
    tableSessionId: o.tableSessionId || undefined,
    parentOrderId: o.parentOrderId || undefined,
    totemLicenseId: o.totemLicenseId || undefined,
    ...(comLoja ? { storeName: o.franchisee?.storeName || o.franchisee?.name || "—", storeSlug: o.franchisee?.slug || "" } : {}),
    items: o.items.map((i: any) => {
      let itemName = nomeDoItem(i, "");
      if (!itemName || itemName === "Item de Integração" || itemName === "Produto excluído") {
        if (i.comboSelections) {
          try {
            const cs = typeof i.comboSelections === "string" ? JSON.parse(i.comboSelections) : i.comboSelections;
            itemName = cs?.name || cs?.title || cs?.productName || cs?.itemTitle || "";
          } catch {}
        }
      }
      if (!itemName) itemName = "Item (Integração)";
      return {
        id: i.id, quantity: i.quantity, price: i.price,
        name: itemName,
        cost: i.menuProduct?.cost || null,
        menuProduct: { name: itemName },
      };
    }),
  }));
}
