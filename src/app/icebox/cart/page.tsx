"use client";

import { useCart } from "@/components/CartProvider";
import { useState } from "react";
import { Trash2, ArrowLeft, ShoppingBag, AlertTriangle, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function IceboxCartPage() {
  const { items, removeFromCart, total, clearCart, isLoaded } = useCart();
  const [loading, setLoading] = useState(false);
  const [boletoUrl, setBoletoUrl] = useState<string | null>(null);
  const [boletoCode, setBoletoCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [overduePayments, setOverduePayments] = useState<any[] | null>(null);
  const router = useRouter();

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
        setOverduePayments(data.overduePayments);
        setLoading(false);
      } else if (res.status === 401) {
        alert("Sessão expirada. Faça login novamente.");
        router.push("/icebox/login");
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

  const copyCode = () => {
    if (boletoCode) {
      navigator.clipboard.writeText(boletoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /* ── TELA: PEDIDO CONFIRMADO ── */
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
                      transition: "background 0.2s", fontFamily: "inherit",
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
                Seu pedido foi registrado com sucesso, mas o gateway demorou para responder.
              </p>
              <p style={{ color: "#7C2D12", fontSize: "0.82rem", lineHeight: 1.5, marginTop: "0.5rem" }}>
                Acompanhe em <strong>Meus Pedidos</strong>.
              </p>
            </div>
          )}

          <button
            onClick={() => router.push("/store/orders")}
            style={{
              width: "100%", padding: "0.75rem", borderRadius: 12,
              border: "1.5px solid #E2E8F0", background: "#fff",
              fontWeight: 600, fontSize: "0.9rem", color: "#475569", cursor: "pointer",
              fontFamily: "inherit",
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
        <p style={{ color: "#64748B", fontWeight: 600, fontSize: "1.1rem" }}>Carregando carrinho...</p>
      </div>
    );
  }

  /* ── TELA: CARRINHO VAZIO ── */
  if (items.length === 0 && !overduePayments) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <ShoppingBag size={64} color="#CBD5E1" style={{ margin: "0 auto 1rem" }} />
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Carrinho vazio</h2>
          <p style={{ color: "#64748B", marginBottom: "1.5rem" }}>Adicione produtos antes de finalizar.</p>
          <Link href="/icebox/compras" style={{
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

  /* ── TELA: CARRINHO PRINCIPAL ── */
  return (
    <>
      {/* ── MODAL INADIMPLÊNCIA ── */}
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
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className="container" style={{ paddingTop: "1.5rem", paddingBottom: "6rem", maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem 6rem" }}>
        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <Link
            href="/icebox/compras"
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.25rem" }}>
          {/* ── LISTA DE ITENS ── */}
          <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #E2E8F0", padding: "1.25rem", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0F172A", marginBottom: "1rem", paddingBottom: "0.6rem", borderBottom: "2px solid #E2E8F0" }}>
              {items.length} {items.length === 1 ? "item" : "itens"} no carrinho
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {items.map(item => (
                <div key={item.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.85rem 1rem", background: "#F8FAFC", borderRadius: 12,
                  border: "1px solid #E2E8F0", gap: "0.5rem",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0F172A" }}>{item.name}</div>
                    <div style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 2 }}>Qtd: {item.quantity} × R$ {item.price.toFixed(2)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ fontWeight: 800, fontSize: "1rem", color: "#1565C0", whiteSpace: "nowrap" }}>R$ {(item.quantity * item.price).toFixed(2)}</span>
                    <button onClick={() => removeFromCart(item.id)} title="Remover" style={{
                      background: "none", border: "1px solid #FCA5A5", borderRadius: 8,
                      padding: 6, cursor: "pointer", color: "#EF4444", display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RESUMO ── */}
          <div style={{
            background: "#fff", borderRadius: 18, border: "1px solid #E2E8F0",
            padding: "1.25rem", boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0F172A", marginBottom: "1rem", paddingBottom: "0.6rem", borderBottom: "2px solid #E2E8F0" }}>
              Resumo do Pedido
            </h2>

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

            {/* Barra mínimo */}
            {total < 300 && (
              <div style={{
                background: "#FFF7ED", border: "1.5px solid #FBBF24",
                borderRadius: 12, padding: "0.85rem", marginBottom: "1rem",
              }}>
                <div style={{ fontWeight: 700, color: "#B45309", fontSize: "0.85rem", marginBottom: "0.4rem" }}>⚠️ Pedido mínimo: R$ 300,00</div>
                <div style={{ height: 8, background: "#FDE68A", borderRadius: 4, overflow: "hidden", marginBottom: "0.4rem" }}>
                  <div style={{ width: `${Math.min((total / 300) * 100, 100)}%`, height: "100%", background: "linear-gradient(90deg, #F59E0B, #EF4444)", borderRadius: 4, transition: "width 0.4s" }} />
                </div>
                <div style={{ fontSize: "0.78rem", color: "#92400E" }}>
                  Faltam <strong>R$ {(300 - total).toFixed(2)}</strong> para finalizar. Adicione mais itens.
                </div>
              </div>
            )}

            {/* Botão principal */}
            <button
              onClick={handleCheckout}
              disabled={loading || total < 300}
              style={{
                width: "100%", padding: "1rem 1.25rem", border: "none", borderRadius: 14,
                fontWeight: 800, fontSize: "1rem", cursor: loading || total < 300 ? "not-allowed" : "pointer",
                background: loading || total < 300 ? "#94A3B8" : "linear-gradient(135deg, #1565C0, #1976D2)",
                color: "#fff",
                boxShadow: total >= 300 && !loading ? "0 8px 20px rgba(21,101,192,0.35)" : "none",
                opacity: loading || total < 300 ? 0.55 : 1,
                transition: "all 0.2s", letterSpacing: "0.3px",
                fontFamily: "inherit", marginBottom: "0.75rem",
              }}
            >
              {loading
                ? "⏳ Gerando Boleto..."
                : total < 300
                  ? `⚠️ Faltam R$ ${(300 - total).toFixed(2)}`
                  : "✅ Finalizar e Gerar Boleto"}
            </button>

            {total >= 300 && (
              <p style={{ fontSize: "0.78rem", color: "#94A3B8", textAlign: "center" }}>
                Boleto com vencimento em 10 dias via Asaas
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
