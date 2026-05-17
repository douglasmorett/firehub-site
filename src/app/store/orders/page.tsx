import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createAsaasPayment } from "@/lib/asaas";

export const dynamic = "force-dynamic";

export default async function StoreOrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, name: true, email: true, cpfCnpj: true },
  });
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "FRANCHISEE") redirect("/store");

  // ── Auto-fix: gerar links de pagamento faltantes ──────────────────
  const pendingNoLink = await prisma.order.findMany({
    where: { userId: user.id, status: "PENDING_PAYMENT", boletoUrl: null },
  });

  for (const order of pendingNoLink) {
    try {
      const shortId = order.id.slice(-6).toUpperCase();
      const result = await createAsaasPayment({
        userName: user.name || user.email || "",
        userEmail: user.email || "",
        cpfCnpj: user.cpfCnpj || "",
        totalAmount: order.totalAmount,
        orderId: order.id,
        description: `Pedido #${shortId} — Icebox Congelados`,
      });
      if (result) {
        await prisma.order.update({
          where: { id: order.id },
          data: { boletoUrl: result.boletoUrl, asaasPaymentId: result.paymentId },
        });
        console.log(`[auto-fix] Pedido #${shortId} link gerado: ${result.boletoUrl}`);
      }
    } catch (err) {
      console.error(`[auto-fix] Falha ao gerar link para ${order.id}:`, err);
    }
  }

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' }
  });

  const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
    PENDING_PAYMENT: { label: "Aguardando Pagamento", bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" },
    PAGO:            { label: "Pago",                  bg: "#DCFCE7", color: "#166534", border: "#BBF7D0" },
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
          <h1 style={{ fontWeight: 900, fontSize: "1.4rem", margin: 0, color: "#0F172A" }}>
            📋 Meus Pedidos de Insumos
          </h1>
          <p style={{ color: "#94A3B8", fontSize: "0.82rem", margin: "4px 0 0" }}>
            Acompanhe todos os seus pedidos e pagamentos
          </p>
        </div>
        <Link href="/store/compras" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem",
          background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
          textDecoration: "none", boxShadow: "0 3px 10px rgba(21,101,192,0.25)",
        }}>
          ← Voltar às Compras
        </Link>
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
            const isCancelled = order.status === "CANCELADO";

            return (
              <div key={order.id} style={{
                background: "#fff", borderRadius: 14,
                border: `1.5px solid ${isCancelled ? "#FECACA" : "#E2E8F0"}`,
                overflow: "hidden",
              }}>

                {/* ── Card Header ── */}
                <div style={{
                  padding: "1rem 1.25rem",
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  borderBottom: "1px solid #F1F5F9",
                }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>
                      Pedido #{shortId}
                    </div>
                    <div style={{ color: "#94A3B8", fontSize: "0.78rem", marginTop: 2 }}>
                      {new Date(order.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit", month: "long", year: "numeric"
                      })}
                      {" · "}
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit", minute: "2-digit"
                      })}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{
                      padding: "4px 12px", borderRadius: 8, fontWeight: 700, fontSize: "0.73rem",
                      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                      whiteSpace: "nowrap",
                    }}>
                      {st.label}
                    </span>
                    <span style={{ fontWeight: 900, fontSize: "1.1rem", color: "#0F172A", whiteSpace: "nowrap" }}>
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

                {/* ── Aviso: sem link de pagamento ── */}
                {isPending && !order.boletoUrl && (
                  <div style={{ padding: "0 1.25rem 1rem" }}>
                    <div style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "#FEF3C7", border: "1px solid #FDE68A",
                      fontSize: "0.8rem", color: "#92400E", fontWeight: 600, textAlign: "center",
                    }}>
                      ⏳ Link de pagamento sendo gerado — atualize a página em alguns instantes
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
