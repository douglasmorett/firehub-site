import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import MinhaLojaClient from "@/components/customer/MinhaLojaClient";

export default async function StoreSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) redirect("/");

  return (
    <MinhaLojaClient user={{
      id: user.id,
      slug: user.slug || "",
      storeName: user.storeName || "",
      storePhone: user.storePhone || "",
      storeAddress: user.storeAddress || "",
      storeBanner: user.storeBanner || "",
      storeLogo: user.storeLogo || "",
      storeHours: user.storeHours || null,
      storePause: (user as any).storePause || null,
      storeCoupons: (user as any).storeCoupons || [],
      paymentFees: user.paymentFees || null,
      deliveryZoneType: user.deliveryZoneType || null,
      deliveryZones: user.deliveryZones || null,
      storeLatLng: user.storeLatLng || null,
      storeLoyalty: (user as any).storeLoyalty || null,
      deliveryConfig: (user as any).deliveryConfig || null,
    }} />
  );
}
