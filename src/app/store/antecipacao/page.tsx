import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AntecipacaoClient from "@/components/customer/AntecipacaoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Antecipação de Produção" };

// Aberta para toda loja desde 18/10/2026 (era só do Hakim). Funcionário entra
// com KDS, Relatórios ou Financeiro (lib/permissao-da-tela.ts, no proxy).
export default async function AntecipacaoPage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[AntecipacaoPage] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  return <AntecipacaoClient />;
}
