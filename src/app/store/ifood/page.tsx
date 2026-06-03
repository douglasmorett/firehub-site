import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import IfoodHomologacaoClient from "./IfoodHomologacaoClient";

export const dynamic = "force-dynamic";

export default async function IfoodPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const clientId   = process.env.IFOOD_CLIENT_ID || "";

  // Load per-store widget ID and merchant ID from database
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { ifoodWidgetId: true, ifoodMerchantId: true },
  });

  return (
    <IfoodHomologacaoClient
      merchantId={user?.ifoodMerchantId || ""}
      clientId={clientId}
      ifoodWidgetId={user?.ifoodWidgetId || undefined}
    />
  );
}
