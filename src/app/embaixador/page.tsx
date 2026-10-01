import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import PortalDoParceiro from "@/components/parceiro/PortalDoParceiro";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do parceiro - FireHub" };

/**
 * A porta do embaixador para o PORTAL DO PARCEIRO (components/parceiro) — o
 * mesmo de /vendedor. Quem é os dois (o Victor) vê tudo num lugar só: as lojas
 * em cada papel, a comissão do mês e quem está devendo (pedido do Douglas,
 * 30/09/2026). A conta mora em lib/parceiro/relatorio.ts.
 */
export default async function EmbaixadorPage() {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as any;
  if (!sessionUser?.email || sessionUser.role !== "AMBASSADOR") return <AmbassadorLoginForm />;

  const ambassador = await prisma.ambassador.findFirst({
    where: {
      OR: [
        ...(sessionUser.id ? [{ id: sessionUser.id }] : []),
        { email: { equals: sessionUser.email, mode: "insensitive" as const } },
      ],
    },
    select: { id: true },
  });
  if (!ambassador) return <AmbassadorLoginForm />;

  const relatorio = await relatorioDoParceiro(ambassador.id);
  if (!relatorio) return <AmbassadorLoginForm />;

  return <PortalDoParceiro relatorio={relatorio} saida="/embaixador" />;
}
