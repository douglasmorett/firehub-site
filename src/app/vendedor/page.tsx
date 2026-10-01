import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import PortalDoParceiro from "@/components/parceiro/PortalDoParceiro";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";
import { lojaQueAbreOPortal } from "@/lib/paineis-do-dono";

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
    select: { id: true, isVendedor: true },
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

  const relatorio = await relatorioDoParceiro(vendedor.id);
  if (!relatorio) return <AmbassadorLoginForm modo="vendedor" />;

  return <PortalDoParceiro relatorio={relatorio} saida="/vendedor" />;
}
