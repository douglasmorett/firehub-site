import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import GeneratePaymentLink from "@/components/GeneratePaymentLink";

export const dynamic = "force-dynamic";

export default async function StoreOrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, name: true, email: true, cpfCnpj: true, storeTimezone: true },
  });
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "FRANCHISEE" && user.role !== "STAFF") redirect("/store");

  const tz = user.storeTimezone || "America/Sao_Paulo";

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' }
  });

  const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
    PENDING_PAYMENT: { label: "Aguardando Pagamento", bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" },
    PAGO:            { label: "Pago",                  bg: "#DCFCE7", color: "#166534", border: "#BBF7D0" },
    PAID:            { label: "Pago",                  bg: "#DCFCE7", color: "#166534", border: "#BBF7D0" },
    AGUARDANDO_ENTREGA: { label: "Aguardando Entrega", bg: "#DBEAFE", color: "#1E40AF", border: "#BFDBFE" },
    FINALIZADO:      { label: "Finalizado",            bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0" },
    CANCELADO:       { label: "Cancelado",             bg: "#FEE2E2", color: "#DC2626", border: "#FECACA" },
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem" }}>

      {/* ── HEADER ──────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem",
      }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: "1.3rem", margin: 0, color: "#0F172A" }}>
            📋 Meus Pedidos
          </h1>
          <p style={{ color: "#94A3B8", fontSize: "0.78rem", margin: "4px 0 0" }}>
            Acompanhe pedidos e pagamentos
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href="/store/perfil" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem",
            background: "#fff", color: "#475569", border: "1.5px solid #E2E8F0",
            textDecoration: "none", whiteSpace: "nowrap",
          }}>
            👤 Perfil
          </Link>
          <Link href="/store/compras" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem",
            background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
            textDecoration: "none", boxShadow: "0 3px 10px rgba(21,101,192,0.25)",
            whiteSpace: "nowrap",
          }}>
            ← Compras
          </Link>
        </div>
      </div>

      {/* ── LISTA DE PEDIDOS ────────────────────────────── */}
      {orders.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "4rem 1.5rem", background: "#fff",
          borderRadius: 14, border: "1px solid #E2E8F0",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📭</div>
          <p style={{ color: "#94A3B8", fontWeight: 600 }}>Nenhum pedido realizado ainda.</p>
          <Link href="/store/compras" style={{
            display: "inline-flex", marginTop: "1rem", padding: "10px 24px", borderRadius: 10,
            background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
            fontWeight: 700, textDecoration: "none",
          }}>
            🛒 Fazer Primeiro Pedido
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {orders.map(order => {
            const st = STATUS_CONFIG[order.status] || { label: order.status, bg: "#F1F5F9", color: "#475569", border: "#E2E8F0" };
            const shortId = order.id.slice(-6).toUpperCase();
            const isPending = order.status === "PENDING_PAYMENT";
            const isPaid = order.status === "PAGO" || order.status === "PAID";
            const isCancelled = order.status === "CANCELADO";

            return (
              <div key={order.id} style={{
                background: "#fff", borderRadius: 14,
                border: `1.5px solid ${isCancelled ? "#FECACA" : "#E2E8F0"}`,
                overflow: "hidden",
              }}>

                {/* ── Card Header ── */}
                <div style={{
                  padding: "1rem 1rem",
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  borderBottom: "1px solid #F1F5F9",
                  flexWrap: "wrap", gap: "0.5rem",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "1rem", color: "#0F172A" }}>
                      Pedido #{shortId}
                    </div>
                    <div style={{ color: "#94A3B8", fontSize: "0.75rem", marginTop: 2 }}>
                      {new Date(order.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit", month: "long", year: "numeric",
                        timeZone: tz
                      })}
                      {" · "}
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit", minute: "2-digit",
                        timeZone: tz
                      })}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 8, fontWeight: 700, fontSize: "0.7rem",
                      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                      whiteSpace: "nowrap",
                    }}>
                      {st.label}
                    </span>
                    <span style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", whiteSpace: "nowrap" }}>
                      R$ {order.totalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* ── Itens (tabela limpa) ── */}
                <div style={{ padding: "0.75rem 1.25rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <tbody>
                      {order.items.map((item, idx) => (
                        <tr key={item.id} style={{
                          borderBottom: idx < order.items.length - 1 ? "1px solid #F8FAFC" : "none",
                        }}>
                          <td style={{ padding: "5px 0", color: "#475569" }}>
                            <span style={{ fontWeight: 700, color: "#1565C0", marginRight: 6 }}>
                              {item.quantity}x
                            </span>
                            {item.product.name}
                          </td>
                          <td style={{ padding: "5px 0", textAlign: "right", color: "#64748B", fontWeight: 600, whiteSpace: "nowrap" }}>
                            R$ {(item.price * item.quantity).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Emergência badge ── */}
                {order.isEmergency && (
                  <div style={{ padding: "0 1.25rem 0.5rem" }}>
                    <span style={{
                      fontSize: "0.7rem", padding: "3px 10px", borderRadius: 6,
                      background: "#FEF2F2", color: "#DC2626", fontWeight: 700,
                      border: "1px solid #FECACA",
                    }}>
                      🚨 PEDIDO EMERGENCIAL
                    </span>
                  </div>
                )}

                {/* ── Motivo de reprovação ── */}
                {order.isEmergency && order.emergencyStatus === "REJECTED" && order.rejectionReason && (
                  <div style={{ margin: "0 1.25rem 0.75rem", padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, border: "1px solid #FECACA" }}>
                    <p style={{ color: "#DC2626", fontSize: "0.8rem", fontWeight: 600, margin: 0 }}>
                      ❌ Motivo: {order.rejectionReason}
                    </p>
                  </div>
                )}

                {/* ── Botão Pagar ── */}
                {isPending && order.boletoUrl && (
                  <div style={{ padding: "0 1.25rem 1rem" }}>
                    <a href={order.boletoUrl} target="_blank" rel="noreferrer" style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", padding: "11px", borderRadius: 10,
                      background: "linear-gradient(135deg, #16A34A, #22C55E)", color: "#fff",
                      fontWeight: 800, fontSize: "0.9rem", textDecoration: "none",
                      boxShadow: "0 3px 10px rgba(22,163,74,0.25)",
                    }}>
                      💳 Pagar Agora
                    </a>
                  </div>
                )}

                {/* ── Sem link: gera automaticamente via client-side ── */}
                {isPending && !order.boletoUrl && (
                  <div style={{ padding: "0 1.25rem 1rem" }}>
                    <GeneratePaymentLink orderId={order.id} shortId={shortId} />
                  </div>
                )}

                {/* ── Badge de pagamento confirmado ── */}
                {isPaid && (
                  <div style={{ padding: "0 1.25rem 1rem" }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", padding: "11px", borderRadius: 10,
                      background: "#DCFCE7", color: "#166534",
                      fontWeight: 800, fontSize: "0.9rem",
                      border: "1.5px solid #BBF7D0",
                    }}>
                      ✅ Pagamento Confirmado
                    </div>
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
