import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import IfoodHomologacaoClient from "./IfoodHomologacaoClient";

export const dynamic = "force-dynamic";

export default async function IfoodPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const merchantId = process.env.IFOOD_MERCHANT_UUID || "";
  const clientId   = process.env.IFOOD_CLIENT_ID || "";

  return <IfoodHomologacaoClient merchantId={merchantId} clientId={clientId} />;
}
