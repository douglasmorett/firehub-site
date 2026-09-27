import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import VendedorDashboard, { type ClienteDaCarteira } from "@/components/vendedor/VendedorDashboard";
import { comissaoDasLojas, SELECT_DA_LOJA_NA_CARTEIRA } from "@/lib/comissao-da-carteira";
import { atividadeDasLojas } from "@/lib/atividade-da-loja";
import { ganhaComoVendedor, SELECT_DO_EMBAIXADOR_DA_LOJA } from "@/lib/vendedores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minha Carteira - FireHub" };

/**
 * A CARTEIRA DO VENDEDOR (lib/vendedores.ts): as lojas que o admin pôs com
 * ele, as que ainda esperam o primeiro contato no topo, e a comissão prevista
 * do mês. O login é o do portal do embaixador — vendedor é a mesma conta.
 */
export default async function VendedorPage() {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as any;
  if (!sessionUser?.email || sessionUser.role !== "AMBASSADOR") {
    return <AmbassadorLoginForm modo="vendedor" />;
  }

  const vendedor = await prisma.ambassador.findFirst({
    where: {
      OR: [
        ...(sessionUser.id ? [{ id: sessionUser.id }] : []),
        { email: { equals: sessionUser.email, mode: "insensitive" as const } },
      ],
    },
    select: {
      id: true, name: true, email: true, isVendedor: true, active: true, sellerPercent: true, asaasWalletId: true,
      carteira: {
        select: {
          ...SELECT_DA_LOJA_NA_CARTEIRA, ...SELECT_DO_EMBAIXADOR_DA_LOJA,
          vendedorStatus: true, vendedorAtribuidoEm: true, vendedorAtendidoEm: true,
        },
        orderBy: { vendedorAtribuidoEm: "desc" },
      },
    },
  });

  if (!vendedor) return <AmbassadorLoginForm modo="vendedor" />;

  if (!vendedor.isVendedor) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", fontFamily: "Inter, sans-serif", padding: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 28, maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.1rem", color: "#0F172A", margin: "0 0 8px" }}>Sua conta ainda não é de vendedor</h1>
          <p style={{ color: "#64748B", fontSize: "0.9rem", margin: "0 0 18px" }}>
            Peça ao administrador da FireHub para colocar você na equipe de vendas.
          </p>
          <a href="/embaixador" style={{ color: "#C92E09", fontWeight: 700 }}>Ir para o portal do embaixador →</a>
        </div>
      </div>
    );
  }

  const [lojas, atividade] = await Promise.all([
    // Loja que ele mesmo indicou não rende os 3%: ali ele já ganha como embaixador.
    comissaoDasLojas(vendedor.carteira, (l) => (ganhaComoVendedor(vendedor.id, l) ? vendedor.sellerPercent : 0)),
    atividadeDasLojas(vendedor.carteira.map((l) => l.id)),
  ]);

  const clientes: ClienteDaCarteira[] = lojas.map((l) => {
    const daCarteira = vendedor.carteira.find((c) => c.id === l.id)!;
    return {
      ...l,
      atendimento: daCarteira.vendedorStatus === "ATENDIDO" ? "ATENDIDO" : "AGUARDANDO",
      atribuidoEm: daCarteira.vendedorAtribuidoEm ? daCarteira.vendedorAtribuidoEm.toISOString() : null,
      atendidoEm: daCarteira.vendedorAtendidoEm ? daCarteira.vendedorAtendidoEm.toISOString() : null,
      atividade: atividade.get(l.id) || null,
      suaIndicacao: !ganhaComoVendedor(vendedor.id, daCarteira),
    };
  });

  return (
    <VendedorDashboard
      vendedor={{
        name: vendedor.name,
        email: vendedor.email,
        sellerPercent: vendedor.sellerPercent,
        ativo: vendedor.active,
        temCarteiraAsaas: !!vendedor.asaasWalletId,
      }}
      clientes={clientes}
    />
  );
}
