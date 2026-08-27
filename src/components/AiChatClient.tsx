"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Sparkles, Trash2, BarChart3, FileText, DollarSign, Users } from "lucide-react";

type Message = {
  role: "user" | "ai";
  content: string;
};

const SUGGESTIONS = [
  { icon: <BarChart3 size={16} />, text: "Relatório financeiro do mês" },
  { icon: <FileText size={16} />, text: "Resumo de todas as notas fiscais" },
  { icon: <DollarSign size={16} />, text: "Contas pendentes a vencer" },
  { icon: <Users size={16} />, text: "Lista de lojistas e pedidos" },
];

export default function AiChatClient() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "ai", content: "Olá! Sou o **FireHub IA**, seu assistente administrativo inteligente. 🤖\n\nTenho acesso a todos os dados do sistema — pedidos, notas fiscais, contas a pagar, lojistas, produtos e muito mais.\n\nComo posso te ajudar?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: msg, 
          history: messages.filter(m => m.role !== "ai" || messages.indexOf(m) > 0) 
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        setMessages(prev => [...prev, { role: "ai", content: `❌ ${data.error || "Erro ao processar sua mensagem."}` }]);
      } else {
        setMessages(prev => [...prev, { role: "ai", content: data.reply }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "ai", content: "❌ Erro de conexão com o servidor." }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([
      { role: "ai", content: "Conversa limpa! Como posso ajudar? 🤖" }
    ]);
  };

  // Renderizar markdown simples
  const renderContent = (text: string) => {
    // ESCAPA o HTML ANTES de aplicar o markdown: sem isto, um conteúdo com
    // `<img src=x onerror=...>` (a IA ecoando entrada do usuário, ou texto
    // colado) era injetado como HTML executável no dangerouslySetInnerHTML.
    // Depois de escapar, só as tags que ESTE código gera (<strong>/<em>/
    // <code>/<br>) chegam ao DOM.
    const escapado = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escapado
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:0.85em">$1</code>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 4rem)", maxHeight: "calc(100vh - 4rem)" }}>
      
      {/* Header */}
      <div style={{ 
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "1rem", flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ 
            width: "48px", height: "48px", borderRadius: "16px",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 15px rgba(102, 126, 234, 0.4)"
          }}>
            <Sparkles size={24} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>FireHub IA</h1>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
              Assistente administrativo • Gemini 2.5 Pro
            </p>
          </div>
        </div>
        <button 
          onClick={handleClear}
          style={{ 
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444", padding: "8px 16px", borderRadius: "8px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem"
          }}
        >
          <Trash2 size={16} /> Limpar
        </button>
      </div>

      {/* Messages Area */}
      <div style={{ 
        flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px",
        padding: "16px", borderRadius: "16px",
        backgroundColor: "var(--surface)", border: "1px solid var(--border-color)",
        marginBottom: "1rem"
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ 
            display: "flex", gap: "12px",
            flexDirection: msg.role === "user" ? "row-reverse" : "row",
            alignItems: "flex-start"
          }}>
            {/* Avatar */}
            <div style={{ 
              width: "36px", height: "36px", borderRadius: "12px", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: msg.role === "user" 
                ? "linear-gradient(135deg, #f97316, #ef4444)" 
                : "linear-gradient(135deg, #667eea, #764ba2)",
            }}>
              {msg.role === "user" ? <User size={18} color="white" /> : <Bot size={18} color="white" />}
            </div>
            
            {/* Bubble */}
            <div style={{ 
              maxWidth: "75%", padding: "14px 18px", borderRadius: "16px",
              backgroundColor: msg.role === "user" ? "var(--primary)" : "var(--bg-color)",
              color: msg.role === "user" ? "white" : "var(--text-main)",
              border: msg.role === "user" ? "none" : "1px solid var(--border-color)",
              fontSize: "0.95rem", lineHeight: "1.6",
              boxShadow: msg.role === "user" ? "0 2px 8px rgba(249,115,22,0.3)" : "0 1px 4px rgba(0,0,0,0.05)"
            }}
              dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
            />
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <div style={{ 
              width: "36px", height: "36px", borderRadius: "12px", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, #667eea, #764ba2)",
            }}>
              <Bot size={18} color="white" />
            </div>
            <div style={{ 
              padding: "14px 18px", borderRadius: "16px",
              backgroundColor: "var(--bg-color)", border: "1px solid var(--border-color)",
              display: "flex", alignItems: "center", gap: "8px", color: "var(--text-muted)"
            }}>
              <Loader2 size={18} className="animate-spin" /> Analisando dados do sistema...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions (only show when few messages) */}
      {messages.length <= 2 && (
        <div style={{ 
          display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px", flexShrink: 0
        }}>
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => handleSend(s.text)} disabled={loading} style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "8px 14px", borderRadius: "20px", fontSize: "0.85rem",
              backgroundColor: "var(--surface)", border: "1px solid var(--border-color)",
              color: "var(--text-muted)", cursor: "pointer",
              transition: "all 0.2s"
            }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.color = "var(--primary)"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {s.icon} {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div style={{ 
        display: "flex", gap: "8px", flexShrink: 0,
        padding: "12px", borderRadius: "16px",
        backgroundColor: "var(--surface)", border: "1px solid var(--border-color)",
        boxShadow: "0 -2px 10px rgba(0,0,0,0.05)"
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte qualquer coisa sobre o sistema..."
          disabled={loading}
          rows={1}
          style={{ 
            flex: 1, padding: "12px 16px", borderRadius: "12px", resize: "none",
            border: "1px solid var(--border-color)", backgroundColor: "var(--bg-color)",
            color: "var(--text-main)", fontSize: "1rem", outline: "none",
            minHeight: "48px", maxHeight: "120px"
          }}
        />
        <button 
          onClick={() => handleSend()} 
          disabled={loading || !input.trim()}
          style={{ 
            width: "48px", height: "48px", borderRadius: "12px", border: "none",
            background: input.trim() ? "linear-gradient(135deg, #667eea, #764ba2)" : "var(--border-color)",
            color: "white", cursor: input.trim() ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s", flexShrink: 0
          }}
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
        </button>
      </div>
    </div>
  );
}
