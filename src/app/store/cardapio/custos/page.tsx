import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustoEmMassaClient from "./CustoEmMassaClient";

export const dynamic = "force-dynamic";

export default async function CustoEmMassaPage() {
  // Autenticação FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[CustoEmMassa] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/login");

  // Buscar o usuário FORA do try/catch para que redirect() propague
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true },
  }).catch((err) => {
    console.error("[CustoEmMassa] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  // ADMIN vê tudo; FRANCHISEE só vê os seus próprios produtos
  const franchiseeFilter = user.role === "ADMIN"
    ? { isCombo: false }
    : { isCombo: false, franchiseeId: user.id };

  let products: any[] = [];
  try {
    products = await prisma.menuProduct.findMany({
      where: franchiseeFilter,
      select: { id: true, name: true, price: true, cost: true, category: true, active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  } catch (err) {
    console.error("[CustoEmMassa] Erro ao buscar produtos:", err);
    products = [];
  }

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    cost: p.cost ?? 0,
    category: p.category,
    active: p.active,
  }));

  return <CustoEmMassaClient products={serialized} />;
}
