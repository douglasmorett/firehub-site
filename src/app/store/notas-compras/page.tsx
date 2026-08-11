import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NotasComprasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  redirect("/store/financeiro?tab=notascompras");
}
