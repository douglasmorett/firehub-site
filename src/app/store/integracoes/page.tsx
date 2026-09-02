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
      gaMeasurementId: true,
      gtmContainerId: true,
      // O segredo do Measurement Protocol NUNCA viaja para o navegador — vai
      // só o booleano, para a tela saber que existe um configurado.
      gaApiSecret: true,
      pagarmeRecipientId: true,
      mpAccessToken: true,
      mpSellerId: true,
      food99Connected: true,
      food99MerchantId: true,
    },
  });

  const franchiseeId = user?.ownerId || user?.id;

  // ── Credenciais Brendi ────────────────────────────────────────────────────
  // As colunas brendi* nascem por SQL cru no boot (ensureBrendiColumns), não
  // pelo schema.prisma — o Prisma Client não as conhece, então o select acima
  // não pode pedi-las. Lemos por SQL cru, do DONO da conta (ownerId || id),
  // porque é nele que o POST /api/store/integracoes/brendi grava.
  // A falha é silenciosa de propósito: se as colunas ainda não existirem
  // neste banco, a página abre igual, só com o card da Brendi desconectado —
  // uma integração nova jamais pode derrubar a tela das outras.
  // O secret NUNCA sai daqui: só o booleano `hasSecret` viaja para o cliente.
  let brendi = { clientId: "", merchantId: "", connected: false, hasSecret: false };
  if (franchiseeId) {
    try {
      const rows = await prisma.$queryRaw<
        {
          brendiClientId: string | null;
          brendiMerchantId: string | null;
          brendiConnected: boolean | null;
          temSecret: boolean | null;
        }[]
      >`
        SELECT "brendiClientId", "brendiMerchantId", "brendiConnected",
               ("brendiClientSecret" IS NOT NULL AND "brendiClientSecret" <> '') AS "temSecret"
        FROM "User"
        WHERE "id" = ${franchiseeId}
        LIMIT 1
      `;
      const r = Array.isArray(rows) ? rows[0] : undefined;
      if (r) {
        brendi = {
          clientId: r.brendiClientId || "",
          merchantId: r.brendiMerchantId || "",
          connected: !!r.brendiConnected,
          hasSecret: !!r.temSecret,
        };
      }
    } catch {
      // colunas ainda não criadas neste banco — o ensure do boot resolve
    }
  }

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
      gaMeasurementId={user?.gaMeasurementId || ""}
      gtmContainerId={user?.gtmContainerId || ""}
      gaHasApiSecret={!!user?.gaApiSecret}
      pagarmeRecipientId={user?.pagarmeRecipientId || undefined}
      mpConnected={!!(user?.mpAccessToken || user?.mpSellerId)}
      brendiClientId={brendi.clientId}
      brendiMerchantId={brendi.merchantId}
      brendiConnected={brendi.connected}
      brendiHasSecret={brendi.hasSecret}
      initialIfoodIntegrations={JSON.parse(JSON.stringify(ifoodIntegrations))}
    />
  );
}
