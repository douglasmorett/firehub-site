import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import IntegracoesHubClient from "./IntegracoesHubClient";

export const dynamic = "force-dynamic";

export default async function IntegracoesPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const clientId = process.env.IFOOD_CLIENT_ID || "";

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true,
      ownerId: true,
      email: true,
      ifoodWidgetId: true,
      ifoodMerchantId: true,
      ifoodConnected: true,
      facebookPixelId: true,
      metaPixelId: true,
      pagarmeRecipientId: true,
      mpAccessToken: true,
      mpSellerId: true,
      food99Connected: true,
      food99MerchantId: true,
    },
  });

  const franchiseeId = user?.ownerId || user?.id;

  const ifoodIntegrations = franchiseeId
    ? await prisma.ifoodIntegration.findMany({
        where: { userId: franchiseeId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          label: true,
          merchantId: true,
          connected: true,
          active: true,
          widgetId: true,
          createdAt: true,
        },
      })
    : [];

  const effectiveMerchantId = user?.ifoodMerchantId || ifoodIntegrations[0]?.merchantId || "";

  return (
    <IntegracoesHubClient
      userEmail={session.user?.email || ""}
      ifoodMerchantId={effectiveMerchantId}
      ifoodClientId={clientId}
      ifoodWidgetId={user?.ifoodWidgetId || undefined}
      ifoodConnected={!!user?.ifoodConnected}
      facebookPixelId={user?.facebookPixelId || user?.metaPixelId || ""}
      pagarmeRecipientId={user?.pagarmeRecipientId || undefined}
      mpConnected={!!(user?.mpAccessToken || user?.mpSellerId)}
      initialIfoodIntegrations={JSON.parse(JSON.stringify(ifoodIntegrations))}
    />
  );
}
