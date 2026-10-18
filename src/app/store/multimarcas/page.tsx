import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import MultimarcasClient from "./MultimarcasClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Multimarcas" };

/**
 * /store/multimarcas — a página das várias marcas da mesma cozinha (dark
 * kitchen): apresentação, ativação com termo e R$ 97/mês no boleto, à parte
 * da mensalidade (lib/multimarcas).
 */
export default async function MultimarcasPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <MultimarcasClient />;
}
