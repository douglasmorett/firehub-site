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
      email: true,
      ifoodWidgetId: true,
      ifoodMerchantId: true,
      facebookPixelId: true,
      metaPixelId: true,
      pagarmeRecipientId: true,
      mpAccessToken: true,
      mpSellerId: true,
      food99Connected: true,
      food99MerchantId: true,
    },
  });

  return (
    <IntegracoesHubClient
      userId={user?.id || ""}
      userEmail={session.user?.email || ""}
      ifoodMerchantId={user?.ifoodMerchantId || ""}
      ifoodClientId={clientId}
      ifoodWidgetId={user?.ifoodWidgetId || undefined}
      facebookPixelId={user?.facebookPixelId || user?.metaPixelId || ""}
      pagarmeRecipientId={user?.pagarmeRecipientId || undefined}
      mpConnected={!!(user?.mpAccessToken || user?.mpSellerId)}
      food99Connected={!!user?.food99Connected}
      food99MerchantId={user?.food99MerchantId || ""}
    />
  );
}
