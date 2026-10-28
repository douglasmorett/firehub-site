import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MotoboyDashboard from "@/components/customer/MotoboyDashboard";
import AppNaMaquininha from "@/components/admin/AppNaMaquininha";
import MaquininhasClient from "@/components/admin/MaquininhasClient";
import { LOJAS_COM_LANCHE_DA_EQUIPE } from "@/lib/lanche-da-equipe-regras";
import { estaNaSenhaPadrao } from "@/lib/motoboy-senha";

export default async function MotoboysPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/");

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) redirect("/");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  // O deliveryConfig é da LOJA (opções do acerto e a regra antiga de pedido de
  // app, que vale para o entregador sem escolha própria) — em conta de
  // funcionário, vem do dono, não de quem está logado.
  const dono = (user as any).ownerId
    ? await prisma.user.findUnique({ where: { id: targetFranchiseeId }, select: { deliveryConfig: true, slug: true, storeName: true } }).catch(() => null)
    : null;

  const doBanco = await prisma.motoboy.findMany({
    where: { franchiseeId: targetFranchiseeId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  // A lista vai para o navegador (props do componente de cliente): sem a senha
  // (hash, ou texto puro nas antigas) e sem o PIN — o mesmo que api/motoboys
  // faz. A tela só precisa saber quem ainda está na senha padrão.
  const motoboys = await Promise.all(doBanco.map(async ({ password, pinCode, ...mb }) => ({
    ...mb,
    senhaPadrao: await estaNaSenhaPadrao(password),
  })));

  return (
    <div className="container" style={{ marginTop: "1.5rem" }}>
      <h1 className="font-bold" style={{ fontSize: "1.8rem", marginBottom: "0.25rem" }}>🏍️ Motoboys</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Cadastre seus entregadores, configure pagamentos e gere relatórios de comissão.
      </p>
      <MotoboyDashboard
        initialMotoboys={motoboys}
        storeTimezone={user.storeTimezone || undefined}
        deliveryConfig={(dono as any)?.deliveryConfig ?? (user as any).deliveryConfig}
        // Quem está logado — não o dono: trocar a forma de pagamento pelo
        // relatório segue a permissão de editar pedidos de cada funcionário.
        operador={{ role: user.role, permissions: (user as any).permissions }}
        // O lanche dos motoboys: aba só nas lojas que têm a tela (lib/lanche-da-equipe.ts).
        lanche={LOJAS_COM_LANCHE_DA_EQUIPE.has(targetFranchiseeId)
          ? { slug: (dono as any)?.slug || (user as any).slug || "", loja: (dono as any)?.storeName || (user as any).storeName || "" }
          : null}
      />
      {/* O app FireHub Motoboy na maquininha: entregas, cobrança na porta e GPS. */}
      <AppNaMaquininha produto="MOTOBOY" />
      <MaquininhasClient totens={[]} />
    </div>
  );
}
