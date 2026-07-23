import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MotoboyDashboard from "@/components/customer/MotoboyDashboard";

export default async function MotoboysPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/");

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) redirect("/");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: targetFranchiseeId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="container" style={{ marginTop: "1.5rem" }}>
      <h1 className="font-bold" style={{ fontSize: "1.8rem", marginBottom: "0.25rem" }}>🏍️ Motoboys</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Cadastre seus entregadores, configure pagamentos e gere relatórios de comissão.
      </p>
      <MotoboyDashboard initialMotoboys={motoboys} />
    </div>
  );
}
