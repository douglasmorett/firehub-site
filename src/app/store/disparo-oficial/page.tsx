import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import DisparoOficialClient from "./DisparoOficialClient";

export const dynamic = "force-dynamic";

/** Disparo de promoção pela API oficial da Meta (lib/disparo-oficial). Só o dono da loja. */
export default async function DisparoOficialPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/store");
  return <DisparoOficialClient />;
}
