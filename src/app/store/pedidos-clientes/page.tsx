import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import StoreOrdersDashboard from "@/components/customer/StoreOrdersDashboard";

export default async function FranchiseeCustomerOrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, name: true, storeName: true, storeAddress: true, storePhone: true, slug: true, city: true, role: true, storeHours: true, storeDeliveryOnly: true, storeLogo: true, storeLatLng: true }
  });
  if (!user) redirect("/");

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    include: { items: { include: { menuProduct: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  return (
    <StoreOrdersDashboard user={user} orders={orders} isFranqueado={user.role === "FRANCHISEE"} />
  );
}
