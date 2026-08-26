"use client";
import { useState, useEffect, useCallback } from "react";
import { Printer, CheckCircle, Download, AlertCircle, Plus, Trash2, RefreshCw } from "lucide-react";
import { VERSAO_ASSISTENTE_ATUAL } from "@/lib/print";

/* ─── Tipos ─────────────────────────────────────────────────── */
type PrinterConfig = {
  autoprint: boolean;
  autoBeverageTag?: boolean;
  customBeverageKeywords?: string;
  defaultPaperWidth?: "58mm" | "80mm"; // herdado por impressora detectada sozinha
  printers: PrinterEntry[];
};

type PrinterEntry = {
  id: string;
  name: string;       // nome da impressora no Windows
  label: string;      // apelido (ex: "Cozinha", "Bar")
  categories: string[]; // categorias que imprime
  copies: number;
  paperWidth?: "58mm" | "80mm"; // 58mm (32 colunas) ou 80mm (48 colunas)
  columns?: number;             // largura REAL medida pela regua (vazio = padrao da bobina)
  escposProfile?: "full" | "safe" | "legacy"; // perfil de preambulo ESC/POS
};

type AssistantStatus = "checking" | "disconnected" | "connected";
type DetectedPrinter = { name: string; driver: string; port: string; status: string };

const ASSISTANT_URL = "http://localhost:7891";

/* ─── Componente principal ───────────────────────────────────── */
export default function PrinterSetupClient({
  storeName, franchiseeId, initialConfig, categories,
}: {
  storeName: string;
  franchiseeId: string;
  initialConfig: PrinterConfig | null;
  categories: string[];
}) {
  const [status, setStatus] = useState<AssistantStatus>("checking");
  const [availablePrinters, setAvailablePrinters] = useState<DetectedPrinter[]>([]);
  const [config, setConfig] = useState<PrinterConfig>(
    initialConfig
      ? { ...initialConfig, autoprint: initialConfig.autoprint !== undefined ? initialConfig.autoprint : true }
      : { autoprint: true, printers: [] }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  const [rulerPrinter, setRulerPrinter] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  /** Versão do Assistente que está rodando neste computador. */
  const [versaoInstalada, setVersaoInstalada] = useState<string | null>(null);

  // Comparação literal de propósito: qualquer diferença é motivo de aviso.
  // Comparar por ordem de versão exigiria confiar no formato que cada build
  // antigo devolve, e havia build reportando "2.0.0" com código mais velho que
  // o de hoje — a ordem mentiria.
  const versaoDesatualizada = !!versaoInstalada && versaoInstalada !== VERSAO_ASSISTENTE_ATUAL;

  const tryConnect = useCallback(async (userClicked = false) => {
    setStatus("checking");

    // 1. Tenta conectar via WebSocket (Bypassa bloqueios CORS/PNA do Chrome em HTTPS!)
    const wsPorts = [7899, 7900, 7901, 7891];
    for (const port of wsPorts) {
      try {
        const wsData = await new Promise<any>((resolve) => {
          let timer: any;
          try {
            const ws = new WebSocket(`ws://localhost:${port}`);
            timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 1200);
            ws.onmessage = (evt) => {
              clearTimeout(timer);
              try {
                const parsed = JSON.parse(evt.data);
                if (parsed.ok) resolve(parsed); else resolve(null);
              } catch { resolve(null); }
            };
            ws.onerror = () => { clearTimeout(timer); resolve(null); };
          } catch {
            clearTimeout(timer);
            resolve(null);
          }
        });

        if (wsData) {
          setStatus("connected");
          setAvailablePrinters(wsData.printers || []);
          setVersaoInstalada(wsData.version || null);
          if (userClicked) {
            alert(`✅ Assistente FireHub conectado com sucesso!\n\n${(wsData.printers || []).length} impressora(s) detectada(s) no Windows.`);
          }
          return;
        }
      } catch {}
    }

    // 2. Fallback HTTP fetch
    const urls = [
      "http://localhost:7899", "http://127.0.0.1:7899",
      "http://localhost:7900", "http://127.0.0.1:7900",
      "http://localhost:7901", "http://127.0.0.1:7901",
      "http://localhost:7891", "http://127.0.0.1:7891",
    ];
    let connectedData = null;

    for (const url of urls) {
      try {
        const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(1500) });
        const data = await res.json();
        if (data.ok && (data.app === "FireHub-Thermal-Printer-v2" || (data.printers && data.printers.length > 0))) {
          connectedData = data;
          break;
        }
      } catch {}
    }

    if (connectedData) {
      setStatus("connected");
      setAvailablePrinters(connectedData.printers || []);
      setVersaoInstalada((connectedData as any).version || null);
      if (userClicked) {
        alert(`✅ Assistente FireHub conectado com sucesso!\n\n${(connectedData.printers || []).length} impressora(s) detectada(s) neste computador.`);
      }
    } else {
      setStatus("disconnected");
      if (userClicked) {
        alert("⚠️ Não foi possível conectar ao Assistente local.");
      }
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

      const firstPrinter = config.printers[0];
      if (firstPrinter) {
        const ports = [7899, 7900, 7901, 7891];
        for (const p of ports) {
          fetch(`http://localhost:${p}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              // Campos legados: honrados pelo assistente ja instalado.
              // franchiseeId e pre-requisito de seguranca: sem ele o polling
              // da nuvem nao sabe de qual loja puxar os pedidos.
              franchiseeId,
              printer: firstPrinter.name,
              paperWidth: firstPrinter.paperWidth || "80mm",
              // Campo novo: assistente antigo ignora, assistente novo usa
              // para resolver largura/perfil POR IMPRESSORA (Cozinha 80mm + Bar 58mm).
              printers: config.printers.map(pr => ({
                name: pr.name,
                paperWidth: pr.paperWidth || "80mm",
                columns: pr.columns,
                escposProfile: pr.escposProfile,
                copies: pr.copies || 1,
                categories: pr.categories || [],
              })),
            }),
          }).catch(() => {});
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert("Erro ao salvar configurações.");
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

  const runRuler = async (printerName: string) => {
    setRulerPrinter(printerName);
    try {
      const { printWidthRuler } = await import("@/lib/print");
      const ok = await printWidthRuler(printerName);
      if (ok) {
        alert("📏 Régua enviada!\n\nNo papel, ache a ÚLTIMA linha \"CABE N\" que NÃO quebrou e digite esse número no campo \"colunas reais\" ao lado.");
      } else {
        alert("⚠️ Não foi possível falar com o Assistente FireHub neste computador.");
      }
    } catch (e: any) {
      alert(`❌ Erro ao imprimir a régua: ${e.message}`);
    } finally {
      setRulerPrinter(null);
    }
  };

  const testPrint = async (printerName: string, label: string) => {
    setTestingPrinter(printerName);
    try {
      // 1. Envia para a Fila de Impressão na Nuvem
      await fetch("/api/store/print-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: {
            id: "TESTE",
            customerName: "Cliente Teste FireHub",
            customerPhone: "(00) 00000-0000",
            customerAddress: "Rua Exemplo, 123 - Centro",
            deliveryType: "DELIVERY",
            paymentMethod: "Pix (Online)",
            items: [{ name: "Item Teste Impressão FireHub", qty: 1, price: 10.00 }],
            totalAmount: 10.00,
            notes: "Teste de Impressão Direta",
          },
          storeName,
        }),
      });

      // 2. Envio direto no assistente local, respeitando a largura configurada.
      //    /print-test ignora "columns" no assistente instalado — printTestReceipt
      //    vai por /print, que honra 58/80 e a calibracao fina hoje mesmo.
      const entry = config.printers.find(p => p.name === printerName);
      const { printTestReceipt } = await import("@/lib/print");
      await printTestReceipt(
        printerName,
        storeName,
        entry?.paperWidth || config.defaultPaperWidth || "80mm",
        entry?.columns,
        config as any,
        entry?.escposProfile
      );

      alert(`✅ Impressão de teste enviada para "${label || printerName || "Impressora"}"!\n\nA comanda sairá na impressora em poucos segundos.`);
    } catch (e: any) {
      alert(`❌ Erro ao enviar teste: ${e.message}`);
    } finally {
      setTestingPrinter(null);
    }
  };

  /* ─── CONFIGURAÇÃO DA IMPRESSORA (Sempre visível em todos os computadores) ─── */

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
                {/* Sem isto não havia como saber, olhando a tela, qual build a loja
                    tem instalado — e duas lojas em versões diferentes imprimiam a
                    mesma comanda de jeitos diferentes sem ninguém entender por quê. */}
                {versaoInstalada && (
                  <p style={{ margin: "3px 0 0", fontSize: "0.72rem", fontWeight: 700, color: versaoDesatualizada ? "#B45309" : "#64748B" }}>
                    {versaoDesatualizada
                      ? `⚠️ Assistente ${versaoInstalada} — a versão atual é ${VERSAO_ASSISTENTE_ATUAL}. Baixe o instalador ao lado, desinstale o antigo e instale o novo.`
                      : `Assistente ${versaoInstalada} — atualizado`}
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <a
                href="/downloads/FireHub-Assistente-Impressao-Setup.exe"
                download
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "linear-gradient(135deg,#B71C1C,#C62828)", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: "0.78rem", whiteSpace: "nowrap" }}
              >
                <Download size={14} /> Baixar Instalador (.exe)
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

        {/* Marcador Inteligente de Bebidas */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1.5px solid #E2E8F0", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: (config.autoBeverageTag !== false) ? "#EFF6FF" : "#F8FAFC", border: `1.5px solid ${(config.autoBeverageTag !== false) ? "#93C5FD" : "#E2E8F0"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem" }}>
                🍹
              </div>
              <div>
                <p style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0, color: "#0F172A" }}>Marcador Inteligente de Bebidas</p>
                <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>
                  {(config.autoBeverageTag !== false) ? "✅ Filtra e destaca bebidas automaticamente em TODAS as comandas e notas impressas (iFood, JotaJá, 99Food, WhatsApp, Balcão, etc.)" : "Desativado — destaca apenas bebidas sinalizadas manualmente no cardápio"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setConfig(c => ({ ...c, autoBeverageTag: c.autoBeverageTag === false ? true : false }))}
              style={{ width: 52, height: 28, borderRadius: 14, background: (config.autoBeverageTag !== false) ? "#2563EB" : "#E2E8F0", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}
            >
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: (config.autoBeverageTag !== false) ? 27 : 3, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
            </button>
          </div>

          {(config.autoBeverageTag !== false) && (
            <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginTop: 12 }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                🥤 Bebidas personalizadas / regionais da sua cidade:
              </label>
              <input
                type="text"
                value={config.customBeverageKeywords || ""}
                onChange={e => setConfig(c => ({ ...c, customBeverageKeywords: e.target.value }))}
                placeholder="Ex: Guaraná Jesus, Mineirinho, Mate Couro, Catuaba, Suco da Terra"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
              />
              <p style={{ fontSize: "0.74rem", color: "#64748B", margin: "6px 0 0", lineHeight: 1.4 }}>
                💡 Separe por vírgula. Funciona em <b>todas as integrações (iFood, JotaJá, 99Food, WhatsApp, Venda Presencial)</b>. Qualquer produto ou opção com estes termos receberá o carimbo <code>[ ◄=== BEBIDA ]</code> na impressão.
              </p>
            </div>
          )}
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
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", background: "#fff", fontWeight: 600 }}
              >
                <option value="">-- Selecione a impressora instalada no Windows --</option>
                {availablePrinters.map(p => (
                  <option key={p.name} value={p.name}>
                    🖨️ {p.name} {p.port ? `(${p.port})` : ""}
                  </option>
                ))}
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

              {/* Calibração fina — só é necessária quando a impressora não obedece o padrão */}
              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => runRuler(printer.name)}
                  disabled={rulerPrinter === printer.name}
                  style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#F8FAFC", color: "#475569", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {rulerPrinter === printer.name ? "Imprimindo..." : "📏 Calibrar largura (régua)"}
                </button>
                <input
                  type="number"
                  min={24}
                  max={64}
                  placeholder={printer.paperWidth === "58mm" ? "32" : "48"}
                  value={printer.columns ?? ""}
                  onChange={e => {
                    const v = Number(e.target.value);
                    updatePrinter(printer.id, {
                      columns: e.target.value && Number.isFinite(v) ? Math.max(24, Math.min(64, Math.floor(v))) : undefined,
                    });
                  }}
                  style={{ width: 88, padding: "7px 10px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit" }}
                />
                <span style={{ fontSize: "0.72rem", color: "#64748B" }}>
                  colunas reais (deixe vazio para o padrão)
                </span>
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
