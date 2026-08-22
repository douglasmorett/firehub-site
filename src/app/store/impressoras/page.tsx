import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrinterSetupClient from "./PrinterSetupClient";

export default async function ImpressorasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  const me = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!me) redirect("/");

  // Mesma resolucao de dono usada pelo PUT/GET de /api/store/printer-config
  const ownerId = me.ownerId || me.id;
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, storeName: true, printerConfig: true },
  });
  if (!user) redirect("/");

  const products = await prisma.menuProduct.findMany({
    where: { active: true },
    select: { id: true, name: true, category: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const categories = [...new Set(products.map((p) => p.category))];

  return (
    <PrinterSetupClient
      storeName={user.storeName || ""}
      franchiseeId={ownerId}
      initialConfig={user.printerConfig as any}
      categories={categories}
    />
  );
}
