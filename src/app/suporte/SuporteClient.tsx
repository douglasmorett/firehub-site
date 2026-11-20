"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A TELA DO SUPORTE PELO NAVEGADOR — com cara de WhatsApp (Douglas, 20/11/2026:
 * "tipo um WhatsApp mesmo… ele tem que conseguir mandar áudio, tudo normal").
 * Texto, foto, PDF e áudio gravado no próprio navegador. A conversa vem de
 * /api/suporte (lib/atendimento/site.ts); a tela pergunta de novo a cada 2,5 s.
 */

type Mensagem = { id: string; eu: boolean; nome: string | null; tipo: string; texto: string; midiaUrl: string | null; em: string; enviando?: boolean };
type Estado = { entrou: boolean; nome?: string | null; atendente?: string; digitando?: boolean; mensagens?: Mensagem[]; error?: string };

const VERDE = "#075E54";
const MAX_GRAVACAO_S = 180;
const MAX_ARQUIVO = 12 * 1024 * 1024;

const ICONES = {
  microfone: "M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
  enviar: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  clipe: "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
  lixeira: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  relogio: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
};
function Icone({ nome, tamanho = 24, cor = "currentColor" }: { nome: keyof typeof ICONES; tamanho?: number; cor?: string }) {
  return <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill={cor} aria-hidden="true"><path d={ICONES[nome]} /></svg>;
}
/** O "lido" do WhatsApp: os dois tiques azuis. */
function DuploCheck({ cor }: { cor: string }) {
  return (
    <svg viewBox="0 0 16 11" width={16} height={11} fill={cor} aria-hidden="true">
      <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.405-2.272a.463.463 0 0 0-.336-.146.47.47 0 0 0-.343.146l-.311.31a.445.445 0 0 0-.14.337c0 .136.047.25.14.343l2.996 2.996a.724.724 0 0 0 .501.203.697.697 0 0 0 .546-.266l6.646-8.417a.497.497 0 0 0 .108-.299.441.441 0 0 0-.19-.374L11.07.653zm4.81 0a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-1.152-1.09-.672.84 1.287 1.288a.724.724 0 0 0 .501.203.697.697 0 0 0 .546-.266l6.646-8.417a.497.497 0 0 0 .108-.299.441.441 0 0 0-.19-.374l-.199-.197z" />
    </svg>
  );
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function dia(iso: string) {
  const d = new Date(iso), hoje = new Date(), ontem = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function lerComoDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => erro(r.error); r.readAsDataURL(blob); });
}

/** *negrito*, _itálico_, links clicáveis e quebras de linha, como no WhatsApp. */
function Formatado({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {partes.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "#027EB5", wordBreak: "break-all" }}>{p}</a>;
        const pedacos = p.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
        return pedacos.map((q, j) =>
          /^\*[^*]+\*$/.test(q) ? <strong key={`${i}-${j}`}>{q.slice(1, -1)}</strong>
          : /^_[^_]+_$/.test(q) ? <em key={`${i}-${j}`}>{q.slice(1, -1)}</em>
          : <span key={`${i}-${j}`}>{q}</span>);
      })}
    </>
  );
}

function Balao({ m }: { m: Mensagem }) {
  const audio = m.tipo === "AUDIO";
  const imagem = m.tipo === "IMAGEM";
  const arquivo = m.tipo === "ARQUIVO";
  const transcricao = audio ? m.texto.replace(/^🎤\s*/, "") : "";
  return (
    <div style={{ display: "flex", justifyContent: m.eu ? "flex-end" : "flex-start", padding: "1px 0" }}>
      <div className={`fh-balao ${m.eu ? "fh-eu" : "fh-ele"}`}>
        {!m.eu && m.nome && <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#E8590C", marginBottom: 2 }}>{m.nome}</div>}
        {imagem && m.midiaUrl && (
          <a href={m.midiaUrl} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.midiaUrl} alt="Imagem enviada" style={{ display: "block", maxWidth: 260, maxHeight: 320, width: "100%", objectFit: "cover", borderRadius: 6 }} />
          </a>
        )}
        {audio && m.midiaUrl && <audio controls preload="metadata" src={m.midiaUrl} style={{ width: 240, maxWidth: "100%", height: 40 }} />}
        {arquivo && m.midiaUrl && (
          <a href={m.midiaUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(0,0,0,0.05)", borderRadius: 6, padding: "10px 12px", color: "#111B21", textDecoration: "none" }}>
            <span style={{ fontSize: "1.6rem" }}>📄</span>
            <span style={{ fontSize: "0.9rem", fontWeight: 600, wordBreak: "break-word" }}>{m.texto.replace(/^📎\s*/, "") || "Arquivo"}</span>
          </a>
        )}
        {audio && transcricao && !transcricao.startsWith("Áudio (") && (
          <div style={{ fontSize: "0.78rem", color: "#667781", fontStyle: "italic", marginTop: 4, maxWidth: 240 }}>{transcricao}</div>
        )}
        {!audio && !imagem && !arquivo && (
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}><Formatado texto={m.texto} /></div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 3, fontSize: "0.68rem", color: "#667781", marginTop: 2, marginLeft: 24 }}>
          {hora(m.em)}
          {m.eu && (m.enviando ? <Icone nome="relogio" tamanho={13} cor="#8696A0" /> : <DuploCheck cor="#53BDEB" />)}
        </div>
      </div>
    </div>
  );
}

export default function SuporteClient({ token }: { token: string | null }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pendentes, setPendentes] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ nome: "", telefone: "", loja: "" });
  const [entrando, setEntrando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const fimRef = useRef<HTMLDivElement>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const cancelarRef = useRef(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef(0);

  const aplicar = useCallback((d: Estado) => {
    if (d?.error) { setErro(d.error); return; }
    setEstado(d);
  }, []);

  const buscar = useCallback(async () => {
    try {
      const r = await fetch("/api/suporte", { cache: "no-store" });
      aplicar(await r.json());
    } catch { /* sem rede: tenta na próxima volta */ }
  }, [aplicar]);

  // Entrada: link pessoal (?c=) ou a conversa que este navegador já tem.
  useEffect(() => {
    (async () => {
      if (token) {
        const r = await fetch("/api/suporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entrar: token }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) { aplicar(d); window.history.replaceState(null, "", "/suporte"); return; }
        setErro(d.error || "Este link não vale mais.");
      }
      await buscar();
    })();
  }, [token, aplicar, buscar]);

  // Pergunta de novo a cada 2,5 s (8 s com a aba escondida).
  useEffect(() => {
    if (!estado?.entrou) return;
    let parado = false;
    let t: ReturnType<typeof setTimeout>;
    const volta = async () => {
      if (parado) return;
      await buscar();
      t = setTimeout(volta, document.hidden ? 8000 : 2500);
    };
    t = setTimeout(volta, 2500);
    return () => { parado = true; clearTimeout(t); };
  }, [estado?.entrou, buscar]);

  // Desce para a última e toca um bip quando chega resposta.
  const mensagens = [...(estado?.mensagens || []), ...pendentes];
  useEffect(() => {
    const qtd = mensagens.length;
    const ultima = mensagens[qtd - 1];
    if (qtd > qtdRef.current && qtdRef.current > 0 && ultima && !ultima.eu) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.12);
      } catch { /* sem som */ }
    }
    qtdRef.current = qtd;
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length, estado?.digitando]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(corpo: Record<string, unknown>, previa: Mensagem) {
    setErro("");
    setPendentes((p) => [...p, previa]);
    try {
      const r = await fetch("/api/suporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d.error || "Não foi possível enviar. Tente de novo.");
      else aplicar(d);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setPendentes((p) => p.filter((x) => x.id !== previa.id));
    }
  }

  function enviarTexto() {
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    void enviar({ texto: t }, { id: `p-${Date.now()}`, eu: true, nome: null, tipo: "TEXTO", texto: t, midiaUrl: null, em: new Date().toISOString(), enviando: true });
  }

  async function enviarArquivo(f: File) {
    if (f.size > MAX_ARQUIVO) { setErro("Arquivo muito grande (máximo 12 MB)."); return; }
    const imagem = f.type.startsWith("image/");
    const dataUrl = await lerComoDataUrl(f);
    void enviar(
      { midia: dataUrl, nomeDoArquivo: f.name },
      { id: `p-${Date.now()}`, eu: true, nome: null, tipo: imagem ? "IMAGEM" : f.type.startsWith("audio/") ? "AUDIO" : "ARQUIVO", texto: imagem ? "📷 Imagem" : `📎 ${f.name}`, midiaUrl: imagem ? dataUrl : null, em: new Date().toISOString(), enviando: true },
    );
  }

  // ── Áudio: grava no navegador e manda como no WhatsApp ──
  async function comecarGravacao() {
    setErro("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErro("Este navegador não grava áudio. Escreva a mensagem ou mande pelo celular."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const g = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacosRef.current = [];
      cancelarRef.current = false;
      g.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data); };
      g.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        if (cancelarRef.current || !pedacosRef.current.length) return;
        const blob = new Blob(pedacosRef.current, { type: (g.mimeType || "audio/webm").split(";")[0] });
        const dataUrl = await lerComoDataUrl(blob);
        void enviar({ midia: dataUrl, nomeDoArquivo: "audio" }, { id: `p-${Date.now()}`, eu: true, nome: null, tipo: "AUDIO", texto: "🎤", midiaUrl: URL.createObjectURL(blob), em: new Date().toISOString(), enviando: true });
      };
      g.start(250);
      gravadorRef.current = g;
      setSegundos(0);
      setGravando(true);
    } catch {
      setErro("Não deu para usar o microfone. Libere o microfone para este site e tente de novo.");
    }
  }
  function pararGravacao(cancelar: boolean) {
    cancelarRef.current = cancelar;
    gravadorRef.current?.stop();
  }
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos((s) => {
      if (s + 1 >= MAX_GRAVACAO_S) pararGravacao(false);
      return s + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  async function comecar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setErro("");
    try {
      const r = await fetch("/api/suporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d.error || "Não foi possível começar.");
      else aplicar(d);
    } finally {
      setEntrando(false);
    }
  }

  const atendente = estado?.atendente || "Suporte FireHub";
  const mmss = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

  return (
    <div className="fh-suporte">
      <style>{`
        .fh-suporte { position: fixed; inset: 0; display: flex; flex-direction: column; background: #EFEAE2; font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #111B21; }
        .fh-suporte * { box-sizing: border-box; }
        .fh-fundo { background-color: #EFEAE2; background-image: radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px); background-size: 18px 18px; }
        .fh-balao { max-width: min(78%, 520px); padding: 6px 8px 4px; border-radius: 8px; font-size: 0.94rem; line-height: 1.35; box-shadow: 0 1px 0.5px rgba(11,20,26,0.13); position: relative; }
        .fh-eu { background: #D9FDD3; border-top-right-radius: 0; }
        .fh-ele { background: #fff; border-top-left-radius: 0; }
        .fh-btn-redondo { width: 46px; height: 46px; border-radius: 50%; border: none; background: #00A884; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; font-size: 1.15rem; }
        .fh-btn-redondo:active { transform: scale(0.95); }
        .fh-icone { width: 42px; height: 42px; border-radius: 50%; border: none; background: transparent; color: #54656F; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.3rem; flex-shrink: 0; }
        .fh-campo { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #D1D7DB; font-size: 1rem; font-family: inherit; outline: none; }
        .fh-campo:focus { border-color: #00A884; }
        @keyframes fhPisca { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
      `}</style>

      {/* Cabeçalho */}
      <div style={{ background: VERDE, color: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="FireHub" style={{ width: 40, height: 40, borderRadius: "50%", background: "#fff", objectFit: "cover" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "1.02rem" }}>{atendente}</div>
          <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>{estado?.digitando ? "digitando…" : "online"}</div>
        </div>
      </div>

      {/* Ainda sem conversa: quem é você */}
      {estado && !estado.entrou ? (
        <div className="fh-fundo" style={{ flex: 1, overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <form onSubmit={comecar} style={{ background: "#fff", borderRadius: 14, padding: 22, width: "100%", maxWidth: 400, boxShadow: "0 2px 10px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: "1.15rem" }}>Fale com o suporte do FireHub</div>
            <div style={{ fontSize: "0.88rem", color: "#54656F", lineHeight: 1.45 }}>Funciona como o WhatsApp: você manda texto, foto e áudio, e a gente responde por aqui.</div>
            <input className="fh-campo" placeholder="Seu nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoComplete="name" />
            <input className="fh-campo" placeholder="Seu WhatsApp com DDD" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} autoComplete="tel" />
            <input className="fh-campo" placeholder="Nome da sua loja (se tiver)" value={form.loja} onChange={(e) => setForm({ ...form, loja: e.target.value })} />
            {erro && <div style={{ color: "#B42318", fontSize: "0.85rem" }}>{erro}</div>}
            <button type="submit" disabled={entrando} style={{ background: "#00A884", color: "#fff", border: "none", borderRadius: 24, padding: "13px 16px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: entrando ? 0.7 : 1 }}>
              {entrando ? "Entrando…" : "Começar conversa"}
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Conversa */}
          <div className="fh-fundo" style={{ flex: 1, overflowY: "auto", padding: "10px 4%" }}>
            {!estado && <div style={{ textAlign: "center", color: "#667781", marginTop: 40 }}>Carregando…</div>}
            {estado?.entrou && mensagens.length === 0 && (
              <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
                <div style={{ background: "#FFEECD", color: "#54656F", fontSize: "0.82rem", padding: "8px 12px", borderRadius: 8, maxWidth: 420, textAlign: "center", lineHeight: 1.4 }}>
                  Olá{estado.nome ? `, ${estado.nome.split(" ")[0]}` : ""}! Mande sua dúvida por aqui: texto, foto, PDF ou áudio. A gente responde nesta tela.
                </div>
              </div>
            )}
            {mensagens.map((m, i) => {
              const novoDia = i === 0 || dia(mensagens[i - 1].em) !== dia(m.em);
              return (
                <div key={m.id}>
                  {novoDia && (
                    <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
                      <span style={{ background: "#fff", color: "#54656F", fontSize: "0.75rem", padding: "5px 12px", borderRadius: 8, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>{dia(m.em)}</span>
                    </div>
                  )}
                  <div style={{ marginTop: i > 0 && mensagens[i - 1].eu !== m.eu ? 8 : 2 }}><Balao m={m} /></div>
                </div>
              );
            })}
            {estado?.digitando && (
              <div style={{ display: "flex", padding: "4px 0" }}>
                <div className="fh-balao fh-ele" style={{ display: "flex", gap: 4, padding: "10px 14px" }}>
                  {[0, 1, 2].map((k) => <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: "#8696A0", animation: `fhPisca 1.2s ${k * 0.2}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={fimRef} />
          </div>

          {erro && <div style={{ background: "#FEE4E2", color: "#B42318", fontSize: "0.84rem", padding: "8px 14px", flexShrink: 0 }}>{erro}</div>}

          {/* Barra de digitar */}
          <div style={{ background: "#F0F2F5", padding: "8px 8px", display: "flex", alignItems: "flex-end", gap: 6, flexShrink: 0, paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
            {gravando ? (
              <>
                <button className="fh-icone" onClick={() => pararGravacao(true)} title="Cancelar" aria-label="Cancelar áudio"><Icone nome="lixeira" /></button>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: "#fff", borderRadius: 24, padding: "12px 16px", fontSize: "0.95rem" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#E53935", animation: "fhPisca 1s infinite" }} />
                  Gravando… {mmss}
                </div>
                <button className="fh-btn-redondo" onClick={() => pararGravacao(false)} title="Enviar áudio" aria-label="Enviar áudio"><Icone nome="enviar" /></button>
              </>
            ) : (
              <>
                <button className="fh-icone" onClick={() => arquivoRef.current?.click()} title="Foto ou arquivo" aria-label="Anexar foto ou arquivo" style={{ transform: "rotate(45deg)" }}><Icone nome="clipe" /></button>
                <input ref={arquivoRef} type="file" accept="image/*,application/pdf,audio/*" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void enviarArquivo(f); }} />
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarTexto(); } }}
                  placeholder="Mensagem"
                  rows={1}
                  style={{ flex: 1, resize: "none", border: "none", outline: "none", borderRadius: 24, padding: "12px 16px", fontSize: "0.98rem", fontFamily: "inherit", maxHeight: 120, lineHeight: 1.35, background: "#fff" }}
                />
                {texto.trim() ? (
                  <button className="fh-btn-redondo" onClick={enviarTexto} title="Enviar" aria-label="Enviar"><Icone nome="enviar" /></button>
                ) : (
                  <button className="fh-btn-redondo" onClick={comecarGravacao} title="Gravar áudio" aria-label="Gravar áudio"><Icone nome="microfone" /></button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
