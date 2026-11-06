import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { produtosDaBalanca, balancaEstaLigada } from "@/lib/balanca/assinatura";
import { precoDoCanal } from "@/lib/preco-por-canal";
import TelaDaBalanca from "./TelaDaBalanca";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Tela da balança" };

/**
 * /store/balanca/pesar — a tela que fica ligada na balança (lib/balanca).
 * `?simular=1`: uma Prix 3 Fit de mentira, para testar e treinar sem balança.
 */
export default async function PesarPage({ searchParams }: { searchParams: Promise<{ simular?: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login?callbackUrl=/store/balanca/pesar");
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!u) redirect("/login");
  const franchiseeId = u.ownerId || u.id;

  const ligada = await balancaEstaLigada(franchiseeId);
  const ids = ligada ? await produtosDaBalanca(franchiseeId) : [];
  const produtos = ids.length
    ? await prisma.menuProduct.findMany({
        where: { id: { in: ids }, franchiseeId, active: true },
        select: { id: true, name: true, price: true, priceSalao: true, priceDelivery: true, priceTotem: true, promoPrice: true },
      })
    : [];
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeName: true, name: true } });

  return (
    <TelaDaBalanca
      ligada={ligada}
      simular={(await searchParams).simular === "1"}
      nomeDaLoja={loja?.storeName || loja?.name || ""}
      produtos={produtos.map((p) => ({ id: p.id, nome: p.name, precoDoQuilo: precoDoCanal(p as any, "salao") }))}
    />
  );
}
