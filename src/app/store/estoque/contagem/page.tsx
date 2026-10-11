import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ContagemClient from "./ContagemClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Contagem de estoque" };

/**
 * /store/estoque/contagem — a contagem de estoque, base do CMV real.
 * Abre para quem tem "Estoque" (prefixo /store/estoque em
 * lib/permissao-da-tela.ts). Valor em R$ só aparece para quem vê dados
 * sensíveis: a API decide (lib/cmv/acesso.ts).
 */
export default async function ContagemPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <ContagemClient />;
}
