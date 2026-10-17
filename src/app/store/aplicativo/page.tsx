import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AplicativoClient from "./AplicativoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Aplicativo da loja" };

/**
 * /store/aplicativo — o aplicativo próprio da loja (Play Store e App Store):
 * apresentação, preços e o pedido para a FireHub desenvolver
 * (lib/app-da-loja/solicitacao.ts).
 */
export default async function AplicativoPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <AplicativoClient />;
}
