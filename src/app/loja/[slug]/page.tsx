import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import CustomerStorePage from "@/components/customer/CustomerStorePage";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { storeName: true, name: true, city: true }
  });
  
  if (!franchisee) return { title: "Loja n├úo encontrada" };
  
  const name = franchisee.storeName || franchisee.name;
  return {
    title: `${name} | Card├ípio Online`,
    description: `Fa├ºa seu pedido online em ${name}. Pe├ºa agora pelo card├ípio digital!`,
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
      paymentFees: true,
      deliveryZoneType: true,
      deliveryZones: true,
      city: true,
      slug: true,
      storeOpen: true,
      storePause: true,
      facebookPixelId: true,
    }
  });

  if (!franchisee) notFound();

  const menuProducts = await prisma.menuProduct.findMany({
    where: { active: true, franchiseeId: franchisee.id },
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
  });

  // Get store reviews
  const reviewsData = await prisma.storeReview.aggregate({
    where: { franchiseeId: franchisee.id },
    _avg: { rating: true },
    _count: { rating: true }
  });

  const recentReviews = await prisma.storeReview.findMany({
    where: { franchiseeId: franchisee.id, comment: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { customer: { select: { name: true } } },
  });

  const storeRating = {
    average: reviewsData._avg.rating || 0,
    count: reviewsData._count.rating || 0,
    reviews: recentReviews.map(r => ({
      rating: r.rating,
      comment: r.comment || "",
      customerName: r.customer?.name || "Cliente",
      createdAt: r.createdAt.toISOString(),
    })),
  };

  return (
    <>
      {/* Mercado Pago SDK ÔÇö tokeniza├º├úo de cart├úo no cliente (PCI Compliant) */}
      <script src="https://sdk.mercadopago.com/js/v2" async />
      <CustomerStorePage franchisee={franchisee} menuProducts={menuProducts} storeRating={storeRating} />
    </>
  );
}