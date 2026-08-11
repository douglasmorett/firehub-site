import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TotemModuleClient from "./TotemModuleClient";

export const metadata = { title: "Totem — FireHub" };

export default async function TotemPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true, slug: true, storeName: true, ownerId: true, role: true,
      totemEnabled: true, totemConfig: true,
      totemLicenses: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, label: true, token: true, active: true,
          deviceFingerprint: true, lastHeartbeat: true, lastIp: true,
          userAgent: true, monthlyPrice: true, createdAt: true,
        }
      }
    }
  });
  if (!user) redirect("/login");

  // Staff sees owner's store
  const franchiseeId = user.role === "STAFF" && user.ownerId ? user.ownerId : user.id;

  // If staff, re-fetch owner's data
  let storeData = user;
  if (franchiseeId !== user.id) {
    const owner = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: {
        id: true, slug: true, storeName: true,
        totemEnabled: true, totemConfig: true,
        totemLicenses: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, label: true, token: true, active: true,
            deviceFingerprint: true, lastHeartbeat: true, lastIp: true,
            userAgent: true, monthlyPrice: true, createdAt: true,
          }
        }
      }
    });
    if (owner) storeData = owner as any;
  }

  return <TotemModuleClient store={storeData} />;
}
