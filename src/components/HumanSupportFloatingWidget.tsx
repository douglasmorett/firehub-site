"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ehTelaSemWidget } from "@/lib/telas-sem-widget";
import { MessageSquare, X, Send, User, CheckCircle2, Bot, ShieldCheck } from "lucide-react";

export default function HumanSupportFloatingWidget() {
  // Este botão é montado no layout de /store inteiro, então aparecia também na
  // mesa, no balcão e no KDS — fixo no canto inferior direito, em cima do Total
  // e do "Fechar Conta". Num tablet de garçom, o dedo mirava o valor da mesa e
  // abria o chat de suporte.
  const pathname = usePathname();
  const escondido = ehTelaSemWidget(pathname);

  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<any[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [selectedChatJid, setSelectedChatJid] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const fetchChats = async () => {
    try {
      const res = await fetch("/api/chatbot/human-support").then((r) => r.json());
      if (res.success) {
        setChats(res.chats || []);
        setTotalUnread(res.totalUnread || 0);
      }
    } catch (e) {}
  };

  useEffect(() => {
    // Escondido não significa só invisível: sem isto, o tablet do garçom e a TV
    // do KDS continuariam pedindo a lista de conversas a cada 4 segundos, o dia
    // inteiro, para desenhar um botão que ninguém vê.
    if (escondido) return;
    fetchChats();
    const interval = setInterval(fetchChats, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escondido]);

  const activeChat = chats.find((c) => c.jid === selectedChatJid);

  const handleOpenChat = async (jid: string) => {
    setSelectedChatJid(jid);
    await fetch("/api/chatbot/human-support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", jid }),
    }).catch(() => {});
    fetchChats();
  };

  const handleSendReply = async () => {
    if (!selectedChatJid || !replyText.trim() || sending) return;
    setSending(true);

    try {
      const res = await fetch("/api/chatbot/human-support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          jid: selectedChatJid,
          message: replyText,
        }),
      });

      if (res.ok) {
        setReplyText("");
        fetchChats();
      }
    } catch (e) {
    } finally {
      setSending(false);
    }
  };

  const handleCloseSupport = async (jid: string) => {
    try {
      await fetch("/api/chatbot/human-support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_chat", jid }),
      });
      if (selectedChatJid === jid) setSelectedChatJid(null);
      fetchChats();
    } catch (e) {}
  };

  if (escondido) return null;

  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, fontFamily: "sans-serif" }}>
      {/* JANELA DO CHAT DE SUPORTE */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "70px",
            right: "0",
            width: "380px",
            maxHeight: "560px",
            height: "520px",
            background: "#fff",
            borderRadius: "16px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
            border: "1px solid #E2E8F0",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* HEADER DO WIDGET */}
          <div style={{ background: "linear-gradient(135deg, #DC2626, #B91C1C)", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <MessageSquare size={20} />
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>Atendimento Humano WhatsApp</div>
                <div style={{ fontSize: "0.72rem", color: "#FECACA" }}>
                  {chats.length === 0
                    ? "Nenhum cliente aguardando no momento"
                    : `${chats.length} ${chats.length === 1 ? "cliente solicitando" : "clientes solicitando"} atendimento`}
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}>
              <X size={20} />
            </button>
          </div>

          {/* LISTA DE CHATS OU CONVERSA SELECIONADA */}
          {!selectedChatJid ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px", background: "#F8FAFC" }}>
              {chats.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748B" }}>
                  <CheckCircle2 size={40} color="#16A34A" style={{ marginBottom: "12px" }} />
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1E293B" }}>Tudo em dia!</div>
                  <div style={{ fontSize: "0.78rem", marginTop: "4px" }}>Quando um cliente pedir atendente no WhatsApp, a notificação com número piscará aqui.</div>
                </div>
              ) : (
                chats.map((c) => (
                  <div
                    key={c.jid}
                    onClick={() => handleOpenChat(c.jid)}
                    style={{
                      background: "#fff",
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: "1px solid #E2E8F0",
                      marginBottom: "10px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, overflow: "hidden" }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#FEE2E2", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                        <User size={18} />
                      </div>
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>{c.clientName || c.phone || "Cliente WhatsApp"}</div>
                        {/* Numa fila de dez, o motivo é o que diz por onde começar:
                            quem está reclamando de atraso não pode esperar a vez. */}
                        {c.motivo && (
                          <div style={{ display: "inline-block", background: "#FEE2E2", color: "#B91C1C", fontSize: "0.68rem", fontWeight: 800, padding: "1px 7px", borderRadius: 6, margin: "2px 0" }}>
                            {c.motivo}
                          </div>
                        )}
                        <div style={{ fontSize: "0.75rem", color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.lastMessage}</div>
                      </div>
                    </div>

                    {c.unreadCount > 0 && (
                      <span style={{ background: "#DC2626", color: "#fff", fontSize: "0.72rem", fontWeight: 800, padding: "2px 8px", borderRadius: "10px", marginLeft: "8px" }}>
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            /* CONVERSA INDIVIDUAL SELECIONADA */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#E5DDD5" }}>
              {/* SUB-HEADER DA CONVERSA */}
              <div style={{ background: "#fff", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button onClick={() => setSelectedChatJid(null)} style={{ background: "#F1F5F9", border: "none", padding: "4px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", color: "#475569" }}>
                  ← Voltar
                </button>

                <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0F172A" }}>{activeChat?.phone}</div>

                <button
                  onClick={() => handleCloseSupport(selectedChatJid)}
                  style={{ background: "#DCFCE7", border: "1px solid #BBF7D0", color: "#166534", padding: "4px 10px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer" }}
                >
                  ✓ Encerrar &amp; Reativar Robô
                </button>
              </div>

              {/* ÁREA DE MENSAGENS */}
              <div style={{ flex: 1, padding: "12px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                {activeChat?.messages.map((m: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: m.sender === "attendant" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      background: m.sender === "attendant" ? "#DCF8C6" : "#FFFFFF",
                      color: "#0F172A",
                      padding: "8px 12px",
                      borderRadius: m.sender === "attendant" ? "10px 0px 10px 10px" : "0px 10px 10px 10px",
                      fontSize: "0.82rem",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                    }}
                  >
                    {m.text}
                  </div>
                ))}
              </div>

              {/* INPUT DE RESPOSTA */}
              <div style={{ padding: "10px", background: "#fff", borderTop: "1px solid #E2E8F0", display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendReply()}
                  placeholder="Responder ao cliente no WhatsApp..."
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "20px", border: "1px solid #CBD5E1", fontSize: "0.82rem", outline: "none" }}
                />
                <button
                  onClick={handleSendReply}
                  disabled={sending || !replyText.trim()}
                  style={{ width: 36, height: 36, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BALÃOZINHO FLUTUANTE DE NOTIFICAÇÃO (BOTÃO REDONDO) */}
      {/* O numerinho já piscava, mas um número de 22px no canto da tela não
          chama ninguém que está olhando a cozinha. Com cliente esperando, o
          botão inteiro ganha um anel que se expande — visível de longe, e só
          quando há alguém de fato aguardando. */}
      <style>{`@keyframes firehubChamando{0%{transform:scale(1);opacity:.65}100%{transform:scale(1.9);opacity:0}}`}</style>
      {totalUnread > 0 && !open && (
        <span
          aria-hidden
          style={{
            position: "absolute", bottom: 0, right: 0, width: 56, height: 56,
            borderRadius: "50%", background: "#DC2626", pointerEvents: "none",
            animation: "firehubChamando 1.6s ease-out infinite",
          }}
        />
      )}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #DC2626, #B91C1C)",
          color: "#fff",
          border: "none",
          boxShadow: "0 8px 24px rgba(220, 38, 38, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
          transition: "transform 0.2s",
        }}
      >
        <MessageSquare size={26} />

        {/* NUMERINHO DE NOTIFICAÇÃO NÃO LIDA (SÓ SUME AO ABRIR/VISUALIZAR) */}
        {totalUnread > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              background: "#EF4444",
              color: "#fff",
              border: "2px solid #fff",
              borderRadius: "50%",
              width: "22px",
              height: "22px",
              fontSize: "0.75rem",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
              animation: "pulse 1.5s infinite",
            }}
          >
            {totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
