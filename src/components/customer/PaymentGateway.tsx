"use client";
/**
 * FireHub — Componente de Pagamento Online
 * Gateways: Mercado Pago (PIX + Cartão D+2)
 * Celcoin: integração futura (standby)
 *
 * Fluxo PIX:
 *   POST /api/payments/pix → qr code → polling /api/payments/status
 *
 * Fluxo Cartão:
 *   MP Brick tokeniza o cartão no cliente → POST /api/payments/card
 */
import { useState, useEffect, useRef } from "react";
import { QrCode, CreditCard, Check, X, Loader, RefreshCw } from "lucide-react";

type PayMethod = "pix" | "credit_card";

const PAYMENT_LABELS: Record<PayMethod, string> = {
  pix:         "💰 PIX — Instantâneo",
  credit_card: "💳 Cartão de Crédito — D+2",
};

export default function PaymentGateway({
  orderId, amount, onPaid, onError, onCancel
}: {
  orderId:  string;
  amount:   number;
  onPaid:   () => void;
  onError:  (msg: string) => void;
  onCancel: () => void;
}) {
  const [method, setMethod]       = useState<PayMethod>("pix");
  const [loading, setLoading]     = useState(false);
  const [pixData, setPixData]     = useState<{ paymentId: string; pixKey: string; qrCodeBase64: string | null; expiresAt: string } | null>(null);
  const [pixPaid, setPixPaid]     = useState(false);
  const [pixExpired, setPixExpired] = useState(false);
  const [copied, setCopied]       = useState(false);

  // Dados do cartão (tokenizados via MP Brick)
  const [cardNumber, setCardNumber]         = useState("");
  const [cardHolder, setCardHolder]         = useState("");
  const [cardExpiry, setCardExpiry]         = useState("");
  const [cardCvv, setCardCvv]               = useState("");
  const [payerCpf, setPayerCpf]             = useState("");
  const [installments, setInstallments]     = useState(1);

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ──────────────────────────── PIX ────────────────────────────
  const handlePixPay = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) { onError(data.error || "Erro ao gerar PIX"); return; }

      setPixData(data);
      startPixPolling(data.paymentId);

      // Expiração
      if (data.expiresAt) {
        const ms = new Date(data.expiresAt).getTime() - Date.now();
        if (ms > 0) setTimeout(() => setPixExpired(true), ms);
      }
    } catch (e: any) {
      onError(e.message || "Erro de rede");
    } finally {
      setLoading(false);
    }
  };

  const startPixPolling = (paymentId?: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/status?orderId=${orderId}`);
        if (res.ok) {
          const d = await res.json();
          if (d.paid)   { setPixPaid(true); clearInterval(pollRef.current!); setTimeout(onPaid, 1500); }
          if (d.failed) { clearInterval(pollRef.current!); onError("PIX expirado ou falhou."); }
        }
      } catch {}
    }, 3000);
  };

  const copyPix = () => {
    if (pixData?.pixKey) {
      navigator.clipboard.writeText(pixData.pixKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ──────────────────────────── CARTÃO ────────────────────────────
  const handleCardPay = async () => {
    if (!cardNumber || !cardHolder || !cardExpiry || !cardCvv || !payerCpf) {
      onError("Preencha todos os dados do cartão."); return;
    }
    setLoading(true);
    try {
      // Tokenização via Mercado Pago SDK (carregado no layout)
      const mp = (window as any).MercadoPago;
      if (!mp) {
        onError("Biblioteca Mercado Pago não carregada. Recarregue a página.");
        setLoading(false); return;
      }

      const mpInstance = new mp(process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "");
      const [expMonth, expYear] = cardExpiry.split("/");

      const { token: cardToken, error: tokenError } = await mpInstance.createCardToken({
        cardNumber:       cardNumber.replace(/\s/g, ""),
        cardholderName:   cardHolder,
        cardExpirationMonth: expMonth,
        cardExpirationYear: `20${expYear}`,
        securityCode:    cardCvv,
        identificationType: "CPF",
        identificationNumber: payerCpf.replace(/\D/g, ""),
      });

      if (tokenError) { onError("Dados do cartão inválidos. Verifique e tente novamente."); return; }

      const res = await fetch("/api/payments/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId, cardToken, installments,
          payerCpf: payerCpf.replace(/\D/g, ""),
        }),
      });
      const data = await res.json();
      if (!res.ok) { onError(data.error || "Cartão recusado"); return; }
      if (data.paid) { setTimeout(onPaid, 800); }
      else { onError("Pagamento não aprovado. Tente outro cartão ou use o PIX."); }
    } catch (e: any) {
      onError(e.message || "Erro no cartão");
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────── FORMATAÇÃO ────────────────────────────
  const fmtCard   = (v: string) => v.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim().slice(0, 19);
  const fmtExpiry = (v: string) => { const d = v.replace(/\D/g, ""); return d.length > 2 ? `${d.slice(0,2)}/${d.slice(2,4)}` : d; };
  const fmtCpf    = (v: string) => { const d = v.replace(/\D/g, ""); return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"); };

  const inp: React.CSSProperties = {
    width: "100%", padding: "11px 13px", borderRadius: "10px",
    border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none",
    fontFamily: "inherit", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px"
  };

  // ──────────────────────────── RENDER ────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>💳 Pagamento Online</h2>
          <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>
            Total: <strong style={{ color: "#16A34A" }}>R$ {amount.toFixed(2).replace(".", ",")}</strong>
          </p>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8" }}>
          <X size={20} />
        </button>
      </div>

      {/* Seleção de método */}
      {!pixData && !pixPaid && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {(["pix", "credit_card"] as PayMethod[]).map(m => (
            <button key={m} onClick={() => setMethod(m)}
              style={{
                flex: 1, padding: "12px 8px", borderRadius: "12px",
                border: `2px solid ${method === m ? "#009EE3" : "#E2E8F0"}`,
                background: method === m ? "#EFF9FF" : "#fff",
                cursor: "pointer", textAlign: "center",
                fontWeight: method === m ? 700 : 500, fontSize: "0.82rem",
                color: method === m ? "#009EE3" : "#475569",
                transition: "all 0.15s", fontFamily: "inherit",
              }}>
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {/* ── PIX ── */}
      {method === "pix" && !pixData && !pixPaid && (
        <button onClick={handlePixPay} disabled={loading}
          style={{
            width: "100%", padding: "14px", borderRadius: "12px", border: "none",
            background: loading ? "#94A3B8" : "linear-gradient(135deg,#00BFA5,#009688)",
            color: "#fff", fontWeight: 800, fontSize: "1rem",
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit",
          }}>
          {loading
            ? <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Gerando PIX...</>
            : <><QrCode size={18} /> Gerar QR Code PIX</>}
        </button>
      )}

      {/* QR CODE */}
      {pixData && !pixPaid && !pixExpired && (
        <div style={{ textAlign: "center" }}>
          <div style={{ background: "#F0FDF4", border: "2px solid #BBF7D0", borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#16A34A", marginBottom: "12px" }}>
              📱 Escaneie ou copie o código PIX abaixo
            </p>
            {pixData.qrCodeBase64 ? (
              <img src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                alt="QR Code PIX" style={{ width: 200, height: 200, borderRadius: "8px" }} />
            ) : (
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixData.pixKey)}`}
                alt="QR Code PIX" style={{ width: 200, height: 200, borderRadius: "8px" }} />
            )}
            <div style={{ marginTop: "12px" }}>
              <button onClick={copyPix}
                style={{
                  padding: "10px 20px", borderRadius: "10px",
                  border: "1.5px solid #16A34A",
                  background: copied ? "#16A34A" : "#fff",
                  color: copied ? "#fff" : "#16A34A",
                  fontWeight: 700, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "inherit",
                }}>
                {copied ? <><Check size={14} /> Copiado!</> : "📋 Copiar código PIX"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", color: "#64748B", fontSize: "0.8rem" }}>
            <Loader size={13} style={{ animation: "spin 2s linear infinite" }} />
            Aguardando confirmação...
          </div>
          {pixData.expiresAt && (
            <p style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: "6px" }}>
              Expira às {new Date(pixData.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      )}

      {pixPaid && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Check size={32} color="#fff" />
          </div>
          <h3 style={{ fontWeight: 800, color: "#16A34A" }}>PIX Confirmado! ✅</h3>
          <p style={{ fontSize: "0.85rem", color: "#64748B" }}>Seu pedido foi aceito automaticamente.</p>
        </div>
      )}

      {pixExpired && (
        <div style={{ textAlign: "center", padding: "1.5rem" }}>
          <p style={{ fontWeight: 700, color: "#DC2626" }}>⏱️ PIX expirado.</p>
          <button onClick={() => { setPixData(null); setPixExpired(false); }}
            style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "#009688", color: "#fff", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
            <RefreshCw size={14} /> Gerar novo PIX
          </button>
        </div>
      )}

      {/* ── CARTÃO ── */}
      {method === "credit_card" && !pixData && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "10px 14px", background: "#EFF9FF", border: "1px solid #BAE6FD", borderRadius: "10px", fontSize: "0.78rem", color: "#0369A1", fontWeight: 600 }}>
            🔒 Dados criptografados pelo Mercado Pago — não armazenados no servidor
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>Número do Cartão</label>
              <input style={inp} value={cardNumber} onChange={e => setCardNumber(fmtCard(e.target.value))}
                placeholder="0000 0000 0000 0000" maxLength={19} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>Nome no Cartão</label>
              <input style={inp} value={cardHolder} onChange={e => setCardHolder(e.target.value.toUpperCase())}
                placeholder="NOME COMO NO CARTÃO" />
            </div>
            <div>
              <label style={lbl}>Validade</label>
              <input style={inp} value={cardExpiry} onChange={e => setCardExpiry(fmtExpiry(e.target.value))}
                placeholder="MM/AA" maxLength={5} />
            </div>
            <div>
              <label style={lbl}>CVV</label>
              <input style={inp} value={cardCvv} onChange={e => setCardCvv(e.target.value.replace(/\D/g, ""))}
                placeholder="123" maxLength={4} type="password" />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>CPF do Titular</label>
              <input style={inp} value={payerCpf} onChange={e => setPayerCpf(fmtCpf(e.target.value))}
                placeholder="000.000.000-00" maxLength={14} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>Parcelas</label>
              <select style={{ ...inp, cursor: "pointer" }} value={installments} onChange={e => setInstallments(Number(e.target.value))}>
                {[1,2,3,4,5,6].map(n => (
                  <option key={n} value={n}>
                    {n}x de R$ {(amount / n).toFixed(2).replace(".", ",")} {n === 1 ? "(sem juros)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button onClick={handleCardPay}
            disabled={loading || !cardNumber || !cardHolder || !cardExpiry || !cardCvv || !payerCpf}
            style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: loading ? "#94A3B8" : "linear-gradient(135deg,#009EE3,#006EBF)",
              color: "#fff", fontWeight: 800, fontSize: "1rem",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit",
            }}>
            {loading
              ? <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Processando...</>
              : <><CreditCard size={18} /> Pagar R$ {amount.toFixed(2).replace(".", ",")} via Mercado Pago</>}
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
