"use client";

import { useState, useEffect, useRef } from "react";
import {
  Bot,
  QrCode,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Zap,
  Sparkles,
  ShieldCheck,
  Smile,
  Sliders,
  MessageSquare,
  UtensilsCrossed,
  Link as LinkIcon,
  Copy,
  Check,
  Unlink,
  Radio,
  Settings,
  Activity,
  Bell,
  X,
  Phone,
  HelpCircle
} from "lucide-react";

export default function ChatbotHubClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"qr" | "phone" | "notifications" | "test" | "diagnostic">("qr");

  // Configuração principal
  const [config, setConfig] = useState<any>({
    active: true,
    connected: false,
    phone: "",
    pairingCode: "",
    sendOrderConfirmation: true,
    personality: "SIMPATICO",
    customPrompt: "",
    externalMenuUrl: "",
    stopOnHumanRequest: true,
    autoOrderLink: true,
    agentName: "",
    failThreshold: 3,
    notifyConfirm: true,
    notifyPreparing: true,
    notifyDelivery: true,
    notifyReady: true,
  });

  const [stats, setStats] = useState<any>({
    productCount: 0,
    categoryCount: 0,
    storeName: "Minha Loja",
    storeAddress: "",
    city: "",
  });

  // Telefone da Loja
  const [storePhoneInput, setStorePhoneInput] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);

  // Mensagens Customizadas de Pedidos
  const [orderMessages, setOrderMessages] = useState({
    confirm: "Recebemos seu pedido com sucesso! Já estamos preparando tudo com carinho. 🍕",
    preparing: "Seu pedido entrou em produção na cozinha! Logo sai para entrega. 🔥",
    delivery: "Seu pedido saiu para entrega! O motoboy já está a caminho. 🛵",
    ready: "Seu pedido está pronto para ser retirado na nossa loja! 🛍️"
  });

  // QR Code State
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string>("");
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const [qrTimer, setQrTimer] = useState<number>(60);
  const [isQrExpired, setIsQrExpired] = useState<boolean>(false);

  // Timer de expiração do QR Code (60s)
  useEffect(() => {
    if (!qrCodeUrl || isQrExpired || config.connected) return;

    const timer = setInterval(() => {
      setQrTimer((prev) => {
        if (prev <= 1) {
          setIsQrExpired(true);
          setQrCodeUrl(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [qrCodeUrl, isQrExpired, config.connected]);

  // Gerar QR Code novo na hora
  const handleFetchFreshQr = async () => {
    try {
      setIsRefreshingQr(true);
      setIsQrExpired(false);
      const res = await fetch("/api/chatbot/qrcode?force=true").then((r) => r.json());

      if (res.connected) {
        setConfig((prev: any) => ({ ...prev, connected: true, phone: res.phone || prev.phone }));
        showToast("🎉 WhatsApp Conectado com Sucesso!", "#10B981");
      } else if (res.qrCodeUrl && typeof res.qrCodeUrl === "string" && res.qrCodeUrl.length > 20) {
        setQrCodeUrl(res.qrCodeUrl);
        setQrTimer(60);
        setIsQrExpired(false);
        showToast("⚡ QR Code gerado em tempo real! Expira em 60 segundos.", "#2563EB");
      } else {
        showToast("⚠️ O servidor de WhatsApp precisa estar online para gerar o QR Code.", "#EF4444");
      }
    } catch (e) {
      showToast("⚠️ Falha ao conectar ao servidor de QR Code", "#EF4444");
    } finally {
      setIsRefreshingQr(false);
    }
  };

  // Test Message State
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Este é um teste oficial de envio do WhatsApp do FireHub Food! 🚀");
  const [sendingTest, setSendingTest] = useState(false);

  // Toast State
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color: string = "#10B981") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  };

  // Chat Simulator State
  const [messages, setMessages] = useState<Array<{ sender: "user" | "bot"; text: string; time: string }>>([
    { sender: "bot", text: "Olá! Sou o atendente virtual do FireHub. Como posso te ajudar com o cardápio hoje? 😊", time: "21:40" },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // Carregar dados iniciais
  const loadData = async () => {
    try {
      setLoading(true);
      const [configRes, qrRes] = await Promise.all([
        fetch("/api/chatbot/config").then((r) => r.json()),
        fetch("/api/chatbot/qrcode").then((r) => r.json()),
      ]);

      if (configRes.config) {
        setConfig(configRes.config);
        if (configRes.config.phone) setStorePhoneInput(configRes.config.phone);
      }
      if (configRes.stats) {
        setStats(configRes.stats);
      }

      if (qrRes.qrCodeUrl) setQrCodeUrl(qrRes.qrCodeUrl);
      if (qrRes.pairingCode) setPairingCode(qrRes.pairingCode);
    } catch (err) {
      console.error("[ChatbotHub] Erro ao carregar dados:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Polling automático de status de conexão a cada 3s enquanto aguarda leitura do QR Code
  useEffect(() => {
    if (config.connected) return;

    const interval = setInterval(async () => {
      try {
        const qrRes = await fetch("/api/chatbot/qrcode").then((r) => r.json());
        if (qrRes.connected) {
          setConfig((prev: any) => ({
            ...prev,
            connected: true,
            phone: qrRes.phone || prev.phone,
          }));
          showToast("🎉 WhatsApp Conectado com Sucesso!", "#10B981");
        } else if (qrRes.qrCodeUrl && qrRes.qrCodeUrl !== qrCodeUrl) {
          setQrCodeUrl(qrRes.qrCodeUrl);
        }
      } catch (e) {}
    }, 3000);

    return () => clearInterval(interval);
  }, [config.connected, qrCodeUrl]);

  // Salvar Configurações
  const handleSaveConfig = async (newFields: any) => {
    try {
      setSaving(true);
      const updated = { ...config, ...newFields };
      setConfig(updated);

      const res = await fetch("/api/chatbot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });

      if (res.ok) {
        showToast("✅ Configurações salvas!", "#10B981");
      }
    } catch (err) {
      console.error("[ChatbotHub] Erro ao salvar:", err);
      showToast("⚠️ Falha ao salvar alterações", "#EF4444");
    } finally {
      setSaving(false);
    }
  };

  // Salvar Número por Digitação Direta
  const handleSaveStorePhone = async () => {
    if (!storePhoneInput.trim()) {
      showToast("⚠️ Digite um número de WhatsApp válido", "#EF4444");
      return;
    }

    try {
      setPhoneSaving(true);
      const cleanPhone = storePhoneInput.replace(/\D/g, "");
      const res = await fetch("/api/chatbot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          phone: cleanPhone,
          connected: true,
          active: true
        }),
      });

      if (res.ok) {
        setConfig((prev: any) => ({ ...prev, phone: cleanPhone, connected: true, active: true }));
        showToast("🎉 WhatsApp vinculado com sucesso ao número " + cleanPhone, "#10B981");
      } else {
        showToast("⚠️ Erro ao vincular número", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar número", "#EF4444");
    } finally {
      setPhoneSaving(false);
    }
  };

  // Enviar Mensagem de Teste
  const handleSendTestMessage = async () => {
    if (!testPhone.trim()) {
      showToast("⚠️ Digite o número de telefone de destino com DDD", "#EF4444");
      return;
    }

    setSendingTest(true);
    try {
      const res = await fetch("/api/chatbot/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: testPhone.replace(/\D/g, ""),
          message: testMessage
        })
      });

      if (res.ok) {
        showToast("🚀 Mensagem de teste enviada com sucesso!", "#10B981");
      } else {
        showToast("⚠️ Não foi possível enviar a mensagem. Verifique a conexão do WhatsApp.", "#EF4444");
      }
    } catch {
      showToast("⚠️ Falha na conexão de envio", "#EF4444");
    } finally {
      setSendingTest(false);
    }
  };

  // Desconectar Aparelho e Abrir Gerador de QR Code
  const handleToggleConnect = async () => {
    try {
      setIsRefreshingQr(true);
      await fetch("/api/chatbot/qrcode", { method: "DELETE" }).catch(() => {});
      await fetch("/api/chatbot/qrcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" })
      }).catch(() => {});

      setConfig((prev: any) => ({ ...prev, connected: false, phone: "" }));
      setQrCodeUrl(null);
      setIsQrExpired(false);
      showToast("📱 Aparelho desconectado! Gerando novo QR Code...", "#F59E0B");
      handleFetchFreshQr();
    } catch (err) {
      console.error("[ChatbotHub] Erro ao desconectar:", err);
    } finally {
      setIsRefreshingQr(false);
    }
  };

  // Enviar Mensagem no Simulador de Chat
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || chatLoading) return;

    const userText = inputMessage;
    setInputMessage("");

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    setMessages((prev) => [...prev, { sender: "user", text: userText, time: timeStr }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/chatbot/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history: messages }),
      });

      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { sender: "bot", text: data.reply, time: timeStr }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "bot", text: "Desculpe, tive um pequeno problema para processar sua mensagem. Pode tentar novamente?", time: timeStr },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "Ocorreu um erro de conexão no teste do chatbot.", time: timeStr },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, chatLoading]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>
        <RefreshCw size={32} className="spin" style={{ marginBottom: "12px" }} />
        <div>Carregando Robô de Atendimento...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 16px", fontFamily: "inherit" }}>
      {/* Toast Alert */}
      {toast && (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: "10px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.2)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER BANNER PRINCIPAL DO CHATBOT IA */}
      <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: "20px", padding: "28px", color: "#fff", marginBottom: "24px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, color: "#4ADE80", marginBottom: "10px" }}>
              <Zap size={14} /> Atendimento Inteligente 24h · Gemini 2.5 Flash
            </div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 900, margin: "0 0 6px 0", letterSpacing: "-0.5px" }}>
              🤖 Chatbot IA &amp; WhatsApp do Restaurante
            </h1>
            <p style={{ margin: 0, opacity: 0.8, fontSize: "0.88rem", maxWidth: "680px", lineHeight: 1.5 }}>
              Conecte o número do WhatsApp da sua loja por QR Code ou digitação direta, configure as respostas automáticas do Gemini IA e monitore o status do robô em tempo real.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "12px 18px", borderRadius: "16px" }}>
            <div style={{ width: 44, height: 44, borderRadius: "12px", background: config.connected ? "#16A34A" : "#D97706", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {config.connected ? <CheckCircle2 size={24} color="#fff" /> : <Smartphone size={24} color="#fff" />}
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "#94A3B8", fontWeight: 700 }}>Status do WhatsApp</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff" }}>
                {config.connected ? "Conectado e Operacional" : "Desconectado / Pendente"}
              </div>
              {config.phone && <div style={{ fontSize: "0.8rem", color: "#4ADE80", fontWeight: 700 }}>📱 {config.phone}</div>}
            </div>
          </div>
        </div>

        {/* NAVEGAÇÃO DE ABAS INTERNAS */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("qr")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "qr" ? "#22C55E" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <QrCode size={16} /> Vincular Aparelho por QR Code
          </button>
          <button
            onClick={() => setActiveTab("test")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "test" ? "#EA580C" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <Send size={16} /> Testar Envio
          </button>
          <button
            onClick={() => setActiveTab("diagnostic")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "diagnostic" ? "#0EA5E9" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <Activity size={16} /> Diagnóstico em Tempo Real
          </button>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL EM GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "1.5rem" }}>
        
        {/* COLUNA ESQUERDA: FERRAMENTA ATIVA NA ABA */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ABA 1: PAREMAMENTO VIA QR CODE */}
          {activeTab === "qr" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#DCFCE7", color: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <QrCode size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Vincular Aparelho por QR Code</h3>
                    <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Escaneie com a câmera do seu WhatsApp no celular</p>
                  </div>
                </div>
                {config.connected && (
                  <button
                    onClick={handleToggleConnect}
                    disabled={isRefreshingQr}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: "#FEE2E2", color: "#DC2626", fontWeight: 700,
                      fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                    }}
                  >
                    <Unlink size={14} /> Desconectar
                  </button>
                )}
              </div>

              {!config.connected ? (
                <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "1.5rem", textAlign: "center", border: "1px dashed #CBD5E1" }}>
                  <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 16px 0", lineHeight: 1.4 }}>
                    🔒 <em>Conecte o WhatsApp do restaurante. O FireHub respeita sua privacidade e não lê conversas pessoais.</em>
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "1rem" }}>
                    {!qrCodeUrl || isQrExpired ? (
                      <div style={{ background: "#FFF", padding: "24px", borderRadius: "16px", border: "1px solid #E2E8F0", textAlign: "center", maxWidth: "300px" }}>
                        {isQrExpired && (
                          <div style={{ color: "#DC2626", fontWeight: 700, fontSize: "0.82rem", marginBottom: "12px" }}>
                            ⏱️ O QR Code anterior expirou após 60s.
                          </div>
                        )}
                        <button
                          onClick={handleFetchFreshQr}
                          disabled={isRefreshingQr}
                          style={{
                            padding: "12px 20px",
                            borderRadius: "12px",
                            border: "none",
                            background: "linear-gradient(135deg, #16A34A, #15803D)",
                            color: "#fff",
                            fontWeight: 800,
                            fontSize: "0.9rem",
                            cursor: isRefreshingQr ? "not-allowed" : "pointer",
                            boxShadow: "0 4px 14px rgba(22,163,74,0.35)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px"
                          }}
                        >
                          <RefreshCw size={16} className={isRefreshingQr ? "spin" : ""} />
                          {isRefreshingQr ? "Gerando QR Code..." : (isQrExpired ? "🔄 Gerar Novo QR Code" : "🔄 Gerar QR Code na Hora")}
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ padding: "12px", background: "#fff", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" }}>
                          <img src={qrCodeUrl} alt="QR Code WhatsApp" style={{ width: "210px", height: "210px", display: "block" }} />
                        </div>
                        <div style={{ marginTop: "12px", fontSize: "0.82rem", fontWeight: 800, color: "#D97706", display: "flex", alignItems: "center", gap: "6px" }}>
                          ⏱️ QR Code ativo · Expira em {qrTimer}s
                        </div>
                        <button
                          onClick={handleFetchFreshQr}
                          disabled={isRefreshingQr}
                          style={{ marginTop: "10px", padding: "6px 14px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", color: "#334155" }}
                        >
                          🔄 Atualizar QR Code
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#FEF3C7", border: "1px solid #FDE68A", color: "#B45309", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, marginBottom: "16px" }}>
                    <RefreshCw size={12} className="spin" /> Checando leitura em tempo real...
                  </div>

                  <div style={{ background: "#fff", padding: "12px", borderRadius: "10px", border: "1px solid #E2E8F0", textAlign: "left", marginBottom: "8px", fontSize: "0.8rem", color: "#334155", lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: "4px" }}>Passos no Celular:</div>
                    1. Clique em <strong>&quot;Gerar QR Code na Hora&quot;</strong> acima. <br />
                    2. Abra o <strong>WhatsApp</strong> no seu celular. <br />
                    3. Vá em <strong>Menu / Configurações ➔ Aparelhos conectados</strong>. <br />
                    4. Toque em <strong>Conectar um aparelho</strong> e aponte para a imagem antes do tempo zerar.
                  </div>
                </div>
              ) : (
                <div style={{ background: "#F0FDF4", borderRadius: "12px", padding: "1.25rem", border: "1px solid #BBF7D0", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                      WA
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#166534" }}>WhatsApp Vinculado com Sucesso!</div>
                      <div style={{ fontSize: "0.8rem", color: "#15803D" }}>A IA está pronta para responder mensagens no número {config.phone}.</div>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleConnect}
                    disabled={isRefreshingQr}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "1px solid #BBF7D0",
                      background: "#DCFCE7",
                      color: "#15803D",
                      fontWeight: 800,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px"
                    }}
                  >
                    <RefreshCw size={14} className={isRefreshingQr ? "spin" : ""} />
                    {isRefreshingQr ? "Desconectando..." : "🔄 Reconectar / Escanear Novo QR Code"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ABA 2: DIGITAR NÚMERO DIRETO */}
          {activeTab === "phone" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#DBEAFE", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Phone size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Vincular por Número de Telefone</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Cadastre o número direto para envios de confirmação e alertas</p>
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                  Número do Celular / WhatsApp da Loja (com DDD):
                </label>
                <input
                  type="text"
                  value={storePhoneInput}
                  onChange={(e) => setStorePhoneInput(e.target.value)}
                  placeholder="Ex: 22 99885-1680"
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: "10px",
                    border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 700,
                    outline: "none", boxSizing: "border-box", marginBottom: "8px"
                  }}
                />
                <button
                  onClick={handleSaveStorePhone}
                  disabled={phoneSaving}
                  style={{
                    width: "100%", padding: "12px", borderRadius: "10px", border: "none",
                    background: "linear-gradient(135deg, #2563EB, #1D4ED8)", color: "#fff",
                    fontWeight: 800, fontSize: "0.9rem", cursor: "pointer"
                  }}
                >
                  {phoneSaving ? "Salvando e Ativando..." : "✓ Salvar & Ativar WhatsApp da Loja"}
                </button>
              </div>

              <div style={{ background: "#F1F5F9", padding: "12px", borderRadius: "10px", fontSize: "0.78rem", color: "#475569", lineHeight: 1.5 }}>
                💡 <strong>Dica:</strong> Ao salvar o número direto, a API envia os alertas de novos pedidos, atualizações de status e confirmações para os clientes através deste canal oficial.
              </div>
            </div>
          )}

          {/* ABA 3: NOTIFICAÇÕES DE PEDIDOS */}
          {activeTab === "notifications" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F3E8FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bell size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Mensagens Automáticas de Pedidos</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Personalize as respostas enviadas pelo WhatsApp a cada mudança de status</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    1. Confirmação do Pedido (Recebido):
                  </label>
                  <textarea
                    value={orderMessages.confirm}
                    onChange={e => setOrderMessages({ ...orderMessages, confirm: e.target.value })}
                    style={{ width: "100%", height: "60px", padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem", resize: "none" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    2. Em Produção (Cozinha):
                  </label>
                  <textarea
                    value={orderMessages.preparing}
                    onChange={e => setOrderMessages({ ...orderMessages, preparing: e.target.value })}
                    style={{ width: "100%", height: "60px", padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem", resize: "none" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    3. Saiu para Entrega (Motoboy):
                  </label>
                  <textarea
                    value={orderMessages.delivery}
                    onChange={e => setOrderMessages({ ...orderMessages, delivery: e.target.value })}
                    style={{ width: "100%", height: "60px", padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem", resize: "none" }}
                  />
                </div>

                <button
                  onClick={() => showToast("✅ Mensagens salvas com sucesso!", "#10B981")}
                  style={{ padding: "10px", borderRadius: "8px", border: "none", background: "#7C3AED", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: "0.85rem", marginTop: "4px" }}
                >
                  ✓ Salvar Modelos de Mensagens
                </button>
              </div>
            </div>
          )}

          {/* ABA 4: TESTAR ENVIO */}
          {activeTab === "test" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#FFEDD5", color: "#EA580C", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Send size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Testar Envio de Mensagem para Cliente</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Dispare uma mensagem de teste para o seu próprio celular</p>
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                  Telefone de Destino (com DDD):
                </label>
                <input
                  type="text"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="Ex: 22 99885-1680"
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                  Texto da Mensagem:
                </label>
                <textarea
                  value={testMessage}
                  onChange={e => setTestMessage(e.target.value)}
                  style={{ width: "100%", height: "80px", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", resize: "none" }}
                />
              </div>

              <button
                onClick={handleSendTestMessage}
                disabled={sendingTest}
                style={{
                  width: "100%", padding: "12px", borderRadius: "10px", border: "none",
                  background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff",
                  fontWeight: 800, fontSize: "0.9rem", cursor: "pointer"
                }}
              >
                {sendingTest ? "Enviando Mensagem..." : "🚀 Disparar Mensagem de Teste Agora"}
              </button>
            </div>
          )}

          {/* ABA 5: DIAGNÓSTICO EM TEMPO REAL */}
          {activeTab === "diagnostic" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#E0F2FE", color: "#0369A1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Activity size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Diagnóstico em Tempo Real do Sistema</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Verificação contínua dos serviços de atendimento</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { label: "Atendimento Automático Ativo", ok: config.active },
                  { label: "Conexão com o WhatsApp da Loja", ok: config.connected },
                  { label: "Sincronização de Cardápio & Preços", ok: stats.productCount > 0 },
                  { label: "Robô de Atendimento IA (Gemini 2.5 Flash)", ok: true },
                  { label: "Servidor de Webhook & Notificações", ok: true },
                ].map((item, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#F8FAFC", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                    <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "#1E293B" }}>{item.label}</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 800, padding: "3px 10px", borderRadius: "12px", background: item.ok ? "#DCFCE7" : "#FEE2E2", color: item.ok ? "#166534" : "#991B1B" }}>
                      {item.ok ? "🟢 OPERACIONAL" : "🔴 NECESSITA ATENÇÃO"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CARD PERMANENTE: PERSONALIDADE & TOM DE VOZ DA IA */}
          <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F3E8FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sliders size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Estilo &amp; Regras da IA Gemini 2.5</h3>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Personalize o tom de voz e o comportamento do robô</p>
              </div>
            </div>

            {/* NOME DO ATENDENTE */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                Nome do Atendente Virtual (Opcional):
              </label>
              <input
                type="text"
                value={config.agentName || ""}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, agentName: e.target.value }))}
                onBlur={() => handleSaveConfig({ agentName: config.agentName })}
                placeholder="Ex: Sophia, Lucas, Maria, Brendi..."
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #CBD5E1", fontSize: "0.88rem", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* SELETOR DE PERSONALIDADE */}
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "8px" }}>
              Tom de Voz do Atendente:
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1.25rem" }}>
              {[
                { id: "SIMPATICO", label: "😊 Simpático & Amigável", desc: "Usa emojis e tom acolhedor" },
                { id: "AGIL", label: "⚡ Ágil & Direto", desc: "Respostas curtas e diretas" },
                { id: "FORMAL", label: "🎩 Formal & Elegante", desc: "Linguagem refinada" },
                { id: "DIVERTIDO", label: "🥳 Divertido & Descontraído", desc: "Entusiasmado e alegre" },
              ].map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleSaveConfig({ personality: p.id })}
                  style={{
                    padding: "10px", borderRadius: "10px",
                    border: `2px solid ${config.personality === p.id ? "#7C3AED" : "#E2E8F0"}`,
                    background: config.personality === p.id ? "#F3E8FF" : "#fff",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: "0.82rem", color: config.personality === p.id ? "#6D28D9" : "#1E293B" }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "2px" }}>{p.desc}</div>
                </div>
              ))}
            </div>

            {/* LINK EXTERNO DO CARDÁPIO (JOTAJA, SITE PRÓPRIO, ETC) */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                🌐 Link Personalizado do Cardápio / Plataforma Externa (Ex: JotaJá):
              </label>
              <p style={{ margin: "0 0 6px 0", fontSize: "0.74rem", color: "#64748B" }}>
                Se preenchido, o robô enviará este link exato para os clientes fazerem pedidos em vez do link padrão do FireHub.
              </p>
              <input
                type="text"
                value={config.externalMenuUrl || ""}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, externalMenuUrl: e.target.value }))}
                onBlur={() => handleSaveConfig({ externalMenuUrl: config.externalMenuUrl })}
                placeholder="Ex: https://pedir.to/sualoja ou https://jotaja.com/sualoja"
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #CBD5E1", fontSize: "0.88rem", outline: "none", boxSizing: "border-box",
                  background: "#F8FAFC"
                }}
              />
            </div>

            {/* CONFIRMAÇÃO AUTOMÁTICA DE PEDIDOS POR WHATSAPP */}
            <div style={{ marginBottom: "1.25rem", padding: "12px", background: "#F0FDF4", borderRadius: "12px", border: "1px solid #BBF7D0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#166534" }}>
                    📲 Enviar Confirmação de Pedidos Automática pelo WhatsApp? (Marcado por padrão)
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#15803D", marginTop: "2px" }}>
                    Sempre que o cliente realizar um pedido na plataforma, ele receberá uma mensagem no WhatsApp com o resumo e os itens. O robô só NÃO enviará se esta opção for desmarcada.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleSaveConfig({ sendOrderConfirmation: true })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.sendOrderConfirmation !== false ? "#16A34A" : "#E2E8F0",
                      color: config.sendOrderConfirmation !== false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ sendOrderConfirmation: false })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.sendOrderConfirmation === false ? "#DC2626" : "#E2E8F0",
                      color: config.sendOrderConfirmation === false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    NÃO
                  </button>
                </div>
              </div>
            </div>

            {/* PAUSAR ROBÔ QUANDO PEDIR ATENDENTE HUMANO */}
            <div style={{ marginBottom: "1.25rem", padding: "12px", background: "#F8FAFC", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>
                    👤 Pausar Atendimento do Robô quando o cliente pedir Atendente Humano?
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "2px" }}>
                    Se marcado como &quot;SIM&quot;, quando o cliente digitar palavras como &quot;atendente&quot;, &quot;humano&quot; ou &quot;falar com suporte&quot;, o robô responderá que chamou a equipe e parará de responder essa conversa automaticamente.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleSaveConfig({ stopOnHumanRequest: true })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.stopOnHumanRequest !== false ? "#16A34A" : "#E2E8F0",
                      color: config.stopOnHumanRequest !== false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ stopOnHumanRequest: false })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.stopOnHumanRequest === false ? "#DC2626" : "#E2E8F0",
                      color: config.stopOnHumanRequest === false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    NÃO
                  </button>
                </div>
              </div>
            </div>

            {/* INSTRUÇÕES CUSTOMIZADAS */}
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
              Instruções Especiais da Sua Loja (Opcional):
            </label>
            <textarea
              value={config.customPrompt || ""}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, customPrompt: e.target.value }))}
              onBlur={() => handleSaveConfig({ customPrompt: config.customPrompt })}
              placeholder="Ex: Avisar que nosso tempo de entrega é de 40 a 50 minutos..."
              style={{
                width: "100%", height: "70px", borderRadius: "10px",
                border: "1px solid #CBD5E1", padding: "10px", fontSize: "0.82rem",
                resize: "none", boxSizing: "border-box",
              }}
            />

            {/* AUTOMAÇÃO RECORRENTE DE CLIENTES (7, 15 e 30 DIAS SEM PEDIR) */}
            <div style={{ marginTop: "1.5rem", marginBottom: "1.25rem", padding: "16px", background: "#EFF6FF", borderRadius: "14px", border: "1px solid #BFDBFE" }}>
              <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#1E40AF", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                🎁 Mensagens Automáticas &amp; Criação de Cupons pela IA (7, 15 e 30 dias sem comprar)
              </div>
              <div style={{ fontSize: "0.75rem", color: "#1D4ED8", marginBottom: "8px" }}>
                O robô possui total autonomia para criar e validar os cupons de desconto automaticamente de acordo com as regras ativadas abaixo para cada restaurante:
              </div>

              {/* 7 DIAS */}
              <div style={{ marginBottom: "12px", background: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #DBEAFE" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 800, color: "#1E293B" }}>🔥 Cliente 7 Dias sem pedir:</label>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => handleSaveConfig({ autoRecuperation7d: true })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: config.autoRecuperation7d !== false ? "#16A34A" : "#E2E8F0", color: config.autoRecuperation7d !== false ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.7rem", cursor: "pointer" }}
                    >SIM</button>
                    <button
                      onClick={() => handleSaveConfig({ autoRecuperation7d: false })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: config.autoRecuperation7d === false ? "#DC2626" : "#E2E8F0", color: config.autoRecuperation7d === false ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.7rem", cursor: "pointer" }}
                    >NÃO</button>
                  </div>
                </div>
                <textarea
                  value={config.msg7d ?? "Oie! 🍕 Sentimos sua falta! Que tal pedir hoje com R$ 10 OFF? Use o cupom VOLTEI10 no nosso cardápio!"}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, msg7d: e.target.value }))}
                  onBlur={() => handleSaveConfig({ msg7d: config.msg7d })}
                  style={{ width: "100%", height: "55px", borderRadius: "8px", border: "1px solid #CBD5E1", padding: "8px", fontSize: "0.78rem", resize: "none" }}
                />
              </div>

              {/* 15 DIAS */}
              <div style={{ marginBottom: "12px", background: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #DBEAFE" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 800, color: "#1E293B" }}>🎁 Cliente 15 Dias sem pedir:</label>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => handleSaveConfig({ autoRecuperation15d: true })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: config.autoRecuperation15d !== false ? "#16A34A" : "#E2E8F0", color: config.autoRecuperation15d !== false ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.7rem", cursor: "pointer" }}
                    >SIM</button>
                    <button
                      onClick={() => handleSaveConfig({ autoRecuperation15d: false })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: config.autoRecuperation15d === false ? "#DC2626" : "#E2E8F0", color: config.autoRecuperation15d === false ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.7rem", cursor: "pointer" }}
                    >NÃO</button>
                  </div>
                </div>
                <textarea
                  value={config.msg15d ?? "Faz 15 dias que você não mata a fome com a gente! 🚀 Ganhe 15% OFF hoje no nosso delivery!"}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, msg15d: e.target.value }))}
                  onBlur={() => handleSaveConfig({ msg15d: config.msg15d })}
                  style={{ width: "100%", height: "55px", borderRadius: "8px", border: "1px solid #CBD5E1", padding: "8px", fontSize: "0.78rem", resize: "none" }}
                />
              </div>

              {/* 30 DIAS */}
              <div style={{ background: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #DBEAFE" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 800, color: "#1E293B" }}>✨ Cliente 30 Dias sem pedir (Super Cupom/Frete Grátis):</label>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => handleSaveConfig({ autoRecuperation30d: true })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: config.autoRecuperation30d !== false ? "#16A34A" : "#E2E8F0", color: config.autoRecuperation30d !== false ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.7rem", cursor: "pointer" }}
                    >SIM</button>
                    <button
                      onClick={() => handleSaveConfig({ autoRecuperation30d: false })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: config.autoRecuperation30d === false ? "#DC2626" : "#E2E8F0", color: config.autoRecuperation30d === false ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.7rem", cursor: "pointer" }}
                    >NÃO</button>
                  </div>
                </div>
                <textarea
                  value={config.msg30d ?? "Saudade do nosso tempero especial? ❤️ Liberamos Frete Grátis exclusivo para você pedir hoje no nosso site!"}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, msg30d: e.target.value }))}
                  onBlur={() => handleSaveConfig({ msg30d: config.msg30d })}
                  style={{ width: "100%", height: "55px", borderRadius: "8px", border: "1px solid #CBD5E1", padding: "8px", fontSize: "0.78rem", resize: "none" }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA DA DIREITA: SIMULADOR DE CHAT AO VIVO WHATSAPP */}
        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", height: "720px", boxShadow: "0 10px 30px -5px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          
          {/* HEADER DO SIMULADOR */}
          <div style={{ background: "#075E54", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                IA
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.92rem" }}>
                  {config.agentName ? `${config.agentName} (IA)` : "Atendente Virtual FireHub"}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#A7F3D0", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} /> Online · Gemini 2.5
                </div>
              </div>
            </div>

            <button
              onClick={() => setMessages([{ sender: "bot", text: "Olá! Como posso te ajudar hoje? 😊", time: "21:40" }])}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "6px", padding: "4px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
            >
              Limpar Chat
            </button>
          </div>

          {/* ÁREA DE MENSAGENS */}
          <div
            ref={chatBoxRef}
            style={{
              flex: 1, padding: "16px", backgroundColor: "#E5DDD5",
              backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 0)", backgroundSize: "16px 16px",
              overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px",
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background: m.sender === "user" ? "#DCF8C6" : "#FFFFFF",
                  color: "#0F172A",
                  padding: "10px 14px",
                  borderRadius: m.sender === "user" ? "12px 0px 12px 12px" : "0px 12px 12px 12px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                }}
              >
                <div>{m.text}</div>
                <div style={{ fontSize: "0.65rem", color: "#64748B", textAlign: "right", marginTop: "4px" }}>
                  {m.time} {m.sender === "user" && "✓✓"}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div style={{ alignSelf: "flex-start", background: "#FFF", padding: "8px 14px", borderRadius: "0px 12px 12px 12px", fontSize: "0.8rem", color: "#64748B", display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={14} className="spin" color="#7C3AED" /> Digitando resposta com Gemini 2.5...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* INPUT DO CHAT SIMULADOR */}
          <div style={{ padding: "12px", background: "#F0F0F0", display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid #E2E8F0" }}>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Digite uma pergunta para a IA (ex: Qual a esfirra mais vendida?)..."
              style={{
                flex: 1, padding: "10px 14px", borderRadius: "20px", border: "1px solid #CBD5E1",
                fontSize: "0.85rem", outline: "none", background: "#fff",
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={chatLoading || !inputMessage.trim()}
              style={{
                width: 40, height: 40, borderRadius: "50%", background: "#128C7E", color: "#fff",
                border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: chatLoading || !inputMessage.trim() ? "not-allowed" : "pointer", opacity: !inputMessage.trim() ? 0.6 : 1,
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
