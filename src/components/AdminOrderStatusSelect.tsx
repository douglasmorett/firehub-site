"use client";
import { cancelOrder } from "@/app/actions/cancelOrder";
import { updateOrderStatus } from "@/app/actions/order";
import { useState } from "react";

export default function AdminOrderStatusSelect({ orderId, currentStatus }: { orderId: string, currentStatus: string }) {
  const [loading, setLoading] = useState(false);

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    
    if (newStatus === "CANCELADO") {
      const adminPassword = window.prompt("Para cancelar este pedido e remover a cobrança do Asaas, digite sua SENHA de acesso:");
      if (!adminPassword) {
        e.target.value = currentStatus;
        return;
      }

      const reason = window.prompt("Por favor, informe o MOTIVO do cancelamento:");
      if (!reason) {
        alert("O motivo é obrigatório para cancelar.");
        e.target.value = currentStatus;
        return;
      }
      
      setLoading(true);
      try {
        await cancelOrder(orderId, adminPassword, reason);
        alert("Pedido cancelado com sucesso!");
      } catch (err: any) {
        alert(err.message || "Erro ao cancelar pedido.");
        e.target.value = currentStatus;
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      await updateOrderStatus(orderId, newStatus);
    } catch (err) {
      alert("Erro ao atualizar status");
      e.target.value = currentStatus;
    } finally {
      setLoading(false);
    }
  };

  return (
    <select 
      value={currentStatus} 
      onChange={handleStatusChange} 
      disabled={loading || currentStatus === "PAID"}
      style={{
        padding: "0.5rem",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--bg-card)",
        color: "var(--text-main)",
        fontWeight: "bold",
        fontSize: "0.85rem",
        cursor: "pointer"
      }}
    >
      <option value="PENDING_PAYMENT">Aguardando Pagamento</option>
      <option value="AGUARDANDO_ENTREGA">Aguardando Entrega</option>
      <option value="FINALIZADO">Finalizado</option>
      <option value="PAID">Pago (Asaas)</option>
      <option value="CANCELADO">Cancelado</option>
    </select>
  );
}
