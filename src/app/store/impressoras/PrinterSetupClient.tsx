"use client";
import { useState, useEffect, useCallback } from "react";
import { Printer, CheckCircle, Download, AlertCircle, Plus, Trash2, RefreshCw } from "lucide-react";

/* ─── Tipos ─────────────────────────────────────────────────── */
type PrinterConfig = {
  autoprint: boolean;
  printers: PrinterEntry[];
};

type PrinterEntry = {
  id: string;
  name: string;       // nome da impressora no Windows
  label: string;      // apelido (ex: "Cozinha", "Bar")
  categories: string[]; // categorias que imprime
  copies: number;
  paperWidth?: "58mm" | "80mm"; // 58mm (32 colunas) ou 80mm (48 colunas)
};

type AssistantStatus = "checking" | "disconnected" | "connected";
type DetectedPrinter = { name: string; driver: string; port: string; status: string };

const ASSISTANT_URL = "http://localhost:7891";

/* ─── Componente principal ───────────────────────────────────── */
export default function PrinterSetupClient({
  storeName, initialConfig, categories,
}: {
  storeName: string;
  initialConfig: PrinterConfig | null;
  categories: string[];
}) {
  const [status, setStatus] = useState<AssistantStatus>("checking");
  const [availablePrinters, setAvailablePrinters] = useState<DetectedPrinter[]>([]);
  const [config, setConfig] = useState<PrinterConfig>(
    initialConfig || { autoprint: false, printers: [] }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const tryConnect = useCallback(async () => {
    setStatus("checking");
    try {
      const res = await fetch(`${ASSISTANT_URL}/status`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      if (data.ok) {
        setStatus("connected");
        setAvailablePrinters(data.printers || []);
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => { tryConnect(); }, [tryConnect]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await fetch("/api/store/printer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const addPrinter = () => {
    // Filtra só impressoras reais (porta USB, LPT, COM — ignora virtuais)
    const realPrinters = availablePrinters.filter(p =>
      /^(USB|LPT|COM)/i.test(p.port) || p.driver.toLowerCase().includes("elgin") || p.driver.toLowerCase().includes("bematech") || p.driver.toLowerCase().includes("epson")
    );
    const defaultName = realPrinters[0]?.name || availablePrinters[0]?.name || "";
    const p: PrinterEntry = {
      id: Date.now().toString(),
      name: defaultName,
      label: `Impressora ${config.printers.length + 1}`,
      categories: [],
      copies: 1,
      paperWidth: "80mm",
    };
    setConfig(c => ({ ...c, printers: [...c.printers, p] }));
  };

  const removePrinter = (id: string) => {
    setConfig(c => ({ ...c, printers: c.printers.filter(p => p.id !== id) }));
  };

  const updatePrinter = (id: string, patch: Partial<PrinterEntry>) => {
    setConfig(c => ({
      ...c,
      printers: c.printers.map(p => p.id === id ? { ...p, ...patch } : p),
    }));
  };

  const toggleCategory = (printerId: string, cat: string) => {
    const printer = config.printers.find(p => p.id === printerId);
    if (!printer) return;
    const has = printer.categories.includes(cat);
    updatePrinter(printerId, {
      categories: has ? printer.categories.filter(c => c !== cat) : [...printer.categories, cat],
    });
  };

  const testPrint = async (printerName: string, label: string) => {
    setTestingPrinter(printerName);
    try {
      const res = await fetch(`${ASSISTANT_URL}/print-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printer: printerName, storeName }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ Impressão de teste enviada para "${label}"!`);
      } else {
        alert(`❌ Erro: ${data.error}`);
      }
    } catch (e: any) {
      alert(`❌ Assistente não respondeu: ${e.message}`);
    } finally {
      setTestingPrinter(null);
    }
  };

  /* ─── WIZARD DE INSTALAÇÃO ─────────────────────────────────── */
  if (status !== "connected") {
    return (
      <div style={{ fontFamily: "'Inter',sans-serif", minHeight: "100vh", background: "#F8FAFC", padding: "2rem 1rem" }}>
        <div style={{ maxWidth: 580, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#B71C1C,#C62828)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Printer size={24} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontWeight: 900, fontSize: "1.4rem", margin: 0, color: "#0F172A" }}>Configurar Impressora</h1>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B" }}>{storeName}</p>
            </div>
          </div>

          {/* Status banner */}
          <div style={{ background: status === "checking" ? "#EFF6FF" : "#FEF2F2", border: `1.5px solid ${status === "checking" ? "#BFDBFE" : "#FECACA"}`, borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: 10 }}>
            {status === "checking"
              ? <><RefreshCw size={18} color="#3B82F6" style={{ animation: "spin 1s linear infinite" }} /><span style={{ fontSize: "0.88rem", color: "#1E40AF", fontWeight: 600 }}>Procurando Assistente FireHub...</span></>
              : <><AlertCircle size={18} color="#EF4444" /><span style={{ fontSize: "0.88rem", color: "#B91C1C", fontWeight: 600 }}>Assistente FireHub não encontrado. Siga os passos abaixo.</span></>
            }
          </div>

          {status === "disconnected" && (
            <>
              {/* O que é */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", marginBottom: "1rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 8px", color: "#0F172A" }}>❓ O que é o Assistente FireHub?</h2>
                <p style={{ fontSize: "0.85rem", color: "#475569", lineHeight: 1.6, margin: 0 }}>
                  É um pequeno programa que roda em segundo plano no computador da loja. Ele permite que o sistema imprima comandas <strong>automaticamente, sem nenhum clique</strong>, assim que o pedido for aceito.
                </p>
              </div>

              {/* Passo 1 */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>1</div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Baixar e abrir o Assistente</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px", lineHeight: 1.5 }}>
                  Baixe o assistente e execute no computador que está conectado à impressora. <strong>Não feche a janela</strong> enquanto quiser impressão automática.
                </p>
                <a
                  href="/downloads/FireHub-Assistente-Impressao.exe"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", background: "linear-gradient(135deg,#B71C1C,#C62828)", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: "0.88rem" }}
                >
                  <Download size={15} /> Baixar Assistente FireHub
                </a>
              </div>

              {/* Passo 2 — Mockup visual REALISTA do Chrome */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #3B82F6", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>2</div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Permitir acesso à rede local</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 14px", lineHeight: 1.5 }}>
                  Na barra de endereço do navegador, clique no <strong>ícone de cadeado</strong> e ative <strong>"Apps no dispositivo"</strong>:
                </p>

                {/* ── MOCKUP REALISTA DO CHROME ──────────────────── */}
                <div style={{ borderRadius: 12, overflow: "hidden", border: "1.5px solid #DEE1E6" }}>

                  {/* Barra de endereço do Chrome */}
                  <div style={{ background: "#F1F3F4", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, background: "#fff", borderRadius: 20, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #DEE1E6" }}>
                      {/* Cadeado com seta animada */}
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <div className="bounce-arrow" style={{ position: "absolute", top: -30, left: "50%", transform: "translateX(-50%)", fontSize: "1.2rem", zIndex: 10 }}>
                          👆
                        </div>
                        <div className="pulse-ring">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5F6368" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                        </div>
                      </div>
                      <span style={{ fontSize: "0.82rem", color: "#202124" }}>firehubfood.com.br/store/impressoras</span>
                    </div>
                  </div>

                  {/* Popup do Chrome — cópia fiel */}
                  <div style={{ background: "#fff", padding: 0 }}>
                    {/* Header do popup */}
                    <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #E8EAED" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.92rem", color: "#202124" }}>firehubfood.com.br</span>
                      <span style={{ fontSize: "0.82rem", color: "#5F6368", cursor: "pointer", lineHeight: 1 }}>✕</span>
                    </div>

                    {/* Conexão segura */}
                    <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F1F3F4" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5F6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                        <span style={{ fontSize: "0.82rem", color: "#202124" }}>A conexão é segura</span>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#5F6368" }}>›</span>
                    </div>

                    {/* Notificações */}
                    <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F1F3F4" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5F6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                        <span style={{ fontSize: "0.82rem", color: "#202124" }}>Notificações</span>
                      </div>
                      <div style={{ width: 36, height: 18, borderRadius: 9, background: "#1A73E8", position: "relative" }}>
                        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                      </div>
                    </div>

                    {/* ★ Apps no dispositivo — DESTAQUE com seta */}
                    <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F1F3F4", background: "#E8F0FE", position: "relative" }}>
                      {/* Seta animada lateral */}
                      <div className="bounce-right" style={{ position: "absolute", right: 50, top: "50%", transform: "translateY(-50%)", fontSize: "1.1rem" }}>
                        👉
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                        <span style={{ fontSize: "0.82rem", color: "#1A73E8", fontWeight: 600 }}>Apps no dispositivo</span>
                      </div>
                      {/* Toggle animado — liga/desliga */}
                      <div className="toggle-demo" style={{ width: 36, height: 18, borderRadius: 9, position: "relative", flexShrink: 0 }}>
                        <div className="toggle-knob" style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                      </div>
                    </div>

                    {/* Redefinir permissões */}
                    <div style={{ padding: "12px 16px", display: "flex", justifyContent: "center", borderBottom: "1px solid #F1F3F4" }}>
                      <span style={{ fontSize: "0.78rem", color: "#1A73E8", fontWeight: 500, padding: "6px 16px", border: "1px solid #DADCE0", borderRadius: 20 }}>Redefinir permissões</span>
                    </div>

                    {/* Cookies e dados */}
                    <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F1F3F4" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5F6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                        <span style={{ fontSize: "0.82rem", color: "#202124" }}>Cookies e dados de sites</span>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#5F6368" }}>›</span>
                    </div>

                    {/* Configurações */}
                    <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5F6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                        <span style={{ fontSize: "0.82rem", color: "#202124" }}>Configurações de sites</span>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#5F6368" }}>↗</span>
                    </div>
                  </div>
                </div>

                {/* Dica */}
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "10px 14px", marginTop: "0.75rem", display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "#1E40AF" }}>
                  <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>💡</span>
                  <span>Isso autoriza o site a se comunicar com o Assistente no seu computador. É <strong>seguro</strong> e funciona apenas na rede local.</span>
                </div>
              </div>

              {/* Passo 3 */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#64748B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>3</div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Verificar conexão</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px" }}>
                  Após abrir o assistente e permitir o acesso, clique abaixo para verificar.
                </p>
                <button onClick={tryConnect} style={{ padding: "10px 20px", borderRadius: 10, background: "#3B82F6", color: "#fff", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <RefreshCw size={14} /> Verificar conexão
                </button>
              </div>
            </>
          )}
        </div>
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes bounceUp {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
          .bounce-arrow { animation: bounceUp 1.2s ease-in-out infinite; }
          @keyframes bounceRight {
            0%, 100% { transform: translateY(-50%) translateX(0); }
            50% { transform: translateY(-50%) translateX(6px); }
          }
          .bounce-right { animation: bounceRight 1s ease-in-out infinite; }
          @keyframes pulseRing {
            0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); }
            70% { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
            100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
          }
          .pulse-ring { animation: pulseRing 2s ease-in-out infinite; border-radius: 50%; }
          @keyframes toggleSlide {
            0%, 40% { left: 20px; background: #1A73E8; }
            45% { left: 2px; background: #DADCE0; }
            50%, 90% { left: 20px; background: #1A73E8; }
            95% { left: 2px; background: #DADCE0; }
            100% { left: 20px; background: #1A73E8; }
          }
          .toggle-demo { background: #1A73E8; }
          .toggle-knob { animation: toggleSlide 3s ease-in-out infinite; left: 20px; }
        `}</style>
      </div>
    );
  }

  /* ─── CONFIGURAÇÃO (Assistente conectado) ──────────────────── */

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", minHeight: "100vh", background: "#F8FAFC", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#B71C1C,#C62828)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Printer size={24} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontWeight: 900, fontSize: "1.3rem", margin: 0 }}>Impressoras</h1>
              <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#64748B" }}>{storeName}</p>
            </div>
          </div>
          <button
            onClick={saveConfig}
            disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 12, background: saved ? "#16A34A" : "linear-gradient(135deg,#B71C1C,#C62828)", color: "#fff", border: "none", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}
          >
            {saving ? "Salvando..." : saved ? "✅ Salvo!" : "Salvar configurações"}
          </button>
        </div>

        {/* ── CARD: ASSISTENTE + DOWNLOAD ─────────────────────── */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 220 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#F0FDF4", border: "1.5px solid #BBF7D0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CheckCircle size={20} color="#16A34A" />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: "0.95rem" }}>Assistente FireHub</span>
                  <span style={{ padding: "2px 8px", borderRadius: 20, background: "#F0FDF4", color: "#16A34A", fontSize: "0.68rem", fontWeight: 700, border: "1px solid #BBF7D0" }}>Conectado</span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  {availablePrinters.filter(p => /^(USB|LPT|COM)/i.test(p.port)).length || availablePrinters.length} impressora(s) detectada(s) no computador
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <a
                href="/downloads/FireHub-Assistente-Impressao.exe"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "linear-gradient(135deg,#B71C1C,#C62828)", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: "0.78rem", whiteSpace: "nowrap" }}
              >
                <Download size={14} /> Baixar Assistente
              </a>
              <button onClick={() => setShowHelp(v => !v)} style={{ padding: "8px 14px", borderRadius: 10, background: "#F1F5F9", border: "none", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", color: "#64748B", whiteSpace: "nowrap" }}>
                ❓ Ajuda
              </button>
            </div>
          </div>

          {/* Info rápida */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: "#475569", background: "#F8FAFC", padding: "5px 10px", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              🖨️ Permite comunicação com suas impressoras
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: "#475569", background: "#F8FAFC", padding: "5px 10px", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              🔒 Acesso seguro apenas à sua rede local
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: "#475569", background: "#F8FAFC", padding: "5px 10px", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              ✅ Necessário para impressão automática
            </div>
          </div>

          {/* Seção de ajuda expandível */}
          {showHelp && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1.5px solid #F1F5F9" }}>
              <h3 style={{ fontWeight: 800, fontSize: "0.9rem", margin: "0 0 12px", color: "#0F172A" }}>📖 Como configurar sua impressora</h3>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.75rem", flexShrink: 0, marginTop: 1 }}>1</div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>Baixe o Assistente FireHub</p>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>Clique no botão vermelho "Baixar Assistente" acima. Salve o arquivo no computador que está conectado à impressora.</p>
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.75rem", flexShrink: 0, marginTop: 1 }}>2</div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>Execute o programa</p>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>Dê dois cliques no arquivo baixado para abrir. Uma janela preta vai aparecer com a mensagem "FireHub Assistente rodando". <strong>Não feche essa janela!</strong></p>
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.75rem", flexShrink: 0, marginTop: 1 }}>3</div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>Permita acesso à rede local</p>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>O navegador pode pedir permissão para acessar a rede local. Clique em <strong>"Permitir"</strong>. Isso é necessário apenas na primeira vez.</p>
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.75rem", flexShrink: 0, marginTop: 1 }}>4</div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>Configure sua impressora</p>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>Clique em "Adicionar impressora", selecione a impressora na lista, dê um apelido (ex: "Cozinha") e faça um teste de impressão.</p>
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.75rem", flexShrink: 0, marginTop: 1 }}>5</div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>Ative a impressão automática</p>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>Ligue o botão "Impressão automática" e salve. Pronto! Cada pedido aceito vai imprimir a comanda sozinho.</p>
                  </div>
                </div>
              </div>

              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 14px", marginTop: "1rem", fontSize: "0.78rem", color: "#92400E", lineHeight: 1.5 }}>
                <strong>⚠️ Importante:</strong> O Assistente precisa estar aberto no computador para funcionar. Se fechar o programa, a impressão automática para até abrir novamente.
              </div>
            </div>
          )}
        </div>

        {/* Auto-print toggle */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", marginBottom: "1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: config.autoprint ? "#F0FDF4" : "#F8FAFC", border: `1.5px solid ${config.autoprint ? "#BBF7D0" : "#E2E8F0"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle size={18} color={config.autoprint ? "#16A34A" : "#94A3B8"} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Impressão automática de pedidos</p>
              <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>
                {config.autoprint ? "✅ Comanda impressa automaticamente ao aceitar pedido" : "Desativado — você precisará imprimir manualmente"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setConfig(c => ({ ...c, autoprint: !c.autoprint }))}
            style={{ width: 52, height: 28, borderRadius: 14, background: config.autoprint ? "#16A34A" : "#E2E8F0", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}
          >
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: config.autoprint ? 27 : 3, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
          </button>
        </div>

        {/* Impressoras cadastradas */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, color: "#0F172A" }}>🖨️ Impressoras configuradas</h2>
          <button
            onClick={addPrinter}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, background: "#0F172A", color: "#fff", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
          >
            <Plus size={14} /> Adicionar impressora
          </button>
        </div>

        {config.printers.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 14, padding: "2rem", textAlign: "center", border: "1.5px dashed #E2E8F0", marginBottom: "1.25rem" }}>
            <Printer size={36} color="#CBD5E1" style={{ marginBottom: 8 }} />
            <p style={{ color: "#94A3B8", fontSize: "0.88rem", margin: 0 }}>Nenhuma impressora configurada ainda.</p>
            <p style={{ color: "#94A3B8", fontSize: "0.82rem", margin: "4px 0 0" }}>Clique em "Adicionar impressora" para começar.</p>
          </div>
        )}

        {config.printers.map((printer, idx) => (
          <div key={printer.id} style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", marginBottom: "1rem" }}>
            {/* Nome e apelido */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem", flexWrap: "wrap" }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "#FFF7ED", border: "1px solid #FED7AA", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", color: "#C2410C", flexShrink: 0 }}>
                {idx + 1}
              </div>
              <input
                value={printer.label}
                onChange={e => updatePrinter(printer.id, { label: e.target.value })}
                placeholder="Apelido (ex: Cozinha, Bar)"
                style={{ flex: 1, minWidth: 120, padding: "8px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontWeight: 700, fontFamily: "inherit" }}
              />
              <button onClick={() => removePrinter(printer.id)} style={{ padding: 8, borderRadius: 8, background: "#FEF2F2", border: "none", cursor: "pointer" }}>
                <Trash2 size={15} color="#EF4444" />
              </button>
            </div>

            {/* Seletor de impressora */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>IMPRESSORA DO COMPUTADOR</label>
              <select
                value={printer.name}
                onChange={e => updatePrinter(printer.id, { name: e.target.value })}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", background: "#fff" }}
              >
                <option value="">Selecione uma impressora...</option>
                {availablePrinters.map(p => <option key={p.name} value={p.name}>{p.name} {p.port && `(${p.port})`}</option>)}
              </select>
            </div>

            {/* Largura da Bobina / Papel */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>LARGURA DA BOBINA (PAPEL)</label>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => updatePrinter(printer.id, { paperWidth: "80mm" })}
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 10,
                    border: `1.5px solid ${(!printer.paperWidth || printer.paperWidth === "80mm") ? "#C62828" : "#E2E8F0"}`,
                    background: (!printer.paperWidth || printer.paperWidth === "80mm") ? "#C6282810" : "#fff",
                    color: (!printer.paperWidth || printer.paperWidth === "80mm") ? "#C62828" : "#64748B",
                    fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s"
                  }}
                >
                  📄 POS 80 (80mm / 48 colunas)
                </button>
                <button
                  type="button"
                  onClick={() => updatePrinter(printer.id, { paperWidth: "58mm" })}
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 10,
                    border: `1.5px solid ${printer.paperWidth === "58mm" ? "#C62828" : "#E2E8F0"}`,
                    background: printer.paperWidth === "58mm" ? "#C6282810" : "#fff",
                    color: printer.paperWidth === "58mm" ? "#C62828" : "#64748B",
                    fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s"
                  }}
                >
                  🧾 POS 58 (58mm / 32 colunas)
                </button>
              </div>
            </div>

            {/* Cópias */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>NÚMERO DE CÓPIAS</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => updatePrinter(printer.id, { copies: Math.max(1, printer.copies - 1) })} style={{ width: 32, height: 32, borderRadius: 8, background: "#F1F5F9", border: "none", fontWeight: 800, fontSize: "1rem", cursor: "pointer" }}>−</button>
                <span style={{ fontWeight: 800, fontSize: "1rem", minWidth: 24, textAlign: "center" }}>{printer.copies}</span>
                <button onClick={() => updatePrinter(printer.id, { copies: Math.min(5, printer.copies + 1) })} style={{ width: 32, height: 32, borderRadius: 8, background: "#F1F5F9", border: "none", fontWeight: 800, fontSize: "1rem", cursor: "pointer" }}>+</button>
                <span style={{ fontSize: "0.78rem", color: "#94A3B8", marginLeft: 4 }}>vias por pedido</span>
              </div>
            </div>

            {/* Categorias */}
            {categories.length > 0 && (
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6 }}>
                  CATEGORIAS QUE ESTA IMPRESSORA RECEBE
                  <span style={{ fontWeight: 400, marginLeft: 6 }}>(vazio = todas)</span>
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {categories.map(cat => {
                    const active = printer.categories.includes(cat);
                    return (
                      <button key={cat} onClick={() => toggleCategory(printer.id, cat)} style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${active ? "#C62828" : "#E2E8F0"}`, background: active ? "#C6282810" : "#fff", color: active ? "#C62828" : "#64748B", fontSize: "0.78rem", fontWeight: active ? 700 : 500, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                        {active ? "✓ " : ""}{cat}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "6px 0 0" }}>
                  💡 Ex: Impressora "Cozinha" recebe só Lanches e Pizzas; impressora "Bar" recebe só Bebidas.
                </p>
              </div>
            )}

            {/* Botão de teste individual */}
            {printer.name && (
              <div style={{ background: "#EFF6FF", borderRadius: 12, padding: "0.85rem 1rem", border: "1px solid #BFDBFE", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: "1rem" }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0, color: "#1E40AF" }}>🧪 Testar "{printer.label}"</p>
                  <p style={{ fontSize: "0.72rem", color: "#3B82F6", margin: "2px 0 0" }}>Imprime uma comanda de teste</p>
                </div>
                <button
                  onClick={() => testPrint(printer.name, printer.label)}
                  disabled={testingPrinter === printer.name}
                  style={{ padding: "8px 16px", borderRadius: 10, background: "#3B82F6", color: "#fff", border: "none", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: testingPrinter === printer.name ? 0.6 : 1 }}
                >
                  {testingPrinter === printer.name ? "Imprimindo..." : "Imprimir teste"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
