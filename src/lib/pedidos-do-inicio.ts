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
 */

import { prisma } from "@/lib/prisma";
import { nomeDoItem } from "@/lib/nome-do-item";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Mais que isto num "Período" é relatório: ver /store/relatorios. */
export const MAIOR_PERIODO_EM_DIAS = 93;

/**
 * Desde quando a Início vem carregada: o começo do mês ou 15 dias atrás, o
 * que vier antes. 15 dias porque o "7 dias" se compara com os 7 anteriores.
 *
 * O servidor conta em UTC e a loja, no fuso dela (até UTC−5 no Acre): o mês
 * é o de seis horas atrás, para a madrugada do dia 1 em UTC — que ainda é o
 * dia 31 no Brasil — não pular o mês inteiro da loja.
 */
export function inicioDaJanela(agora = new Date()): Date {
  const noBrasil = new Date(agora.getTime() - 6 * HORA);
  const inicioDoMes = Date.UTC(noBrasil.getUTCFullYear(), noBrasil.getUTCMonth(), 1);
  return new Date(Math.min(inicioDoMes, agora.getTime() - 15 * DIA));
}

export type PedidoDoInicio = {
  id: string;
  totalAmount: number;
  status: string;
  deliveryType: string;
  paymentMethod?: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerLatLng?: unknown;
  ifoodReference?: string;
  openDeliveryReference?: string;
  source?: string;
  notes?: string;
  createdAt: string;
  storeName?: string;
  storeSlug?: string;
  items: Array<{ id: string; quantity: number; price: number; name: string; cost: number | null; menuProduct: { name: string } }>;
};

/**
 * Pedidos de uma loja (ou de todas, para o ADMIN com `franchiseeId` nulo)
 * entre `desde` e `ate`, mais novos primeiro.
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
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, totalAmount: true, status: true, deliveryType: true, paymentMethod: true,
      customerName: true, customerPhone: true, customerAddress: true, customerLatLng: true,
      ifoodReference: true, openDeliveryReference: true, source: true, notes: true, createdAt: true,
      franchisee: comLoja ? { select: { name: true, slug: true } } : undefined,
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
    totalAmount: o.totalAmount,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod || undefined,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerAddress: o.customerAddress || undefined,
    // O ponto que o parceiro mandou com o pedido: o mapa de calor usa
    // direto, sem gastar uma busca de endereço. Ver StoreDashboardMap.
    customerLatLng: o.customerLatLng || undefined,
    ifoodReference: o.ifoodReference || undefined,
    openDeliveryReference: o.openDeliveryReference || undefined,
    source: o.source || undefined,
    notes: o.notes || undefined,
    createdAt: o.createdAt.toISOString(),
    ...(comLoja ? { storeName: o.franchisee?.name || "—", storeSlug: o.franchisee?.slug || "" } : {}),
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
