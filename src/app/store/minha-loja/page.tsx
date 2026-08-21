import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import MinhaLojaClient from "@/components/customer/MinhaLojaClient";
import { normalizeStoreHours } from "@/lib/store-hours";

export const dynamic = "force-dynamic";

export default async function StoreSettingsPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" }
  }).catch(() => null);
  if (!user) redirect("/login");

  const owner = (user as any).ownerId
    ? await prisma.user.findUnique({ where: { id: (user as any).ownerId } }).catch(() => null)
    : null;
  const storeOwner = owner || user;

  return (
    <MinhaLojaClient user={{
      id: user.id,
      role: user.role || "FRANCHISEE",
      ownerId: (user as any).ownerId || null,
      slug: storeOwner.slug || "",
      name: user.name || "",
      email: user.email || "",
      cpfCnpj: storeOwner.cpfCnpj || user.cpfCnpj || "",
      city: storeOwner.city || user.city || "",
      storeName: storeOwner.storeName || user.storeName || "",
      storePhone: storeOwner.storePhone || "",
      storeAddress: storeOwner.storeAddress || "",
      storeBanner: storeOwner.storeBanner || "",
      storeLogo: storeOwner.storeLogo || "",
      storeHours: storeOwner.storeHours ? normalizeStoreHours(storeOwner.storeHours) : null,
      hasConfiguredHours: Boolean(storeOwner.storeHours && Array.isArray(storeOwner.storeHours) && storeOwner.storeHours.length > 0),
      hasConfiguredPayment: Boolean(storeOwner.paymentFees && typeof storeOwner.paymentFees === "object" && (storeOwner.paymentFees as any).PIX && typeof (storeOwner.paymentFees as any).PIX === "object"),
      storePause: (storeOwner as any).storePause || null,
      storeCoupons: (storeOwner as any).storeCoupons || [],
      paymentFees: storeOwner.paymentFees || null,
      deliveryZoneType: storeOwner.deliveryZoneType || null,
      deliveryZones: storeOwner.deliveryZones || null,
      storeLatLng: storeOwner.storeLatLng || null,
      storeLoyalty: (storeOwner as any).storeLoyalty || null,
      deliveryConfig: (storeOwner as any).deliveryConfig || null,
      storeTimezone: (storeOwner as any).storeTimezone || "America/Sao_Paulo",
      showAddressOnMenu: (storeOwner as any).showAddressOnMenu !== false,
    }} />
  );
}
