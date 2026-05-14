import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustoEmMassaClient from "./CustoEmMassaClient";

export default async function CustoEmMassaPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/");

  const products = await prisma.menuProduct.findMany({
    where: { isCombo: false },
    select: { id: true, name: true, price: true, cost: true, category: true, active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const serialized = products.map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    cost: p.cost ?? 0,
    category: p.category,
    active: p.active,
  }));

  return <CustoEmMassaClient products={serialized} />;
}
