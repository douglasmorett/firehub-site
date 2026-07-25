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
    select: { email: true, ifoodWidgetId: true, ifoodMerchantId: true },
  });

  return (
    <IntegracoesHubClient
      userEmail={session.user?.email || ""}
      ifoodMerchantId={user?.ifoodMerchantId || ""}
      ifoodClientId={clientId}
      ifoodWidgetId={user?.ifoodWidgetId || undefined}
    />
  );
}
