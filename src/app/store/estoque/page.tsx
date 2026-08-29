import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import EstoqueClient from "@/components/customer/EstoqueClient";
import { temEstruturaDeLotes } from "@/lib/garantir-colunas";

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

  // Garantir que é um lojista, funcionário ou admin
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") {
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

  // ── O FLUXO DO QR, EM NÚMEROS REAIS ──────────────────────────────────────
  //
  // A trilha na tela RELATA o que a loja já fez; ela não é um cartaz com quatro
  // passos fixos. Um passo que sabe se você já fez aquilo é software; um passo
  // que não sabe é decoração — e decoração o dono aprende a ignorar na segunda
  // visita, que foi exatamente o destino do banner anterior.
  //
  // `franchiseeId` é quem IMPRIMIU a etiqueta e `recebidoPorId` é quem RECEBEU.
  // Numa loja só os dois coincidem; numa rede, contar o passo 2 pelo
  // franchiseeId faria a fábrica nunca "receber" nada e o passo ficaria
  // pendente para sempre.
  const franchiseeId = user?.id || "";
  let fluxo = { criadas: 0, recebidos: 0, baixas: 0, disponivel: false };
  try {
    if (franchiseeId && (await temEstruturaDeLotes())) {
      const [criadas, recebidos, baixas] = await Promise.all([
        prisma.stockLot.count({ where: { franchiseeId } }),
        prisma.stockLot.count({ where: { recebidoPorId: franchiseeId } }),
        prisma.stockTransaction.count({
          where: { stockLotId: { not: null }, stockItem: { franchiseeId } },
        }),
      ]);
      fluxo = { criadas, recebidos, baixas, disponivel: true };
    }
  } catch {
    // Recurso opcional não derruba o módulo de estoque: sem os números, a
    // trilha aparece do mesmo jeito, só sem o relato.
    fluxo = { criadas: 0, recebidos: 0, baixas: 0, disponivel: false };
  }

  return (
    <EstoqueClient 
      fluxo={fluxo}
      userName={user?.name || session.user?.name || "Administrador"} 
      storeName={user?.storeName || "Minha Loja"} 
    />
  );
}
