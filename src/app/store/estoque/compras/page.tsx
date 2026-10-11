import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ComprasClient from "./ComprasClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Compras" };

/**
 * /store/estoque/compras — as compras lançadas (nota com IA e sem nota), cada
 * uma com o estoque que gerou e as contas a pagar. Abre para quem tem "Estoque".
 */
export default async function ComprasPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <ComprasClient />;
}
