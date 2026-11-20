import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MarketingHubClient from "./MarketingHubClient";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  // Os cupons são da LOJA (a linha do dono), como em Minha loja › Cupons: a aba
  // Cupons daqui edita a mesma lista (components/customer/CuponsEditor.tsx).
  const quem = await prisma.user.findUnique({ where: { email: session.user?.email || "" }, select: { id: true, ownerId: true } }).catch(() => null);
  const loja = quem
    ? await prisma.user.findUnique({ where: { id: quem.ownerId || quem.id }, select: { storeCoupons: true, paymentFees: true, slug: true } }).catch(() => null)
    : null;

  return (
    <MarketingHubClient
      cuponsIniciais={Array.isArray(loja?.storeCoupons) ? (loja!.storeCoupons as any[]) : []}
      paymentConfig={loja?.paymentFees ?? null}
      slug={loja?.slug ?? null}
    />
  );
}
