import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function StoreOrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.email) redirect("/login");

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "FRANCHISEE") redirect("/store");

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' }
  });

  const STATUS_MAP: Record<string, { label: string; bg: string; color: string; icon: string }> = {
    PENDING_PAYMENT: { label: "Aguardando Pagamento", bg: "#FEF3C7", color: "#92400E", icon: "⏳" },
    PAGO: { label: "Pago", bg: "#DCFCE7", color: "#166534", icon: "✅" },
    AGUARDANDO_ENTREGA: { label: "Aguardando Entrega", bg: "#DBEAFE", color: "#1E40AF", icon: "📦" },
    FINALIZADO: { label: "Finalizado", bg: "#F0FDF4", color: "#16A34A", icon: "🎉" },
    CANCELADO: { label: "Cancelado", bg: "#FEE2E2", color: "#DC2626", icon: "❌" },
  };

  return (
    <div className="container" style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: "1.5rem", margin: 0, color: "#0F172A" }}>📋 Meus Pedidos de Insumos</h1>
          <p style={{ color: "#64748B", fontSize: "0.85rem", margin: "4px 0 0" }}>Acompanhe todos os seus pedidos e pagamentos</p>
        </div>
        <Link href="/store/compras" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 12, fontWeight: 700, fontSize: "0.88rem",
          background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
          textDecoration: "none", boxShadow: "0 4px 12px rgba(21,101,192,0.3)",
        }}>
          ← Voltar às Compras
        </Link>
      </div>

      {orders.length === 0 ? (
        <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📭</div>
          <p style={{ color: "#94A3B8", fontWeight: 600, fontSize: "1rem" }}>Você ainda não realizou nenhum pedido de insumo.</p>
          <Link href="/store/compras" style={{
            display: "inline-flex", marginTop: "1rem", padding: "10px 24px", borderRadius: 12,
            background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
            fontWeight: 700, textDecoration: "none",
          }}>
            🛒 Fazer Primeiro Pedido
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {orders.map(order => {
            const st = STATUS_MAP[order.status] || { label: order.status, bg: "#F1F5F9", color: "#475569", icon: "📄" };
            return (
              <div key={order.id} style={{
                background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0",
                overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}>
                {/* Order Header */}
                <div style={{ padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", borderBottom: "1px solid #F1F5F9" }}>
                  <div>
                    <span style={{ fontWeight: 800, fontSize: "1rem", color: "#0F172A" }}>
                      Pedido #{order.id.slice(-6).toUpperCase()}
                    </span>
                    <p style={{ color: "#94A3B8", fontSize: "0.78rem", margin: "2px 0 0" }}>
                      {new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                      {" · "}
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{
                      padding: "4px 12px", borderRadius: 20, fontWeight: 700, fontSize: "0.75rem",
                      background: st.bg, color: st.color,
                    }}>
                      {st.icon} {st.label}
                    </span>
                    <span style={{ fontWeight: 900, fontSize: "1.15rem", color: "#1565C0" }}>
                      R$ {order.totalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <div style={{ padding: "0.75rem 1.25rem" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {order.items.map(item => (
                      <span key={item.id} style={{
                        fontSize: "0.78rem", padding: "3px 10px", borderRadius: 8,
                        background: "#F8FAFC", color: "#475569", fontWeight: 500,
                      }}>
                        {item.quantity}x {item.product.name}
                      </span>
                    ))}
                  </div>
                </div>

                {order.isEmergency && order.emergencyStatus === "REJECTED" && order.rejectionReason && (
                  <div style={{ margin: "0 1.25rem 0.75rem", padding: "10px 14px", background: "#FEF2F2", borderRadius: 10, border: "1px solid #FECACA" }}>
                    <p style={{ color: "#DC2626", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
                      ❌ Motivo da reprovação: {order.rejectionReason}
                    </p>
                  </div>
                )}

                {/* Payment Link */}
                {order.status === "PENDING_PAYMENT" && order.boletoUrl && (
                  <div style={{ padding: "0.75rem 1.25rem 1rem", borderTop: "1px solid #F1F5F9" }}>
                    <a href={order.boletoUrl} target="_blank" rel="noreferrer" style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", padding: "12px", borderRadius: 12,
                      background: "linear-gradient(135deg, #16A34A, #22C55E)", color: "#fff",
                      fontWeight: 800, fontSize: "0.92rem", textDecoration: "none",
                      boxShadow: "0 4px 12px rgba(22,163,74,0.3)",
                    }}>
                      💳 Pagar Agora
                    </a>
                  </div>
                )}

                {order.isEmergency && (
                  <div style={{ padding: "0 1.25rem 0.75rem" }}>
                    <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 6, background: "#FEF2F2", color: "#DC2626", fontWeight: 700 }}>
                      🚨 PEDIDO EMERGENCIAL
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
