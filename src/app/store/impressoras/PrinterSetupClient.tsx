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

              {/* Passo 2 */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#64748B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>2</div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Permitir acesso à rede local</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px", lineHeight: 1.5 }}>
                  O navegador vai pedir permissão para acessar a rede local. Clique em <strong>"Permitir"</strong>. Isso permite a comunicação com suas impressoras.
                </p>
              </div>

              {/* Passo 3 */}
              <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "10px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#64748B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>3</div>
                  <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Verificar conexão</h3>
                </div>
                <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 12px" }}>
                  Após abrir o assistente, clique no botão abaixo.
                </p>
                <button onClick={tryConnect} style={{ padding: "10px 20px", borderRadius: 10, background: "#3B82F6", color: "#fff", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <RefreshCw size={14} /> Verificar conexão
                </button>
              </div>
            </>
          )}
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A" }} />
                <span style={{ fontSize: "0.78rem", color: "#16A34A", fontWeight: 700 }}>
                  Assistente conectado • {availablePrinters.filter(p => /^(USB|LPT|COM)/i.test(p.port)).length || availablePrinters.length} impressora(s) detectada(s)
                </span>
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
              <CheckCircle size={18} color={config.autoprint ? "#16A34A" : "#94A3B8"} />
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
