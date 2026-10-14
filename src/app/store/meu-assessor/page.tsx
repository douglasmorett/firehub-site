import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import MeuAssessorClient from "./MeuAssessorClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Meu Assessor" };

/**
 * /store/meu-assessor — o dono lança estoque e financeiro pelo WhatsApp da
 * loja (áudio, texto ou foto). Liga e desliga aqui; R$ 29,90/mês no boleto.
 */
export default async function MeuAssessorPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <MeuAssessorClient />;
}
