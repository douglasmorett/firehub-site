import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import BillClient from "./BillClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Bill, seu assessor" };

/**
 * /store/bill — Bill, seu assessor: o dono lança estoque e financeiro pelo WhatsApp da
 * loja (áudio, texto ou foto). Liga e desliga aqui; R$ 29,90/mês no boleto.
 */
export default async function BillPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <BillClient />;
}
