import { prisma } from "@/lib/prisma";
import LabelsClient from "./LabelsClient";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Validação & Etiquetas — FireHub",
  description: "Módulo de Impressão de Etiquetas de Validade e Tabela Nutricional"
};

export default async function LabelsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  let storeAddress = "";
  let storeCnpj = "";
  let storeName = "";
  let storeLogo = "";
  let currentUserId: string | undefined;

  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });
    if (user) {
      currentUserId = user.id;
      storeAddress = user.storeAddress || "";
      storeCnpj = user.cpfCnpj || "";
      storeName = user.storeName || "";
      storeLogo = user.storeLogo || "";
    }
  }

  const products = await prisma.menuProduct.findMany({
    where: currentUserId ? { franchiseeId: currentUserId } : {},
    orderBy: { name: "asc" }
  });

  const kitchenItems = await prisma.kitchenItem.findMany({
    where: { franchiseeId: currentUserId },
    orderBy: { name: "asc" }
  });

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <LabelsClient products={products} kitchenItems={kitchenItems} storeAddress={storeAddress} storeCnpj={storeCnpj} storeName={storeName} storeLogo={storeLogo} />
    </div>
  );
}
