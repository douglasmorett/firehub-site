import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ehEquipeInterna } from "@/lib/equipe-interna";

export const metadata = { title: "FireHub Admin — Painel de Gestão", manifest: "/admin.webmanifest" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!(await ehEquipeInterna(session))) redirect("/store");

  return <>{children}</>;
}
