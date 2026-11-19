"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Search, Send, ShieldCheck } from "lucide-react";
import BalcaoNaConversa from "@/components/balcao/BalcaoNaConversa";

/**
 * /store/atendimento — A TELA GRANDE DO WHATSAPP DA LOJA.
 *
 * O chatzinho do canto (HumanSupportFloatingWidget) mostra a conversa numa
 * janela de 380px e não deixa lançar pedido. O Túlio Lanches (06/11/2026):
 * "a janela é pequena e não dá para fazer o pedido por ali". Aqui são três
 * colunas: as conversas, a conversa aberta no visual do WhatsApp, e o Balcão
 * (o MESMO de /store/venda-presencial, components/balcao) já com o nome e o
 * telefone de quem está falando.
 *
 * Abre pelo "Abrir em tela grande" do chatzinho, numa aba nova, já na conversa
 * (?jid=...&loja=...). As APIs são as do chatzinho — /api/chatbot/conversas
 * para ler, responder e pausar o robô, /api/chatbot/human-support para saber
 * quem chamou atendente — então quem não pode lá não pode aqui.
 */

type Conversa = {
  remoteJid: string;
  telefone: string;
  lojaId?: string;
  nome?: string;
  ultimaMensagem: string;
  ultimoAutor: "user" | "bot";
  ultimaEm: number;
  pausado?: boolean;
  motivoDaPausa?: string | null;
};
type Mensagem = { sender: "user" | "bot"; text: string; timestamp: number; autor?: string };

const telefoneBonito = (t: string) => {
  const d = String(t || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || "";
};
/**
 * Só o jid de número (`@s.whatsapp.net`) é telefone. O `@lid` é um código
 * interno do WhatsApp: no campo Telefone do pedido ele viraria um número que
 * não liga para ninguém.
 */
const telefoneDoJid = (jid: string) => (/@s\.whatsapp\.net$/.test(jid) ? jid.split("@")[0] : "");
/** Como chamar quem não tem nome: o número, ou "Cliente do WhatsApp" quando nem número há (`@lid`). */
const semNome = (jid: string) => telefoneBonito(telefoneDoJid(jid)) || "Cliente do WhatsApp";
const horaDe = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaDe = (ms: number) => {
  const d = new Date(ms);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoje.toDateString()) return "HOJE";
  if (d.toDateString() === ontem.toDateString()) return "ONTEM";
  return d.toLocaleDateString("pt-BR");
};
const quandoNaLista = (ms: number) => (new Date(ms).toDateString() === new Date().toDateString() ? horaDe(ms) : diaDe(ms).toLowerCase());
const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "#";
/** A cor do avatar sai do número: a mesma pessoa tem sempre a mesma cor. */
const corDoAvatar = (chave: string) => {
  const cores = ["#00A884", "#53BDEB", "#FFB02E", "#FF6B6B", "#A78BFA", "#25D366", "#F472B6", "#06B6D4"];
  let h = 0;
  for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return cores[h % cores.length];
};

export default function AtendimentoTelaGrande() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  /** Quem chamou atendente (a fila do chatzinho): ganha o selo na lista. */
  const [chamando, setChamando] = useState<Map<string, string>>(new Map());
  const [aberta, setAberta] = useState<{ jid: string; loja: string | null } | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [pausado, setPausado] = useState(false);
  const [mudandoPausa, setMudandoPausa] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState("");
  const [busca, setBusca] = useState("");
  /** Qual conversa está na tela AGORA — resposta atrasada de outra é descartada (o mesmo cuidado do chatzinho). */
  const abertaRef = useRef<string | null>(null);
  const caixaDasMensagens = useRef<HTMLDivElement | null>(null);
  // ── A ALTURA É A QUE SOBRA NA JANELA ─────────────────────────────────────
  // Um número fixo (o "100vh - 145px" do Balcão) erra quando o painel mostra
  // uma faixa de aviso no topo (impressão parada, caixa aberto há 24 h): a
  // tela passava do fim da janela e a PÁGINA rolava junto com a conversa.
  // Mede onde a grade começa e ocupa o resto; refaz quando a janela muda ou
  // uma faixa aparece/some (o corpo da página muda de tamanho).
  const grade = useRef<HTMLDivElement | null>(null);
  const [altura, setAltura] = useState<number | null>(null);
  useEffect(() => {
    const medir = () => {
      const el = grade.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top + window.scrollY;
      setAltura(Math.max(480, Math.floor(window.innerHeight - topo)));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(document.body);
    window.addEventListener("resize", medir);
    return () => { observador.disconnect(); window.removeEventListener("resize", medir); };
  }, []);

  const buscarConversas = async () => {
    try {
      const r = await fetch("/api/chatbot/conversas");
      if (r.status === 401 || r.status === 403) { setSemAcesso(true); return; }
      const d = await r.json();
      if (d.success) { setConversas(d.conversas || []); setSemAcesso(false); }
    } catch {
    } finally {
      setCarregando(false);
    }
  };

  const buscarFila = async () => {
    try {
      const d = await fetch("/api/chatbot/human-support").then((r) => r.json());
      if (d.success) {
        setChamando(new Map((d.chats || []).map((c: any) => [`${c.userId || ""}|${c.jid}`, c.clientName || ""])));
      }
    } catch {}
  };

  const buscarMensagens = async (jid: string, loja: string | null) => {
    try {
      const d = await fetch(`/api/chatbot/conversas?jid=${encodeURIComponent(jid)}${loja ? `&loja=${encodeURIComponent(loja)}` : ""}`).then((r) => r.json());
      if (abertaRef.current !== jid) return;
      if (d.success) { setMensagens(d.mensagens || []); setPausado(!!d.pausado); }
    } catch {}
  };

  const abrir = (jid: string, loja: string | null) => {
    abertaRef.current = jid;
    setAberta({ jid, loja });
    setMensagens([]);
    setTexto("");
    setErroDoEnvio("");
    setPausado(!!conversas.find((c) => c.remoteJid === jid && (!loja || c.lojaId === loja))?.pausado);
    buscarMensagens(jid, loja);
    // A conversa vai para o endereço: F5 (ou o link copiado) volta nela.
    const q = new URLSearchParams({ jid, ...(loja ? { loja } : {}) });
    window.history.replaceState(null, "", `?${q.toString()}`);
  };

  // Chegou pelo "Abrir em tela grande": a conversa já vem no endereço.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const jid = q.get("jid");
    if (jid) {
      abertaRef.current = jid;
      setAberta({ jid, loja: q.get("loja") });
      buscarMensagens(jid, q.get("loja"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A lista a cada 6 s e a fila a cada 10 s, como o chatzinho aberto; aba do
  // navegador escondida não pergunta (o painel fica aberto o dia inteiro).
  useEffect(() => {
    buscarConversas();
    buscarFila();
    const t1 = setInterval(() => { if (!document.hidden) buscarConversas(); }, 6000);
    const t2 = setInterval(() => { if (!document.hidden) buscarFila(); }, 10000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  useEffect(() => {
    if (!aberta) return;
    const t = setInterval(() => { if (!document.hidden) buscarMensagens(aberta.jid, aberta.loja); }, 4000);
    return () => clearInterval(t);
  }, [aberta]);

  // Rola a caixa das mensagens (não a página) para a última.
  useEffect(() => {
    const caixa = caixaDasMensagens.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length, aberta?.jid]);

  const alternarPausa = async () => {
    if (!aberta || mudandoPausa) return;
    setMudandoPausa(true);
    try {
      const d = await fetch("/api/chatbot/conversas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pausado ? "retomar" : "pausar", jid: aberta.jid, loja: aberta.loja }),
      }).then((r) => r.json());
      if (d.success) setPausado(!!d.pausado);
      buscarConversas();
    } catch {
    } finally {
      setMudandoPausa(false);
    }
  };

  const enviar = async () => {
    if (!aberta || !texto.trim() || enviando) return;
    setEnviando(true);
    setErroDoEnvio("");
    try {
      const d = await fetch("/api/chatbot/conversas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enviar", jid: aberta.jid, message: texto, loja: aberta.loja }),
      }).then((r) => r.json());
      if (d.success) {
        setTexto("");
        setPausado(true);
        await buscarMensagens(aberta.jid, aberta.loja);
        buscarConversas();
      } else {
        // O texto fica na caixa: achar que o cliente foi respondido é pior que o erro.
        setErroDoEnvio(d.error || "Não consegui enviar. Tente de novo.");
      }
    } catch {
      setErroDoEnvio("Não consegui falar com o servidor. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const daLista = aberta ? conversas.find((c) => c.remoteJid === aberta.jid && (!aberta.loja || c.lojaId === aberta.loja)) : undefined;
  const nomeDaFila = aberta ? chamando.get(`${aberta.loja || ""}|${aberta.jid}`) || "" : "";
  const nomeAberto = daLista?.nome || nomeDaFila;
  const telefoneAberto = aberta ? telefoneDoJid(aberta.jid) : "";
  const tituloAberto = nomeAberto || (aberta ? semNome(aberta.jid) : "");

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversas;
    const digitos = q.replace(/\D/g, "");
    return conversas.filter((c) => (c.nome || "").toLowerCase().includes(q) || (digitos && c.telefone.includes(digitos)));
  }, [conversas, busca]);

  // O balcão só monta depois da primeira lista: é dela que vem o nome do
  // cliente, e o balcão lê o cliente uma vez, ao abrir a conversa.
  const cliente = aberta ? { nome: nomeAberto, telefone: telefoneAberto } : null;

  return (
    <div ref={grade} className="atd-grade" style={{ height: altura ? `${altura}px` : "calc(100vh - 145px)", display: "grid", gridTemplateColumns: "300px minmax(340px, 1fr) minmax(380px, 440px)", background: "#fff", borderTop: "1px solid #E9EDEF", fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif", overflow: "hidden" }}>
      <style>{`
        /* Notebook de 1366px com o menu do painel aberto: a lista encolhe
           antes de a conversa ou o balcão ficarem apertados demais. */
        @media (max-width: 1380px) { .atd-grade { grid-template-columns: 250px minmax(320px, 1fr) 400px !important; } }
        @media (max-width: 1100px) { .atd-grade { grid-template-columns: 0 minmax(300px, 1fr) 380px !important; } .atd-lista { display: none !important; } }
        .atd-item:hover { background: #F5F6F6 !important; }
        .atd-fundo {
          background-color: #EFEAE2;
          background-image: radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px);
          background-size: 14px 14px;
        }
      `}</style>

      {/* ===== CONVERSAS ===== */}
      <div className="atd-lista" style={{ display: "flex", flexDirection: "column", borderRight: "1px solid #E9EDEF", minHeight: 0 }}>
        <div style={{ padding: "12px 14px 8px", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#111B21" }}>Conversas</div>
          <div style={{ fontSize: "0.74rem", color: "#667781", marginBottom: 8 }}>
            {conversas.length === 0 ? "WhatsApp da loja" : `${conversas.length} nas últimas horas · ${conversas.filter((c) => !c.pausado).length} com o robô`}
          </div>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#667781" }} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nome ou número"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px 8px 34px", borderRadius: 8, border: "none", background: "#F0F2F5", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {semAcesso ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#667781", fontSize: "0.82rem" }}>
              <ShieldCheck size={36} color="#94A3B8" style={{ marginBottom: 10 }} />
              <div style={{ fontWeight: 700, color: "#111B21" }}>Sem acesso às conversas</div>
              O dono da loja libera em Configurações → Equipe, marcando o Painel de Pedidos para você.
            </div>
          ) : carregando ? (
            <div style={{ textAlign: "center", padding: 30, color: "#667781", fontSize: "0.82rem" }}>Carregando as conversas...</div>
          ) : filtradas.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#667781", fontSize: "0.82rem" }}>
              <Bot size={36} color="#94A3B8" style={{ marginBottom: 10 }} />
              <div style={{ fontWeight: 700, color: "#111B21" }}>{busca ? "Nada com esse nome ou número" : "Nenhuma conversa agora"}</div>
              {!busca && "Assim que alguém falar com o WhatsApp da loja, a conversa aparece aqui."}
            </div>
          ) : (
            filtradas.map((c) => {
              const chave = `${c.lojaId || ""}|${c.remoteJid}`;
              const selecionada = aberta?.jid === c.remoteJid && (!aberta.loja || aberta.loja === c.lojaId);
              const nome = c.nome || semNome(c.remoteJid);
              const chamou = chamando.has(chave);
              return (
                <div key={chave} className="atd-item" onClick={() => abrir(c.remoteJid, c.lojaId || null)}
                  style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", cursor: "pointer", background: selecionada ? "#F0F2F5" : "#fff", borderBottom: "1px solid #F0F2F5" }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, background: corDoAvatar(c.remoteJid), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.95rem" }}>
                    {c.nome ? iniciais(c.nome) : <span style={{ fontSize: "1.1rem" }}>👤</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "#111B21", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nome}</span>
                      <span style={{ fontSize: "0.72rem", color: chamou ? "#C92E09" : "#667781", flexShrink: 0, fontWeight: chamou ? 800 : 400 }}>{quandoNaLista(c.ultimaEm)}</span>
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#667781", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.ultimoAutor === "bot" ? "🤖 " : ""}{c.ultimaMensagem}
                    </div>
                    {(chamou || c.pausado) && (
                      <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                        {chamou && <span style={{ background: "#FEE2E2", color: "#B71C1C", fontSize: "0.66rem", fontWeight: 800, padding: "1px 6px", borderRadius: 5 }}>🙋 chamou atendente</span>}
                        {c.pausado && <span style={{ background: "#FFF7E6", color: "#B45309", fontSize: "0.66rem", fontWeight: 800, padding: "1px 6px", borderRadius: 5 }}>robô pausado</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== A CONVERSA, NO VISUAL DO WHATSAPP ===== */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid #E9EDEF" }}>
        {!aberta ? (
          <div className="atd-fundo" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: "26px 28px", maxWidth: 380, textAlign: "center", boxShadow: "0 1px 3px rgba(11,20,26,0.13)" }}>
              <div style={{ fontSize: "2rem" }}>💬</div>
              <div style={{ fontWeight: 800, color: "#111B21", margin: "6px 0" }}>Escolha uma conversa</div>
              <div style={{ fontSize: "0.85rem", color: "#667781", lineHeight: 1.5 }}>
                Leia o que o cliente pediu e monte o pedido no balcão ao lado — o nome e o telefone dele já entram.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ background: "#F0F2F5", padding: "8px 14px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E9EDEF" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: corDoAvatar(aberta.jid), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                {nomeAberto ? iniciais(nomeAberto) : "👤"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "#111B21", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tituloAberto}</div>
                <div style={{ fontSize: "0.76rem", color: "#667781" }}>
                  {[nomeAberto && telefoneAberto ? telefoneBonito(telefoneAberto) : "", pausado ? "você está atendendo" : "🤖 o robô está atendendo"].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button type="button" onClick={alternarPausa} disabled={mudandoPausa}
                title={pausado ? "O robô volta a responder este cliente" : "O robô para de responder este cliente até você devolver"}
                style={{ background: pausado ? "#F0FDFA" : "#FFF7E6", border: `1px solid ${pausado ? "#99F6E4" : "#FDE68A"}`, color: pausado ? "#0F766E" : "#B45309", padding: "7px 12px", borderRadius: 8, fontSize: "0.8rem", fontWeight: 800, cursor: mudandoPausa ? "wait" : "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>
                {mudandoPausa ? "..." : pausado ? "▶ Voltar o robô" : "⏸ Pausar robô"}
              </button>
            </div>

            {pausado && (
              <div style={{ background: "#FFF7E6", color: "#92400E", fontSize: "0.78rem", fontWeight: 700, padding: "6px 12px", textAlign: "center" }}>
                O robô não está respondendo este cliente. Quem responde é você.
              </div>
            )}

            <div ref={caixaDasMensagens} className="atd-fundo" style={{ flex: 1, overflowY: "auto", padding: "14px 6%", display: "flex", flexDirection: "column", gap: 3, minHeight: 0 }}>
              {mensagens.length === 0 ? (
                <div style={{ alignSelf: "center", background: "#FFF3C4", color: "#54656F", fontSize: "0.78rem", padding: "6px 12px", borderRadius: 8, marginTop: 20 }}>
                  Sem mensagens guardadas desta conversa (a memória dura poucas horas).
                </div>
              ) : (
                mensagens.map((m, i) => {
                  const nossa = m.sender === "bot";
                  const dia = diaDe(m.timestamp);
                  const novoDia = i === 0 || diaDe(mensagens[i - 1].timestamp) !== dia;
                  const mesmoLadoAntes = i > 0 && !novoDia && mensagens[i - 1].sender === m.sender;
                  return (
                    <div key={i} style={{ display: "contents" }}>
                      {novoDia && (
                        <div style={{ alignSelf: "center", background: "#fff", color: "#54656F", fontSize: "0.72rem", padding: "5px 12px", borderRadius: 8, margin: "8px 0", boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>
                          {dia}
                        </div>
                      )}
                      <div style={{
                        alignSelf: nossa ? "flex-end" : "flex-start", maxWidth: "72%", marginTop: mesmoLadoAntes ? 0 : 6,
                        background: nossa ? "#D9FDD3" : "#fff", color: "#111B21", padding: "6px 9px 8px",
                        borderRadius: mesmoLadoAntes ? 8 : nossa ? "8px 0 8px 8px" : "0 8px 8px 8px",
                        boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)", fontSize: "0.9rem", lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      }}>
                        {nossa && !mesmoLadoAntes && (
                          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: m.autor === "atendente" ? "#027EB5" : "#00A884", marginBottom: 2 }}>
                            {m.autor === "atendente" ? "Você" : "🤖 Robô"}
                          </div>
                        )}
                        {m.text}
                        <span style={{ float: "right", fontSize: "0.68rem", color: "#667781", margin: "6px 0 -4px 10px" }}>
                          {horaDe(m.timestamp)}{nossa ? " ✓✓" : ""}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {erroDoEnvio && (
              <div style={{ background: "#FEE2E2", color: "#B71C1C", fontSize: "0.78rem", fontWeight: 700, padding: "7px 12px", textAlign: "center" }}>{erroDoEnvio}</div>
            )}

            <div style={{ background: "#F0F2F5", padding: "8px 12px", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                rows={1}
                maxLength={1000}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                // Enter envia, Shift+Enter quebra a linha — como no WhatsApp Web.
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder={pausado ? "Digite uma mensagem" : "Digite uma mensagem (pausa o robô)"}
                style={{ flex: 1, resize: "none", maxHeight: 120, padding: "10px 14px", borderRadius: 8, border: "none", background: "#fff", fontSize: "0.92rem", outline: "none", fontFamily: "inherit", lineHeight: 1.35 }}
              />
              <button type="button" onClick={enviar} disabled={enviando || !texto.trim()} title="Enviar"
                style={{ width: 42, height: 42, borderRadius: "50%", border: "none", flexShrink: 0, background: texto.trim() ? "#00A884" : "#B6C2C9", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: texto.trim() ? "pointer" : "default" }}>
                <Send size={18} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ===== O BALCÃO DESTA CONVERSA ===== */}
      <div style={{ minHeight: 0, display: "flex", flexDirection: "column", background: "#fff" }}>
        <div style={{ padding: "8px 12px", background: "#1C1917", color: "#fff", fontSize: "0.8rem", fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>🧾 Pedido {aberta ? `de ${tituloAberto}` : "avulso"}</span>
          <a href="/store/venda-presencial" target="_blank" rel="noopener noreferrer" style={{ color: "#FDBA74", textDecoration: "none", whiteSpace: "nowrap" }}>Balcão completo ↗</a>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {carregando && aberta ? null : (
            <BalcaoNaConversa
              // Uma conversa, um balcão: trocar de conversa monta outro, com o
              // rascunho DAQUELA conversa e o cliente dela nos campos.
              key={aberta ? `${aberta.loja || ""}|${aberta.jid}` : "avulso"}
              cliente={cliente}
              chaveDoRascunho={`firehub_atendimento_rascunho:${aberta ? `${aberta.loja || ""}|${aberta.jid}` : "avulso"}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
