import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import BalancaClient from "./BalancaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Balança" };

/**
 * /store/balanca — o módulo de self-service por quilo: apresentação, ativação
 * com termo e R$ 197/mês no boleto, à parte da mensalidade (lib/balanca).
 */
export default async function BalancaPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <BalancaClient />;
}
