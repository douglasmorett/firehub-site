import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import MinhaLojaClient from "@/components/customer/MinhaLojaClient";

export const dynamic = "force-dynamic";

export default async function StoreSettingsPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" }
  }).catch(() => null);
  if (!user) redirect("/login");

  return (
    <MinhaLojaClient user={{
      id: user.id,
      role: user.role || "FRANCHISEE",
      ownerId: (user as any).ownerId || null,
      slug: user.slug || "",
      name: user.name || "",
      email: user.email || "",
      cpfCnpj: user.cpfCnpj || "",
      city: user.city || "",
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
      storeTimezone: (user as any).storeTimezone || "America/Sao_Paulo",
    }} />
  );
}
