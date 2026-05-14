import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ProductGrid from "@/components/ProductGrid";
import { getNextDeliveryInfo } from "@/lib/deliveryDates";

export default async function ComprasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/");

  const city = (session.user as any)?.city || null;
  const deliveryInfo = await getNextDeliveryInfo(city);

  // Check if user is Franqueado Hakim
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { isFranqueadoHakim: true }
  });
  const isFranqueadoHakim = user?.isFranqueadoHakim || false;
  
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(isFranqueadoHakim ? {} : { franchiseOnly: false })
    },
    orderBy: { name: 'asc' }
  });

  return (
    <ProductGrid products={products} deliveryInfo={deliveryInfo} />
  );
}
