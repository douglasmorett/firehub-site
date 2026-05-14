"use client";
import { useState, useEffect, useCallback } from "react";
import { CheckCircle, Clock, ChefHat, Bike, Package, X, Phone, ArrowLeft, Star } from "lucide-react";
import Link from "next/link";

type Item = { name: string; qty: number; price: number; imageUrl: string | null };

const STATUS_FLOW = [
  { key: "NOVO",         label: "Pedido Recebido",     icon: Clock,       color: "#3B82F6", emoji: "­ƒöö", desc: "Aguardando confirma├º├úo da loja" },
  { key: "ACEITO",       label: "Pedido Confirmado",   icon: CheckCircle, color: "#10B981", emoji: "Ô£à", desc: "A loja aceitou seu pedido!" },
  { key: "PREPARANDO",   label: "Em Preparo",          icon: ChefHat,     color: "#F59E0B", emoji: "­ƒæ¿ÔÇì­ƒì│", desc: "Sua comida est├í sendo preparada" },
  { key: "SAIU_ENTREGA", label: "Saiu para Entrega",   icon: Bike,        color: "#8B5CF6", emoji: "­ƒøÁ", desc: "O entregador est├í a caminho!" },
  { key: "ENTREGUE",     label: "Pedido Entregue!",    icon: Package,     color: "#16A34A", emoji: "­ƒÄë", desc: "Bom apetite! Aproveite sua refei├º├úo ­ƒÿï" },
  { key: "CANCELADO",    label: "Pedido Cancelado",    icon: X,           color: "#EF4444", emoji: "ÔØî", desc: "Seu pedido foi cancelado" },
];

function fmtR(v: number) { return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; }

export default function OrderTrackingClient({
  orderId, initialStatus, customerName, deliveryType, totalAmount, deliveryFee,
  paymentMethod, items, createdAt, storeName, storeLogo, storePhone, slug,
}: {
  orderId: string; initialStatus: string; customerName: string; deliveryType: string;
  totalAmount: number; deliveryFee: number; paymentMethod: string;
  items: Item[]; createdAt: string; storeName: string; storeLogo: string | null;
  storePhone: string | null; slug: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [lastCheck, setLastCheck] = useState(new Date());
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingDone, setRatingDone] = useState(false);
  const [showItems, setShowItems] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer-order/${orderId}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.status !== status) setStatus(data.status);
        setLastCheck(new Date());
      }
    } catch {}
  }, [orderId, status]);

  useEffect(() => {
    if (status === "ENTREGUE" || status === "CANCELADO") return;
    const iv = setInterval(pollStatus, 15000); // poll a cada 15s
    return () => clearInterval(iv);
  }, [pollStatus, status]);

  const currentIdx = STATUS_FLOW.findIndex(s => s.key === status);
  const currentStep = STATUS_FLOW[currentIdx] || STATUS_FLOW[0];
  const isCanceled = status === "CANCELADO";
  const isDelivered = status === "ENTREGUE";

  const submitRating = async () => {
    if (!ratingValue) return;
    await fetch(`/api/customer-order/${orderId}/rating`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: ratingValue, comment: ratingComment }),
    });
    setRatingDone(true);
  };

  const estimatedTime = () => {
    if (status === "NOVO" || status === "ACEITO") return deliveryType === "DELIVERY" ? "30-45 min" : "15-20 min";
    if (status === "PREPARANDO") return deliveryType === "DELIVERY" ? "20-30 min" : "10-15 min";
    if (status === "SAIU_ENTREGA") return "5-15 min";
    return "";
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8FAFC", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #B71C1C 0%, #C62828 100%)", padding: "1rem 1.5rem", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href={`/loja/${slug}`} style={{ color: "#fff", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none", fontSize: "0.85rem" }}>
          <ArrowLeft size={16} /> Voltar
        </Link>
        <div style={{ flex: 1 }} />
        {storeLogo && <img src={storeLogo} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />}
        <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>{storeName}</span>
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "1.5rem 1rem" }}>
        
        {/* Status principal */}
        <div style={{
          background: isCanceled ? "#FEF2F2" : "#fff", borderRadius: "20px", padding: "2rem",
          border: `2px solid ${currentStep.color}30`, marginBottom: "1.25rem",
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)", textAlign: "center",
        }}>
          <div style={{ fontSize: "3.5rem", marginBottom: "12px", animation: isDelivered ? "none" : "pulse 2s infinite" }}>
            {currentStep.emoji}
          </div>
          <h1 style={{ fontWeight: 900, fontSize: "1.4rem", color: currentStep.color, margin: "0 0 6px" }}>
            {currentStep.label}
          </h1>
          <p style={{ color: "#64748B", fontSize: "0.88rem", margin: "0 0 16px" }}>
            {currentStep.desc}
          </p>
          {estimatedTime() && !isCanceled && !isDelivered && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: "20px", padding: "6px 16px", fontSize: "0.82rem", fontWeight: 700, color: "#C2410C" }}>
              <Clock size={14} /> Previs├úo: {estimatedTime()}
            </div>
          )}
          {!isCanceled && !isDelivered && (
            <p style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: "12px" }}>
              Atualizado: {lastCheck.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}
        </div>

        {/* Timeline de progresso */}
        {!isCanceled && (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "1.25rem 1.5rem", marginBottom: "1.25rem", border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#475569", margin: "0 0 1rem" }}>­ƒù║´©Å Acompanhe seu pedido</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {STATUS_FLOW.filter(s => s.key !== "CANCELADO").map((step, idx) => {
                const stepIdx = STATUS_FLOW.findIndex(s => s.key === step.key);
                const done = stepIdx <= currentIdx;
                const active = stepIdx === currentIdx;
                const Icon = step.icon;
                return (
                  <div key={step.key} style={{ display: "flex", alignItems: "flex-start", gap: "12px", paddingBottom: idx < 4 ? "16px" : 0, position: "relative" }}>
                    {/* Linha vertical */}
                    {idx < 4 && (
                      <div style={{ position: "absolute", left: "17px", top: "34px", width: "2px", height: "calc(100% - 18px)", background: done && stepIdx < currentIdx ? step.color : "#E2E8F0" }} />
                    )}
                    {/* C├¡rculo */}
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                      background: done ? (active ? step.color : step.color + "22") : "#F8FAFC",
                      border: `2px solid ${done ? step.color : "#E2E8F0"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.3s",
                      boxShadow: active ? `0 0 0 4px ${step.color}22` : "none",
                    }}>
                      <Icon size={16} color={done ? (active ? "#fff" : step.color) : "#CBD5E1"} />
                    </div>
                    {/* Texto */}
                    <div style={{ paddingTop: "6px" }}>
                      <p style={{ fontWeight: active ? 800 : done ? 600 : 400, fontSize: "0.88rem", color: done ? (active ? step.color : "#0F172A") : "#94A3B8", margin: 0 }}>
                        {step.label}
                      </p>
                      {active && <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "2px 0 0" }}>{step.desc}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Resumo do pedido */}
        <div style={{ background: "#fff", borderRadius: "16px", padding: "1.25rem", marginBottom: "1.25rem", border: "1px solid #F1F5F9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#475569", margin: 0 }}>­ƒº¥ Resumo do Pedido</h3>
            <button onClick={() => setShowItems(v => !v)} style={{ fontSize: "0.75rem", color: "#3B82F6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
              {showItems ? "Ocultar" : "Ver itens"}
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#64748B", marginBottom: "4px" }}>
            <span>Pedido #{orderId.slice(-8).toUpperCase()}</span>
            <span>{new Date(createdAt).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#64748B", marginBottom: "4px" }}>
            <span>Tipo:</span>
            <span style={{ fontWeight: 600 }}>{deliveryType === "DELIVERY" ? "­ƒøÁ Delivery" : "­ƒÅ¬ Retirada"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#64748B", marginBottom: "8px" }}>
            <span>Pagamento:</span>
            <span style={{ fontWeight: 600 }}>{paymentMethod}</span>
          </div>

          {showItems && (
            <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: "8px", marginTop: "4px" }}>
              {items.map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "4px 0", borderBottom: i < items.length - 1 ? "1px solid #F8FAFC" : "none" }}>
                  <span style={{ color: "#475569" }}>{item.qty}x {item.name}</span>
                  <span style={{ fontWeight: 600, color: "#0F172A" }}>{fmtR(item.price * item.qty)}</span>
                </div>
              ))}
              {deliveryFee > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "4px 0", color: "#64748B" }}>
                  <span>­ƒøÁ Taxa de entrega</span>
                  <span>{fmtR(deliveryFee)}</span>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1rem", marginTop: "8px", borderTop: "1.5px solid #F1F5F9", paddingTop: "8px" }}>
            <span>Total</span>
            <span style={{ color: "#16A34A" }}>{fmtR(totalAmount)}</span>
          </div>
        </div>

        {/* Avalia├º├úo (s├│ aparece quando entregue) */}
        {isDelivered && !ratingDone && (
          <div style={{ background: "linear-gradient(135deg, #FFF7ED, #FEF3C7)", borderRadius: "16px", padding: "1.5rem", marginBottom: "1.25rem", border: "1px solid #FCD34D" }}>
            <h3 style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 4px", color: "#92400E" }}>Ô¡É Como foi sua experi├¬ncia?</h3>
            <p style={{ fontSize: "0.8rem", color: "#B45309", margin: "0 0 1rem" }}>Sua avalia├º├úo ajuda o restaurante a melhorar</p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginBottom: "12px" }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRatingValue(n)} style={{
                  fontSize: "2rem", background: "none", border: "none", cursor: "pointer",
                  transform: n <= ratingValue ? "scale(1.2)" : "scale(0.9)",
                  opacity: n <= ratingValue ? 1 : 0.35, transition: "all 0.15s",
                }}>Ô¡É</button>
              ))}
            </div>
            {ratingValue > 0 && (
              <>
                <textarea
                  value={ratingComment} onChange={e => setRatingComment(e.target.value)}
                  placeholder="Deixe um coment├írio (opcional)..."
                  rows={2}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #FCD34D", fontSize: "0.85rem", boxSizing: "border-box", resize: "none", background: "#fff", fontFamily: "inherit", marginBottom: "10px" }}
                />
                <button onClick={submitRating} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "#fff", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", fontFamily: "inherit" }}>
                  Enviar Avalia├º├úo
                </button>
              </>
            )}
          </div>
        )}
        {isDelivered && ratingDone && (
          <div style={{ background: "#F0FDF4", borderRadius: "16px", padding: "1.25rem", marginBottom: "1.25rem", border: "1px solid #BBF7D0", textAlign: "center" }}>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "#16A34A" }}>­ƒÖÅ Obrigado pela avalia├º├úo!</p>
          </div>
        )}

        {/* Contato loja */}
        {storePhone && !isDelivered && !isCanceled && (
          <a href={`https://wa.me/55${storePhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "#25D366", color: "#fff", borderRadius: "14px", padding: "12px", fontWeight: 700, fontSize: "0.88rem", textDecoration: "none", marginBottom: "1rem" }}>
            <Phone size={16} /> Falar com a loja no WhatsApp
          </a>
        )}

        <Link href={`/loja/${slug}`} style={{ display: "block", textAlign: "center", fontSize: "0.82rem", color: "#3B82F6", fontWeight: 600, textDecoration: "none" }}>
          ÔåÉ Voltar ao card├ípio
        </Link>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}