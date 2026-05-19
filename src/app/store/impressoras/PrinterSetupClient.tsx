"use client";
import { useState, useEffect, useCallback } from "react";
import { Printer, CheckCircle, Download, Monitor, Settings, Zap, AlertCircle, Plus, Trash2, ChevronRight, RefreshCw } from "lucide-react";

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
};

type QZStatus = "checking" | "disconnected" | "connected";

/* ─── Helpers QZ ─────────────────────────────────────────────── */
declare global { interface Window { qz: any } }

async function loadQZ(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.qz) return true;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.min.js";
    script.onload = () => resolve(!!window.qz);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function connectQZ(): Promise<{ ok: boolean; printers: string[] }> {
  try {
    const loaded = await loadQZ();
    if (!loaded) return { ok: false, printers: [] };
    if (!window.qz.websocket.isActive()) {
      await window.qz.websocket.connect({ host: "localhost", port: { secure: [8182], insecure: [8181] } });
    }
    const printers: string[] = await window.qz.printers.find();
    return { ok: true, printers };
  } catch {
    return { ok: false, printers: [] };
  }
}

/* ─── Componente principal ───────────────────────────────────── */
export default function PrinterSetupClient({
  storeName, initialConfig, categories,
}: {
  storeName: string;
  initialConfig: PrinterConfig | null;
  categories: string[];
}) {
  const [qzStatus, setQzStatus] = useState<QZStatus>("checking");
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [config, setConfig] = useState<PrinterConfig>(
    initialConfig || { autoprint: false, printers: [] }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [setupStep, setSetupStep] = useState(0); // 0=not started, 1=download, 2=install, 3=done

  const tryConnect = useCallback(async () => {
    setQzStatus("checking");
    const result = await connectQZ();
    if (result.ok) {
      setQzStatus("connected");
      setAvailablePrinters(result.printers);
    } else {
      setQzStatus("disconnected");
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
    const p: PrinterEntry = {
      id: Date.now().toString(),
      name: availablePrinters[0] || "",
      label: `Impressora ${config.printers.length + 1}`,
      categories: [],
      copies: 1,
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

  /* ─── WIZARD DE INSTALAÇÃO ─────────────────────────────────── */
  if (qzStatus !== "connected") {
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
          <div style={{ background: qzStatus === "checking" ? "#EFF6FF" : "#FEF2F2", border: `1.5px solid ${qzStatus === "checking" ? "#BFDBFE" : "#FECACA"}`, borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: 10 }}>
            {qzStatus === "checking"
              ? <><RefreshCw size={18} color="#3B82F6" style={{ animation: "spin 1s linear infinite" }} /><span style={{ fontSize: "0.88rem", color: "#1E40AF", fontWeight: 600 }}>Procurando QZ Tray no seu computador...</span></>
              : <><AlertCircle size={18} color="#EF4444" /><span style={{ fontSize: "0.88rem", color: "#B91C1C", fontWeight: 600 }}>QZ Tray não encontrado. Siga os passos abaixo para configurar.</span></>
            }
          </div>

          {/* Steps */}
          {qzStatus === "disconnected" && (
            <>
              {/* O que é QZ Tray */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", marginBottom: "1rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 8px", color: "#0F172A" }}>❓ O que é o QZ Tray?</h2>
                <p style={{ fontSize: "0.85rem", color: "#475569", lineHeight: 1.6, margin: 0 }}>
                  É um pequeno programa gratuito (5MB) que fica rodando em segundo plano no computador da loja. Ele permite que o sistema imprima comandas <strong>automaticamente, sem nenhum clique</strong>, assim que o pedido for aceito.
                </p>
              </div>

              {/* Passo 1 */}
              <div style={{ background: setupStep >= 1 ? "#F0FDF4" : "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: `1.5px solid ${setupStep >= 1 ? "#BBF7D0" : "#E2E8F0"}`, marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: setupStep >= 1 ? "#16A34A" : "#C62828", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>
                    {setupStep >= 1 ? "✓" : "1"}
                  </div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0, color: setupStep >= 1 ? "#16A34A" : "#0F172A" }}>Baixar o QZ Tray</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px", lineHeight: 1.5 }}>
                  Clique no botão abaixo para baixar o instalador. Escolha a versão <strong>Windows (.exe)</strong>.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    href="https://qz.io/download/"
                    target="_blank" rel="noreferrer"
                    onClick={() => setSetupStep(s => Math.max(s, 1))}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", background: "linear-gradient(135deg,#B71C1C,#C62828)", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: "0.88rem" }}
                  >
                    <Download size={15} /> Baixar QZ Tray (Windows / Mac)
                  </a>
                </div>
              </div>

              {/* Passo 2 */}
              <div style={{ background: setupStep >= 2 ? "#F0FDF4" : "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: `1.5px solid ${setupStep >= 2 ? "#BBF7D0" : "#E2E8F0"}`, marginBottom: "1rem", opacity: setupStep < 1 ? 0.5 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: setupStep >= 2 ? "#16A34A" : "#64748B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>
                    {setupStep >= 2 ? "✓" : "2"}
                  </div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Instalar e abrir o programa</h3>
                </div>
                <ol style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px", paddingLeft: "1.2rem", lineHeight: 2 }}>
                  <li>Abra o arquivo baixado e clique em <strong>"Instalar"</strong></li>
                  <li>Ao terminar, o ícone do QZ Tray aparece na <strong>barra de tarefas</strong> (canto inferior direito)</li>
                  <li>Clique no ícone e selecione <strong>"Start"</strong> se não estiver rodando</li>
                </ol>
                <button
                  onClick={() => setSetupStep(s => Math.max(s, 2))}
                  disabled={setupStep < 1}
                  style={{ padding: "8px 18px", borderRadius: 10, background: setupStep >= 1 ? "#0F172A" : "#E2E8F0", color: setupStep >= 1 ? "#fff" : "#94A3B8", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: setupStep >= 1 ? "pointer" : "not-allowed", fontFamily: "inherit" }}
                >
                  ✅ Instalei e abri o QZ Tray
                </button>
              </div>

              {/* Passo 3 — aguardando detecção */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0", opacity: setupStep < 2 ? 0.5 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#64748B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>3</div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Aguardando conexão automática...</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px" }}>
                  O sistema detectará o QZ Tray automaticamente. Pode levar alguns segundos após abrir o programa.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <RefreshCw size={16} color="#94A3B8" style={{ animation: setupStep >= 2 ? "spin 2s linear infinite" : "none" }} />
                  <span style={{ fontSize: "0.8rem", color: "#94A3B8" }}>
                    {setupStep >= 2 ? "Clique no botão abaixo para verificar a conexão" : "Conclua os passos anteriores"}
                  </span>
                  <button onClick={tryConnect} disabled={setupStep < 2} style={{ marginLeft: 8, padding: "8px 18px", borderRadius: 10, background: setupStep >= 2 ? "#3B82F6" : "#E2E8F0", color: setupStep >= 2 ? "#fff" : "#94A3B8", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: setupStep >= 2 ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={14} /> Verificar conexão</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ─── CONFIGURAÇÃO (QZ conectado) ──────────────────────────── */
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A" }} />
                <span style={{ fontSize: "0.78rem", color: "#16A34A", fontWeight: 700 }}>QZ Tray conectado • {availablePrinters.length} impressora{availablePrinters.length !== 1 ? "s" : ""} detectada{availablePrinters.length !== 1 ? "s" : ""}</span>
              </div>
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

        {/* Auto-print toggle */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", marginBottom: "1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: config.autoprint ? "#F0FDF4" : "#F8FAFC", border: `1.5px solid ${config.autoprint ? "#BBF7D0" : "#E2E8F0"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={18} color={config.autoprint ? "#16A34A" : "#94A3B8"} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Impressão automática</p>
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

            {/* Seletor de impressora do Windows */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>IMPRESSORA DO COMPUTADOR</label>
              <select
                value={printer.name}
                onChange={e => updatePrinter(printer.id, { name: e.target.value })}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", background: "#fff" }}
              >
                <option value="">Selecione uma impressora...</option>
                {availablePrinters.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
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
          </div>
        ))}

        {/* Botão de teste */}
        {config.printers.length > 0 && config.printers[0].name && (
          <div style={{ background: "#EFF6FF", borderRadius: 14, padding: "1rem 1.25rem", border: "1px solid #BFDBFE", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: "0.88rem", margin: 0, color: "#1E40AF" }}>🧪 Testar impressão</p>
              <p style={{ fontSize: "0.75rem", color: "#3B82F6", margin: "2px 0 0" }}>Imprime uma comanda de teste para verificar o layout</p>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("firehub:test-print"))}
              style={{ padding: "8px 18px", borderRadius: 10, background: "#3B82F6", color: "#fff", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
            >
              Imprimir teste
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
