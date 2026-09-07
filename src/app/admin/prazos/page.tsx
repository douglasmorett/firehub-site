import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";
import PrazosAdminClient from "./PrazosAdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub Prazos — contas da extensão" };

/**
 * Contas da extensão FireHub Prazos — o produto vendido fora do FireHub.
 *
 * Aqui se cria a conta do piloto (e-mail, senha, loja, WhatsApp), se vê o
 * último sinal de cada extensão instalada (host do painel, pedidos lidos,
 * prazo aplicado, erro) e se corta ou libera o uso. A compra na Cakto faz o
 * mesmo sozinha pelo webhook (/api/prazos/cakto); esta tela é para o piloto
 * e para o suporte.
 */
export default async function AdminPrazosPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if ((session.user as any)?.role !== "ADMIN") redirect("/store");

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "var(--bg-body)" }}>
      <AdminSidebar />
      <main style={{ flex: 1, marginLeft: "250px", padding: "2rem" }} className="admin-main-content">
        <PrazosAdminClient />
      </main>
    </div>
  );
}
