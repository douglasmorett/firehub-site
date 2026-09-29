import { prisma } from "@/lib/prisma";
import { nomeDoItem } from "@/lib/nome-do-item";
import { parseComboSelections } from "@/lib/parse-combo";
import { notFound } from "next/navigation";
import OrderTrackingClient from "./OrderTrackingClient";

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { id: true, storeName: true, storeLogo: true, storePhone: true },
  });
  if (!franchisee) notFound();

  const order = await prisma.customerOrder.findFirst({
    where: { id, franchiseeId: franchisee.id },
    include: {
      items: {
        include: { menuProduct: { select: { name: true, imageUrl: true } } },
      },
    },
  });
  if (!order) notFound();

  return (
    <OrderTrackingClient
      orderId={order.id}
      initialStatus={order.status}
      customerName={order.customerName}
      deliveryType={order.deliveryType}
      totalAmount={order.totalAmount}
      deliveryFee={order.deliveryFee}
      paymentMethod={order.paymentMethod || ""}
      items={order.items.map((i) => ({
        name: nomeDoItem(i, "—"),
        // Os sabores do meio a meio e as escolhas do combo moram aqui. O resumo
        // mostrava só o nome do item: "1x Camarão" num pedido de meio a meio
        // (Serpa, 28/09/2026). Mesma leitura do painel e da cozinha.
        opcoes: parseComboSelections(i.comboSelections).map((o) => (o.quantity > 1 ? `${o.quantity}x ${o.name}` : o.name)),
        qty: i.quantity,
        price: i.price,
        imageUrl: i.menuProduct?.imageUrl || null,
      }))}
      createdAt={order.createdAt.toISOString()}
      storeName={franchisee.storeName || "Loja"}
      storeLogo={franchisee.storeLogo || null}
      storePhone={franchisee.storePhone || null}
      slug={slug}
    />
  );
}