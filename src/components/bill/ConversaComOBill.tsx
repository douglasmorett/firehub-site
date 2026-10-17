"use client";

/**
 * A CONVERSA COM O BILL no painel — a mesma do WhatsApp (lib/assessor/conversa.ts).
 *
 * Usada no balão do canto (BillFlutuante) e na página /store/bill. Mostra as
 * falas dos dois canais com a etiqueta de onde vieram, busca as novas a cada
 * 6 s (o dono mandou áudio pelo celular → aparece aqui) e aceita texto, áudio
 * gravado no navegador e foto.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Camera, Send, Loader2 } from "lucide-react";
import RostoDoBill, { type EmocaoDoBill } from "./RostoDoBill";

type Fala = { id: string; papel: "DONO" | "BILL"; texto: string; canal: "WHATSAPP" | "PAINEL"; autor: string | null; criadoEm: string; provisoria?: boolean };

function paraBase64(blob: Blob): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = erro;
    r.readAsDataURL(blob);
  });
}

/** Foto do celular tem 4–8 MB: reduz para 1600 px em JPEG antes de mandar. */
async function fotoReduzida(arquivo: File): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = erro;
      i.src = url;
    });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.85));
    return { base64: await paraBase64(blob), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const hora = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("pt-BR", hoje ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** *negrito* do WhatsApp vira negrito aqui também. */
function comNegrito(t: string) {
  return t.split(/(\*[^*\n]+\*)/g).map((p, j) => (p.length > 2 && p.startsWith("*") && p.endsWith("*") ? <b key={j}>{p.slice(1, -1)}</b> : p));
}

export default function ConversaComOBill({ altura = 380, aoGravar, aoMudarEstado }: {
  altura?: number | string;
  aoGravar?: () => void;
  /** O humor do rosto que acompanha esta conversa: ouvindo (gravando), pensando (enviando), erro, feliz (respondeu). */
  aoMudarEstado?: (e: EmocaoDoBill) => void;
}) {
  const [falas, setFalas] = useState<Fala[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [comemorando, setComemorando] = useState(false);

  useEffect(() => {
    if (!aoMudarEstado) return;
    aoMudarEstado(erro ? "erro" : gravando ? "ouvindo" : enviando ? "pensando" : comemorando ? "feliz" : "normal");
  }, [erro, gravando, enviando, comemorando, aoMudarEstado]);
  useEffect(() => {
    if (!comemorando) return;
    const t = setTimeout(() => setComemorando(false), 2500);
    return () => clearTimeout(t);
  }, [comemorando]);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const fim = useRef<HTMLDivElement | null>(null);
  const arquivo = useRef<HTMLInputElement | null>(null);
  const ultima = useRef<string | null>(null);

  const buscarNovas = useCallback(async () => {
    try {
      const url = ultima.current ? `/api/store/assessor/conversa?depois=${encodeURIComponent(ultima.current)}` : "/api/store/assessor/conversa";
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const novas: Fala[] = j.falas || [];
      if (novas.length) {
        ultima.current = novas[novas.length - 1].criadoEm;
        setFalas((f) => {
          const ids = new Set(f.map((x) => x.id));
          return [...f.filter((x) => !x.provisoria), ...novas.filter((x) => !ids.has(x.id))];
        });
      }
    } catch {}
    setCarregou(true);
  }, []);

  useEffect(() => {
    buscarNovas();
    const t = setInterval(() => { if (document.visibilityState === "visible") buscarNovas(); }, 6000);
    return () => clearInterval(t);
  }, [buscarNovas]);

  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [falas, enviando]);

  async function mandar(corpo: { texto?: string; audio?: any; imagem?: any }, rotulo: string) {
    setErro(null);
    setFalas((f) => [...f, { id: `tmp-${Date.now()}`, papel: "DONO", texto: rotulo, canal: "PAINEL", autor: null, criadoEm: new Date().toISOString(), provisoria: true }]);
    setEnviando(true);
    try {
      const r = await fetch("/api/store/assessor/conversar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não consegui falar com o Bill agora.");
      await buscarNovas();
      setComemorando(true);
      if (j.gravou) aoGravar?.();
    } catch (e: any) {
      setFalas((f) => f.filter((x) => !x.provisoria));
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function gravar() {
    if (gravando) {
      gravador.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacos.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) pedacos.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const blob = new Blob(pedacos.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        await mandar({ audio: { base64: await paraBase64(blob), mimeType: (rec.mimeType || "audio/webm").split(";")[0] } }, "🎤 Áudio");
      };
      gravador.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      setErro("O navegador não liberou o microfone. Permita o microfone no cadeado da barra de endereço.");
    }
  }

  async function foto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const legenda = texto.trim();
    setTexto("");
    await mandar({ imagem: await fotoReduzida(f), texto: legenda || undefined }, `📷 Foto${legenda ? `: ${legenda}` : ""}`);
  }

  function enviarTexto() {
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto("");
    mandar({ texto: t }, t);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: altura, background: "#EFEAE2", minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
        {carregou && falas.length === 0 && (
          <Balao de="BILL">Oi, chefe! Aqui é o Bill. Me fala o que chegou, o que pagou, o que acabou ou o que quer saber. Pode mandar áudio ou foto da nota — e o que você me mandar pelo WhatsApp aparece aqui também.</Balao>
        )}
        {falas.map((f) => (
          <Balao key={f.id} de={f.papel} rodape={`${f.papel === "DONO" ? (f.canal === "WHATSAPP" ? "📱 WhatsApp" : `💻 painel${f.autor ? ` · ${f.autor}` : ""}`) : f.canal === "WHATSAPP" ? "respondeu no WhatsApp" : ""} ${f.provisoria ? "" : hora(f.criadoEm)}`.trim()}>
            {comNegrito(f.texto)}
          </Balao>
        ))}
        {enviando && (
          <Balao de="BILL"><span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "#64748B" }}><Loader2 size={14} className="animate-spin" /> resolvendo…</span></Balao>
        )}
        {erro && <div style={{ alignSelf: "center", fontSize: 12, color: "#B91C1C", background: "#FEF2F2", borderRadius: 8, padding: "6px 10px" }}>{erro}</div>}
        <div ref={fim} />
      </div>
      <div style={{ display: "flex", gap: 8, padding: 10, background: "#F0F2F5", alignItems: "center" }}>
        <input ref={arquivo} type="file" accept="image/*" capture="environment" onChange={foto} style={{ display: "none" }} />
        <button title="Foto da nota ou do boleto" onClick={() => arquivo.current?.click()} disabled={enviando || gravando}
          style={{ background: "white", border: 0, borderRadius: 999, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>
          <Camera size={18} color="#475569" />
        </button>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") enviarTexto(); }}
          placeholder={gravando ? "Gravando… toque no quadrado para enviar" : "Ex.: acabou a esfirra de frango, pausa"}
          disabled={enviando || gravando}
          style={{ flex: 1, minWidth: 0, border: 0, borderRadius: 999, padding: "10px 14px", fontSize: 14, outline: "none" }} />
        {texto.trim() ? (
          <button onClick={enviarTexto} disabled={enviando} title="Enviar" style={{ background: "#00A884", border: 0, borderRadius: 999, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>
            <Send size={18} color="white" />
          </button>
        ) : (
          <button onClick={gravar} disabled={enviando} title={gravando ? "Parar e enviar" : "Gravar áudio"}
            style={{ background: gravando ? "#DC2626" : "#00A884", border: 0, borderRadius: 999, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>
            {gravando ? <Square size={16} color="white" /> : <Mic size={18} color="white" />}
          </button>
        )}
      </div>
    </div>
  );
}

function Balao({ de, rodape, children }: { de: "DONO" | "BILL"; rodape?: string; children: React.ReactNode }) {
  const dono = de === "DONO";
  return (
    <div style={{ alignSelf: dono ? "flex-end" : "flex-start", maxWidth: "85%", display: "flex", gap: 6, alignItems: "flex-end" }}>
      {!dono && <RostoDoBill tamanho={24} piscar={false} style={{ flexShrink: 0 }} />}
      <div style={{ background: dono ? "#DCF8C6" : "white", borderRadius: 10, padding: "8px 11px", fontSize: 14, color: "#0F172A", whiteSpace: "pre-wrap", boxShadow: "0 1px 1px rgba(0,0,0,.08)", wordBreak: "break-word" }}>
        {children}
        {rodape && <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3, textAlign: "right" }}>{rodape}</div>}
      </div>
    </div>
  );
}
