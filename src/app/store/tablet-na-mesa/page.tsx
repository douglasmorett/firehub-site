import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import TabletNaMesaClient from "./TabletNaMesaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Tablet na mesa" };

/**
 * /store/tablet-na-mesa — o cliente pede pelo tablet preso à mesa
 * (lib/tablet-da-mesa): apresentação, ativação com termo (R$ 29,90 por tablet
 * ativo no mês) e os tablets de cada mesa.
 */
export default async function TabletNaMesaPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  return <TabletNaMesaClient />;
}
