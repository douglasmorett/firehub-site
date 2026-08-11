"use client";

import React, { useState, useEffect } from "react";
import { Star, MessageSquare, ToggleLeft, ToggleRight, Check, Send, Sparkles, Filter, Loader2, Info } from "lucide-react";

export default function StoreReviewsManager({ initialShowReviews }: { initialShowReviews?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [showOnMenu, setShowOnMenu] = useState<boolean>(initialShowReviews ?? true);
  const [updatingToggle, setUpdatingToggle] = useState(false);

  const [stats, setStats] = useState({
    totalReviews: 0,
    averageRating: 5.0,
    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>,
  });
  const [reviews, setReviews] = useState<any[]>([]);
  const [filterRating, setFilterRating] = useState<number | "all">("all");

  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [savingReply, setSavingReply] = useState(false);

  const fetchReviews = async () => {
    try {
      const res = await fetch("/api/store-reviews");
      if (res.ok) {
        const data = await res.json();
        setShowOnMenu(data.showReviewsOnMenu ?? true);
        setStats(data.stats || { totalReviews: 0, averageRating: 5.0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
        setReviews(data.reviews || []);
      }
    } catch {
      console.error("Erro ao carregar avaliações");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const handleToggleShow = async () => {
    const nextState = !showOnMenu;
    setUpdatingToggle(true);
    try {
      const res = await fetch("/api/store-reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showReviewsOnMenu: nextState }),
      });
      if (res.ok) {
        setShowOnMenu(nextState);
      } else {
        alert("Erro ao atualizar exibição das avaliações.");
      }
    } catch {
      alert("Erro de conexão.");
    } finally {
      setUpdatingToggle(false);
    }
  };

  const handleSendReply = async (reviewId: string) => {
    if (!replyText.trim()) return;
    setSavingReply(true);
    try {
      const res = await fetch("/api/store-reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, reply: replyText }),
      });
      if (res.ok) {
        setReplyingId(null);
        setReplyText("");
        fetchReviews();
      } else {
        alert("Erro ao salvar resposta.");
      }
    } catch {
      alert("Erro de conexão ao responder.");
    } finally {
      setSavingReply(false);
    }
  };

  const filteredReviews = filterRating === "all"
    ? reviews
    : reviews.filter((r) => r.rating === filterRating);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", fontFamily: "sans-serif" }}>

      {/* Card 1: Toggle de Exibição no Cardápio Digital */}
      <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Sparkles size={18} color="#D97706" />
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>
              Exibir Avaliações no Cardápio Digital?
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B" }}>
            Se ativado, a nota média e depoimentos de clientes aparecerão na sua loja online pública.
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggleShow}
          disabled={updatingToggle}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "8px 16px", borderRadius: 30, border: "none",
            background: showOnMenu ? "#16A34A" : "#64748B", color: "#FFFFFF",
            fontWeight: 800, fontSize: "0.88rem", cursor: "pointer",
            boxShadow: showOnMenu ? "0 4px 12px rgba(22,163,74,0.25)" : "none",
            transition: "all 0.2s ease"
          }}
        >
          {updatingToggle ? (
            <Loader2 className="animate-spin" size={18} />
          ) : showOnMenu ? (
            <>
              <Check size={18} /> SIM (Exibindo no Cardápio)
            </>
          ) : (
            <>
              🔒 NÃO (Oculto no Cardápio)
            </>
          )}
        </button>
      </div>

      {/* Info Card: NPS Automático via WhatsApp */}
      <div style={{ background: "#EFF6FF", borderRadius: 16, padding: "1rem 1.25rem", border: "1px solid #BFDBFE", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Info size={20} color="#2563EB" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: "0.83rem", color: "#1E40AF", lineHeight: 1.5 }}>
          <b>🤖 Disparo de NPS Pós-Entrega Ativo:</b> Toda vez que um pedido for alterado para <b>"ENTREGUE"</b>, o robô enviará automaticamente uma mensagem no WhatsApp do cliente agradecendo e solicitando a avaliação do pedido em 5 segundos.
        </div>
      </div>

      {/* Card 2: Estatísticas Globais */}
      <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        <h4 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 800, color: "#334155" }}>
          Desempenho Geral (NPS)
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.25rem", alignItems: "center" }}>
          
          {/* Média Grande */}
          <div style={{ textAlign: "center", background: "#FEF3C7", borderRadius: 16, padding: "1.25rem", border: "1px solid #FDE68A" }}>
            <span style={{ fontSize: "2.8rem", fontWeight: 900, color: "#B45309", lineHeight: 1 }}>
              {stats.averageRating}
            </span>
            <div style={{ display: "flex", justifyContent: "center", gap: 4, margin: "6px 0 4px" }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={18} fill={s <= Math.round(stats.averageRating) ? "#F59E0B" : "none"} color={s <= Math.round(stats.averageRating) ? "#F59E0B" : "#CBD5E1"} />
              ))}
            </div>
            <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 700, color: "#92400E" }}>
              Baseado em <b>{stats.totalReviews}</b> avaliações
            </p>
          </div>

          {/* Barras de Distribuição */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[5, 4, 3, 2, 1].map((starNum) => {
              const count = stats.distribution[starNum] || 0;
              const pct = stats.totalReviews > 0 ? Math.round((count / stats.totalReviews) * 100) : 0;
              return (
                <div key={starNum} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem" }}>
                  <span style={{ width: 28, fontWeight: 700, color: "#475569" }}>{starNum} ★</span>
                  <div style={{ flex: 1, height: 8, background: "#F1F5F9", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: starNum >= 4 ? "#16A34A" : starNum === 3 ? "#F59E0B" : "#EF4444", borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 35, textAlign: "right", color: "#64748B", fontWeight: 600 }}>{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>

        </div>
      </div>

      {/* Card 3: Lista de Avaliações */}
      <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        
        {/* Top Header & Filter */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.25rem", paddingBottom: "0.75rem", borderBottom: "1px solid #F1F5F9" }}>
          <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
            Feedbacks dos Clientes ({filteredReviews.length})
          </h4>

          {/* Filtros de Estrelas */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={() => setFilterRating("all")}
              style={{
                padding: "5px 10px", borderRadius: 8, border: "none", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
                background: filterRating === "all" ? "#0F172A" : "#F1F5F9",
                color: filterRating === "all" ? "#FFFFFF" : "#64748B"
              }}
            >
              Todas
            </button>
            {[5, 4, 3, 2, 1].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterRating(s)}
                style={{
                  padding: "5px 8px", borderRadius: 8, border: "none", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
                  background: filterRating === s ? "#D97706" : "#F1F5F9",
                  color: filterRating === s ? "#FFFFFF" : "#64748B"
                }}
              >
                {s}★
              </button>
            ))}
          </div>
        </div>

        {/* Loading ou Vazio */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#64748B" }}>
            <Loader2 className="animate-spin" size={24} style={{ margin: "0 auto 8px" }} />
            Carregando avaliações...
          </div>
        ) : filteredReviews.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", background: "#F8FAFC", borderRadius: 14, border: "1px dashed #CBD5E1", color: "#64748B" }}>
            <MessageSquare size={36} color="#94A3B8" style={{ margin: "0 auto 8px" }} />
            <p style={{ margin: "0 0 4px", fontWeight: 800, color: "#334155" }}>Nenhuma avaliação encontrada</p>
            <p style={{ margin: 0, fontSize: "0.8rem" }}>Assim que os clientes avaliarem os pedidos entregues, os depoimentos aparecerão aqui.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {filteredReviews.map((r) => {
              const customerName = r.order?.customerName || "Cliente";
              const orderNum = r.order?.dailyOrderNumber || r.order?.ifoodReference || r.order?.openDeliveryReference || r.orderId.slice(-4);
              const dateStr = new Date(r.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

              return (
                <div key={r.id} style={{ background: "#F8FAFC", borderRadius: 14, padding: "1rem 1.25rem", border: "1px solid #E2E8F0" }}>
                  
                  {/* Rating Header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>
                        {customerName}
                      </span>
                      <span style={{ fontSize: "0.75rem", background: "#E2E8F0", color: "#475569", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>
                        Pedido #{orderNum}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} size={15} fill={s <= r.rating ? "#F59E0B" : "none"} color={s <= r.rating ? "#F59E0B" : "#CBD5E1"} />
                      ))}
                      <span style={{ fontSize: "0.78rem", color: "#64748B", marginLeft: 6 }}>{dateStr}</span>
                    </div>
                  </div>

                  {/* Comment */}
                  {r.comment ? (
                    <p style={{ margin: "6px 0 10px", fontSize: "0.88rem", color: "#334155", lineHeight: 1.45, fontStyle: "italic", background: "#FFFFFF", padding: "10px", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                      "{r.comment}"
                    </p>
                  ) : (
                    <p style={{ margin: "4px 0 8px", fontSize: "0.78rem", color: "#94A3B8" }}>
                      (Cliente avaliou sem comentário por texto)
                    </p>
                  )}

                  {/* Existing Store Reply */}
                  {r.reply && (
                    <div style={{ background: "#EFF6FF", borderRadius: 10, padding: "8px 12px", borderLeft: "4px solid #2563EB", marginTop: 8, fontSize: "0.82rem" }}>
                      <span style={{ fontWeight: 800, color: "#1E40AF" }}>💬 Resposta da Loja:</span>
                      <p style={{ margin: "2px 0 0", color: "#1E3A8A" }}>{r.reply}</p>
                    </div>
                  )}

                  {/* Reply Button / Input Form */}
                  <div style={{ marginTop: 8 }}>
                    {replyingId === r.id ? (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        <textarea
                          rows={2}
                          placeholder="Escreva sua resposta para o cliente..."
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #2563EB", fontSize: "0.82rem", fontFamily: "inherit" }}
                        />
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => { setReplyingId(null); setReplyText(""); }}
                            style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#E2E8F0", color: "#475569", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendReply(r.id)}
                            disabled={savingReply || !replyText.trim()}
                            style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#2563EB", color: "#FFFFFF", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                          >
                            {savingReply ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Salvar Resposta
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setReplyingId(r.id); setReplyText(r.reply || ""); }}
                        style={{ background: "transparent", border: "none", color: "#2563EB", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
                      >
                        <MessageSquare size={13} /> {r.reply ? "Editar Resposta" : "Responder Avaliação"}
                      </button>
                    )}
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </div>

    </div>
  );
}
