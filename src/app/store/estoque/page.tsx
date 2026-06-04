import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import EstoqueClient from "@/components/customer/EstoqueClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Controle de Estoque" };

export default async function EstoquePage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[EstoquePage] Erro ao obter sessão:", err);
    return null;
  });

  if (!session) redirect("/login");

  const email = session.user?.email || "";
  const role = (session.user as any)?.role;

  // Garantir que é um lojista ou admin
  if (role !== "FRANCHISEE" && role !== "ADMIN") {
    redirect("/store");
  }

  // Obter detalhes do lojista
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, storeName: true },
  });

  if (!user && role !== "ADMIN") {
    redirect("/store");
  }

  return (
    <EstoqueClient 
      userName={user?.name || session.user?.name || "Administrador"} 
      storeName={user?.storeName || "Minha Loja"} 
    />
  );
}
