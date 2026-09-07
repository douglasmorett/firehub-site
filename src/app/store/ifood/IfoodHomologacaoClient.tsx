"use client";
import React, { useState, useEffect } from "react";
import { Store, Clock, RefreshCw, Trash2, Plus, CheckCircle, ExternalLink, Loader, Wifi, WifiOff, Copy } from "lucide-react";
import TabCardapio from "./TabCardapio";
import TabEntrega from "./TabEntrega";
import TabEventos from "./TabEventos";

type Tab = "loja" | "pausas" | "horarios" | "cardapio" | "entrega" | "eventos" | "widget";

// ── Status da conexão ──────────────────────────────────────
type ConnStatus = "idle" | "loading" | "ok" | "error";

// ── helpers ────────────────────────────────────────────────
const fmt = (s: string) => new Date(s).toLocaleString("pt-BR");

const DAYS_PT: Record<string, string> = {
  MONDAY: "Segunda", TUESDAY: "Terça", WEDNESDAY: "Quarta",
  THURSDAY: "Quinta", FRIDAY: "Sexta", SATURDAY: "Sábado", SUNDAY: "Domingo",
};

// ── Componente principal ────────────────────────────────────
export default function IfoodHomologacaoClient({
  merchantId,
  clientId,
  ifoodWidgetId,
}: {
  merchantId: string;
  clientId: string;
  ifoodWidgetId?: string;
}) {
  const [tab, setTab]           = useState<Tab>("loja");
  const [connStatus, setConn]   = useState<ConnStatus>("loading"); // começa carregando
  const [connData,   setConnData] = useState<any>(null);
  const [authCode,   setAuthCode] = useState("");
  const [authStep,   setAuthStep] = useState<"idle"|"loading"|"done">("idle");
  const [authResult, setAuthResult] = useState<any>(null);
  const [genCode,    setGenCode]    = useState<string | null>(null);
  const [genVerifier, setGenVerifier] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError,   setGenError]   = useState("");
  const [showModal,  setShowModal]  = useState(false);

  // Conexão direta por Merchant UUID (Aplicativos Centralizados)
  const [connectMethod, setConnectMethod] = useState<"direct" | "code">("direct");
  const [directId, setDirectId] = useState("");
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState("");

  const linkDirectMerchantId = async () => {
    setDirectLoading(true); setDirectError("");
    try {
      const r = await fetch("/api/ifood/auth/link-merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: directId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao conectar");
      await testConnection();
    } catch (e: any) {
      setDirectError(e.message);
    } finally {
      setDirectLoading(false);
    }
  };

  const generateActivationCode = async (app: "producao" | "homologacao" = "producao") => {
    setGenLoading(true); setGenError(""); setGenCode(null); setGenVerifier(null);
    try {
      const r = await fetch("/api/ifood/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || JSON.stringify(d.details || "Erro"));
      // userCode é o que o lojista digita no portal.ifood.com.br/apps/code
      setGenCode(d.userCode ?? d.authorizationCode);
      setGenVerifier(d.verifier ?? null);
    } catch (e: any) { setGenError(e.message); }
    finally { setGenLoading(false); }
  };

  const testConnection = async (force = false) => {
    setConn("loading");
    try {
      // /api/ifood/conexao pergunta pela camada nova, que usa o token da
      // própria loja. O teste antigo perguntava com o token do app
      // centralizado e concluía "desconectada" para toda loja do distribuído.
      const r = await fetch("/api/ifood/conexao?distribuido=1");
      const d = await r.json();
      setConnData(d);
      setConn(r.ok && d.connected ? "ok" : "error");
    } catch { setConn("error"); }
  };

  const disconnectStore = async () => {
    if (!window.confirm("Tem certeza que deseja desconectar esta conta iFood?")) return;
    setConn("loading");
    try {
      const r = await fetch("/api/ifood/auth?step=disconnect");
      await r.json();
      setConnData(null);
      setConn("idle");
    } catch { setConn("error"); }
  };

  // Auto-verifica ao carregar a página (force=true para reconectar automaticamente)
  useEffect(() => { testConnection(true); }, []);

  const getAuthUrl = async () => {
    const r = await fetch("/api/ifood/auth?step=url");
    const d = await r.json();
    if (d.authUrl) window.open(d.authUrl, "_blank");
  };

  const exchangeCode = async () => {
    setAuthStep("loading");
    try {
      const r = await fetch("/api/ifood/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizationCode: authCode }),
      });
      const d = await r.json();
      setAuthResult(d);
      setAuthStep("done");
      if (d.success) await testConnection();
    } catch { setAuthStep("idle"); }
  };

  const tabBtn = (id: Tab, label: string, emoji: string, disabled = false) => (
    <button
      onClick={() => !disabled && setTab(id)}
      disabled={disabled}
      style={{
        flex: 1, padding: "0.75rem 0.5rem", border: "none",
        borderBottom: tab === id ? "3px solid #E8360C" : "3px solid transparent",
        background: tab === id ? "#FFF5F3" : "#fff",
        color: tab === id ? "#E8360C" : "#64748B",
        fontWeight: tab === id ? 800 : 500,
        fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}
    >
      {emoji} {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "1.5rem 1rem" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.25rem" }}>
        <img src="/firehub-flame.png" alt="FireHub" style={{ width: 36, height: 36, borderRadius: 9, objectFit: "cover" }} />
        <div style={{ lineHeight: 1.2 }}>
          <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "#0F172A" }}>
            Fire<span style={{ color: "#E8360C" }}>Hub</span>
          </span>
          <p style={{ margin: 0, fontSize: "0.68rem", color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Integração iFood — Homologação
          </p>
        </div>
        <a
          href="https://portal.ifood.com.br/apps/code"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#E8360C", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: "0.8rem" }}
        >
          <ExternalLink size={14} /> Portal do Parceiro
        </a>
      </div>

      {/* ── CARD: Status da Integração iFood ── */}
      <div style={{ background: connStatus === "ok" ? "#F0FDF4" : "#fff", border: `1.5px solid ${connStatus === "ok" ? "#BBF7D0" : "#E2E8F0"}`, borderRadius: 16, marginBottom: "1.25rem", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        {/* Card header */}
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "1.2rem" }}>
            {connStatus === "loading" ? "⏳" : connStatus === "ok" ? "✅" : "🔗"}
          </span>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", color: connStatus === "ok" ? "#16A34A" : "#0F172A" }}>
              {connStatus === "loading" ? "Verificando integração..." :
               connStatus === "ok" ? `${connData?.storeName || "Loja iFood"}` :
               "Nenhuma loja conectada"}
            </p>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748B" }}>
              {connStatus === "ok"
                ? `iFood Merchant · UUID: ${connData?.merchantId}`
                : connStatus === "loading" ? "Aguarde..."
                : "Clique em \"Integrar loja\" para conectar sua conta iFood"}
            </p>
          </div>
          {/* Só mostra botão de reconectar se já conectado (discreto) ou botão integrar se não */}
          {connStatus === "ok" ? (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => testConnection(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "transparent", border: "1px solid #BBF7D0", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.72rem", color: "#16A34A", fontFamily: "inherit" }}>
                <RefreshCw size={11} /> Reconectar
              </button>
              <button onClick={disconnectStore} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "transparent", border: "1px solid #FECACA", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.72rem", color: "#DC2626", fontFamily: "inherit" }}>
                <Trash2 size={11} /> Desconectar
              </button>
            </div>
          ) : connStatus !== "loading" ? (
            <button onClick={() => testConnection(true)} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "linear-gradient(135deg,#E8360C,#C62828)", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: "0.8rem", fontFamily: "inherit" }}>
              <ExternalLink size={14} /> Conectar conta iFood
            </button>
          ) : null}
        </div>

        {/* Card body — só aparece quando não conectado */}
        {(connStatus === "idle" || connStatus === "error") && (
          <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* Banner: app centralizado — aguardando homologação completa */}
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: "1.2rem", flexShrink: 0, marginTop: 1 }}>⚠️</span>
              <div>
                <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: "0.85rem", color: "#92400E" }}>App iFood aguardando homologação completa</p>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#78350F", lineHeight: 1.6 }}>
                  O FireHub usa um app do tipo <strong>Centralizado</strong> no iFood — atualmente com status <strong>"Parcialmente homologado"</strong>. 
                  Para conectar lojas, você solicita o acesso pelo <strong>Portal do Desenvolvedor</strong> e o lojista aprova no Portal do Parceiro.
                </p>
              </div>
            </div>

            {/* Passo 1 */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#E8360C,#C62828)", color: "#fff", fontWeight: 900, fontSize: "0.88rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 3px 10px rgba(232,54,12,0.3)" }}>1</div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: "0.9rem", color: "#0F172A" }}>Solicite o acesso à loja no Portal do Desenvolvedor</p>
                <p style={{ margin: "0 0 10px", fontSize: "0.79rem", color: "#64748B", lineHeight: 1.6 }}>
                  Acesse o Portal do Desenvolvedor → app <strong>FireHub</strong> → aba <strong>Permissões</strong> → solicite acesso pelo <strong>CNPJ ou Merchant UUID</strong> da loja. O iFood notificará o lojista para aprovar.
                </p>
                <a
                  href="https://developer.ifood.com.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 20px", background: "linear-gradient(135deg,#E8360C,#C62828)", color: "#fff", borderRadius: 12, textDecoration: "none", fontWeight: 800, fontSize: "0.88rem", boxShadow: "0 4px 14px rgba(232,54,12,0.28)" }}
                >
                  <ExternalLink size={16} /> Abrir Portal do Desenvolvedor
                </a>
              </div>
            </div>

            {/* Divisor */}
            <div style={{ borderTop: "1px dashed #E2E8F0" }} />

            {/* Passo 2 */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#16A34A,#15803D)", color: "#fff", fontWeight: 900, fontSize: "0.88rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 3px 10px rgba(22,163,74,0.3)" }}>2</div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: "0.9rem", color: "#0F172A" }}>Após aprovação, cole o ID da loja e conecte</p>
                <p style={{ margin: "0 0 10px", fontSize: "0.79rem", color: "#64748B" }}>
                  Quando o lojista aprovar, cole o <strong>Merchant UUID</strong> da loja abaixo.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="Cole o Merchant UUID (ex: f2170891-3073-47ea-...)"
                    value={directId}
                    onChange={(e) => setDirectId(e.target.value)}
                    disabled={directLoading}
                    style={{ flex: 1, minWidth: 200, padding: "11px 14px", border: "1.5px solid #E2E8F0", borderRadius: 12, fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    onFocus={(e) => (e.target.style.borderColor = "#16A34A")}
                    onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                  />
                  <button
                    onClick={linkDirectMerchantId}
                    disabled={directLoading || !directId.trim()}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", background: directLoading || !directId.trim() ? "#E2E8F0" : "linear-gradient(135deg,#16A34A,#15803D)", color: directLoading || !directId.trim() ? "#94A3B8" : "#fff", border: "none", borderRadius: 12, fontWeight: 800, fontSize: "0.88rem", cursor: directLoading || !directId.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: directLoading || !directId.trim() ? "none" : "0 4px 14px rgba(22,163,74,0.28)", transition: "all 0.2s" }}
                  >
                    {directLoading ? <><Loader size={14} /> Conectando...</> : <><CheckCircle size={14} /> Conectar loja</>}
                  </button>
                </div>
                {directError && (
                  <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, fontSize: "0.78rem", color: "#DC2626", fontWeight: 600, lineHeight: 1.5 }}>
                    ⚠️ {directError}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>



      {/* Integrar nova loja — botão no topo + modal com o wizard */}
      {connStatus === "ok" && (
        <>
          <div style={{ marginBottom: "1.25rem", border: "1.5px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "0.75rem 1.25rem", background: "linear-gradient(135deg, #FFF7ED, #FEF3C7)", borderBottom: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>💡</span>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.82rem", color: "#92400E" }}>
                  A partir da 2ª loja integrada ao iFood, é cobrado <strong>R$ 50,00/mês por loja adicional.</strong>
                </p>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#78350F", lineHeight: 1.5 }}>
                  Fique tranquilo — esse valor será descontado automaticamente dos seus pagamentos online ou lançado em boleto no fechamento mensal, junto com a mensalidade do FireHub.
                </p>
              </div>
            </div>
            <div style={{ padding: "1rem 1.25rem", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>Integrar nova loja ao iFood</p>
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748B" }}>Conecte outra conta iFood ao FireHub</p>
              </div>
              <button onClick={() => { setShowModal(true); setGenCode(null); setGenError(""); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "linear-gradient(135deg,#E8360C,#C62828)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                + Integrar nova loja
              </button>
            </div>
          </div>

          {/* Modal do wizard */}
          {showModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowModal(false)}>
              <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 500, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>🔗 Integrar nova loja ao iFood</p>
                  <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "#94A3B8", lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* Passo 1 */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E8360C", color: "#fff", fontWeight: 900, fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>Gere o código de ativação</p>
                      <p style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "#64748B" }}>Clique abaixo para gerar o código de 8 dígitos e insira no Portal do Parceiro iFood.</p>
                      <button onClick={() => generateActivationCode("producao")} disabled={genLoading} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "linear-gradient(135deg,#E8360C,#C62828)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit", opacity: genLoading ? 0.7 : 1 }}>
                        {genLoading ? <><Loader size={15} /> Gerando...</> : "🔑 Gerar Código de Ativação"}
                      </button>
                      {/* A homologação tem que ser gravada com o APLICATIVO DE TESTE.
                          O código de ativação de um aplicativo não serve para outro, então
                          conectar a loja de teste exige gerar o código por aqui. */}
                      <button
                        onClick={() => generateActivationCode("homologacao")}
                        disabled={genLoading}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 7, marginLeft: 10,
                          padding: "10px 18px", background: "#fff", color: "#0F5257",
                          border: "1.5px solid #0F5257", borderRadius: 10, fontWeight: 800,
                          fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit",
                          opacity: genLoading ? 0.7 : 1,
                        }}
                      >
                        🧪 Código para a loja de teste
                      </button>
                      {genError && <p style={{ margin: "0.5rem 0 0", fontSize: "0.78rem", color: "#DC2626", fontWeight: 700 }}>⚠️ {genError}</p>}
                      {genCode && (
                        <div style={{ marginTop: "0.75rem", background: "#FFF5F3", border: "2px solid #E8360C", borderRadius: 12, padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <div>
                            <p style={{ margin: "0 0 4px", fontSize: "0.72rem", fontWeight: 700, color: "#E8360C", textTransform: "uppercase", letterSpacing: "0.5px" }}>Seu código de ativação</p>
                            <span style={{ fontFamily: "monospace", fontSize: "2rem", fontWeight: 900, color: "#0F172A", letterSpacing: "4px" }}>{genCode}</span>
                          </div>
                          <button onClick={() => navigator.clipboard.writeText(genCode)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", border: "1.5px solid #E8360C", color: "#E8360C", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
                            <Copy size={13} /> Copiar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Passo 2 */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, opacity: genCode ? 1 : 0.4 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: genCode ? "#E8360C" : "#CBD5E1", color: "#fff", fontWeight: 900, fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>Insira no Portal do Parceiro iFood</p>
                      <p style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "#64748B" }}>Portal iFood → <strong>"Ativar por código"</strong> → insira o código acima.</p>
                      <a href="https://portal.ifood.com.br/apps/code" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: genCode ? "#E8360C" : "#94A3B8", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 800, fontSize: "0.88rem", pointerEvents: genCode ? "auto" : "none" }}>
                        <ExternalLink size={15} /> Abrir Portal do Parceiro
                      </a>
                    </div>
                  </div>
                  {/* Passo 3 */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, opacity: genCode ? 1 : 0.4 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: genCode ? "#16A34A" : "#CBD5E1", color: "#fff", fontWeight: 900, fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>3</div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>Confirme a conexão</p>
                      <button onClick={() => { testConnection(true); setShowModal(false); }} disabled={!genCode} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: genCode ? "#16A34A" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.88rem", cursor: genCode ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                        <CheckCircle size={15} /> Já conectei — Verificar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Aviso de módulo não liberado — a diferença entre "reconectar a loja" e
          "pedir acesso no Portal do Desenvolvedor" muda o que se deve fazer. */}
      {connStatus === "ok" && connData?.moduloMerchant?.aviso && (
        <div style={{
          background: "#FFFBEB", border: "1.5px solid #FDE68A", color: "#92400E",
          borderRadius: 12, padding: "12px 15px", marginBottom: "1rem", fontSize: "0.86rem", lineHeight: 1.5,
        }}>
          <strong style={{ display: "block", marginBottom: 3 }}>
            Módulo Merchant sem liberação neste aplicativo
          </strong>
          {connData.moduloMerchant.aviso}
          {connData.credenciais?.length > 0 && (
            <span style={{ display: "block", marginTop: 6, fontSize: "0.78rem", opacity: 0.85 }}>
              Token em uso: {connData.origem ?? "—"} · disponíveis: {connData.credenciais.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Abas de Navegação */}
      {connStatus === "ok" && (
        <div style={{
          display: "flex",
          border: "1.5px solid #E2E8F0",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: "1.25rem",
          background: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)"
        }}>
          {tabBtn("loja", "Loja", "🏪")}
          {tabBtn("pausas", "Pausas", "⏸️")}
          {tabBtn("horarios", "Horários", "🕐")}
          {tabBtn("cardapio", "Cardápio", "📖")}
          {tabBtn("entrega", "Entrega", "🛵")}
          {tabBtn("eventos", "Eventos", "📡")}
          {tabBtn("widget", "Widget Chat", "💬")}
        </div>
      )}

      {/* Conteúdo das Abas */}
      {connStatus === "ok" && tab === "loja" && <TabLoja />}
      {connStatus === "ok" && tab === "pausas" && <TabPausas />}
      {connStatus === "ok" && tab === "horarios" && <TabHorarios />}
      {connStatus === "ok" && tab === "cardapio" && <TabCardapio />}
      {connStatus === "ok" && tab === "entrega" && <TabEntrega />}
      {connStatus === "ok" && tab === "eventos" && <TabEventos />}
      {connStatus === "ok" && tab === "widget" && <TabWidget currentWidgetId={ifoodWidgetId} />}
    </div>
  );
}


// ── CENÁRIO 1: Informações da Loja ────────────────────────
function TabLoja() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/ifood/merchant?distribuido=1");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro");
      setData(d);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionCard title="Lojas Vinculadas ao Integrador" emoji="🏪">
        <RefreshBtn onClick={load} loading={loading} />
        {error && <ErrorBox msg={error} />}
        {!loading && !error && data && (
          <>
            <InfoRow label="Merchant ID (UUID)" value={data.merchantId} mono />
            <div style={{ marginTop: "0.75rem" }}>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", fontWeight: 700, color: "#64748B" }}>LOJAS ({(data.list ?? []).length})</p>
              {(data.list ?? []).length === 0 && (
                <div style={{ textAlign: "center", color: "#94A3B8", padding: "1rem", fontSize: "0.85rem" }}>
                  Nenhuma loja listada — a API pode retornar apenas o merchant principal.
                </div>
              )}
              {(data.list ?? []).map((m: any, i: number) => (
                <div key={i} style={{ padding: "10px 14px", background: "#F8FAFC", borderRadius: 10, marginBottom: 6, fontSize: "0.85rem" }}>
                  <strong>{m.name || m.id}</strong>
                  {m.id && <span style={{ marginLeft: 8, color: "#94A3B8", fontFamily: "monospace", fontSize: "0.75rem" }}>{m.id}</span>}
                </div>
              ))}
            </div>
          </>
        )}
        {loading && <LoadingBox />}
      </SectionCard>

      <SectionCard title="Detalhes Completos da Loja" emoji="📋">
        {data?.detail ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <InfoRow label="Nome" value={data.detail.name} />
            <InfoRow label="Razão Social" value={data.detail.corporateName || data.detail.name} />
            <InfoRow label="Tipo" value={data.detail.type || "STORE"} />
            <InfoRow label="Status" value={data.detail.status || "—"} />
            <InfoRow label="Ticket Médio" value={data.detail.averageTicket ? `R$ ${data.detail.averageTicket}` : "—"} />
            <InfoRow label="Categoria" value={data.detail.test === "TEST" ? "Loja de Teste" : "Produção"} />
            {data.detail.address && (
              <>
                <InfoRow label="Cidade" value={`${data.detail.address.city} — ${data.detail.address.state}`} />
                <InfoRow label="Endereço" value={`${data.detail.address.street}, ${data.detail.address.number}`} />
                <InfoRow label="CEP" value={data.detail.address.postalCode || "—"} />
                <InfoRow label="País" value={data.detail.address.country || "BR"} />
              </>
            )}
            {(data.detail.operations ?? []).map((op: any, i: number) => (
              <InfoRow key={i} label={`Canal — ${op.name}`} value={(op.salesChannels ?? []).map((c: any) => c.name + (c.enabled ? " ✅" : " ❌")).join(", ") || "—"} />
            ))}
          </div>
        ) : <LoadingBox />}
      </SectionCard>

      <SectionCard title="Disponibilidade da Loja" emoji="🟢">
        {data?.status ? (() => {
          const entries = Array.isArray(data.status) ? data.status : [data.status];
          const isAvailable = entries.some((s: any) => s.available === true);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 20, background: isAvailable ? "#DCFCE7" : "#FEE2E2", color: isAvailable ? "#16A34A" : "#DC2626", fontWeight: 800, fontSize: "0.95rem", alignSelf: "flex-start" }}>
                {isAvailable ? "✅ LOJA DISPONÍVEL" : "🔴 LOJA INDISPONÍVEL"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {entries.map((s: any, i: number) => (
                  <React.Fragment key={i}>
                    {s.salesChannel && <InfoRow label="Canal" value={s.salesChannel} />}
                    {s.operation    && <InfoRow label="Operação" value={s.operation} />}
                    {s.state        && <InfoRow label="Estado" value={s.state} />}
                    {s.available !== undefined && <InfoRow label="Disponível" value={s.available ? "Sim ✅" : "Não ❌"} />}
                    {s.message?.title && <InfoRow label="Motivo" value={s.message.title} />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })() : <LoadingBox />}
      </SectionCard>
    </div>
  );
}

// ── CENÁRIO 2: Pausas / Interrupções ──────────────────────
function TabPausas() {
  const [pausas, setPausas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Formulário
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const localISO = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const defaultStart = localISO(now);
  const defaultEnd   = localISO(new Date(now.getTime() + 60 * 60 * 1000));

  const [desc,  setDesc]  = useState("Pausa para manutenção");
  const [start, setStart] = useState(defaultStart);
  const [end,   setEnd]   = useState(defaultEnd);

  const loadPausas = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/ifood/interruptions?distribuido=1");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao listar pausas");
      setPausas(Array.isArray(d) ? d : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadPausas(); }, []);

  const createPausa = async () => {
    setCreating(true); setError(""); setSuccess("");
    try {
      const r = await fetch("/api/ifood/interruptions?distribuido=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, start, end }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || JSON.stringify(d.details || "Erro"));
      setSuccess("✅ Pausa criada com sucesso! Verifique no Portal do Parceiro.");
      setShowForm(false);
      await loadPausas();
    } catch (e: any) { setError(e.message); }
    finally { setCreating(false); }
  };

  const removePausa = async (id: string) => {
    setRemoving(id); setError(""); setSuccess("");
    try {
      const r = await fetch(`/api/ifood/interruptions/${id}?distribuido=1`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao remover pausa");
      setSuccess("✅ Pausa removida! Verifique no Portal do Parceiro.");
      await loadPausas();
    } catch (e: any) { setError(e.message); }
    finally { setRemoving(null); }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error   && <ErrorBox msg={error} />}
      {success && <SuccessBox msg={success} />}

      {/* Criar pausa */}
      <SectionCard title="Cadastrar Pausa" emoji="➕">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#E8360C", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" }}
          >
            <Plus size={16} /> Criar Nova Pausa
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Descrição</label>
              <input style={inp} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ex: Pausa para manutenção" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Início</label>
                <input type="datetime-local" style={inp} value={start} onChange={e => setStart(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Fim</label>
                <input type="datetime-local" style={inp} value={end} onChange={e => setEnd(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: "10px", background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#475569" }}>Cancelar</button>
              <button onClick={createPausa} disabled={creating} style={{ flex: 2, padding: "10px", background: "#E8360C", color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: creating ? 0.7 : 1 }}>
                {creating ? <><Loader size={15} className="spin" /> Criando...</> : <><CheckCircle size={15} /> Confirmar Pausa no iFood</>}
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Lista de pausas ativas */}
      <SectionCard title="Pausas Ativas" emoji="⏸️">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.8rem", color: "#64748B" }}>{pausas.length} pausa(s) ativa(s)</span>
          <RefreshBtn onClick={loadPausas} loading={loading} />
        </div>
        {loading && <LoadingBox />}
        {!loading && pausas.length === 0 && (
          <div style={{ textAlign: "center", color: "#94A3B8", padding: "1.5rem", fontSize: "0.85rem" }}>
            Nenhuma pausa ativa no momento.
          </div>
        )}
        {pausas.map((p: any) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#FFF5F3", border: "1px solid #FFCDC4", borderRadius: 12, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "0.9rem", color: "#0F172A" }}>{p.description || "Pausa"}</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748B" }}>
                {p.start ? fmt(p.start) : "—"} → {p.end ? fmt(p.end) : "—"}
              </p>
              <p style={{ margin: "2px 0 0", fontFamily: "monospace", fontSize: "0.68rem", color: "#94A3B8" }}>ID: {p.id}</p>
            </div>
            <button
              onClick={() => removePausa(p.id)}
              disabled={removing === p.id}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", opacity: removing === p.id ? 0.6 : 1 }}
            >
              {removing === p.id ? <Loader size={13} /> : <Trash2 size={13} />}
              {removing === p.id ? "Removendo..." : "Remover"}
            </button>
          </div>
        ))}
      </SectionCard>

      {/* Verificação ao vivo */}
      <IfoodLiveCheck type="pausas" triggerAfterAction={success} />
    </div>
  );
}

// ── CENÁRIO 3: Horário de Funcionamento ───────────────────
const HOMOLOG_HOURS = {
  openingHours: [
    { dayOfWeek: "SATURDAY",  shifts: [{ start: "10:00", duration: 540 }] },
    { dayOfWeek: "SUNDAY",    shifts: [{ start: "09:00", duration: 180 }, { start: "13:00", duration: 180 }, { start: "17:00", duration: 360 }] },
  ],
};

function TabHorarios() {
  const [current, setCurrent] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  const loadHours = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/ifood/opening-hours?distribuido=1");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro");
      setCurrent(d.openingHours);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadHours(); }, []);

  const saveHomologHours = async () => {
    setSaving(true); setError(""); setSuccess("");
    try {
      const r = await fetch("/api/ifood/opening-hours?distribuido=1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(HOMOLOG_HOURS),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || JSON.stringify(d.details || "Erro"));
      setSuccess("✅ Horários enviados ao iFood! Verifique no Portal do Parceiro.");
      await loadHours();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const durationToEnd = (start: string, min: number) => {
    const [h, m] = start.split(":").map(Number);
    const end = new Date(0, 0, 0, h, m + min);
    return `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
  };
  const pad2 = (n: number) => String(n).padStart(2, "0");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error   && <ErrorBox msg={error} />}
      {success && <SuccessBox msg={success} />}

      {/* Horários a serem enviados (homologação) */}
      <SectionCard title="Horários para Homologação" emoji="📋">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#64748B" }}>
          Esses são os horários exigidos pelo iFood para o Cenário 3. Clique em "Enviar" para cadastrá-los via API.
        </p>
        {HOMOLOG_HOURS.openingHours.map(d => (
          <div key={d.dayOfWeek} style={{ padding: "10px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, marginBottom: 6 }}>
            <strong style={{ fontSize: "0.88rem", color: "#0F172A" }}>{DAYS_PT[d.dayOfWeek]}</strong>
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {d.shifts.map((s, i) => (
                <span key={i} style={{ padding: "3px 10px", background: "#E1F5FE", color: "#0277BD", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700 }}>
                  {s.start} → {durationToEnd(s.start, s.duration)}
                </span>
              ))}
            </div>
          </div>
        ))}
        <button
          onClick={saveHomologHours}
          disabled={saving}
          style={{ width: "100%", marginTop: "0.75rem", padding: "11px", background: "#E8360C", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <><Loader size={15} /> Enviando...</> : <><CheckCircle size={15} /> Enviar Horários ao iFood</>}
        </button>
      </SectionCard>

      {/* Horários atuais no iFood */}
      <SectionCard title="Horários Atuais no iFood" emoji="🕐">
        <RefreshBtn onClick={loadHours} loading={loading} />
        {loading && <LoadingBox />}
        {!loading && current && (
          <div style={{ marginTop: "0.75rem" }}>
            {(Array.isArray(current) ? current : current?.openingHours ?? []).map((d: any, i: number) => (
              <div key={i} style={{ padding: "10px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, marginBottom: 6 }}>
                <strong style={{ fontSize: "0.88rem", color: "#0F172A" }}>{DAYS_PT[d.dayOfWeek] || d.dayOfWeek}</strong>
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(d.shifts ?? []).map((s: any, j: number) => (
                    <span key={j} style={{ padding: "3px 10px", background: "#DCFCE7", color: "#16A34A", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700 }}>
                      {s.start} → {durationToEnd(s.start, s.duration)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {(Array.isArray(current) ? current : current?.openingHours ?? []).length === 0 && (
              <div style={{ textAlign: "center", color: "#94A3B8", padding: "1rem", fontSize: "0.85rem" }}>Nenhum horário cadastrado.</div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Verificação ao vivo */}
      <IfoodLiveCheck type="horarios" triggerAfterAction={success} />
    </div>
  );
}

// ── Verificação ao vivo — prova para homologação ──────────
function IfoodLiveCheck({ type, triggerAfterAction }: { type: "pausas" | "horarios"; triggerAfterAction: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const check = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ifood/status?distribuido=1");
      const json = await res.json();
      setData(json);
      setCheckedAt(new Date());
    } catch {}
    setLoading(false);
  };

  // Auto-check when an action succeeds
  useEffect(() => { if (triggerAfterAction) { setTimeout(check, 1500); } }, [triggerAfterAction]);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const durationToEnd = (start: string, min: number) => {
    const [h, m] = start.split(":").map(Number);
    const end = new Date(0, 0, 0, h, m + min);
    return `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
  };

  return (
    <div style={{ background: "#0F172A", borderRadius: 16, padding: "1.25rem", border: "2px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", color: "#F1F5F9" }}>📡 Verificação ao Vivo — API iFood</p>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748B" }}>Consulta direta à API oficial do iFood · mesmo dado do Portal do Parceiro</p>
        </div>
        <button
          onClick={check}
          disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: loading ? "#1E293B" : "#EA1D2C", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}
        >
          {loading ? "⏳ Consultando..." : "🔍 Verificar Reflexo no iFood"}
        </button>
      </div>

      {checkedAt && (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.72rem", color: "#94A3B8" }}>⏱ Consultado em: {checkedAt.toLocaleTimeString("pt-BR")} · {checkedAt.toLocaleDateString("pt-BR")}</p>
      )}

      {!data && !loading && (
        <div style={{ textAlign: "center", padding: "1.5rem", color: "#475569", fontSize: "0.85rem" }}>Clique no botão para consultar o iFood em tempo real</div>
      )}

      {data && type === "pausas" && (
        <div>
          {/* Status da loja */}
          <div style={{ display: "flex", gap: 10, marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {(() => {
              // O status vem como array na API de disponibilidade. Lendo
              // `data.status?.available` direto, um array (que nunca tem essa
              // propriedade) dava sempre undefined — e a loja aparecia como
              // FECHADA mesmo aberta, bem no vídeo do cenário 2.
              const itens = Array.isArray(data.status) ? data.status : data.status ? [data.status] : [];
              const semDado = itens.length === 0;
              const aberta = itens.some((s: any) => s.available === true);
              const cor = semDado
                ? { bg: "#F1F5F9", fg: "#475569", txt: "⚪ DISPONIBILIDADE NÃO INFORMADA" }
                : aberta
                  ? { bg: "#DCFCE7", fg: "#16A34A", txt: "🟢 LOJA ABERTA" }
                  : { bg: "#FEE2E2", fg: "#DC2626", txt: "🔴 LOJA FECHADA/PAUSADA" };
              return (
                <span style={{ padding: "5px 14px", borderRadius: 20, fontWeight: 800, fontSize: "0.85rem", background: cor.bg, color: cor.fg }}>
                  {cor.txt}
                </span>
              );
            })()}
          </div>
          {/* Pausas */}
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Pausas ativas no iFood</p>
          {Array.isArray(data.interruptions) && data.interruptions.length > 0 ? (
            data.interruptions.map((i: any, idx: number) => (
              <div key={idx} style={{ padding: "10px 14px", background: "#1E293B", borderRadius: 10, marginBottom: 6, border: "1px solid #F59E0B" }}>
                <p style={{ margin: 0, fontWeight: 700, color: "#FCD34D", fontSize: "0.88rem" }}>⏸ {i.description ?? "Pausa"}</p>
                {(i.start || i.startTime) && <p style={{ margin: "3px 0 0", fontSize: "0.75rem", color: "#94A3B8" }}>{i.start ?? i.startTime} → {i.end ?? i.endTime}</p>}
                <p style={{ margin: "3px 0 0", fontSize: "0.68rem", color: "#475569", fontFamily: "monospace" }}>ID: {i.id}</p>
              </div>
            ))
          ) : (
            <div style={{ padding: "10px 14px", background: "#1E293B", borderRadius: 10, color: "#22C55E", fontWeight: 700, fontSize: "0.85rem" }}>✅ Nenhuma pausa ativa — loja disponível</div>
          )}
        </div>
      )}

      {data && type === "horarios" && (() => {
        const hours = Array.isArray(data.openingHours) ? data.openingHours
          : data.openingHours?.openingHours ?? [];
        return (
          <div>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Horários de funcionamento no iFood</p>
            {hours.length === 0 && <div style={{ padding: "10px 14px", background: "#1E293B", borderRadius: 10, color: "#94A3B8", fontSize: "0.85rem" }}>Nenhum horário cadastrado</div>}
            {hours.map((h: any, i: number) => (
              <div key={i} style={{ padding: "10px 14px", background: "#1E293B", borderRadius: 10, marginBottom: 6, border: "1px solid #3B82F6" }}>
                <p style={{ margin: 0, fontWeight: 800, color: "#93C5FD", fontSize: "0.88rem" }}>{DAYS_PT[h.dayOfWeek] || h.dayOfWeek}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                  {(h.shifts ?? []).map((s: any, j: number) => (
                    <span key={j} style={{ padding: "3px 10px", background: "#1D4ED8", color: "#BFDBFE", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700 }}>
                      🕐 {s.start} → {durationToEnd(s.start, s.duration)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {checkedAt && (
        <div style={{ marginTop: "0.75rem", padding: "8px 12px", background: "#1E293B", borderRadius: 8, fontSize: "0.72rem", color: "#475569", display: "flex", justifyContent: "space-between" }}>
          <span>🔗 Endpoint: <code style={{ color: "#94A3B8" }}>/api/ifood/status</code></span>
          <span>📡 iFood Merchant API v1.0</span>
        </div>
      )}
    </div>
  );
}

// ── CENÁRIO 4: Widget Chat iFood ──────────────────────────
function TabWidget({ currentWidgetId }: { currentWidgetId?: string }) {
  const [widgetId, setWidgetId] = useState(currentWidgetId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const save = async () => {
    setSaving(true); setError(""); setSuccess("");
    try {
      const r = await fetch("/api/ifood/widget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ifoodWidgetId: widgetId || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao salvar");
      setSuccess("✅ Widget ID salvo com sucesso!");
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "monospace", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error   && <ErrorBox msg={error} />}
      {success && <SuccessBox msg={success} />}

      <SectionCard title="Widget ID do iFood" emoji="💬">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#64748B", lineHeight: 1.6 }}>
          Cole aqui o <strong>widgetId</strong> do chat integrado do iFood. Ele aparecerá como opção de contato no cardápio online da sua loja.
        </p>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Widget ID</label>
          <input
            style={inp}
            value={widgetId}
            onChange={e => setWidgetId(e.target.value)}
            placeholder="Ex: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          style={{
            width: "100%", padding: "11px", background: "#E8360C", color: "#fff",
            border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem",
            cursor: "pointer", fontFamily: "inherit", display: "flex",
            alignItems: "center", justifyContent: "center", gap: 7,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Salvando..." : "💾 Salvar Widget ID"}
        </button>
      </SectionCard>

      <SectionCard title="Como obter o Widget ID" emoji="📖">
        <div style={{ fontSize: "0.82rem", color: "#374151", lineHeight: 1.7 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "0.75rem" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E8360C", color: "#fff", fontWeight: 900, fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</div>
            <span>Acesse o <a href="https://portal.ifood.com.br" target="_blank" rel="noopener noreferrer" style={{ color: "#E8360C", fontWeight: 700 }}>Portal do Parceiro iFood</a> → <strong>Developer Portal</strong> → <strong>Widgets</strong></span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "0.75rem" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E8360C", color: "#fff", fontWeight: 900, fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</div>
            <span>Clique em <strong>"Registrar Widget"</strong> → personalize a aparência → <strong>Salve</strong></span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "0.75rem" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E8360C", color: "#fff", fontWeight: 900, fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>3</div>
            <span>Clique em <strong>"Embedding Code"</strong> (Código de Incorporação)</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "0.75rem" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#16A34A", color: "#fff", fontWeight: 900, fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>4</div>
            <span>Copie o <strong>widgetId</strong> do código gerado e cole no campo acima</span>
          </div>
          <div style={{ padding: "10px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, marginTop: "0.5rem" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Exemplo do código</p>
            <code style={{ fontSize: "0.75rem", color: "#0F172A", wordBreak: "break-all" }}>
              {`iFoodWidget.init({ widgetId: "`}<span style={{ color: "#E8360C", fontWeight: 700 }}>SEU_WIDGET_ID</span>{`", merchantIds: ["..."] })`}
            </code>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ── UI Helpers ─────────────────────────────────────────────
function SectionCard({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden" }}>
      <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{emoji}</span>
        <span style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>{title}</span>
      </div>
      <div style={{ padding: "1.25rem" }}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F1F5F9", fontSize: "0.85rem" }}>
      <span style={{ color: "#64748B", fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: mono ? "monospace" : "inherit", color: "#0F172A", fontWeight: 700, fontSize: mono ? "0.78rem" : "inherit" }}>{value}</span>
    </div>
  );
}

function RefreshBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#F1F5F9", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", color: "#475569", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
      <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} /> Atualizar
    </button>
  );
}
function LoadingBox() {
  return <div style={{ textAlign: "center", color: "#94A3B8", padding: "1.5rem", fontSize: "0.85rem" }}>⏳ Carregando...</div>;
}
function ErrorBox({ msg }: { msg: string }) {
  return <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.75rem" }}>⚠️ {msg}</div>;
}
function SuccessBox({ msg }: { msg: string }) {
  return <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#16A34A", padding: "10px 14px", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.75rem" }}>{msg}</div>;
}
