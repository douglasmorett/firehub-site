import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ImportarClient from "./ImportarClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Importar produtos do mercado" };

/**
 * /store/caixa-mercado/importar — o cadastro do mercado em lote: planilha do
 * PDV antigo, XML das notas de compra, NCM pela IA e a planilha por NCM para o
 * contador (lib/caixa-mercado/importar.ts).
 */
export default async function ImportarPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <ImportarClient />;
}
