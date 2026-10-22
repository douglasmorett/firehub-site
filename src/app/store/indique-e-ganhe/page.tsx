import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import IndiqueEGanheClient from "./IndiqueEGanheClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Indique e ganhe" };

/**
 * /store/indique-e-ganhe — o programa de indicação entre lojistas explicado
 * por inteiro (lib/indique-e-ganhe.ts), com o link e o andamento da conta.
 * Douglas, 22/10/2026: "coloca um botão de indique e ganhe [no topo], o
 * pessoal poder ver, explicando bem detalhado como é que funciona."
 */
export default async function IndiqueEGanhePage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <IndiqueEGanheClient />;
}
