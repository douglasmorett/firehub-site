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
} from "lucide-react";

export default function ChatbotHubClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>({
    active: true,
    connected: false,
    phone: "",
    pairingCode: "",
    personality: "SIMPATICO",
    customPrompt: "",
    autoOrderLink: true,
  });
  const [stats, setStats] = useState<any>({
    productCount: 0,
    categoryCount: 0,
    storeName: "Minha Loja",
    storeAddress: "",
    city: "",
  });

  // QR Code State
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string>("");
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

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

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, chatLoading]);

  // Salvar configurações
  const handleSaveConfig = async (newConfig: any) => {
    const updated = { ...config, ...newConfig };
    setConfig(updated);
    try {
      setSaving(true);
      await fetch("/api/chatbot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      console.error("Erro ao salvar config:", err);
    } finally {
      setSaving(false);
    }
  };

  // Simular Conexão / Desconexão WhatsApp
  const handleToggleConnect = async () => {
    try {
      setIsRefreshingQr(true);
      const action = config.connected ? "disconnect" : "connect";
      const res = await fetch("/api/chatbot/qrcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, phone: "+55 (21) 98765-4321" }),
      }).then((r) => r.json());

      if (res.success) {
        setConfig((prev: any) => ({
          ...prev,
          connected: res.connected,
          phone: res.config?.phone || "",
        }));
      }
    } catch (err) {
      console.error("Erro na conexão WhatsApp:", err);
    } finally {
      setIsRefreshingQr(false);
    }
  };

  // Enviar mensagem no simulador ao vivo
  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || inputMessage;
    if (!textToSend.trim() || chatLoading) return;

    const userTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const userMsg = { sender: "user" as const, text: textToSend, time: userTime };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInputMessage("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chatbot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history: messages.map((m) => ({ sender: m.sender === "user" ? "Cliente" : "Atendente", text: m.text })),
        }),
      }).then((r) => r.json());

      const botTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const botMsg = {
        sender: "bot" as const,
        text: res.reply || "Desculpe, tive um pequeno problema. Pode tentar novamente?",
        time: botTime,
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error("Erro no chat simulador:", err);
    } finally {
      setChatLoading(false);
    }
  };

  const copyPairingCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <RefreshCw size={36} style={{ animation: "spin 1s linear infinite", color: "#3B82F6", marginBottom: "1rem" }} />
          <p style={{ fontWeight: 600, color: "#64748B" }}>Carregando Central do Chatbot IA...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.5rem" }}>
      {/* ─── BANNER PRINCIPAL ─── */}
      <div
        style={{
          background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 50%, #312E81 100%)",
          borderRadius: "20px",
          padding: "2rem",
          color: "#fff",
          marginBottom: "2rem",
          boxShadow: "0 20px 40px -15px rgba(49, 46, 129, 0.4)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "700px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(99, 102, 241, 0.2)", border: "1px solid rgba(129, 140, 248, 0.4)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.8rem", fontWeight: 700, color: "#A5B4FC", marginBottom: "12px" }}>
            <Sparkles size={14} /> Gemini 2.5 High Precision Engine
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 8px 0", letterSpacing: "-0.5px" }}>
            🤖 Chatbot IA para WhatsApp
          </h1>
          <p style={{ fontSize: "0.95rem", color: "#C7D2FE", margin: 0, lineHeight: "1.5" }}>
            Conecte seu WhatsApp com 1 clique por QR Code. Sua inteligência artificial atende clientes 24/7, apresenta o cardápio atualizado ao vivo e responde de forma humana e sem erros.
          </p>
        </div>

        {/* STATUS BADGE */}
        <div style={{ background: "rgba(255, 255, 255, 0.08)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "16px", padding: "16px 24px", display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: 48, height: 48, borderRadius: "12px", background: config.connected ? "#10B981" : "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {config.connected ? <CheckCircle2 size={26} color="#fff" /> : <QrCode size={26} color="#fff" />}
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "1px", color: "#94A3B8", fontWeight: 700 }}>Status do WhatsApp</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>
              {config.connected ? "Conectado e Ativo" : "Aguardando Leitura"}
            </div>
            {config.phone && <div style={{ fontSize: "0.8rem", color: "#A7F3D0" }}>{config.phone}</div>}
          </div>
        </div>
      </div>

      {/* ─── CONTEÚDO PRINCIPAL (GRID 2 COLUNAS) ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "1.5rem" }}>
        
        {/* COLUNA DA ESQUERDA: QR CODE & CONFIGURAÇÕES */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* CARD 1: PAREAMENTO WHATSAPP (QR CODE & PAIRING CODE) */}
          <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#DCFCE7", color: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Smartphone size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Vincular WhatsApp da Loja</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Escaneie o QR Code no seu celular ou use o código</p>
                </div>
              </div>
              <button
                onClick={handleToggleConnect}
                disabled={isRefreshingQr}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "none",
                  background: config.connected ? "#FEE2E2" : "#25D366",
                  color: config.connected ? "#DC2626" : "#fff",
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {config.connected ? (
                  <>
                    <Unlink size={14} /> Desconectar
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Simular Conexão
                  </>
                )}
              </button>
            </div>

            {!config.connected ? (
              <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "1.5rem", textAlign: "center", border: "1px dashed #CBD5E1" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem" }}>
                  {qrCodeUrl ? (
                    <div style={{ padding: "12px", background: "#fff", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" }}>
                      <img src={qrCodeUrl} alt="QR Code WhatsApp" style={{ width: "200px", height: "200px", display: "block" }} />
                    </div>
                  ) : (
                    <div style={{ width: 200, height: 200, background: "#E2E8F0", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                      Gerando QR Code...
                    </div>
                  )}
                </div>

                <div style={{ fontSize: "0.85rem", color: "#334155", fontWeight: 700, marginBottom: "8px" }}>
                  1. Abra o WhatsApp no celular 📱
                </div>
                <div style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: "16px" }}>
                  Vá em <strong>Configurações &gt; Aparelhos conectados &gt; Conectar um aparelho</strong> e aponte para a imagem acima.
                </div>

                {/* PAIRING CODE ALTERNATIVO */}
                {pairingCode && (
                  <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "10px", padding: "12px", display: "inline-flex", alignItems: "center", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "#1D4ED8", fontWeight: 800 }}>Código de Pareamento</div>
                      <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#1E40AF", letterSpacing: "2px" }}>{pairingCode}</div>
                    </div>
                    <button
                      onClick={copyPairingCode}
                      style={{ background: "#3B82F6", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}
                    >
                      {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: "#F0FDF4", borderRadius: "12px", padding: "1.25rem", border: "1px solid #BBF7D0", display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                  WA
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#166534" }}>WhatsApp Vinculado com Sucesso!</div>
                  <div style={{ fontSize: "0.8rem", color: "#15803D" }}>A IA está respondendo mensagens automaticamente nesta conta.</div>
                </div>
              </div>
            )}
          </div>

          {/* CARD 2: CONTEXTO E CARDÁPIO SINCRONIZADO */}
          <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#E0E7FF", color: "#4338CA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <UtensilsCrossed size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Cardápio &amp; Dados Sincronizados</h3>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Sua IA consulta seu banco de dados em tempo real</p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "1rem" }}>
              <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "10px", border: "1px solid #E2E8F0", textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#3B82F6" }}>{stats.productCount}</div>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>Produtos no Cardápio</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "10px", border: "1px solid #E2E8F0", textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#8B5CF6" }}>{stats.categoryCount}</div>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>Categorias Ativas</div>
              </div>
            </div>

            <div style={{ fontSize: "0.82rem", color: "#475569", background: "#F1F5F9", padding: "10px 12px", borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldCheck size={16} color="#16A34A" />
              <span>Sempre que você alterar um preço ou criar um produto no cardápio, a IA aprende na mesma hora!</span>
            </div>
          </div>

          {/* CARD 3: PERSONALIDADE & REGRAS DA IA */}
          <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F3E8FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sliders size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Estilo &amp; Regras de Atendimento</h3>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Personalize o tom de voz do seu atendente virtual</p>
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
                placeholder="Ex: Brendi, Sophia, Lucas, Maria..."
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid #CBD5E1",
                  fontSize: "0.88rem",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "4px" }}>
                A IA vai se identificar com este nome nas saudações e conversas (Ex: &quot;Olá! Sou a Brendi...&quot;)
              </div>
            </div>

            {/* SELETOR DE PERSONALIDADE */}
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "8px" }}>
              Tom de Voz do Atendente:
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1.25rem" }}>
              {[
                { id: "SIMPATICO", label: "😊 Simpático & Amigável", desc: "Usa emojis, tom acolhedor e sugere produtos" },
                { id: "AGIL", label: "⚡ Ágil & Direto", desc: "Respostas curtas e sem enrolação" },
                { id: "FORMAL", label: "🎩 Formal & Elegante", desc: "Linguagem refinada e executiva" },
                { id: "DIVERTIDO", label: "🥳 Divertido & Descontraído", desc: "Entusiasmado e alegre" },
              ].map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleSaveConfig({ personality: p.id })}
                  style={{
                    padding: "10px",
                    borderRadius: "10px",
                    border: `2px solid ${config.personality === p.id ? "#7C3AED" : "#E2E8F0"}`,
                    background: config.personality === p.id ? "#F3E8FF" : "#fff",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: "0.82rem", color: config.personality === p.id ? "#6D28D9" : "#1E293B" }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "2px" }}>{p.desc}</div>
                </div>
              ))}
            </div>

            {/* INSTRUÇÕES CUSTOMIZADAS */}
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
              Instruções Especiais da Sua Loja (Opcional):
            </label>
            <textarea
              value={config.customPrompt || ""}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, customPrompt: e.target.value }))}
              onBlur={() => handleSaveConfig({ customPrompt: config.customPrompt })}
              placeholder="Ex: Avisar que nosso tempo de entrega é de 40 a 50 minutos. Oferecer molho especial nas esfirras..."
              style={{
                width: "100%",
                height: "80px",
                borderRadius: "10px",
                border: "1px solid #CBD5E1",
                padding: "10px",
                fontSize: "0.82rem",
                fontFamily: "inherit",
                resize: "none",
                marginBottom: "1rem",
                boxSizing: "border-box",
              }}
            />

            {/* TOGGLE LINK DO CARRINHO */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F8FAFC", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
              <div>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0F172A" }}>Enviar Link do Cardápio com 1-Clique</div>
                <div style={{ fontSize: "0.72rem", color: "#64748B" }}>Envia o link do cardápio digital quando o cliente quer pedir</div>
              </div>
              <input
                type="checkbox"
                checked={config.autoOrderLink !== false}
                onChange={(e) => handleSaveConfig({ autoOrderLink: e.target.checked })}
                style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#7C3AED" }}
              />
            </div>

            {/* TOGGLE PERMITIR PEDIDO NO WHATSAPP */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F8FAFC", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E2E8F0", marginTop: "8px" }}>
              <div>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0F172A" }}>Aceitar Fazer Pedido pelo WhatsApp</div>
                <div style={{ fontSize: "0.72rem", color: "#64748B" }}>Se desligado, avisa que o pedido é no site. Se ligado, pergunta se deseja chamar um atendente.</div>
              </div>
              <input
                type="checkbox"
                checked={config.allowWhatsappOrders === true}
                onChange={(e) => handleSaveConfig({ allowWhatsappOrders: e.target.checked })}
                style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#7C3AED" }}
              />
            </div>
          </div>
        </div>

        {/* COLUNA DA DIREITA: SIMULADOR DE CHAT AO VIVO WHATSAPP */}
        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", height: "720px", boxShadow: "0 10px 30px -5px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          
          {/* HEADER DO WHATSAPP */}
          <div style={{ background: "#075E54", color: "#fff", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#128C7E", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "1.1rem" }}>
              🤖
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: "1rem" }}>{stats.storeName} — {config.agentName ? config.agentName : "Atendente IA"}</div>
              <div style={{ fontSize: "0.75rem", color: "#25D366", display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#25D366" }}></span>
                online • Gemini High Precision
              </div>
            </div>
            <button
              onClick={() => setMessages([{ sender: "bot", text: "Conversa reiniciada! Como posso te ajudar?", time: "21:40" }])}
              title="Reiniciar chat"
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", padding: "6px 10px", borderRadius: "8px", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}
            >
              Limpar
            </button>
          </div>

          {/* ÁREA DE MENSAGENS */}
          <div ref={chatBoxRef} style={{ flex: 1, padding: "1.25rem", background: "#E5DDD5", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
            {messages.map((m, index) => (
              <div
                key={index}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background: m.sender === "user" ? "#DCF8C6" : "#FFFFFF",
                  borderRadius: m.sender === "user" ? "12px 12px 0 12px" : "12px 12px 12px 0",
                  padding: "10px 14px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                  fontSize: "0.88rem",
                  color: "#303030",
                  lineHeight: "1.4",
                  whiteSpace: "pre-wrap",
                  position: "relative",
                }}
              >
                <div>{m.text}</div>
                <div style={{ fontSize: "0.65rem", color: "#8C8C8C", textAlign: "right", marginTop: "4px" }}>
                  {m.time} {m.sender === "user" && "✓✓"}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div style={{ alignSelf: "flex-start", background: "#FFFFFF", borderRadius: "12px 12px 12px 0", padding: "10px 14px", fontSize: "0.82rem", color: "#64748B", display: "flex", alignItems: "center", gap: "8px" }}>
                <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
                <span>Atendente IA digitando...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* PROMPTS RÁPIDOS DE TESTE */}
          <div style={{ background: "#F0F0F0", padding: "8px 12px", borderTop: "1px solid #DDD", display: "flex", gap: "6px", overflowX: "auto" }}>
            {[
              "Qual o cardápio de hoje?",
              "Quais são os refrigerantes?",
              "Qual o endereço da loja?",
              "Quero fazer um pedido!",
            ].map((q, i) => (
              <button
                key={i}
                onClick={() => handleSendMessage(q)}
                style={{
                  whiteSpace: "nowrap",
                  padding: "4px 10px",
                  borderRadius: "14px",
                  border: "1px solid #CBD5E1",
                  background: "#fff",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                💬 {q}
              </button>
            ))}
          </div>

          {/* BARRA DE ENVIO DE MENSAGEM */}
          <div style={{ padding: "10px 12px", background: "#F0F0F0", borderTop: "1px solid #DDD", display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Digite uma mensagem para testar a IA..."
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: "20px",
                border: "1px solid #CCC",
                fontSize: "0.88rem",
                outline: "none",
                background: "#fff",
              }}
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={chatLoading || !inputMessage.trim()}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#075E54",
                color: "#fff",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: chatLoading || !inputMessage.trim() ? "default" : "pointer",
                opacity: chatLoading || !inputMessage.trim() ? 0.5 : 1,
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
