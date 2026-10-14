"use client";

/**
 * Meu Assessor — a tela do dono.
 *
 * Desligado: a oferta (o que faz, exemplos, R$ 29,90/mês, 7 dias grátis).
 * Ligado: de quais números falar, a conversa de teste (texto, áudio gravado
 * no navegador e foto — o mesmo assessor do WhatsApp, gravando de verdade) e
 * o histórico do que ele lançou.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Camera, Send, Package, Wallet, Receipt, Undo2, CheckCircle2, MessageCircle, Loader2 } from "lucide-react";

type Estado = { ativo: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean };
type Registro = { id: string; tipo: string; resumo: string; canal: string; desfeitoEm: string | null; criadoEm: string };
type Dados = { estado: Estado; preco: number; diasDeTeste: number; numerosDoDono: string[]; numeroDoRobo: string | null; registros: Registro[] };
type Fala = { de: "dono" | "assessor"; texto: string; detalhe?: string };
type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };

const VERDE = "#059669";
const fmtR = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fone = (d: string) => {
  const n = d.replace(/^55/, "");
  return n.length >= 10 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : d;
};
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const ROTULO: Record<string, { texto: string; cor: string }> = {
  COMPRA: { texto: "Compra", cor: "#2563EB" },
  SAIDA: { texto: "Saída", cor: "#D97706" },
  DESPESA: { texto: "Despesa", cor: "#DC2626" },
  CONTA: { texto: "Conta a pagar", cor: "#7C3AED" },
  CONTA_PAGA: { texto: "Conta paga", cor: VERDE },
};

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

export default function MeuAssessorClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [confirmarDesligar, setConfirmarDesligar] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/assessor", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 10000 : 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function ligar(ligar: boolean) {
    setSalvando(true);
    setConfirmarDesligar(false);
    try {
      const r = await fetch("/api/store/assessor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ligar }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro");
      setAviso(ligar
        ? { tipo: "ok", titulo: "Meu Assessor ligado!", detalhe: "Mande um áudio do seu WhatsApp para o número da loja e veja a mágica." }
        : { tipo: "ok", titulo: "Meu Assessor desligado.", detalhe: "Nada mais é cobrado a partir de hoje." });
      await carregar();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;

  const { estado } = dados;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px" }}>
      {aviso && (
        <div role="status" onClick={() => setAviso(null)} style={{
          position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
          width: "min(440px, calc(100vw - 24px))", background: aviso.tipo === "ok" ? "#ECFDF5" : "#FEF2F2",
          borderLeft: `4px solid ${aviso.tipo === "ok" ? VERDE : "#DC2626"}`, borderRadius: 12, padding: "12px 14px",
          boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
        }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
          {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0F172A", margin: 0 }}>Meu Assessor</h1>
        {estado.ativo && (
          <span style={{ fontSize: 12, fontWeight: 800, color: VERDE, background: "#ECFDF5", padding: "4px 10px", borderRadius: 999 }}>
            {estado.emTeste ? `TESTE GRÁTIS até ${new Date(estado.testeAte!).toLocaleDateString("pt-BR")}` : "LIGADO"}
          </span>
        )}
      </div>
      <p style={{ color: "#475569", margin: "0 0 20px", fontSize: 15 }}>
        Seu estoque e seu financeiro pelo WhatsApp. Mande um áudio, um texto ou a foto da nota — eu lanço no sistema na hora.
      </p>

      {!estado.ativo ? <Oferta dados={dados} salvando={salvando} onLigar={() => ligar(true)} /> : (
        <>
          <ComoUsar dados={dados} />
          <Conversa onGravou={carregar} />
          <Historico registros={dados.registros} />
          <div style={{ marginTop: 28, padding: 16, border: "1px solid #E2E8F0", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "#475569" }}>
              {estado.emTeste
                ? <>Grátis até <b>{new Date(estado.testeAte!).toLocaleDateString("pt-BR")}</b>. Depois, <b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub, proporcional aos dias ligados.</>
                : <><b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub, proporcional aos dias ligados.</>}
            </div>
            <button disabled={salvando} onClick={() => { if (confirmarDesligar) ligar(false); else setConfirmarDesligar(true); }}
              onBlur={() => setConfirmarDesligar(false)}
              style={{ background: confirmarDesligar ? "#DC2626" : "white", border: "1px solid", borderColor: confirmarDesligar ? "#DC2626" : "#CBD5E1", color: confirmarDesligar ? "white" : "#475569", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
              {confirmarDesligar ? "Toque de novo para desligar" : "Desligar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Oferta({ dados, salvando, onLigar }: { dados: Dados; salvando: boolean; onLigar: () => void }) {
  const exemplos = [
    { icone: Mic, titulo: "Manda um áudio", fala: "“Comprei 10 Coca lata no Atacadão, paguei 45 no Pix.”", resultado: "📦 +10 Coca-Cola Lata no estoque\n💰 R$ 45,00 no financeiro" },
    { icone: Camera, titulo: "Tira foto da nota", fala: "Foto da nota do fornecedor", resultado: "📦 Todos os itens no estoque, com custo\n💰 Conta paga ou a prazo" },
    { icone: Wallet, titulo: "Fala do gasto", fala: "“Paguei o gás, 130 reais.”", resultado: "💰 Despesa Gás R$ 130,00 no DRE" },
    { icone: Receipt, titulo: "Boleto e conta", fala: "“Paguei o boleto da Enel.”", resultado: "✅ Conta marcada como paga" },
    { icone: Package, titulo: "Perda e consumo", fala: "“Joguei fora 2 kg de queijo, estragou.”", resultado: "📦 Saída de 2 kg (perda) com o valor perdido" },
    { icone: MessageCircle, titulo: "Pergunta o que quiser", fala: "“Quanto tem de Coca? Quanto vendi hoje?”", resultado: "Resposta com o número do sistema" },
  ];
  return (
    <div>
      <div style={{ background: "linear-gradient(135deg,#064E3B,#065F46)", color: "white", borderRadius: 16, padding: "24px 22px", marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Você cuida da loja. Eu cuido da papelada.</div>
        <div style={{ fontSize: 14, opacity: 0.9, maxWidth: 620 }}>
          Chegou mercadoria? Pagou uma conta? Fala com o WhatsApp da sua loja, do seu número, como falaria com um gerente. A quantidade vai para o estoque e o valor vai para o financeiro — numa mensagem só.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={onLigar} disabled={salvando} style={{ background: "#FACC15", color: "#0F172A", border: 0, borderRadius: 10, padding: "12px 20px", fontWeight: 900, fontSize: 15, cursor: "pointer" }}>
            {salvando ? "Ligando…" : dados.estado.jaTestou ? `Ligar por ${fmtR(dados.preco)}/mês` : `Testar ${dados.diasDeTeste} dias grátis`}
          </button>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            Depois, <b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub. Desliga quando quiser, paga só os dias ligados.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {exemplos.map((e) => (
          <div key={e.titulo} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 14, background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
              <e.icone size={18} color={VERDE} /> {e.titulo}
            </div>
            <div style={{ background: "#DCF8C6", borderRadius: 10, padding: "8px 10px", fontSize: 13, color: "#0F172A", marginBottom: 6 }}>{e.fala}</div>
            <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "8px 10px", fontSize: 13, color: "#334155", whiteSpace: "pre-line" }}>{e.resultado}</div>
          </div>
        ))}
      </div>
      {dados.numerosDoDono.length === 0 && (
        <p style={{ marginTop: 16, fontSize: 13, color: "#B45309" }}>
          ⚠️ Cadastre o seu WhatsApp em <b>Minha Loja</b> (WhatsApp do proprietário): é por ele que o assessor sabe que é você.
        </p>
      )}
    </div>
  );
}

function ComoUsar({ dados }: { dados: Dados }) {
  return (
    <div style={{ border: "1px solid #BBF7D0", background: "#F0FDF4", borderRadius: 12, padding: 16, marginBottom: 18 }}>
      <div style={{ fontWeight: 800, color: "#065F46", marginBottom: 6 }}>Como usar pelo WhatsApp</div>
      {dados.numerosDoDono.length > 0 ? (
        <div style={{ fontSize: 14, color: "#065F46" }}>
          Do {dados.numerosDoDono.length > 1 ? "seus números" : "seu número"} <b>{dados.numerosDoDono.map(fone).join(", ")}</b>, mande mensagem para o WhatsApp da loja
          {dados.numeroDoRobo ? <> (<b>{fone(dados.numeroDoRobo)}</b>)</> : " conectado no Chatbot IA"}. Áudio, texto ou foto. Errou? Manda <b>desfaz</b>.
          <div style={{ fontSize: 12, marginTop: 4, color: "#047857" }}>Outros números (sócio, gerente) entram em Chatbot IA › Notificações.</div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: "#B45309" }}>
          Falta o seu número: cadastre o WhatsApp do proprietário em <b>Minha Loja</b>. Enquanto isso, use a conversa aqui embaixo.
        </div>
      )}
    </div>
  );
}

function Conversa({ onGravou }: { onGravou: () => void }) {
  const [falas, setFalas] = useState<Fala[]>([
    { de: "assessor", texto: "Oi, chefe! Me fala o que chegou, o que pagou ou o que quer saber. Pode mandar áudio ou foto da nota." },
  ]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const fim = useRef<HTMLDivElement | null>(null);
  const arquivo = useRef<HTMLInputElement | null>(null);

  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [falas]);

  async function mandar(corpo: { texto?: string; audio?: any; imagem?: any }, rotulo: string) {
    setFalas((f) => [...f, { de: "dono", texto: rotulo }]);
    setEnviando(true);
    try {
      const r = await fetch("/api/store/assessor/conversar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro");
      setFalas((f) => {
        const copia = [...f];
        if (j.ouvi) copia[copia.length - 1] = { de: "dono", texto: rotulo, detalhe: `“${j.ouvi}”` };
        return [...copia, { de: "assessor", texto: j.resposta }];
      });
      if (j.gravou) onGravou();
    } catch (e: any) {
      setFalas((f) => [...f, { de: "assessor", texto: `⚠️ ${e.message}` }]);
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
      setFalas((f) => [...f, { de: "assessor", texto: "⚠️ O navegador não liberou o microfone. Permita o microfone no cadeado da barra de endereço." }]);
    }
  }

  async function foto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const imagem = await fotoReduzida(f);
    await mandar({ imagem, texto: texto.trim() || undefined }, `📷 Foto${texto.trim() ? `: ${texto.trim()}` : ""}`);
    setTexto("");
  }

  function enviarTexto() {
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto("");
    mandar({ texto: t }, t);
  }

  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden", marginBottom: 22, background: "#EFEAE2" }}>
      <div style={{ background: "#075E54", color: "white", padding: "10px 14px", fontWeight: 800, fontSize: 14 }}>
        Converse aqui (o mesmo assessor do WhatsApp — lança de verdade)
      </div>
      <div style={{ height: 380, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {falas.map((f, i) => (
          <div key={i} style={{
            alignSelf: f.de === "dono" ? "flex-end" : "flex-start", maxWidth: "80%",
            background: f.de === "dono" ? "#DCF8C6" : "white", borderRadius: 10, padding: "8px 11px",
            fontSize: 14, color: "#0F172A", whiteSpace: "pre-wrap", boxShadow: "0 1px 1px rgba(0,0,0,.08)",
          }}>
            {/* *negrito* do WhatsApp vira negrito aqui também */}
            {f.texto.split(/(\*[^*\n]+\*)/g).map((p, j) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={j}>{p.slice(1, -1)}</b> : p)}
            {f.detalhe && <div style={{ fontSize: 12, color: "#475569", marginTop: 4, fontStyle: "italic" }}>{f.detalhe}</div>}
          </div>
        ))}
        {enviando && (
          <div style={{ alignSelf: "flex-start", background: "white", borderRadius: 10, padding: "8px 11px", fontSize: 13, color: "#64748B", display: "flex", gap: 6, alignItems: "center" }}>
            <Loader2 size={14} className="animate-spin" /> lançando…
          </div>
        )}
        <div ref={fim} />
      </div>
      <div style={{ display: "flex", gap: 8, padding: 10, background: "#F0F2F5", alignItems: "center" }}>
        <input ref={arquivo} type="file" accept="image/*" capture="environment" onChange={foto} style={{ display: "none" }} />
        <button title="Foto da nota ou do boleto" onClick={() => arquivo.current?.click()} disabled={enviando || gravando}
          style={{ background: "white", border: 0, borderRadius: 999, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer" }}>
          <Camera size={18} color="#475569" />
        </button>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") enviarTexto(); }}
          placeholder={gravando ? "Gravando… toque no quadrado para enviar" : "Ex.: comprei 10 coca lata, paguei 45"}
          disabled={enviando || gravando}
          style={{ flex: 1, border: 0, borderRadius: 999, padding: "10px 14px", fontSize: 14, outline: "none" }} />
        {texto.trim() ? (
          <button onClick={enviarTexto} disabled={enviando} style={{ background: "#00A884", border: 0, borderRadius: 999, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer" }}>
            <Send size={18} color="white" />
          </button>
        ) : (
          <button onClick={gravar} disabled={enviando} title={gravando ? "Parar e enviar" : "Gravar áudio"}
            style={{ background: gravando ? "#DC2626" : "#00A884", border: 0, borderRadius: 999, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer" }}>
            {gravando ? <Square size={16} color="white" /> : <Mic size={18} color="white" />}
          </button>
        )}
      </div>
    </div>
  );
}

function Historico({ registros }: { registros: Registro[] }) {
  return (
    <div>
      <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 8, fontSize: 16 }}>O que o assessor lançou</div>
      {registros.length === 0 ? (
        <div style={{ color: "#64748B", fontSize: 14, padding: 14, border: "1px dashed #CBD5E1", borderRadius: 12 }}>
          Nada ainda. Os lançamentos aparecem aqui e também em Estoque e Financeiro, como se você tivesse digitado.
        </div>
      ) : (
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          {registros.map((r) => {
            const rot = ROTULO[r.tipo] || { texto: r.tipo, cor: "#475569" };
            return (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderBottom: "1px solid #F1F5F9", background: "white", opacity: r.desfeitoEm ? 0.55 : 1 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: rot.cor, background: `${rot.cor}14`, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{rot.texto}</span>
                <div style={{ flex: 1, fontSize: 14, color: "#0F172A", textDecoration: r.desfeitoEm ? "line-through" : "none" }}>{r.resumo}</div>
                <div style={{ fontSize: 12, color: "#64748B", whiteSpace: "nowrap", textAlign: "right" }}>
                  {dataHora(r.criadoEm)}
                  <div>{r.desfeitoEm ? <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}><Undo2 size={11} /> desfeito</span>
                    : <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}><CheckCircle2 size={11} color={VERDE} /> {r.canal === "PAINEL" ? "painel" : "WhatsApp"}</span>}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
