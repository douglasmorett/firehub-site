import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import EscalaClient from "./EscalaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Escala da equipe" };

/**
 * /store/escala — a Escala da equipe (lib/escala-da-equipe): turnos e vagas
 * por dia, quem vem, o link de inscrição para o grupo e a impressão para a
 * parede. Incluso no plano. Funcionário entra com a caixinha "Escala da
 * equipe" (o proxy barra antes de chegar aqui — lib/permissao-da-tela.ts).
 */
export default async function EscalaPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <EscalaClient />;
}
