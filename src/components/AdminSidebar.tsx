import Link from "next/link";
import { LayoutDashboard, Package, Users, ShoppingCart, LogOut, Truck, DollarSign, UserCog, Receipt, Sparkles, Tag, UtensilsCrossed, BarChart3, Warehouse, Calculator, ClipboardCheck, Bike, Store } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import MobileMenuToggle from "./MobileMenuToggle";

export default async function AdminSidebar() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role || "";

  // Busca permissões SEMPRE do banco de dados (mais confiável que o JWT)
  let perms = "";
  if (session?.user?.email && role === "STAFF") {
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { permissions: true }
    });
    perms = dbUser?.permissions || "";
  }

  const can = (key: string) => hasPermission(perms, key, role);

  // Para FRANCHISEE, mostrar menu simplificado
  const isFranchisee = role === "FRANCHISEE";

  return (
    <>
      {/* Mobile top bar */}
      <div style={{
        display: "none",
        position: "fixed",
        top: 0, left: 0, right: 0,
        height: "60px",
        backgroundColor: "var(--surface)",
        borderBottom: "1px solid var(--border-color)",
        zIndex: 400,
        alignItems: "center",
        justifyContent: "center",
        padding: "0 1rem"
      }} className="mobile-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#EF4444", fontWeight: 900, fontSize: "1.1rem" }}>HAKIM</span>
        </div>
      </div>

      <MobileMenuToggle />

      {/* Sidebar */}
      <aside id="admin-sidebar" style={{
        width: "250px",
        backgroundColor: "var(--surface)",
        borderRight: "1px solid var(--border-color)",
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        transition: "transform 0.3s ease",
        boxShadow: "10px 0 30px rgba(0,0,0,0.3)"
      }}>
        <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
            <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="48" fill="#1E293B" stroke="#EF4444" strokeWidth="3"/>
              <path d="M50 15C45 30 30 40 30 55C30 68 39 80 50 85C61 80 70 68 70 55C70 40 55 30 50 15Z" fill="#EF4444"/>
              <path d="M50 35C47 45 40 50 40 58C40 65 44 72 50 75C56 72 60 65 60 58C60 50 53 45 50 35Z" fill="#FF8C00"/>
              <circle cx="50" cy="60" r="6" fill="#FFD700"/>
            </svg>
            <div>
              <span style={{ color: "#EF4444", fontWeight: 900, fontSize: "1.3rem" }}>HAKIM</span>
            </div>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{session?.user?.name}</p>
          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", opacity: 0.6 }}>
            {role === "ADMIN" ? "Administrador" : isFranchisee ? "Franqueado" : "Equipe"}
          </p>
        </div>

        <nav style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "4px", flex: 1, overflowY: "auto" }}>
          
          {/* ===== OPERAÇÃO ===== */}
          <p style={{ fontSize: ".65rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, padding: "8px 12px 4px", margin: 0 }}>Operação</p>

          {can("dashboard") && (
            <Link href="/admin" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <LayoutDashboard size={18} style={{ marginRight: "10px" }} /> Dashboard
            </Link>
          )}
          {can("orders") && (
            <Link href="/admin/orders" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <ShoppingCart size={18} style={{ marginRight: "10px" }} /> Pedidos
            </Link>
          )}
          {(role === "ADMIN" || isFranchisee) && (
            <Link href="/admin/cardapio" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <UtensilsCrossed size={18} style={{ marginRight: "10px" }} /> Cardápio Digital
            </Link>
          )}
          {(role === "ADMIN" || isFranchisee) && (
            <Link href="/admin/motoboys" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <Bike size={18} style={{ marginRight: "10px" }} /> Motoboys
            </Link>
          )}

          {/* ===== GESTÃO ===== */}
          <p style={{ fontSize: ".65rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, padding: "12px 12px 4px", margin: 0 }}>Gestão</p>

          {can("invoices") && (
            <Link href="/admin/invoices" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <Receipt size={18} style={{ marginRight: "10px" }} /> Notas de Compras
            </Link>
          )}
          {can("products") && (
            <Link href="/admin/products" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <Package size={18} style={{ marginRight: "10px" }} /> Produtos
            </Link>
          )}
          {can("products") && (
            <Link href="/admin/labels" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <Tag size={18} style={{ marginRight: "10px" }} /> Validação / Etiquetas
            </Link>
          )}

          {/* ===== FINANCEIRO ===== */}
          <p style={{ fontSize: ".65rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, padding: "12px 12px 4px", margin: 0 }}>Financeiro</p>

          {(can("finance") || can("payables")) && (
            <Link href="/admin/finance" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
              <DollarSign size={18} style={{ marginRight: "10px" }} /> Contas a Pagar
            </Link>
          )}
          {role === "ADMIN" && (
            <Link href="/admin/gestao-financeira" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none", borderLeft: "3px solid #DC2626", background: "rgba(220,38,38,0.06)" }}>
              <BarChart3 size={18} style={{ marginRight: "10px", color: "#DC2626" }} /> Gestão Financeira
            </Link>
          )}

          {/* ===== FERRAMENTAS ===== */}
          <p style={{ fontSize: ".65rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, padding: "12px 12px 4px", margin: 0 }}>Ferramentas</p>

          {(role === "ADMIN" || isFranchisee) && (
            <Link href="/admin/checklist" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none", background: "linear-gradient(135deg, rgba(234,179,8,0.08), rgba(249,115,22,0.08))", borderLeft: "3px solid #F59E0B" }}>
              <ClipboardCheck size={18} style={{ marginRight: "10px", color: "#F59E0B" }} /> Checklist IA
            </Link>
          )}
          {role === "ADMIN" && (
            <Link href="/admin/ai-chat" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none", background: "linear-gradient(135deg, rgba(102,126,234,0.1), rgba(118,75,162,0.1))", borderLeft: "3px solid #667eea" }}>
              <Sparkles size={18} style={{ marginRight: "10px", color: "#667eea" }} /> FireHub IA
            </Link>
          )}

          {/* ===== ADMIN ===== */}
          {role === "ADMIN" && (
            <>
              <p style={{ fontSize: ".65rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, padding: "12px 12px 4px", margin: 0 }}>Administração</p>

              <Link href="/admin/franchisees" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
                <Users size={18} style={{ marginRight: "10px" }} /> Clientes
              </Link>
              <Link href="/admin/equipe" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
                <UserCog size={18} style={{ marginRight: "10px" }} /> Equipe / Acessos
              </Link>
              <Link href="/admin/routes" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none" }}>
                <Truck size={18} style={{ marginRight: "10px" }} /> Logística / Rotas
              </Link>
              <Link href="/admin/lojistas" className="btn btn-outline sidebar-link" style={{ justifyContent: "flex-start", border: "none", background: "rgba(220,38,38,0.06)", borderLeft: "3px solid #DC2626" }}>
                <Store size={18} style={{ marginRight: "10px", color: "#DC2626" }} /> Painel de Lojistas
              </Link>
            </>
          )}
        </nav>

        <div style={{ padding: "16px", borderTop: "1px solid var(--border-color)" }}>
          <a href="/api/auth/signout" className="btn" style={{ width: "100%", justifyContent: "flex-start", color: "var(--danger)" }}>
            <LogOut size={18} style={{ marginRight: "10px" }} /> Sair
          </a>
        </div>
      </aside>
    </>
  );
}
