import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProductGrid from "@/components/ProductGrid";
import { getNextDeliveryInfo } from "@/lib/deliveryDates";

export default async function ComprasPage() {
  const session = await getServerSession(authOptions);
  const isLoggedIn = !!session;
  const role = (session?.user as any)?.role;
  const city = (session?.user as any)?.city || null;
  const deliveryInfo = await getNextDeliveryInfo(city);

  // Check if user is Franqueado Hakim (se logado)
  let isFranqueadoHakim = false;
  if (isLoggedIn && session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isFranqueadoHakim: true }
    });
    isFranqueadoHakim = user?.isFranqueadoHakim || false;
  }

  // Produtos: franqueados Hakim veem tudo, outros não veem franchiseOnly
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(isFranqueadoHakim ? {} : { franchiseOnly: false })
    },
    orderBy: { name: 'asc' }
  });

  return (
    <ProductGrid
      products={products}
      deliveryInfo={deliveryInfo}
      isLoggedIn={isLoggedIn}
    />
  );
}
