import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import PortalDoParceiro from "@/components/parceiro/PortalDoParceiro";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";
import TermoDeComissionamento from "@/components/parceiro/TermoDeComissionamento";
import { aceitouAVersaoVigente } from "@/lib/parceiro/aceite-do-termo";
import { lojaQueAbreOPortal } from "@/lib/paineis-do-dono";

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
  if (!sessionUser?.email || sessionUser.role !== "AMBASSADOR") {
    return <AmbassadorLoginForm logadoNaLoja={await lojaQueAbreOPortal(sessionUser)} />;
  }

  const ambassador = await prisma.ambassador.findFirst({
    where: {
      OR: [
        ...(sessionUser.id ? [{ id: sessionUser.id }] : []),
        { email: { equals: sessionUser.email, mode: "insensitive" as const } },
      ],
    },
    select: { id: true, isVendedor: true, active: true, name: true },
  });
  if (!ambassador) return <AmbassadorLoginForm />;

  // Vendedor que entra por esta porta também aceita o termo de comissionamento antes (o mesmo de /vendedor).
  if (ambassador.isVendedor && ambassador.active && !(await aceitouAVersaoVigente(ambassador.id))) {
    return <TermoDeComissionamento nome={ambassador.name} saida="/embaixador" />;
  }

  const relatorio = await relatorioDoParceiro(ambassador.id);
  if (!relatorio) return <AmbassadorLoginForm />;

  return <PortalDoParceiro relatorio={relatorio} saida="/embaixador" />;
}
