"use client";
/**
 * FireHub — Componente de Pagamento Online
 * Gateways: Mercado Pago (PIX + Cartão D+2)
 *
 * Fluxo PIX:
 *   POST /api/payments/pix → qr code → polling /api/payments/status
 *
 * Fluxo Cartão:
 *   MP Brick tokeniza o cartão no cliente → POST /api/payments/card
 */
import { useState, useEffect, useRef } from "react";
import { Check, X, Loader, RefreshCw, CreditCard, ShieldCheck } from "lucide-react";

type PayMethod = "pix" | "credit_card";

const PAYMENT_LABELS: Record<PayMethod, string> = {
  pix:         "💰 PIX — Instantâneo",
  credit_card: "💳 Cartão de Crédito — D+2",
};

export default function PaymentGateway({
  orderId, amount, initialMethod = "pix", onPaid, onError, onCancel
}: {
  orderId:  string;
  amount:   number;
  initialMethod?: "pix" | "credit_card";
  onPaid:   () => void;
  onError:  (msg: string) => void;
  onCancel: () => void;
}) {
  const [method, setMethod]       = useState<PayMethod>(initialMethod);
  const [loading, setLoading]     = useState(false);
  const [pixData, setPixData]     = useState<{ paymentId: string; pixKey: string; qrCodeBase64: string | null; expiresAt: string } | null>(null);
  const [pixPaid, setPixPaid]     = useState(false);
  const [pixExpired, setPixExpired] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const autoTriggeredRef           = useRef(false);

  // Mercado Pago Public Key
  const [mpPublicKey, setMpPublicKey] = useState<string>(process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "");

  // Dados do cartão
  const [cardNumber, setCardNumber]         = useState("");
  const [cardHolder, setCardHolder]         = useState("");
  const [cardExpiry, setCardExpiry]         = useState("");
  const [cardCvv, setCardCvv]               = useState("");
  const [payerCpf, setPayerCpf]             = useState("");
  const [installments, setInstallments]     = useState(1);

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Carregar script do Mercado Pago e Public Key do backend
  useEffect(() => {
    // 1. Buscar Public Key
    fetch(`/api/payments/config?orderId=${orderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.mpPublicKey) {
          setMpPublicKey(data.mpPublicKey);
        }
      })
      .catch(() => {});

    // 2. Garantir que o script do Mercado Pago está carregado
    if (typeof window !== "undefined" && !(window as any).MercadoPago) {
      const existingScript = document.getElementById("mercadopago-sdk-script");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "mercadopago-sdk-script";
        script.src = "https://sdk.mercadopago.com/js/v2";
        script.async = true;
        document.body.appendChild(script);
      }
    }
  }, [orderId]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Disparar geração de PIX automaticamente na montagem se o método for PIX
  useEffect(() => {
    if (method === "pix" && !pixData && !loading && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handlePixPay();
    }
  }, [method]);

  // ──────────────────────────── PIX ────────────────────────────
  const handlePixPay = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/payments/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        const rawErr = data.error || "Erro ao gerar PIX";
        const isMerchantConfigError =
          rawErr.includes("Credenciais") ||
          rawErr.includes("Mercado Pago") ||
          rawErr.includes("não configuradas") ||
          rawErr.includes("Unauthorized") ||
          rawErr.includes("invalid_token");

        const cleanMsg = isMerchantConfigError
          ? "O pagamento online está temporariamente indisponível nesta loja. Por favor, escolha pagamento na entrega."
          : rawErr;
        setErrorMessage(cleanMsg);
        onError(cleanMsg);
        return;
      }

      setPixData(data);
      startPixPolling(data.paymentId);

      // Expiração
      if (data.expiresAt) {
        const ms = new Date(data.expiresAt).getTime() - Date.now();
        if (ms > 0) setTimeout(() => setPixExpired(true), ms);
      }
    } catch (e: any) {
      const msg = e.message || "Erro de rede ao conectar ao gateway de pagamento.";
      setErrorMessage(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  };

  const startPixPolling = (paymentId?: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/status?orderId=${orderId}`);
        if (res.ok) {
          const d = await res.json();
          if (d.paid) {
            setPixPaid(true);
            if (pollRef.current) clearInterval(pollRef.current);
            setTimeout(onPaid, 1500);
          }
          if (d.failed) {
            if (pollRef.current) clearInterval(pollRef.current);
            setErrorMessage("PIX expirado ou cancelado.");
            onError("PIX expirado ou cancelado.");
          }
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
    setErrorMessage(null);
    const cleanNum = cardNumber.replace(/\s/g, "");
    const cleanCpf = payerCpf.replace(/\D/g, "");

    if (cleanNum.length < 13) {
      const err = "Por favor, digite um número de cartão válido.";
      setErrorMessage(err);
      onError(err);
      return;
    }
    if (!cardHolder.trim()) {
      const err = "Digite o nome do titular como está impresso no cartão.";
      setErrorMessage(err);
      onError(err);
      return;
    }
    if (!cardExpiry.includes("/") || cardExpiry.length < 5) {
      const err = "Digite a validade do cartão no formato MM/AA.";
      setErrorMessage(err);
      onError(err);
      return;
    }
    if (cardCvv.length < 3) {
      const err = "Digite o código de segurança (CVV) do cartão.";
      setErrorMessage(err);
      onError(err);
      return;
    }
    if (cleanCpf.length !== 11) {
      const err = "Digite um CPF válido (11 dígitos).";
      setErrorMessage(err);
      onError(err);
      return;
    }

    setLoading(true);
    try {
      // 1. Aguardar SDK Mercado Pago se ainda estiver carregando
      let mp = (window as any).MercadoPago;
      if (!mp) {
        // Tentar aguardar 1 segundo
        await new Promise(r => setTimeout(r, 1000));
        mp = (window as any).MercadoPago;
      }

      if (!mp) {
        const err = "A biblioteca de pagamento seguro está carregando. Por favor, tente novamente em alguns segundos.";
        setErrorMessage(err);
        onError(err);
        setLoading(false);
        return;
      }

      const activeKey = mpPublicKey || process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "";
      if (!activeKey) {
        const err = "Pagamento por cartão online temporariamente indisponível nesta loja. Escolha pagamento na entrega ou PIX.";
        setErrorMessage(err);
        onError(err);
        setLoading(false);
        return;
      }

      const mpInstance = new mp(activeKey);
      const [expMonth, expYear] = cardExpiry.split("/");
      const fullYear = expYear.length === 2 ? `20${expYear}` : expYear;

      // 2. Tokenização compatível com MP SDK v2
      let cardToken = "";
      try {
        const tokenResp = await mpInstance.createCardToken({
          cardNumber: cleanNum,
          cardholderName: cardHolder.trim(),
          cardExpirationMonth: String(expMonth).padStart(2, "0"),
          cardExpirationYear: fullYear,
          securityCode: cardCvv.trim(),
          identification: {
            type: "CPF",
            number: cleanCpf,
          },
        });

        if (tokenResp.error || !tokenResp.id) {
          const errMsg = tokenResp.error?.message || "Dados do cartão incorretos. Verifique número, validade e CVV.";
          setErrorMessage(errMsg);
          onError(errMsg);
          setLoading(false);
          return;
        }

        cardToken = tokenResp.id;
      } catch (tokenErr: any) {
        const errMsg = tokenErr?.message || "Falha na validação do cartão. Verifique os dados.";
        setErrorMessage(errMsg);
        onError(errMsg);
        setLoading(false);
        return;
      }

      // 3. Enviar token gerado ao backend para autorização
      const res = await fetch("/api/payments/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          cardToken,
          installments,
          payerCpf: cleanCpf,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || "Pagamento recusado pela operadora do cartão.";
        setErrorMessage(errMsg);
        onError(errMsg);
        return;
      }

      if (data.paid) {
        setPixPaid(true);
        setTimeout(onPaid, 1000);
      } else {
        const errMsg = data.statusDetail
          ? `Pagamento não aprovado (${data.statusDetail}). Tente outro cartão ou utilize o PIX.`
          : "Pagamento não aprovado pela operadora. Tente outro cartão ou PIX.";
        setErrorMessage(errMsg);
        onError(errMsg);
      }
    } catch (e: any) {
      const errMsg = e.message || "Erro de comunicação ao processar o cartão.";
      setErrorMessage(errMsg);
      onError(errMsg);
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
    border: "1.5px solid #CBD5E1", fontSize: "0.88rem", outline: "none",
    fontFamily: "inherit", boxSizing: "border-box", transition: "border 0.2s ease"
  };
  const lbl: React.CSSProperties = {
    fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px"
  };

  // ──────────────────────────── RENDER ────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0, color: "#0F172A" }}>
            {method === "pix" ? "💰 Pagamento via Pix" : "💳 Pagamento via Cartão"}
          </h2>
          <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "2px 0 0" }}>
            Total a pagar: <strong style={{ color: "#16A34A" }}>R$ {amount.toFixed(2).replace(".", ",")}</strong>
          </p>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8" }}>
          <X size={20} />
        </button>
      </div>

      {/* Banner explicativo */}
      {!pixPaid && (
        <div style={{
          background: "#FEF3C7",
          border: "1.5px solid #FCD34D",
          borderRadius: "12px",
          padding: "10px 14px",
          marginBottom: "16px",
          fontSize: "0.82rem",
          fontWeight: 700,
          color: "#92400E",
          lineHeight: "1.4",
          textAlign: "center"
        }}>
          ⚠️ Realize o pagamento para o pedido ser enviado à cozinha. A confirmação é automática nesta tela.
        </div>
      )}

      {/* Mensagem de Erro Inline se houver */}
      {errorMessage && (
        <div style={{
          background: "#FEF2F2",
          border: "1.5px solid #FCA5A5",
          borderRadius: "12px",
          padding: "14px",
          marginBottom: "16px",
          textAlign: "center"
        }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#DC2626", margin: "0 0 12px" }}>
            ❌ {errorMessage}
          </p>
          <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setErrorMessage(null);
                if (method === "pix") handlePixPay();
                else handleCardPay();
              }}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "none",
                background: "#DC2626",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
                fontFamily: "inherit"
              }}
            >
              🔄 Tentar Novamente
            </button>
            <button
              onClick={onCancel}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1.5px solid #CBD5E1",
                background: "#fff",
                color: "#475569",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
                fontFamily: "inherit"
              }}
            >
              🛵 Pagar na Entrega
            </button>
          </div>
        </div>
      )}

      {/* Seleção de método (se o lojista aceitar ambos) */}
      {!pixPaid && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {(["pix", "credit_card"] as PayMethod[]).map(m => (
            <button
              key={m}
              onClick={() => {
                setMethod(m);
                setErrorMessage(null);
              }}
              style={{
                flex: 1, padding: "10px 8px", borderRadius: "10px",
                border: `2px solid ${method === m ? "#DC2626" : "#E2E8F0"}`,
                background: method === m ? "#FEF2F2" : "#fff",
                cursor: "pointer", textAlign: "center",
                fontWeight: method === m ? 800 : 600, fontSize: "0.82rem",
                color: method === m ? "#DC2626" : "#475569",
                transition: "all 0.15s", fontFamily: "inherit",
              }}>
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {/* ── PIX ── */}
      {method === "pix" && !pixData && !pixPaid && !errorMessage && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <Loader size={32} color="#DC2626" style={{ animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#334155" }}>Gerando QR Code PIX seguro...</p>
        </div>
      )}

      {/* QR CODE */}
      {method === "pix" && pixData && !pixPaid && !pixExpired && (
        <div style={{ textAlign: "center" }}>
          <div style={{ background: "#F0FDF4", border: "2px solid #BBF7D0", borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
            <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "#16A34A", marginBottom: "12px" }}>
              📱 Escaneie o QR Code ou copie o código PIX
            </p>
            {pixData.qrCodeBase64 ? (
              <img src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                alt="QR Code PIX" style={{ width: 200, height: 200, borderRadius: "8px", margin: "0 auto" }} />
            ) : (
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixData.pixKey)}`}
                alt="QR Code PIX" style={{ width: 200, height: 200, borderRadius: "8px", margin: "0 auto" }} />
            )}
            <div style={{ marginTop: "14px" }}>
              <button onClick={copyPix}
                style={{
                  padding: "12px 24px", borderRadius: "10px",
                  border: "1.5px solid #16A34A",
                  background: copied ? "#16A34A" : "#fff",
                  color: copied ? "#fff" : "#16A34A",
                  fontWeight: 800, cursor: "pointer", fontSize: "0.9rem",
                  display: "inline-flex", alignItems: "center", gap: "8px", fontFamily: "inherit",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
                }}>
                {copied ? <><Check size={16} /> Código Copiado!</> : <>📋 Copiar Código PIX</>}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", color: "#475569", fontSize: "0.85rem", fontWeight: 700 }}>
            <Loader size={15} style={{ animation: "spin 1.5s linear infinite" }} />
            Aguardando confirmação do pagamento...
          </div>
          {pixData.expiresAt && (
            <p style={{ fontSize: "0.74rem", color: "#94A3B8", marginTop: "6px" }}>
              Expira às {new Date(pixData.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      )}

      {pixPaid && (
        <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Check size={36} color="#fff" />
          </div>
          <h3 style={{ fontWeight: 800, color: "#16A34A", fontSize: "1.2rem", marginBottom: "6px" }}>
            Pagamento Confirmado! ✅
          </h3>
          <p style={{ fontSize: "0.88rem", color: "#334155", fontWeight: 600 }}>
            Seu pedido foi recebido e enviado para a cozinha!
          </p>
        </div>
      )}

      {pixExpired && (
        <div style={{ textAlign: "center", padding: "1.5rem" }}>
          <p style={{ fontWeight: 700, color: "#DC2626" }}>⏱️ PIX expirado.</p>
          <button onClick={() => { setPixData(null); setPixExpired(false); handlePixPay(); }}
            style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
            <RefreshCw size={14} /> Gerar novo PIX
          </button>
        </div>
      )}

      {/* ── CARTÃO DE CRÉDITO ── */}
      {method === "credit_card" && !pixPaid && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "10px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "10px", fontSize: "0.78rem", color: "#1E40AF", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
            <ShieldCheck size={18} color="#2563EB" style={{ flexShrink: 0 }} />
            <span>Dados criptografados pelo Mercado Pago com proteção antifraude.</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>Número do Cartão</label>
              <input style={inp} value={cardNumber} onChange={e => setCardNumber(fmtCard(e.target.value))}
                placeholder="0000 0000 0000 0000" maxLength={19} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>Nome Impresso no Cartão</label>
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
              <label style={lbl}>CPF do Titular do Cartão</label>
              <input style={inp} value={payerCpf} onChange={e => setPayerCpf(fmtCpf(e.target.value))}
                placeholder="000.000.000-00" maxLength={14} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={lbl}>Parcelamento</label>
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
              background: loading ? "#94A3B8" : "linear-gradient(135deg, #DC2626, #B91C1C)",
              color: "#fff", fontWeight: 800, fontSize: "1rem",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit",
              boxShadow: "0 4px 14px rgba(220, 38, 38, 0.3)"
            }}>
            {loading
              ? <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Processando Pagamento...</>
              : <><CreditCard size={18} /> Pagar R$ {amount.toFixed(2).replace(".", ",")}</>}
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
