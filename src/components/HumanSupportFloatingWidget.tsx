"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ehTelaSemWidget } from "@/lib/telas-sem-widget";
import { useArrastavel } from "@/lib/useArrastavel";
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

  // ── O ROBÔ ATENDENDO, AO VIVO ────────────────────────────────────────────
  // A aba de cima mostra quem CHAMOU uma pessoa. Esta mostra todo mundo com
  // quem o robô está falando agora — é o pedido do lojista que quer acompanhar
  // o atendimento sem abrir o WhatsApp no celular.
  const [aba, setAba] = useState<"fila" | "robo">("fila");
  const [conversas, setConversas] = useState<any[]>([]);
  const [conversaAberta, setConversaAberta] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<any[]>([]);
  const [pausado, setPausado] = useState(false);
  const [mudandoPausa, setMudandoPausa] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState("");
  const [carregandoConversas, setCarregandoConversas] = useState(true);
  /** Sem acesso às conversas (funcionário sem a permissão do painel de pedidos). */
  const [semAcesso, setSemAcesso] = useState(false);
  const fimDaConversa = useRef<HTMLDivElement | null>(null);
  /** Qual conversa está na tela AGORA — para descartar resposta que chega atrasada. */
  const conversaAbertaRef = useRef<string | null>(null);

  const fetchConversas = async () => {
    try {
      const r = await fetch("/api/chatbot/conversas");
      if (r.status === 401 || r.status === 403) {
        setSemAcesso(true);
        return;
      }
      const res = await r.json();
      if (res.success) {
        setConversas(res.conversas || []);
        setSemAcesso(false);
      }
    } catch (e) {
    } finally {
      setCarregandoConversas(false);
    }
  };

  const fetchMensagens = async (jid: string) => {
    try {
      const res = await fetch(`/api/chatbot/conversas?jid=${encodeURIComponent(jid)}`).then((r) => r.json());
      // A resposta demora e o lojista pode já ter voltado ou aberto OUTRA
      // conversa: sem esta conferência, o histórico do João aparecia dentro da
      // conversa da Maria.
      if (conversaAbertaRef.current !== jid) return;
      if (res.success) {
        setMensagens(res.mensagens || []);
        setPausado(!!res.pausado);
        setErroDoEnvio("");
      }
    } catch (e) {}
  };

  const abrirConversa = async (jid: string) => {
    conversaAbertaRef.current = jid;
    setConversaAberta(jid);
    setMensagens([]);
    // O texto digitado para um cliente não pode seguir para outro.
    setReplyText("");
    setErroDoEnvio("");
    const daLista = conversas.find((c) => c.remoteJid === jid);
    setPausado(!!daLista?.pausado);
    await fetchMensagens(jid);
  };

  const alternarPausa = async (jid: string, pausar: boolean) => {
    if (mudandoPausa) return;
    setMudandoPausa(true);
    try {
      const res = await fetch("/api/chatbot/conversas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pausar ? "pausar" : "retomar", jid }),
      }).then((r) => r.json());
      if (res.success) setPausado(!!res.pausado);
      fetchConversas();
    } catch (e) {
    } finally {
      setMudandoPausa(false);
    }
  };

  const enviarPelaConversa = async () => {
    if (!conversaAberta || !replyText.trim() || sending) return;
    setSending(true);
    setErroDoEnvio("");
    try {
      const res = await fetch("/api/chatbot/conversas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enviar", jid: conversaAberta, message: replyText }),
      }).then((r) => r.json());
      if (res.success) {
        setReplyText("");
        setPausado(true);
        await fetchMensagens(conversaAberta);
        fetchConversas();
      } else {
        // O texto FICA na caixa: deixar o atendente achar que o cliente foi
        // respondido é pior do que o erro em si.
        setErroDoEnvio(res.error || "Não consegui enviar. Tente de novo.");
      }
    } catch (e) {
      setErroDoEnvio("Não consegui falar com o servidor. Tente de novo.");
    } finally {
      setSending(false);
    }
  };

  // Só busca enquanto a janela está aberta na aba do robô: fechada, ninguém
  // está olhando, e são 30 lojas pedindo isto a cada quatro segundos.
  useEffect(() => {
    if (escondido || !open || aba !== "robo") return;
    fetchConversas();
    // Com a aba do navegador escondida ninguém está lendo: são ~30 lojas
    // batendo nisto, e o painel fica aberto o dia inteiro.
    const t = setInterval(() => { if (!document.hidden) fetchConversas(); }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escondido, open, aba]);

  useEffect(() => {
    if (escondido || !open || !conversaAberta) return;
    const t = setInterval(() => { if (!document.hidden) fetchMensagens(conversaAberta); }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escondido, open, conversaAberta]);

  useEffect(() => {
    // Rola a CAIXA de mensagens, não a página: scrollIntoView numa janela
    // fixa arrasta a tela do painel inteira junto.
    const caixa = fimDaConversa.current?.parentElement;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length]);

  const telefoneBonito = (t: string) => {
    const d = String(t || "").replace(/\D/g, "").replace(/^55/, "");
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return t || "";
  };

  const horaDe = (ms: number) =>
    new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const haQuantoTempo = (ms: number) => {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h`;
  };
  // Arrastar tira a bolinha de cima dos botões do pedido sem escondê-la. Fica
  // aqui em cima, junto dos outros hooks: o `return null` de `escondido` vem
  // depois, e hook que não roda em toda renderização derruba a tela.
  const arraste = useArrastavel();

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
    // ── ELE NÃO PODE FICAR EM CIMA DO "FALE CONOSCO" ─────────────────────────
    //
    // O widget de contato do FireHub (`FloatingContactWidget`, montado no layout
    // RAIZ) usa exatamente `fixed; bottom: 24px; right: 24px; z-index: 9999` —
    // o mesmo canto, o mesmo empilhamento. Os dois desenhavam um botão redondo
    // no mesmo pixel, e o de baixo ficava inalcançável: o lojista clicava no
    // balãozinho achando que era o do WhatsApp e abria "Fale conosco".
    //
    // Este sobe 76px e ganha um rótulo, para os dois conviverem e cada um dizer
    // o que é. z-index 10000 porque o outro já ocupa 9999.
    <div style={{ position: "fixed", bottom: "100px", right: "clamp(8px, 4vw, 24px)", zIndex: 10000, fontFamily: "sans-serif", ...arraste.estiloDoContainer }}>
      {/* JANELA DO CHAT DE SUPORTE */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "70px",
            right: "0",
            width: "min(380px, calc(100vw - 24px))",
            // Cabe no notebook da loja: o botão agora fica 100px acima do
            // rodapé, e com altura fixa a janela passava do topo em tela baixa.
            height: "min(520px, calc(100vh - 200px))",
            maxHeight: "calc(100vh - 200px)",
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
          <div style={{ background: "linear-gradient(135deg, #C92E09, #B71C1C)", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <MessageSquare size={20} />
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>WhatsApp da loja</div>
                <div style={{ fontSize: "0.72rem", color: "#FECACA" }}>
                  {aba === "fila"
                    ? chats.length === 0
                      ? "Nenhum cliente aguardando no momento"
                      : `${chats.length} ${chats.length === 1 ? "cliente solicitando" : "clientes solicitando"} atendimento`
                    : conversas.length === 0
                      ? "Nenhuma conversa nas últimas horas"
                      : `${conversas.length} ${conversas.length === 1 ? "conversa" : "conversas"} · ${conversas.filter((c) => !c.pausado).length} com o robô`}
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}>
              <X size={20} />
            </button>
          </div>

          {/* ABAS: quem está chamando x o robô atendendo */}
          <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
            {([
              ["fila", `🙋 Chamando${chats.length > 0 ? ` (${chats.length})` : ""}`],
              ["robo", `🤖 Robô atendendo${conversas.length > 0 ? ` (${conversas.length})` : ""}`],
            ] as const).map(([id, rotulo]) => (
              <button
                key={id}
                onClick={() => { setAba(id); setSelectedChatJid(null); conversaAbertaRef.current = null; setConversaAberta(null); setReplyText(""); setErroDoEnvio(""); }}
                style={{
                  flex: 1,
                  padding: "9px 6px",
                  border: "none",
                  cursor: "pointer",
                  background: aba === id ? "#FEF2F2" : "#fff",
                  color: aba === id ? "#B71C1C" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.74rem",
                  borderBottom: aba === id ? "2px solid #C92E09" : "2px solid transparent",
                }}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {/* ── ABA DO ROBÔ ─────────────────────────────────────────────── */}
          {aba === "robo" ? (
            !conversaAberta ? (
              <div style={{ flex: 1, overflowY: "auto", padding: "12px", background: "#F8FAFC" }}>
                {semAcesso ? (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748B" }}>
                    <ShieldCheck size={40} color="#94A3B8" style={{ marginBottom: "12px" }} />
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1E293B" }}>Sem acesso às conversas</div>
                    <div style={{ fontSize: "0.78rem", marginTop: "4px" }}>
                      O dono da loja libera em Configurações → Equipe, marcando o Painel de Pedidos para você.
                    </div>
                  </div>
                ) : carregandoConversas ? (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748B", fontSize: "0.82rem" }}>
                    Carregando as conversas...
                  </div>
                ) : conversas.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748B" }}>
                    <Bot size={40} color="#94A3B8" style={{ marginBottom: "12px" }} />
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1E293B" }}>Nenhuma conversa agora</div>
                    <div style={{ fontSize: "0.78rem", marginTop: "4px" }}>
                      Assim que alguém falar com o WhatsApp da loja, a conversa aparece aqui ao vivo — com o que o robô respondeu.
                    </div>
                  </div>
                ) : (
                  conversas.map((c) => (
                    <div
                      key={c.remoteJid}
                      onClick={() => abrirConversa(c.remoteJid)}
                      style={{
                        background: "#fff",
                        padding: "10px 12px",
                        borderRadius: "12px",
                        border: `1px solid ${c.pausado ? "#FDE68A" : "#E2E8F0"}`,
                        marginBottom: "8px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: c.pausado ? "#FFF7E6" : "#F0FDFA", color: c.pausado ? "#B45309" : "#0F766E", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {c.pausado ? <ShieldCheck size={17} /> : <Bot size={17} />}
                      </div>
                      <div style={{ overflow: "hidden", flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0F172A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {c.nome || telefoneBonito(c.telefone)}
                          </span>
                          <span style={{ fontSize: "0.68rem", color: "#94A3B8", flexShrink: 0 }}>{haQuantoTempo(c.ultimaEm)}</span>
                        </div>
                        <div style={{ fontSize: "0.74rem", color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.ultimoAutor === "bot" ? "🤖 " : "👤 "}
                          {c.ultimaMensagem}
                        </div>
                        {c.pausado && (
                          <div style={{ display: "inline-block", background: "#FFF7E6", color: "#B45309", fontSize: "0.66rem", fontWeight: 800, padding: "1px 6px", borderRadius: 5, marginTop: 3 }}>
                            robô pausado{c.motivoDaPausa ? ` · ${c.motivoDaPausa}` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#E5DDD5", minHeight: 0 }}>
                <div style={{ background: "#fff", padding: "8px 12px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <button onClick={() => { conversaAbertaRef.current = null; setConversaAberta(null); setReplyText(""); setErroDoEnvio(""); }} style={{ background: "#F1F5F9", border: "none", padding: "4px 9px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#475569" }}>
                    ← Voltar
                  </button>
                  <div style={{ fontWeight: 800, fontSize: "0.78rem", color: "#0F172A", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {conversas.find((c) => c.remoteJid === conversaAberta)?.nome ||
                      telefoneBonito(conversaAberta.split("@")[0])}
                  </div>
                  <button
                    onClick={() => alternarPausa(conversaAberta, !pausado)}
                    disabled={mudandoPausa}
                    title={pausado ? "O robô volta a responder este cliente" : "O robô para de responder este cliente até você devolver"}
                    style={{
                      background: pausado ? "#F0FDFA" : "#FFF7E6",
                      border: `1px solid ${pausado ? "#99F6E4" : "#FDE68A"}`,
                      color: pausado ? "#0F766E" : "#B45309",
                      padding: "4px 9px",
                      borderRadius: "6px",
                      fontSize: "0.7rem",
                      fontWeight: 800,
                      cursor: mudandoPausa ? "wait" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mudandoPausa ? "..." : pausado ? "▶ Voltar o robô" : "⏸ Pausar robô"}
                  </button>
                </div>

                {pausado && (
                  <div style={{ background: "#FFF7E6", color: "#92400E", fontSize: "0.72rem", fontWeight: 700, padding: "6px 12px", textAlign: "center" }}>
                    O robô não está respondendo este cliente. Quem responde é você.
                  </div>
                )}

                <div style={{ flex: 1, padding: "12px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", minHeight: 0 }}>
                  {mensagens.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#64748B", fontSize: "0.78rem", padding: "20px" }}>
                      Sem mensagens guardadas desta conversa.
                    </div>
                  ) : (
                    mensagens.map((m: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          alignSelf: m.sender === "bot" ? "flex-end" : "flex-start",
                          maxWidth: "85%",
                          background: m.sender === "bot" ? (m.autor === "atendente" ? "#DCF8C6" : "#E9FBE5") : "#FFFFFF",
                          color: "#0F172A",
                          padding: "7px 11px",
                          borderRadius: m.sender === "bot" ? "10px 0px 10px 10px" : "0px 10px 10px 10px",
                          fontSize: "0.8rem",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.sender === "bot" && (
                          <div style={{ fontSize: "0.63rem", fontWeight: 800, color: m.autor === "atendente" ? "#0F766E" : "#0F766E", marginBottom: 2 }}>
                            {m.autor === "atendente" ? "VOCÊ" : "ROBÔ"}
                          </div>
                        )}
                        {m.text}
                        <div style={{ fontSize: "0.6rem", color: "#94A3B8", textAlign: "right", marginTop: 2 }}>{horaDe(m.timestamp)}</div>
                      </div>
                    ))
                  )}
                  <div ref={fimDaConversa} />
                </div>

                {erroDoEnvio && (
                  <div style={{ background: "#FEE2E2", color: "#B71C1C", fontSize: "0.74rem", fontWeight: 700, padding: "7px 12px", textAlign: "center" }}>
                    {erroDoEnvio}
                  </div>
                )}

                <div style={{ padding: "10px", background: "#fff", borderTop: "1px solid #E2E8F0", display: "flex", gap: "6px" }}>
                  <input
                    type="text"
                    maxLength={1000}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && enviarPelaConversa()}
                    placeholder="Escrever para o cliente (pausa o robô)..."
                    style={{ flex: 1, padding: "8px 12px", borderRadius: "20px", border: "1px solid #CBD5E1", fontSize: "0.8rem", outline: "none" }}
                  />
                  <button
                    onClick={enviarPelaConversa}
                    disabled={sending || !replyText.trim()}
                    style={{ width: 36, height: 36, borderRadius: "50%", background: "#C92E09", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            )
          ) : /* LISTA DE CHATS OU CONVERSA SELECIONADA */
          !selectedChatJid ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px", background: "#F8FAFC" }}>
              {chats.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748B" }}>
                  <CheckCircle2 size={40} color="#0F766E" style={{ marginBottom: "12px" }} />
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
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#FEE2E2", color: "#C92E09", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                        <User size={18} />
                      </div>
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>{c.clientName || c.phone || "Cliente WhatsApp"}</div>
                        {/* Numa fila de dez, o motivo é o que diz por onde começar:
                            quem está reclamando de atraso não pode esperar a vez. */}
                        {c.motivo && (
                          <div style={{ display: "inline-block", background: "#FEE2E2", color: "#B71C1C", fontSize: "0.68rem", fontWeight: 800, padding: "1px 7px", borderRadius: 6, margin: "2px 0" }}>
                            {c.motivo}
                          </div>
                        )}
                        <div style={{ fontSize: "0.75rem", color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.lastMessage}</div>
                      </div>
                    </div>

                    {c.unreadCount > 0 && (
                      <span style={{ background: "#C92E09", color: "#fff", fontSize: "0.72rem", fontWeight: 800, padding: "2px 8px", borderRadius: "10px", marginLeft: "8px" }}>
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
                  style={{ background: "#F0FDFA", border: "1px solid #99F6E4", color: "#0F766E", padding: "4px 10px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer" }}
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
                  style={{ width: 36, height: 36, borderRadius: "50%", background: "#C92E09", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
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

      {/* O QUE ESTE BOTÃO É. Sem o rótulo, ele é só mais um círculo vermelho no
          canto — indistinguível do "Fale conosco" logo abaixo, que leva ao
          suporte do FireHub. Este abre o WhatsApp DA LOJA. */}
      {!open && (
        <div
          onClick={() => setOpen(true)}
          style={{
            position: "absolute",
            bottom: 14,
            right: 64,
            whiteSpace: "nowrap",
            background: "#fff",
            color: "#B71C1C",
            border: "1px solid #FECACA",
            borderRadius: 999,
            padding: "5px 11px",
            fontSize: "0.72rem",
            fontWeight: 800,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            cursor: "pointer",
          }}
        >
          WhatsApp da loja
        </div>
      )}

      {totalUnread > 0 && !open && (
        <span
          aria-hidden
          style={{
            position: "absolute", bottom: 0, right: 0, width: 56, height: 56,
            borderRadius: "50%", background: "#C92E09", pointerEvents: "none",
            animation: "firehubChamando 1.6s ease-out infinite",
          }}
        />
      )}
      <button
        {...arraste.alca}
        onClick={() => {
          // Quem acabou de arrastar a bolinha para o lado nao quer a janela de
          // conversas abrindo em cima do que estava tentando alcancar.
          if (arraste.arrastou()) return;
          const abrindo = !open; setOpen(abrindo); if (abrindo) { conversaAbertaRef.current = null; setConversaAberta(null); setSelectedChatJid(null); setReplyText(""); setErroDoEnvio(""); if (totalUnread > 0) setAba("fila"); }
        }}
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #C92E09, #B71C1C)",
          color: "#fff",
          border: "none",
          boxShadow: "0 8px 24px rgba(220, 38, 38, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
          position: "relative",
          transition: "transform 0.2s",
          // Sem isto, no tablet o navegador trata o arraste como rolagem da
          // página e a bolinha não sai do lugar.
          touchAction: "none",
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
              background: "#C92E09",
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
