import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import CustomerStorePage from "@/components/customer/CustomerStorePage";

export const revalidate = 60; // ⚡ Cache de Borda (Edge) de 60 segundos


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { storeName: true, name: true, city: true }
  });
  
  if (!franchisee) return { title: "Loja não encontrada" };
  
  const name = franchisee.storeName || franchisee.name;
  return {
    title: `${name} | Cardápio Online`,
    description: `Faça seu pedido online em ${name}. Peça agora pelo cardápio digital!`,
  };
}

export default async function PublicStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  
  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { 
      id: true, 
      name: true, 
      storeName: true, 
      storePhone: true, 
      storeAddress: true, 
      storeBanner: true,
      storeLogo: true,
      storeHours: true,
      storeDeliveryOnly: true,
      storeLatLng: true,
      paymentFees: true,
      deliveryZoneType: true,
      deliveryZones: true,
      deliveryConfig: true,
      storeLoyalty: true,
      storeCoupons: true,
      city: true,
      slug: true,
      storeOpen: true,
      storePause: true,
      facebookPixelId: true,
      metaPixelId: true,
      ifoodMerchantId: true,
      ifoodConnected: true,
      ifoodWidgetId: true,
      mpSellerId: true,
      showReviewsOnMenu: true,
      showAddressOnMenu: true,
      allowScheduledOrders: true,
    }
  });

  if (!franchisee) notFound();

  const showReviews = (franchisee as any).showReviewsOnMenu !== false;

  const [menuProducts, storeCategories, reviewsData, recentReviews] = await Promise.all([
    prisma.menuProduct.findMany({
      // activeDelivery entra no filtro porque este É o delivery. O campo existia
      // desde sempre e a tela de cadastro já oferecia o toggle, mas o cardápio
      // online nunca o consultou: desmarcar "Delivery" não tirava o item daqui.
      //
      // Também é o que permite um produto existir SÓ como opção de combo (o
      // "Frango" que é sabor do mini pastel, a batata que acompanha): ele
      // precisa estar ativo para o grupo enxergá-lo — os itens do combo vêm por
      // outra query, abaixo, sem este filtro — sem virar um item solto de R$ 0,00
      // no meio do cardápio.
      where: { active: true, activeDelivery: true, franchiseeId: franchisee.id },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        comboGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              include: {
                menuProduct: { select: { id: true, name: true, active: true, imageUrl: true } }
              }
            }
          }
        }
      }
    }),
    prisma.menuCategory.findMany({
      where: { franchiseeId: franchisee.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    showReviews
      ? prisma.storeReview.aggregate({
          where: { franchiseeId: franchisee.id },
          _avg: { rating: true },
          _count: { rating: true }
        })
      : Promise.resolve(null),
    showReviews
      ? prisma.storeReview.findMany({
          where: { franchiseeId: franchisee.id, comment: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 15,
          include: {
            customer: { select: { name: true } },
            order: { select: { customerName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  let storeRating = undefined;
  if (showReviews && reviewsData) {
    storeRating = {
      average: reviewsData._avg?.rating || 0,
      count: reviewsData._count?.rating || 0,
      reviews: (recentReviews || []).map((r: any) => ({
        rating: r.rating,
        comment: r.comment || "",
        customerName: r.order?.customerName || r.customer?.name || "Cliente",
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  return (
    <CustomerStorePage 
      franchisee={franchisee as any} 
      menuProducts={menuProducts as any} 
      storeCategories={storeCategories as any}
      storeRating={storeRating} 
    />
  );
}