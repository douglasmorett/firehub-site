"use client";
import { cancelOrder } from "@/app/actions/cancelOrder";
import { updateOrderStatus } from "@/app/actions/order";
import { useState } from "react";

export default function AdminOrderStatusSelect({ orderId, currentStatus }: { orderId: string, currentStatus: string }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(currentStatus);

  const isPaid = status === "PAGO" || status === "PAID";
  const isCancelled = status === "CANCELADO";
  const isFinalizado = status === "FINALIZADO";
  const isLocked = isPaid || isCancelled || isFinalizado;

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    
    if (newStatus === "CANCELADO") {
      const adminPassword = window.prompt("Para cancelar este pedido e remover a cobrança do Asaas, digite sua SENHA de acesso:");
      if (!adminPassword) {
        e.target.value = status;
        return;
      }

      const reason = window.prompt("Por favor, informe o MOTIVO do cancelamento:");
      if (!reason) {
        alert("O motivo é obrigatório para cancelar.");
        e.target.value = status;
        return;
      }
      
      setLoading(true);
      try {
        await cancelOrder(orderId, adminPassword, reason);
        setStatus("CANCELADO");
        alert("Pedido cancelado com sucesso!");
      } catch (err: any) {
        alert(err.message || "Erro ao cancelar pedido.");
        e.target.value = status;
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      await updateOrderStatus(orderId, newStatus);
      setStatus(newStatus);
    } catch (err) {
      alert("Erro ao atualizar status");
      e.target.value = status;
    } finally {
      setLoading(false);
    }
  };

  // Normalizar: se está PAID, tratar como PAGO no select
  const displayStatus = status === "PAID" ? "PAGO" : status;

  return (
    <select 
      value={displayStatus} 
      onChange={handleStatusChange} 
      disabled={loading || isLocked}
      style={{
        padding: "0.5rem",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${isPaid ? "var(--success)" : "var(--border-color)"}`,
        backgroundColor: isPaid ? "rgba(22, 163, 74, 0.1)" : "var(--bg-card)",
        color: isPaid ? "var(--success)" : "var(--text-main)",
        fontWeight: "bold",
        fontSize: "0.85rem",
        cursor: isLocked ? "not-allowed" : "pointer"
      }}
    >
      <option value="PENDING_PAYMENT">Aguardando Pagamento</option>
      <option value="PAGO">✅ Pago</option>
      <option value="AGUARDANDO_ENTREGA">Aguardando Entrega</option>
      <option value="FINALIZADO">Finalizado</option>
      <option value="CANCELADO">Cancelado</option>
    </select>
  );
}

