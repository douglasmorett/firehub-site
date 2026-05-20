"use client";

import { useState } from "react";
import AdminOrderStatusSelect from "./AdminOrderStatusSelect";
import { approveEmergencyOrder, rejectEmergencyOrder } from "@/app/actions/emergency";
import { ChevronDown, ChevronUp, MapPin, Calendar, CreditCard, Truck } from "lucide-react";
import Link from "next/link";

export default function AdminOrderCard({ order, deliveryInfo }: { order: any, deliveryInfo?: any }) {
  const [expanded, setExpanded] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);

  const getStatusLabel = (s: string) => {
    const labels: any = {
      "PENDING_PAYMENT": "Aguardando Pagamento",
      "AGUARDANDO_ENTREGA": "Aguardando Entrega",
      "FINALIZADO": "Finalizado",
      "PAID": "Pago",
      "PAGO": "Pago",
      "CANCELADO": "Cancelado"
    };
    return labels[s] || s;
  };

  const handleApproveEmergency = async () => {
    if (!confirm("Tem certeza que deseja APROVAR este pedido de emergência? O boleto será gerado.")) return;
    setLoadingAction(true);
    try {
      await approveEmergencyOrder(order.id);
      alert("Aprovado com sucesso!");
    } catch (e: any) {
      alert("Erro ao aprovar: " + e.message);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleRejectEmergency = async () => {
    if (!rejectReason) {
      alert("Por favor, informe o motivo da reprovação.");
      return;
    }
    setLoadingAction(true);
    try {
      await rejectEmergencyOrder(order.id, rejectReason);
      alert("Reprovado com sucesso.");
      setIsRejecting(false);
    } catch (e: any) {
      alert("Erro ao reprovar: " + e.message);
    } finally {
      setLoadingAction(false);
    }
  };

  const isPaid = order.status === "PAGO" || order.status === "PAID" || (order.status !== "PENDING_PAYMENT" && order.status !== "CANCELADO" && order.status !== "EMERGENCIA_PENDENTE");

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", transition: "all 0.3s ease" }}>
      {/* HEADER COMPACTO SEMPRE VISÍVEL */}
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr 2fr auto", gap: "1rem", alignItems: "center", cursor: "pointer", userSelect: "none" }}
      >
        <div>
          <h3 className="font-bold">
            #{order.id.slice(-6).toUpperCase()}
            {order.isEmergency && <span style={{ marginLeft: "0.5rem", backgroundColor: "var(--danger)", color: "white", padding: "0.1rem 0.4rem", borderRadius: "4px", fontSize: "0.65rem", verticalAlign: "middle" }}>EMERGÊNCIA</span>}
          </h3>
          <p className="text-muted" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            <Calendar size={12} style={{ display: "inline", marginRight: "4px" }} />
            {new Date(order.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MapPin size={16} color="var(--primary)" />
            <div>
              <p className="font-bold" style={{ fontSize: "0.9rem" }}>{order.user.city || "Sem Rota"}</p>
              <p className="text-muted" style={{ fontSize: "0.8rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px" }}>{order.user.name}</p>
            </div>
          </div>
          {deliveryInfo && deliveryInfo.deliveryStr !== "A definir" && (
             <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "1.5rem" }}>
               <Truck size={12} />
               <span>Previsto: {deliveryInfo.deliveryStr}</span>
             </div>
          )}
        </div>

        <div>
          <p className="font-extrabold" style={{ color: "var(--text-main)" }}>R$ {order.totalAmount.toFixed(2)}</p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", fontWeight: "bold", color: isPaid ? "var(--success)" : "var(--warning)" }}>
            <CreditCard size={14} />
            {isPaid ? "PAGO / ENCAMINHADO" : "EM ABERTO"}
          </div>
        </div>

        <div onClick={e => e.stopPropagation()}>
          {order.isEmergency && order.emergencyStatus === "PENDING_APPROVAL" ? (
            <span style={{ fontWeight: "bold", color: "var(--warning)", fontSize: "0.85rem" }}>Aguardando Aprovação</span>
          ) : (
            <AdminOrderStatusSelect orderId={order.id} currentStatus={order.status} />
          )}
        </div>

        <div>
          {expanded ? <ChevronUp size={20} color="var(--text-muted)" /> : <ChevronDown size={20} color="var(--text-muted)" />}
        </div>
      </div>

      {/* DETALHES (EXPANSÍVEL) */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem", marginTop: "0.5rem", animation: "fadeIn 0.3s ease" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
            
            {/* Lista de Itens */}
            <div>
              <p className="font-bold text-sm mb-3">Itens Solicitados</p>
              <ul style={{ listStyle: "none", margin: 0, fontSize: "0.85rem", backgroundColor: "var(--surface-1)", borderRadius: "8px", padding: "0.5rem 1rem" }}>
                {order.items.map((item: any) => (
                  <li key={item.id} className="flex justify-between" style={{ padding: "0.4rem 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                    <span><strong>{item.quantity}x</strong> {item.product.name}</span>
                    <span className="font-bold">R$ {(item.quantity * item.price).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              {order.status === "PENDING_PAYMENT" && (
                <div style={{ marginTop: "1rem" }}>
                  <Link href={`/admin/orders/${order.id}/edit`} className="btn btn-outline" style={{ fontSize: "0.85rem", width: "100%", textAlign: "center", display: "block" }}>
                    ✏️ Editar Itens e Valores
                  </Link>
                </div>
              )}
            </div>

            {/* Histórico e Outros */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ backgroundColor: "var(--surface-2)", padding: "1rem", borderRadius: "8px", fontSize: "0.8rem" }}>
                <p className="font-bold mb-2">Histórico de Alterações</p>
                {order.history.length === 0 ? (
                  <p className="text-muted">Nenhuma alteração registrada.</p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {order.history.map((h: any) => (
                      <li key={h.id} style={{ borderLeft: "2px solid var(--primary)", paddingLeft: "8px" }}>
                        <div>
                          <strong>{h.actionBy}</strong> alterou para <strong>{getStatusLabel(h.statusTo)}</strong>
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          {new Date(h.createdAt).toLocaleString('pt-BR')} {h.notes && `• Motivo: ${h.notes}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* CONTROLES DE EMERGÊNCIA */}
              {order.isEmergency && order.emergencyStatus === "PENDING_APPROVAL" && (
                <div style={{ backgroundColor: "rgba(245, 158, 11, 0.1)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--warning)" }}>
                  <p className="font-bold mb-2" style={{ color: "var(--warning)" }}>🚨 Solicitação de Retirada de Emergência</p>
                  <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>Avalie o pedido e decida se aprova ou não a retirada na base.</p>
                  
                  {!isRejecting ? (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button onClick={handleApproveEmergency} disabled={loadingAction} className="btn" style={{ backgroundColor: "var(--success)", color: "white", fontSize: "0.85rem", flex: 1 }}>
                        Aprovar e Gerar Boleto
                      </button>
                      <button onClick={() => setIsRejecting(true)} disabled={loadingAction} className="btn" style={{ backgroundColor: "var(--danger)", color: "white", fontSize: "0.85rem", flex: 1 }}>
                        Reprovar
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <input 
                        type="text" 
                        placeholder="Motivo da reprovação..." 
                        className="input-field" 
                        value={rejectReason} 
                        onChange={e => setRejectReason(e.target.value)} 
                        style={{ fontSize: "0.85rem" }}
                      />
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button onClick={() => setIsRejecting(false)} className="btn btn-outline" style={{ fontSize: "0.85rem", flex: 1 }}>Cancelar</button>
                        <button onClick={handleRejectEmergency} disabled={loadingAction} className="btn" style={{ backgroundColor: "var(--danger)", color: "white", fontSize: "0.85rem", flex: 1 }}>
                          Confirmar Reprovação
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {order.isEmergency && order.emergencyStatus === "REJECTED" && order.rejectionReason && (
                <div style={{ padding: "0.5rem", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
                    <strong>Motivo da Reprovação (Emergência):</strong> {order.rejectionReason}
                  </p>
                </div>
              )}

              {order.cancelReason && (
                <div style={{ padding: "0.5rem", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
                    <strong>Motivo do Cancelamento:</strong> {order.cancelReason}
                  </p>
                </div>
              )}

              {order.boletoUrl && order.status !== "CANCELADO" && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto" }}>
                  <a href={order.boletoUrl} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: "0.85rem" }}>
                    Abrir Link (Asaas)
                  </a>
                  <button 
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(order.boletoUrl); alert("Link copiado com sucesso!"); }} 
                    className="btn btn-primary" 
                    style={{ fontSize: "0.85rem" }}
                  >
                    Copiar Link de Pagamento
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
