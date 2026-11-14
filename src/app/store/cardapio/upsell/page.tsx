import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { precoDoCanal } from "@/lib/preco-por-canal";
import { lerUpsellConfig } from "@/lib/upsell-config";
import UpsellClient from "./UpsellClient";

export const dynamic = "force-dynamic";

export default async function UpsellPage() {
  // Autenticação FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[Upsell] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  }).catch((err) => {
    console.error("[Upsell] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");
  // Funcionário configura a oferta da loja do dono (api/store-settings/upsell).
  const lojaId = user.ownerId || user.id;

  let products: any[] = [];
  let config = lerUpsellConfig(null);
  try {
    const [lista, loja] = await Promise.all([
      prisma.menuProduct.findMany({
        // Só o que o site vende: ativo no delivery, sem espelho de integração
        // (lib/espelho-de-integracao.ts) e sem o complemento que só existe
        // dentro de combo — a mesma regra da rota do pedido.
        where: { franchiseeId: lojaId, active: true, activeDelivery: true, origemIntegracao: null, NOT: { apenasEmCombo: true } },
        select: {
          id: true, name: true, price: true, priceDelivery: true, promoPrice: true, imageUrl: true, category: true,
          comboGroups: { select: { id: true } },
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      prisma.user.findUnique({ where: { id: lojaId }, select: { upsellConfig: true } as any }).catch(() => null),
    ]);
    products = lista;
    config = lerUpsellConfig((loja as any)?.upsellConfig);
  } catch (err) {
    console.error("[Upsell] Erro ao buscar produtos:", err);
    products = [];
  }

  const serialized = products.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    // O preço que o site mostra no delivery (com a promoção, se houver): é
    // sobre ele que o % do upsell vale.
    price: precoDoCanal(p, "delivery"),
    imageUrl: (p.imageUrl as string | null) || null,
    category: (p.category as string) || "",
    temOpcoes: (p.comboGroups?.length || 0) > 0,
  }));

  return <UpsellClient products={serialized} inicial={config} />;
}
