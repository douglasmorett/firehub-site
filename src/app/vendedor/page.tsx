import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import PortalDoParceiro from "@/components/parceiro/PortalDoParceiro";
import MapaDeProspeccao from "@/components/prospeccao/MapaDeProspeccao";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";
import { lojaQueAbreOPortal } from "@/lib/paineis-do-dono";
import TermoDeComissionamento from "@/components/parceiro/TermoDeComissionamento";
import { aceitouAVersaoVigente } from "@/lib/parceiro/aceite-do-termo";
import { ganhoComDisparoNoMes, pacotesDoVendedor } from "@/lib/parceiro/disparo-do-vendedor";
import { idsDaCarteira } from "@/lib/perfil-da-loja/no-banco";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do parceiro - FireHub" };

/**
 * A porta do vendedor para o PORTAL DO PARCEIRO — o mesmo de /embaixador, com
 * as abas do CRM (conversas, contatos, agenda). O login é o do embaixador:
 * vendedor é a mesma conta (lib/vendedores.ts).
 */
export default async function VendedorPage() {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as any;
  if (!sessionUser?.email || sessionUser.role !== "AMBASSADOR") {
    return <AmbassadorLoginForm modo="vendedor" logadoNaLoja={await lojaQueAbreOPortal(sessionUser)} />;
  }

  const vendedor = await prisma.ambassador.findFirst({
    where: {
      OR: [
        ...(sessionUser.id ? [{ id: sessionUser.id }] : []),
        { email: { equals: sessionUser.email, mode: "insensitive" as const } },
      ],
    },
    select: { id: true, isVendedor: true, name: true },
  });

  if (!vendedor) return <AmbassadorLoginForm modo="vendedor" />;

  if (!vendedor.isVendedor) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F3EEE5", fontFamily: "Inter, sans-serif", padding: 16 }}>
        <div style={{ background: "#FFFDF9", border: "1px solid #E7DDCD", borderRadius: 16, padding: 28, maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.1rem", color: "#1C1917", margin: "0 0 8px" }}>Sua conta ainda não é de vendedor</h1>
          <p style={{ color: "#6F675E", fontSize: "0.9rem", margin: "0 0 18px" }}>
            Peça ao administrador da FireHub para colocar você na equipe de vendas.
          </p>
          <a href="/embaixador" style={{ color: "#C92E09", fontWeight: 700 }}>Ir para o portal do parceiro →</a>
        </div>
      </div>
    );
  }

  // O termo de comissionamento vem antes das abas (lib/parceiro/termo-de-comissionamento.ts).
  // Bloqueia o portal, não o pagamento: o split segue a regra de quem atende.
  if (!(await aceitouAVersaoVigente(vendedor.id))) {
    return <TermoDeComissionamento nome={vendedor.name} saida="/vendedor" />;
  }

  const [relatorio, ganhoNoMes] = await Promise.all([
    relatorioDoParceiro(vendedor.id),
    idsDaCarteira(vendedor.id).then(ganhoComDisparoNoMes).catch(() => 0),
  ]);
  if (!relatorio) return <AmbassadorLoginForm modo="vendedor" />;

  // Mapa de prospecção por cidade (src/components/prospeccao): só vendedor ativo;
  // a API dele (/api/vendedor/prospeccao) também barra quem não é.
  return (
    <PortalDoParceiro
      relatorio={relatorio}
      saida="/vendedor"
      disparo={{ pacotes: pacotesDoVendedor(), ganhoNoMes }}
      mapaDeProspeccao={<MapaDeProspeccao />}
    />
  );
}
