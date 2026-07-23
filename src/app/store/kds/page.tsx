import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import KDSHubClient from "./KDSHubClient";

export const dynamic = "force-dynamic";

export default async function KDSPage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[KDSPage] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  return <KDSHubClient />;
}
