"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Phone, MapPin, Clock, User, Package } from "lucide-react";

const STATUS_MAP: Record<string, { label: string, color: string }> = {
  "NOVO": { label: "🔔 Novo", color: "#3B82F6" },
  "ACEITO": { label: "✅ Aceito", color: "#10B981" },
  "PREPARANDO": { label: "👨‍🍳 Preparando", color: "#F59E0B" },
  "SAIU_ENTREGA": { label: "🛵 Saiu para Entrega", color: "#8B5CF6" },
  "ENTREGUE": { label: "📦 Entregue", color: "#10B981" },
  "CANCELADO": { label: "❌ Cancelado", color: "#EF4444" },
};

export default function CustomerOrdersList({ orders, isAdmin = false }: { orders: any[], isAdmin?: boolean }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const updateStatus = async (orderId: string, newStatus: string) => {
    setLoadingId(orderId);
    try {
      const res = await fetch("/api/customer-order/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: newStatus })
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Erro ao atualizar status.");
      }
    } catch {
      alert("Erro ao conectar.");
    } finally {
      setLoadingId(null);
    }
  };

  if (orders.length === 0) {
    return (
      <div className="card text-center" style={{ padding: "3rem" }}>
        <p className="text-muted">Nenhum pedido de cliente ainda.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {orders.map(order => {
        const expanded = expandedId === order.id;
        const statusInfo = STATUS_MAP[order.status] || { label: order.status, color: "#64748B" };
        const isLoading = loadingId === order.id;

        return (
          <div key={order.id} className="card" style={{ padding: "1rem", cursor: "pointer" }}>
            {/* HEADER */}
            <div onClick={() => setExpandedId(expanded ? null : order.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <div>
                  <span className="font-bold" style={{ fontSize: "1rem" }}>#{order.id.slice(-6).toUpperCase()}</span>
                  <p className="text-muted" style={{ fontSize: "0.75rem" }}>
                    <Clock size={12} style={{ display: "inline", verticalAlign: "middle" }} /> {new Date(order.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>

                {isAdmin && order.franchisee && (
                  <div style={{ padding: "0.3rem 0.6rem", backgroundColor: "var(--primary-light)", borderRadius: "6px", fontSize: "0.75rem", fontWeight: "bold" }}>
                    {order.franchisee.storeName || order.franchisee.name}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span className="font-extrabold" style={{ color: "var(--primary)" }}>R$ {order.totalAmount.toFixed(2)}</span>
                <span style={{ 
                  padding: "0.3rem 0.8rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: "bold",
                  backgroundColor: `${statusInfo.color}15`, color: statusInfo.color, border: `1px solid ${statusInfo.color}30`
                }}>
                  {statusInfo.label}
                </span>
                {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
            </div>

            {/* EXPANDED */}
            {expanded && (
              <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                  <div>
                    <p className="text-muted" style={{ fontSize: "0.75rem" }}>Cliente</p>
                    <p className="font-semibold" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <User size={14} /> {order.customerName}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: "0.75rem" }}>Telefone</p>
                    <a href={`https://wa.me/55${order.customerPhone.replace(/\D/g, '')}`} target="_blank" className="font-semibold" style={{ display: "flex", alignItems: "center", gap: "4px", color: "#25D366" }}>
                      <Phone size={14} /> {order.customerPhone}
                    </a>
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: "0.75rem" }}>Tipo</p>
                    <p className="font-semibold">{order.deliveryType === "DELIVERY" ? "🛵 Entrega" : "🏪 Retirada"}</p>
                  </div>
                  {order.customerAddress && (
                    <div>
                      <p className="text-muted" style={{ fontSize: "0.75rem" }}>Endereço</p>
                      <p className="font-semibold" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <MapPin size={14} /> {order.customerAddress}
                      </p>
                    </div>
                  )}
                </div>

                {order.notes && (
                  <div style={{ padding: "0.5rem", backgroundColor: "var(--primary-light)", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.85rem" }}>
                    💬 <strong>Obs:</strong> {order.notes}
                  </div>
                )}

                {/* ITEMS */}
                <h4 className="font-bold" style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>Itens</h4>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {order.items.map((item: any) => (
                    <li key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                      <span>{item.quantity}x {item.menuProduct.name}</span>
                      <span className="font-semibold">R$ {(item.price * item.quantity).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>

                {/* STATUS ACTIONS */}
                {order.status !== "ENTREGUE" && order.status !== "CANCELADO" && (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
                    {order.status === "NOVO" && (
                      <>
                        <button disabled={isLoading} onClick={() => updateStatus(order.id, "ACEITO")} className="btn btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
                          ✅ Aceitar
                        </button>
                        <button disabled={isLoading} onClick={() => updateStatus(order.id, "CANCELADO")} className="btn btn-outline" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", color: "var(--danger)" }}>
                          ❌ Recusar
                        </button>
                      </>
                    )}
                    {order.status === "ACEITO" && (
                      <button disabled={isLoading} onClick={() => updateStatus(order.id, "PREPARANDO")} className="btn btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
                        👨‍🍳 Preparando
                      </button>
                    )}
                    {order.status === "PREPARANDO" && (
                      <button disabled={isLoading} onClick={() => updateStatus(order.id, "SAIU_ENTREGA")} className="btn btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
                        🛵 Saiu para Entrega
                      </button>
                    )}
                    {order.status === "SAIU_ENTREGA" && (
                      <button disabled={isLoading} onClick={() => updateStatus(order.id, "ENTREGUE")} className="btn btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
                        📦 Marcar Entregue
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
