import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";
import AdminOrderCard from "@/components/AdminOrderCard";
import { getNextDeliveryInfo } from "@/lib/deliveryDates";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub Admin — Pedidos de Insumos" };

export default async function AdminOrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  const perms = (session.user as any)?.permissions || "";
  if (role !== "ADMIN" && role !== "STAFF") redirect("/store");

  // Buscar TODOS os pedidos de insumos (model Order), incluindo dados do user e itens
  const orders = await prisma.order.findMany({
    include: {
      user: {
        select: { id: true, name: true, email: true, city: true, cpfCnpj: true }
      },
      items: {
        include: { product: true }
      },
      history: {
        orderBy: { createdAt: "desc" }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  // Obter datas de entrega por cidade
  const cityDeliveryMap: Record<string, any> = {};
  for (const order of orders) {
    const city = order.user.city;
    if (city && !cityDeliveryMap[city]) {
      cityDeliveryMap[city] = await getNextDeliveryInfo(city);
    }
  }

  // Estatísticas rápidas
  const stats = {
    total: orders.length,
    pendentes: orders.filter(o => o.status === "PENDING_PAYMENT").length,
    pagos: orders.filter(o => o.status === "PAGO" || o.status === "PAID").length,
    entrega: orders.filter(o => o.status === "AGUARDANDO_ENTREGA").length,
    finalizados: orders.filter(o => o.status === "FINALIZADO").length,
    cancelados: orders.filter(o => o.status === "CANCELADO").length,
    emergencias: orders.filter(o => o.isEmergency && o.emergencyStatus === "PENDING_APPROVAL").length,
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "var(--bg-body)" }}>
      <AdminSidebar />
      <main style={{ flex: 1, marginLeft: "250px", padding: "2rem" }} className="admin-main-content">
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem"
        }}>
          <div>
            <h1 className="font-extrabold" style={{ fontSize: "1.4rem", margin: 0 }}>
              📦 Pedidos de Insumos
            </h1>
            <p className="text-muted" style={{ fontSize: "0.82rem", margin: "4px 0 0" }}>
              Gerencie todos os pedidos de insumos da Icebox Distribuidora
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem"
        }}>
          <StatCard label="Total" value={stats.total} color="#475569" />
          <StatCard label="Pendentes" value={stats.pendentes} color="#F59E0B" />
          <StatCard label="Pagos" value={stats.pagos} color="#16A34A" />
          <StatCard label="Entrega" value={stats.entrega} color="#2563EB" />
          <StatCard label="Finalizados" value={stats.finalizados} color="#10B981" />
          <StatCard label="Cancelados" value={stats.cancelados} color="#EF4444" />
          {stats.emergencias > 0 && (
            <StatCard label="🚨 Emergência" value={stats.emergencias} color="#DC2626" highlight />
          )}
        </div>

        {/* Lista de Pedidos */}
        {orders.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "4rem 2rem" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📭</div>
            <p className="text-muted" style={{ fontWeight: 600 }}>Nenhum pedido de insumos encontrado.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {orders.map(order => (
              <AdminOrderCard
                key={order.id}
                order={order}
                deliveryInfo={cityDeliveryMap[order.user.city || ""] || undefined}
              />
            ))}
          </div>
        )}

        <style>{`
          @media (max-width: 768px) {
            .admin-main-content {
              margin-left: 0 !important;
              padding: 1rem !important;
              padding-top: 70px !important;
            }
          }
        `}</style>
      </main>
    </div>
  );
}

function StatCard({ label, value, color, highlight }: {
  label: string; value: number; color: string; highlight?: boolean
}) {
  return (
    <div style={{
      background: highlight ? `${color}10` : "var(--bg-card)",
      borderRadius: "12px",
      padding: "1rem",
      border: `1.5px solid ${highlight ? color : "var(--border-color)"}`,
      textAlign: "center",
    }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}
