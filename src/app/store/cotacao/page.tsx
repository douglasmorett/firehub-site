import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import CotacaoClient from "./CotacaoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Cotação automática" };

/**
 * /store/cotacao — a Cotação automática (lib/cotacao): apresentação e ativação
 * com termo (R$ 97/mês no boleto, à parte da mensalidade) e, ligada, o
 * comparativo, os fornecedores, os produtos, a agenda e os pedidos.
 */
export default async function CotacaoPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <CotacaoClient />;
}
