import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import AntecipacaoClient from "@/components/customer/AntecipacaoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Antecipação de Produção" };

export default async function AntecipacaoPage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[AntecipacaoPage] Erro ao obter sessão:", err);
    return null;
  });

  if (!session) redirect("/login");

  const email = session.user?.email || "";
  const role = (session.user as any)?.role;

  // Apenas contatohakim@gmail.com e ADMINs podem acessar
  if (email !== "contatohakim@gmail.com" && role !== "ADMIN") {
    redirect("/store");
  }

  // Obter detalhes do usuário lojista
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      storeName: true,
      role: true,
    },
  });

  if (!user && role !== "ADMIN") {
    redirect("/store");
  }

  return (
    <AntecipacaoClient 
      userName={user?.name || session.user?.name || "Administrador"} 
      storeName={user?.storeName || "Hakim Contato"} 
    />
  );
}
