"use client";

import { useCart } from "@/components/CartProvider";
import { useState, useEffect } from "react";
import { Trash2, ArrowLeft, CheckCircle, ShoppingBag, AlertTriangle, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export default function CartPage() {
  const { items, removeFromCart, total, clearCart, isLoaded } = useCart();
  const [loading, setLoading] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [boletoUrl, setBoletoUrl] = useState<string | null>(null);
  const [boletoCode, setBoletoCode] = useState<string | null>(null);
  const [emergencyDone, setEmergencyDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [overduePayments, setOverduePayments] = useState<any[] | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("emergency") === "true") {
      setIsEmergencyModalOpen(true);
    }
  }, [searchParams]);

  const handleCheckout = async () => {
    if (items.length === 0 || total < 300) return;
    setLoading(true);
    setOverduePayments(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, totalAmount: total }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data) {
        setBoletoUrl(data.boletoUrl || null);
        setBoletoCode(data.boletoCode || data.barCode || null);
        setCheckoutSuccess(true);
        clearCart();
      } else if (res.status === 403 && data?.overduePayments) {
        // Inadimplência — mostrar modal com links de pagamento
        setOverduePayments(data.overduePayments);
        setLoading(false);
      } else if (res.status === 401) {
        alert("Sessão expirada. Faça login novamente para finalizar o pedido.");
        setLoading(false);
      } else {
        const errorMsg = data?.error || `Erro ${res.status} ao finalizar pedido.`;
        alert(errorMsg);
        setLoading(false);
      }
    } catch (err) {
      console.error("[checkout] Erro:", err);
      alert("Erro ao conectar com o servidor. Verifique sua internet e tente novamente.");
      setLoading(false);
    }
  };

  const handleEmergencyCheckout = async () => {
    if (items.length === 0) return;
    setLoading(true);

    try {
      const res = await fetch("/api/checkout-emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (res.ok) {
        clearCart();
        setIsEmergencyModalOpen(false);
        setEmergencyDone(true);
        setLoading(false);
      } else {
        const data = await res.json();
        alert(`Erro: ${data.error || "Tente novamente."}`);
        setLoading(false);
      }
    } catch {
      alert("Erro ao conectar com o servidor.");
      setLoading(false);
    }
  };

  const copyCode = () => {
    if (boletoCode) {
      navigator.clipboard.writeText(boletoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /* ── TELA: PEDIDO CONFIRMADO ─────────────────────────────────── */
  if (checkoutSuccess) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #1565C0 0%, #1976D2 60%, #42A5F5 100%)",
        padding: "1.5rem",
      }}>
        <div style={{
          maxWidth: 480, width: "100%", background: "#fff",
          borderRadius: 24, padding: "2rem 1.5rem",
          boxShadow: "0 30px 80px rgba(0,0,0,0.3)", textAlign: "center",
        }}>
          <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem" }}>✅</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F172A", margin: "0 0 0.5rem" }}>
            Pedido Confirmado!
          </h2>

          {boletoUrl || boletoCode ? (
            <>
              <p style={{ color: "#64748B", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                Seu boleto foi gerado com vencimento em <strong>10 dias</strong> via Asaas.
              </p>

              {boletoCode && (
                <div style={{
                  background: "#F0F4FF", borderRadius: 14, padding: "1rem",
                  marginBottom: "1rem", border: "1.5px solid #BFDBFE",
                }}>
                  <p style={{ fontSize: "0.75rem", color: "#64748B", marginBottom: "0.5rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Código de Barras
                  </p>
                  <p style={{
                    fontSize: "0.8rem", color: "#1E3A8A", fontFamily: "monospace",
                    wordBreak: "break-all", lineHeight: 1.6, marginBottom: "0.75rem",
                  }}>
                    {boletoCode}
                  </p>
                  <button
                    onClick={copyCode}
                    style={{
                      width: "100%", padding: "0.75rem", borderRadius: 10,
                      border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.9rem",
                      background: copied ? "#10B981" : "#1565C0", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      transition: "background 0.2s",
                    }}
                  >
                    <Copy size={16} />
                    {copied ? "Código Copiado! ✓" : "Copiar Código"}
                  </button>
                </div>
              )}

              {boletoUrl && (
                <a
                  href={boletoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", padding: "0.85rem", borderRadius: 12,
                    background: "linear-gradient(135deg, #1565C0, #1976D2)",
                    color: "#fff", fontWeight: 700, fontSize: "0.95rem",
                    textDecoration: "none", marginBottom: "0.75rem",
                    boxShadow: "0 8px 20px rgba(21,101,192,0.35)",
                  }}
                >
                  <ExternalLink size={18} />
                  Abrir Boleto
                </a>
              )}
            </>
          ) : (
            <div style={{
              background: "#FFF7ED", borderRadius: 14, padding: "1.25rem",
              marginBottom: "1.5rem", border: "1.5px solid #FDBA74",
              textAlign: "left"
            }}>
              <p style={{ color: "#C2410C", fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={18} /> Boleto em processamento
              </p>
              <p style={{ color: "#7C2D12", fontSize: "0.82rem", lineHeight: 1.5 }}>
                Seu pedido foi registrado com sucesso, mas o gateway de pagamento (Asaas) demorou para responder.
              </p>
              <p style={{ color: "#7C2D12", fontSize: "0.82rem", lineHeight: 1.5, marginTop: "0.5rem" }}>
                Você pode acompanhar e gerar a cobrança a qualquer momento acessando a página <strong>Meus Pedidos</strong>.
              </p>
            </div>
          )}

          <button
            onClick={() => router.push("/store/orders")}
            style={{
              width: "100%", padding: "0.75rem", borderRadius: 12,
              border: "1.5px solid #E2E8F0", background: "#fff",
              fontWeight: 600, fontSize: "0.9rem", color: "#475569", cursor: "pointer",
            }}
          >
            Ver Meus Pedidos
          </button>
        </div>
      </div>
    );
  }

  /* ── TELA: EMERGÊNCIA CONCLUÍDA ─────────────────────────────── */
  if (emergencyDone) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #7F1D1D 0%, #EF4444 100%)",
        padding: "1.5rem",
      }}>
        <div style={{
          maxWidth: 460, width: "100%", background: "#fff",
          borderRadius: 24, padding: "2rem 1.5rem",
          boxShadow: "0 30px 80px rgba(0,0,0,0.3)", textAlign: "center",
        }}>
          <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem" }}>🚨</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F172A", margin: "0 0 0.5rem" }}>
            Solicitação Enviada!
          </h2>
          <p style={{ color: "#64748B", fontSize: "0.9rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Sua retirada de emergência foi registrada.<br />
            <strong>Avise o responsável pelo WhatsApp:</strong>
          </p>
          <a
            href="https://wa.me/5521972947120"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "0.9rem 1.5rem", borderRadius: 12,
              background: "#25D366", color: "#fff", fontWeight: 700,
              fontSize: "1rem", textDecoration: "none", marginBottom: "0.75rem",
              boxShadow: "0 8px 20px rgba(37,211,102,0.4)",
            }}
          >
            📱 (21) 97294-7120 — WhatsApp
          </a>
          <button
            onClick={() => router.push("/store/orders")}
            style={{
              width: "100%", padding: "0.75rem", borderRadius: 12,
              border: "1.5px solid #E2E8F0", background: "#fff",
              fontWeight: 600, fontSize: "0.9rem", color: "#475569", cursor: "pointer",
            }}
          >
            Ver Meus Pedidos
          </button>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#64748B", fontWeight: 600, fontSize: "1.1rem" }}>Carregando carrinho...</p>
        </div>
      </div>
    );
  }

  /* ── TELA: CARRINHO VAZIO ────────────────────────────────────── */
  if (items.length === 0 && !overduePayments) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <ShoppingBag size={64} color="#CBD5E1" style={{ margin: "0 auto 1rem" }} />
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Carrinho vazio</h2>
          <p style={{ color: "#64748B", marginBottom: "1.5rem" }}>Adicione produtos antes de finalizar.</p>
          <Link href="/store/compras" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "0.85rem 1.75rem", borderRadius: 14,
            background: "linear-gradient(135deg, #1565C0, #1976D2)",
            color: "#fff", fontWeight: 700, fontSize: "0.95rem", textDecoration: "none",
          }}>
            Voltar para a Loja
          </Link>
        </div>
      </div>
    );
  }

  /* ── TELA: CARRINHO PRINCIPAL ────────────────────────────────── */
  return (
    <>
      {/* ── BANNER INADIMPLÊNCIA ──────────────────────────────── */}
      {overduePayments && overduePayments.length > 0 && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.6)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "1rem",
        }}>
          <div style={{
            background: "#fff", borderRadius: 20, maxWidth: 480, width: "100%",
            padding: "2rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            animation: "fadeIn 0.3s ease",
          }}>
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <AlertTriangle size={48} color="#DC2626" style={{ margin: "0 auto 0.75rem" }} />
              <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#DC2626", marginBottom: "0.5rem" }}>
                Pendência Financeira
              </h2>
              <p style={{ color: "#64748B", fontSize: "0.9rem", lineHeight: 1.5 }}>
                Você possui {overduePayments.length} cobrança{overduePayments.length > 1 ? "s" : ""} vencida{overduePayments.length > 1 ? "s" : ""}. 
                Regularize para continuar comprando.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              {overduePayments.map((p: any, i: number) => (
                <div key={i} style={{
                  background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12,
                  padding: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "0.75rem", flexWrap: "wrap",
                }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#991B1B" }}>
                      R$ {p.value?.toFixed(2)}
                    </p>
                    <p style={{ fontSize: "0.8rem", color: "#B91C1C" }}>
                      Vencido em {new Date(p.dueDate + "T12:00:00").toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  {p.invoiceUrl && (
                    <a
                      href={p.invoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "0.6rem 1.2rem", borderRadius: 10,
                        background: "linear-gradient(135deg, #16A34A, #22C55E)",
                        color: "#fff", fontWeight: 700, fontSize: "0.85rem",
                        textDecoration: "none", whiteSpace: "nowrap",
                        boxShadow: "0 3px 10px rgba(22,163,74,0.3)",
                      }}
                    >
                      <ExternalLink size={14} />
                      Pagar Agora
                    </a>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={() => setOverduePayments(null)}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: 12,
                border: "1px solid #E2E8F0", background: "#F8FAFC",
                color: "#64748B", fontWeight: 700, fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
      {/* CSS inline para garantir responsividade mesmo sem media query do globals */}
      <style>{`
        .cart-page-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.25rem;
        }
        @media (min-width: 768px) {
          .cart-page-grid {
            grid-template-columns: 2fr 1fr;
          }
        }
        .cart-items-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .cart-item-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.85rem 1rem;
          background: #F8FAFC;
          border-radius: 12px;
          border: 1px solid #E2E8F0;
          gap: 0.5rem;
        }
        .cart-item-info { flex: 1; min-width: 0; }
        .cart-item-name { font-weight: 700; font-size: 0.95rem; color: #0F172A; }
        .cart-item-qty  { font-size: 0.82rem; color: #64748B; margin-top: 2px; }
        .cart-item-price { font-weight: 800; font-size: 1rem; color: #1565C0; white-space: nowrap; }
        .cart-remove-btn {
          background: none; border: 1px solid #FCA5A5; border-radius: 8px;
          padding: 6px; cursor: pointer; color: #EF4444; display: flex;
          align-items: center; justify-content: center; flex-shrink: 0;
          transition: background 0.2s;
        }
        .cart-remove-btn:hover { background: #FEE2E2; }

        /* Resumo Card */
        .cart-summary-card {
          background: #fff;
          border-radius: 18px;
          border: 1px solid #E2E8F0;
          padding: 1.25rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06);
          position: sticky;
          top: 100px;
        }

        /* Barra de progresso do mínimo */
        .min-bar-wrap {
          background: #FFF7ED;
          border: 1.5px solid #FBBF24;
          border-radius: 12px;
          padding: 0.85rem;
          margin-bottom: 1rem;
        }
        .min-bar-title { font-weight: 700; color: #B45309; font-size: 0.85rem; margin-bottom: 0.4rem; }
        .min-bar-track { height: 8px; background: #FDE68A; border-radius: 4px; overflow: hidden; margin-bottom: 0.4rem; }
        .min-bar-fill  { height: 100%; background: linear-gradient(90deg, #F59E0B, #EF4444); border-radius: 4px; transition: width 0.4s; }
        .min-bar-text  { font-size: 0.78rem; color: #92400E; }

        /* Botão finalizar */
        .checkout-main-btn {
          width: 100%;
          padding: 1rem 1.25rem;
          border: none;
          border-radius: 14px;
          font-weight: 800;
          font-size: 1rem;
          cursor: pointer;
          background: linear-gradient(135deg, #1565C0, #1976D2);
          color: #fff;
          box-shadow: 0 8px 20px rgba(21,101,192,0.35);
          transition: all 0.2s;
          margin-bottom: 0.75rem;
          letter-spacing: 0.3px;
        }
        .checkout-main-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(21,101,192,0.45);
        }
        .checkout-main-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
          background: #94A3B8;
        }

        /* Botão emergência */
        .emergency-btn {
          width: 100%;
          padding: 0.85rem 1.25rem;
          border: none;
          border-radius: 14px;
          font-weight: 700;
          font-size: 0.9rem;
          cursor: pointer;
          background: linear-gradient(135deg, #DC2626, #EF4444);
          color: #fff;
          box-shadow: 0 6px 16px rgba(220,38,38,0.35);
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .emergency-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 10px 24px rgba(220,38,38,0.45);
        }
        .emergency-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        /* Modal overlay */
        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.55);
          z-index: 200;
          display: flex; align-items: flex-end; justify-content: center;
          padding: 0;
        }
        @media (min-width: 600px) {
          .modal-overlay { align-items: center; padding: 1rem; }
        }
        .modal-sheet {
          background: #fff;
          border-radius: 24px 24px 0 0;
          width: 100%;
          max-height: 92vh;
          overflow-y: auto;
          padding: 1.5rem 1.25rem 2rem;
        }
        @media (min-width: 600px) {
          .modal-sheet {
            border-radius: 20px;
            max-width: 540px;
          }
        }
        .modal-handle {
          width: 40px; height: 4px; background: #E2E8F0;
          border-radius: 4px; margin: 0 auto 1.25rem; display: block;
        }
        @media (min-width: 600px) { .modal-handle { display: none; } }

        .modal-title {
          font-size: 1.2rem; font-weight: 800; color: #DC2626;
          display: flex; align-items: center; gap: 8px; margin-bottom: 1rem;
        }
        .modal-rule-list {
          list-style: none; display: flex; flex-direction: column; gap: 0.55rem;
          margin-bottom: 1.25rem;
        }
        .modal-rule-list li {
          font-size: 0.88rem; color: #374151; line-height: 1.5;
          padding: 0.5rem 0.75rem; background: #F9FAFB;
          border-radius: 8px; border-left: 3px solid #E2E8F0;
        }
        .modal-rule-list li.danger {
          background: #FEF2F2; border-left-color: #EF4444; color: #7F1D1D;
        }
        .modal-agree-box {
          background: #F0F4FF; border: 1.5px solid #BFDBFE;
          border-radius: 12px; padding: 0.85rem; text-align: center;
          font-weight: 700; color: #1E3A8A; font-size: 0.9rem;
          margin-bottom: 1.25rem;
        }
        .modal-actions { display: flex; gap: 0.75rem; }
        .modal-cancel-btn {
          flex: 1; padding: 0.85rem; border: 1.5px solid #E2E8F0;
          background: #fff; border-radius: 12px; font-weight: 600;
          font-size: 0.9rem; color: #475569; cursor: pointer;
        }
        .modal-confirm-btn {
          flex: 1; padding: 0.85rem; border: none;
          background: linear-gradient(135deg, #DC2626, #EF4444);
          border-radius: 12px; font-weight: 800; font-size: 0.9rem;
          color: #fff; cursor: pointer; box-shadow: 0 6px 16px rgba(220,38,38,0.3);
        }
        .modal-confirm-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>

      <div className="container" style={{ paddingTop: "1.5rem", paddingBottom: "6rem" }}>
        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <Link
            href="/store/compras"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 38, height: 38, borderRadius: "50%",
              border: "1.5px solid #E2E8F0", background: "#fff",
              color: "#475569", textDecoration: "none", flexShrink: 0,
            }}
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0F172A" }}>Meu Carrinho</h1>
        </div>

        <div className="cart-page-grid">
          {/* ── LISTA DE ITENS ─────────────────────────────────── */}
          <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #E2E8F0", padding: "1.25rem", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0F172A", marginBottom: "1rem", paddingBottom: "0.6rem", borderBottom: "2px solid #E2E8F0" }}>
              {items.length} {items.length === 1 ? "item" : "itens"} no carrinho
            </h2>
            <div className="cart-items-list">
              {items.map(item => (
                <div key={item.id} className="cart-item-row">
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.name}</div>
                    <div className="cart-item-qty">Qtd: {item.quantity} × R$ {item.price.toFixed(2)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span className="cart-item-price">R$ {(item.quantity * item.price).toFixed(2)}</span>
                    <button className="cart-remove-btn" onClick={() => removeFromCart(item.id)} title="Remover">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RESUMO E BOTÕES ─────────────────────────────────── */}
          <div className="cart-summary-card">
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0F172A", marginBottom: "1rem", paddingBottom: "0.6rem", borderBottom: "2px solid #E2E8F0" }}>
              Resumo do Pedido
            </h2>

            {/* Linhas de total */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ color: "#64748B", fontSize: "0.9rem" }}>Subtotal</span>
              <span style={{ fontWeight: 600 }}>R$ {total.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <span style={{ color: "#64748B", fontSize: "0.9rem" }}>Frete (Rota Franquia)</span>
              <span style={{ color: "#10B981", fontWeight: 700 }}>Grátis</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between",
              borderTop: "2px solid #E2E8F0", paddingTop: "0.85rem", marginBottom: "1.25rem",
            }}>
              <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>Total</span>
              <span style={{
                fontWeight: 900, fontSize: "1.3rem",
                background: "linear-gradient(135deg, #1565C0, #42A5F5)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>
                R$ {total.toFixed(2)}
              </span>
            </div>

            {/* Barra de progresso pedido mínimo */}
            {total < 300 && (
              <div className="min-bar-wrap">
                <div className="min-bar-title">⚠️ Pedido mínimo: R$ 300,00</div>
                <div className="min-bar-track">
                  <div className="min-bar-fill" style={{ width: `${Math.min((total / 300) * 100, 100)}%` }} />
                </div>
                <div className="min-bar-text">
                  Faltam <strong>R$ {(300 - total).toFixed(2)}</strong> para finalizar. Adicione mais itens.
                </div>
              </div>
            )}

            {/* Botão principal */}
            <button
              className="checkout-main-btn"
              onClick={handleCheckout}
              disabled={loading || total < 300}
            >
              {loading
                ? "⏳ Gerando Boleto..."
                : total < 300
                  ? `⚠️ Faltam R$ ${(300 - total).toFixed(2)}`
                  : "✅ Finalizar e Gerar Boleto"}
            </button>

            {total >= 300 && (
              <p style={{ fontSize: "0.78rem", color: "#94A3B8", textAlign: "center", marginBottom: "1rem" }}>
                Boleto com vencimento em 10 dias via Asaas
              </p>
            )}

            {/* Divisor */}
            <div style={{ borderTop: "1px dashed #E2E8F0", paddingTop: "1rem" }}>
              <button
                className="emergency-btn"
                onClick={() => setIsEmergencyModalOpen(true)}
                disabled={loading}
              >
                <AlertTriangle size={18} />
                Retirada de Emergência
              </button>
              <p style={{ fontSize: "0.72rem", color: "#94A3B8", textAlign: "center", marginTop: "0.5rem" }}>
                Sem entrega • Sujeito a multa de 30% se repetido no mês
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL EMERGÊNCIA ────────────────────────────────────── */}
      {isEmergencyModalOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setIsEmergencyModalOpen(false); }}>
          <div className="modal-sheet">
            <span className="modal-handle" />

            <div className="modal-title">
              <AlertTriangle size={22} />
              Retirada de Emergência
            </div>

            <ul className="modal-rule-list">
              <li>Utilize se esqueceu de pedir, perdeu o prazo ou pediu pouco.</li>
              <li><strong>1 retirada grátis por mês</strong> sem multa.</li>
              <li>A partir da 2ª no mesmo mês: <strong>multa de 30%</strong> sobre o pedido.</li>
              <li>Retirada somente na <strong>base da empresa</strong> (sem entrega).</li>
              <li>Disponível de <strong>segunda a sexta</strong> (sem fins de semana).</li>
              <li>Pedido precisa ser <strong>aceito pela equipe</strong> — não é automático.</li>
              <li>Link de pagamento gerado <strong>somente após aprovação</strong>.</li>
              <li className="danger">
                🚨 Após enviar, <strong>avise o responsável:</strong>{" "}
                <a href="https://wa.me/5521972947120" target="_blank" rel="noopener noreferrer" style={{ color: "#DC2626", textDecoration: "underline" }}>
                  (21) 97294-7120
                </a>
              </li>
            </ul>

            <div className="modal-agree-box">
              Ao confirmar, você concorda com todas as regras acima.
            </div>

            <div className="modal-actions">
              <button
                className="modal-cancel-btn"
                onClick={() => setIsEmergencyModalOpen(false)}
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                className="modal-confirm-btn"
                onClick={handleEmergencyCheckout}
                disabled={loading}
              >
                {loading ? "Enviando..." : "Confirmar Solicitação"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
