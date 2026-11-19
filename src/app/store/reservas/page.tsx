import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ReservasClient from "./ReservasClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Reservas de mesa" };

/**
 * /store/reservas — o módulo de reservas de mesa: apresentação, ativação com
 * termo e R$ 97/mês no boleto (lib/reservas); ligado, o painel do dia, da
 * semana, do mês, os resultados e a configuração.
 */
export default async function ReservasPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <ReservasClient />;
}
