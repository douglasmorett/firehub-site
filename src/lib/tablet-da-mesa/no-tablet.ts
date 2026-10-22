/**
 * O que as rotas do TABLET (o aparelho na mesa, sem login) usam: o tablet do
 * cookie e a conta aberta da mesa dele.
 */
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { COOKIE_DO_TABLET, tabletDoCookie, type TabletAutenticado } from "./tablets";

export async function tabletDaRequisicao(): Promise<TabletAutenticado | null> {
  try {
    return await tabletDoCookie((await cookies()).get(COOKIE_DO_TABLET)?.value);
  } catch {
    return null;
  }
}

export type ContaNoTablet = {
  aberta: boolean;
  sessaoId: string | null;
  total: number;
  itens: { nome: string; quantidade: number; valor: number }[];
};

/** A conta aberta da mesa: os itens dos pedidos que valem, somados por nome e preço. */
export async function contaDaMesa(tableId: string): Promise<ContaNoTablet> {
  const sessao = await prisma.tableSession.findFirst({
    where: { tableId, status: "OPEN" },
    select: {
      id: true,
      orders: {
        where: { status: { notIn: [...STATUS_CANCELADOS] } },
        select: { items: { select: { productName: true, quantity: true, price: true } } },
      },
    },
  });
  if (!sessao) return { aberta: false, sessaoId: null, total: 0, itens: [] };
  const porItem = new Map<string, { nome: string; quantidade: number; valor: number }>();
  for (const o of sessao.orders) {
    for (const i of o.items) {
      const nome = i.productName || "Item";
      const chave = `${nome}|${i.price}`;
      const atual = porItem.get(chave) ?? { nome, quantidade: 0, valor: 0 };
      atual.quantidade += i.quantity;
      atual.valor = Math.round((atual.valor + i.price * i.quantity) * 100) / 100;
      porItem.set(chave, atual);
    }
  }
  const itens = [...porItem.values()];
  return { aberta: true, sessaoId: sessao.id, total: Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100, itens };
}
