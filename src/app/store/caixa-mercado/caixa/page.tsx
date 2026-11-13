import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import CaixaClient from "./CaixaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Caixa" };

/**
 * /store/caixa-mercado/caixa — a frente de caixa em tela cheia
 * (lib/caixa-mercado). `?simular=1` usa a balança simulada (nada muda na venda:
 * a venda é de verdade; só o peso vem de uma balança de mentira).
 */
export default async function CaixaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  const sp = await searchParams;
  return <CaixaClient simularBalanca={sp?.simular === "1"} />;
}
