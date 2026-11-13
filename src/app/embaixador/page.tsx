import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import PortalDoParceiro from "@/components/parceiro/PortalDoParceiro";
import MapaDeProspeccao from "@/components/prospeccao/MapaDeProspeccao";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";
import { projecaoDoMesGuardada } from "@/lib/projecao-do-mes";
import { recortarProjecao } from "@/lib/parceiro/projecao-do-parceiro";
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
    select: { id: true, isVendedor: true, active: true, name: true, splitRecusadoEm: true },
  });
  if (!ambassador) return <AmbassadorLoginForm />;

  // Vendedor que entra por esta porta também aceita o termo de comissionamento antes (o mesmo de /vendedor).
  if (ambassador.isVendedor && ambassador.active && !(await aceitouAVersaoVigente(ambassador.id))) {
    return <TermoDeComissionamento nome={ambassador.name} saida="/embaixador" />;
  }

  const relatorio = await relatorioDoParceiro(ambassador.id);
  if (!relatorio) return <AmbassadorLoginForm />;
  // A projeção do mês das lojas dele — a mesma do /vendedor, só para quem vende.
  const projecaoDoMes = ambassador.isVendedor ? await projecaoDoMesGuardada().catch(() => null) : null;
  const projecao = projecaoDoMes ? recortarProjecao(projecaoDoMes, relatorio.lojas) : null;

  // O mapa de prospecção é do VENDEDOR: embaixador puro não vê a aba (a API
  // /api/vendedor/prospeccao devolve 401 para ele).
  const vendeAtivo = ambassador.isVendedor && ambassador.active;
  return (
    <>
    {/* O Asaas recusou o split de um boleto com a carteira dele: o boleto saiu
        sem comissão (lib/billing.ts). Some quando o admin troca a carteira. */}
    {ambassador.splitRecusadoEm && (
      <div role="alert" style={{ background: "#FEF2F2", color: "#991B1B", borderBottom: "1px solid #FECACA", padding: "12px 16px", textAlign: "center", fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>
        Não conseguimos repassar a sua comissão: o Asaas recusou a sua carteira (Wallet ID).{" "}
        <a href="https://wa.me/5522981118514?text=Oi!%20Sou%20embaixador%20e%20apareceu%20que%20a%20minha%20comiss%C3%A3o%20n%C3%A3o%20foi%20repassada." style={{ color: "#991B1B", textDecoration: "underline" }}>Fale com a gente no WhatsApp</a>.
      </div>
    )}
    <PortalDoParceiro
      relatorio={relatorio}
      saida="/embaixador"
      mapaDeProspeccao={vendeAtivo ? <MapaDeProspeccao /> : undefined}
      projecao={projecao}
    />
    </>
  );
}
