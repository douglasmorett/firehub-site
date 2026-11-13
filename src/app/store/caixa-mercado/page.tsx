import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ModuloClient from "./ModuloClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Caixa de mercado" };

/**
 * /store/caixa-mercado — o módulo: apresentação, termo e R$ 97 por computador,
 * os computadores de caixa, o TEF de cada um e a configuração (lib/caixa-mercado).
 */
export default async function CaixaDeMercadoPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <ModuloClient />;
}
