import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import PortalDoParceiro from "@/components/parceiro/PortalDoParceiro";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatório do parceiro - FireHub Admin" };

/**
 * O admin abre o MESMO relatório que o parceiro vê no portal — para enxergar
 * a estrutura de cada embaixador/vendedor, o que ele vai receber e quem está
 * devendo (pedido do Douglas, 30/09/2026). Só ADMIN: o layout de /admin deixa
 * STAFF passar.
 */
export default async function RelatorioDoParceiroNoAdmin({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if ((session.user as any)?.role !== "ADMIN") redirect("/store");

  const { id } = await params;
  const { de } = await searchParams;
  const relatorio = await relatorioDoParceiro(id);
  if (!relatorio) notFound();

  const voltarPara = de === "ambassadors" ? "/admin?aba=ambassadors" : "/admin?aba=vendedores";
  return <PortalDoParceiro relatorio={relatorio} modo="ADMIN" voltarPara={voltarPara} />;
}
