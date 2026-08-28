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
    const me = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (me) {
      // `ownerId || id`, a convencao do projeto. Aqui era `user.id` cru, e por
      // isso a tela abria VAZIA para funcionario: os produtos e itens de cozinha
      // pertencem ao dono, e a busca era feita no id de quem estava logado.
      currentUserId = me.ownerId || me.id;

      const loja = await prisma.user.findUnique({
        where: { id: currentUserId },
        select: { storeAddress: true, cpfCnpj: true, storeName: true, storeLogo: true },
      });
      storeAddress = loja?.storeAddress || "";
      storeCnpj = loja?.cpfCnpj || "";
      storeName = loja?.storeName || "";
      storeLogo = loja?.storeLogo || "";
    }
  }

  // Sem loja identificada nao ha cardapio para mostrar. O `: {}` que estava aqui
  // transformava o caso de borda em VAZAMENTO: com `currentUserId` indefinido, o
  // findMany varria o banco inteiro e a tela oferecia os produtos de TODAS as
  // lojas do sistema. Mesmo defeito que a tela de impressoras ja teve com as
  // categorias — la esta escrito por que.
  if (!currentUserId) redirect("/store");

  const products = await prisma.menuProduct.findMany({
    where: { franchiseeId: currentUserId },
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
