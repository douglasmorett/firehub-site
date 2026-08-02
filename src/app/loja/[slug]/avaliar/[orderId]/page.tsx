"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Star, CheckCircle, Store, Send, Frown, Smile, Heart, Award, ArrowLeft, Loader2 } from "lucide-react";

export default function CustomerReviewPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const orderId = params?.orderId as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!orderId) return;

    fetch(`/api/customer-order/review?orderId=${orderId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setOrder(data);
          if (data.review) {
            setRating(data.review.rating || 5);
            setComment(data.review.comment || "");
            setSubmitted(true);
          }
        } else {
          setErrorMsg("Pedido não encontrado ou indisponível.");
        }
      })
      .catch(() => setErrorMsg("Erro ao carregar dados do pedido."))
      .finally(() => setLoading(false));
  }, [orderId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating || rating < 1 || rating > 5) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/customer-order/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, rating, comment }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const d = await res.json();
        alert(d.error || "Erro ao salvar avaliação. Tente novamente.");
      }
    } catch {
      alert("Erro de conexão ao enviar avaliação.");
    } finally {
      setSubmitting(false);
    }
  };

  const storeName = order?.franchisee?.storeName || "Nossa Loja";
  const displayNum = order?.dailyOrderNumber || order?.ifoodReference || order?.openDeliveryReference || order?.id?.slice(-4);

  const getRatingLabel = (stars: number) => {
    switch (stars) {
      case 1:
        return "Péssimo 😞";
      case 2:
        return "Ruim 🙁";
      case 3:
        return "Regular 😐";
      case 4:
        return "Muito Bom! 🙂";
      case 5:
        return "Excelente! 😍🚀";
      default:
        return "";
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC" }}>
        <Loader2 className="animate-spin" size={32} color="#2563EB" />
      </div>
    );
  }

  if (errorMsg || !order) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", padding: "1rem" }}>
        <div style={{ background: "#FFF", borderRadius: 16, padding: "2rem", textAlign: "center", maxWidth: 420, boxShadow: "0 10px 25px rgba(0,0,0,0.05)" }}>
          <Frown size={48} color="#EF4444" style={{ margin: "0 auto 1rem" }} />
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0F172A", margin: "0 0 0.5rem" }}>Ops! Algo deu errado</h2>
          <p style={{ fontSize: "0.88rem", color: "#64748B", margin: "0 0 1.5rem" }}>{errorMsg || "Pedido não encontrado."}</p>
          {slug && (
            <a href={`/loja/${slug}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#2563EB", color: "#FFF", padding: "10px 18px", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: "0.88rem" }}>
              <Store size={16} /> Voltar ao Cardápio
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #EFF6FF 0%, #F8FAFC 100%)", padding: "2rem 1rem", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        
        {/* Top Header Card */}
        <div style={{ background: "#FFFFFF", borderRadius: 20, padding: "1.5rem", boxShadow: "0 10px 25px -5px rgba(37,99,235,0.1)", textAlign: "center", marginBottom: "1.25rem", border: "1px solid #E2E8F0" }}>
          {order?.franchisee?.storeLogo ? (
            <img src={order.franchisee.storeLogo} alt={storeName} style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", margin: "0 auto 0.75rem", border: "3px solid #2563EB" }} />
          ) : (
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#EFF6FF", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 0.75rem", fontSize: "1.5rem", fontWeight: 900 }}>
              🏬
            </div>
          )}

          <h2 style={{ fontSize: "1.3rem", fontWeight: 900, color: "#0F172A", margin: "0 0 4px" }}>
            {storeName}
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#64748B", margin: 0 }}>
            Avaliação do Pedido <b>#{displayNum}</b>
          </p>
        </div>

        {/* Form Container / Submitted State */}
        {submitted ? (
          <div style={{ background: "#FFFFFF", borderRadius: 20, padding: "2rem", textDecoration: "none", textAlign: "center", boxShadow: "0 10px 25px rgba(0,0,0,0.05)", border: "1.5px solid #86EFAC" }}>
            <CheckCircle size={56} color="#16A34A" style={{ margin: "0 auto 1rem" }} />
            <h3 style={{ fontSize: "1.3rem", fontWeight: 900, color: "#14532D", margin: "0 0 0.5rem" }}>
              Avaliação Registrada!
            </h3>
            <p style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.5, marginBottom: "1.5rem" }}>
              Sua avaliação de <b>{rating} Estrelas ⭐</b> foi enviada com sucesso para a equipe de <b>{storeName}</b>. Muito obrigado!
            </p>

            {comment && (
              <div style={{ background: "#F8FAFC", padding: "0.85rem", borderRadius: 12, border: "1px solid #E2E8F0", fontSize: "0.85rem", color: "#334155", fontStyle: "italic", marginBottom: "1.5rem" }}>
                "{comment}"
              </div>
            )}

            <a
              href={`/loja/${slug}`}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", padding: "12px", background: "#2563EB", color: "#FFFFFF",
                borderRadius: 12, textDecoration: "none", fontWeight: 800, fontSize: "0.95rem"
              }}
            >
              <Store size={18} /> Voltar ao Cardápio Digital
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: "#FFFFFF", borderRadius: 20, padding: "1.75rem", boxShadow: "0 10px 25px rgba(0,0,0,0.05)", border: "1px solid #E2E8F0" }}>
            
            <h3 style={{ fontSize: "1.1rem", fontWeight: 900, color: "#0F172A", textAlign: "center", margin: "0 0 0.5rem" }}>
              Como foi sua experiência?
            </h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", textAlign: "center", margin: "0 0 1.5rem" }}>
              Avalie a qualidade da refeição e a agilidade da entrega.
            </p>

            {/* Stars Selector */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: "0.75rem" }}>
              {[1, 2, 3, 4, 5].map((star) => {
                const isSelected = star <= (hoverRating || rating);
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      padding: 4, transition: "transform 0.15s ease",
                      transform: isSelected ? "scale(1.15)" : "scale(1)"
                    }}
                  >
                    <Star
                      size={36}
                      fill={isSelected ? "#F59E0B" : "none"}
                      color={isSelected ? "#F59E0B" : "#CBD5E1"}
                      strokeWidth={1.75}
                    />
                  </button>
                );
              })}
            </div>

            {/* Rating Label Indicator */}
            <div style={{ textAlign: "center", height: 28, marginBottom: "1.25rem" }}>
              <span style={{ fontSize: "0.92rem", fontWeight: 800, color: "#D97706" }}>
                {getRatingLabel(hoverRating || rating)}
              </span>
            </div>

            {/* Comment Area */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>
                Deixe um comentário para o restaurante (opcional):
              </label>
              <textarea
                rows={3}
                placeholder="Ex: A comida chegou super quentinha e bem embalada! O entregador foi muito simpático..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{
                  width: "100%", padding: "12px", borderRadius: 12, border: "1.5px solid #CBD5E1",
                  fontSize: "0.88rem", outline: "none", fontFamily: "inherit", resize: "none"
                }}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%", padding: "14px", background: "linear-gradient(135deg, #2563EB, #1D4ED8)",
                color: "#FFFFFF", border: "none", borderRadius: 12, fontWeight: 900,
                fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 8, boxShadow: "0 4px 14px rgba(37,99,235,0.3)"
              }}
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <Send size={18} /> Enviar Avaliação
                </>
              )}
            </button>

          </form>
        )}

      </div>
    </div>
  );
}
