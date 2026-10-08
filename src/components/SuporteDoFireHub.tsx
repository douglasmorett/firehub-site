"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Hand, PlayCircle, Send, UserRound } from "lucide-react";

/**
 * A ABA "SUPORTE FIREHUB" do balão do painel (HumanSupportFloatingWidget).
 *
 * O lojista fala com o FireHub sem sair do painel e sem WhatsApp: o robô do
 * atendimento responde aqui (passo a passo e o vídeo do assunto) e chama a
 * equipe quando precisa; a equipe responde pela tela de Atendimento do admin.
 * Servidor em /api/store/suporte e lib/atendimento/painel.ts.
 *
 * Existe porque o número do FireHub já foi banido duas vezes, e a cada queda
 * os lojistas ficavam sem ter com quem falar (Douglas, 08/10/2026).
 */

type Mensagem = { id: string; de: "LOJA" | "ROBO" | "EQUIPE" | "SISTEMA"; nome: string | null; texto: string; em: string };
type Estado = { mensagens: Mensagem[]; aguardandoPessoa: boolean; roboAtende: boolean };

/** As portas de entrada: o lojista escolhe o assunto num toque e o robô já começa por ele. */
const ASSUNTOS = [
  { rotulo: "Dúvida de como usar o painel", texto: "Tenho uma dúvida de como usar o painel." },
  { rotulo: "A impressora não imprime", texto: "Os pedidos não estão imprimindo." },
  { rotulo: "O robô do WhatsApp da loja parou", texto: "O robô do WhatsApp da minha loja parou de responder." },
  { rotulo: "Pedido do iFood ou 99 não chegou", texto: "Um pedido do iFood/99 não chegou no painel." },
  { rotulo: "Mensalidade e boleto", texto: "Tenho uma dúvida sobre a mensalidade e o boleto." },
];

const CHAVE_VISTO = "firehub_suporte_visto";
const CHAVE_USADO = "firehub_suporte_usado";

function lerLocal(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarLocal(chave: string, valor: string) {
  try { localStorage.setItem(chave, valor); } catch { /* aba anônima: só perde o aviso */ }
}

/**
 * O balão FECHADO precisa saber se o suporte respondeu. Pergunta a cada 45 s,
 * e só depois que este navegador já usou o chat: o painel fica aberto o dia
 * inteiro em dezenas de lojas, e quem nunca escreveu não tem resposta a esperar.
 */
export function useRespostaNovaDoSuporte(vendoOChat: boolean): boolean {
  const [nova, setNova] = useState(false);
  useEffect(() => {
    if (vendoOChat) { setNova(false); return; }
    let parado = false;
    const conferir = async () => {
      if (document.hidden || lerLocal(CHAVE_USADO) !== "1") return;
      try {
        const r = await fetch("/api/store/suporte?resumo=1");
        if (!r.ok) return;
        const { ultimaRespostaEm } = await r.json();
        const visto = lerLocal(CHAVE_VISTO);
        if (!parado) setNova(!!ultimaRespostaEm && (!visto || ultimaRespostaEm > visto));
      } catch { /* sem rede: tenta na próxima */ }
    };
    void conferir();
    const i = setInterval(conferir, 45_000);
    return () => { parado = true; clearInterval(i); };
  }, [vendoOChat]);
  return nova;
}

/** *negrito* do robô e links clicáveis; link de tutorial vira botão de vídeo. */
function textoRico(texto: string): React.ReactNode {
  const linhas = texto.split("\n");
  return linhas.map((linha, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {linha.split(/(https?:\/\/[^\s]+)/g).map((parte, j) => {
        if (/^https?:\/\//.test(parte)) {
          const url = parte.replace(/[).,;!?]+$/, "");
          // O vídeo do assunto (o robô manda o capítulo do YouTube ou a página /tutoriais).
          if (/\/tutoriais\/|youtube\.com\/watch|youtu\.be\//.test(url)) {
            return (
              <a key={j} href={url} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, padding: "6px 12px", borderRadius: 999, background: "#C92E09", color: "#fff", fontWeight: 800, fontSize: "0.78rem", textDecoration: "none" }}>
                <PlayCircle size={15} aria-hidden /> {/[?&]t=\d/.test(url) ? "Ver este trecho do vídeo" : "Assistir ao tutorial"}
              </a>
            );
          }
          return <a key={j} href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#B71C1C", fontWeight: 700, wordBreak: "break-all" }}>{url}</a>;
        }
        return parte.split(/(\*[^*\n]+\*)/g).map((p, k) =>
          /^\*[^*\n]+\*$/.test(p) ? <b key={`${j}-${k}`}>{p.slice(1, -1)}</b> : <React.Fragment key={`${j}-${k}`}>{p}</React.Fragment>,
        );
      })}
    </React.Fragment>
  ));
}

const hora = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default function SuporteDoFireHub() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/suporte");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d?.error || "Não deu para abrir o suporte agora."); return; }
      setErro("");
      setEstado(d);
    } catch {
      setErro("Sem conexão com o servidor. Tentando de novo…");
    }
  }, []);

  const ultima = estado?.mensagens[estado.mensagens.length - 1];
  // Esperando resposta (do robô ou da equipe): pergunta mais rápido.
  const esperando = !!estado && (estado.aguardandoPessoa || ultima?.de === "LOJA");

  useEffect(() => {
    void carregar();
    const i = setInterval(() => { if (!document.hidden) void carregar(); }, esperando ? 3000 : 8000);
    return () => clearInterval(i);
  }, [carregar, esperando]);

  // Ver a conversa é ter visto a resposta: o aviso do balão fechado some.
  useEffect(() => {
    const ultimaResposta = [...(estado?.mensagens || [])].reverse().find((m) => m.de !== "LOJA");
    if (ultimaResposta) gravarLocal(CHAVE_VISTO, ultimaResposta.em);
  }, [estado]);

  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [estado?.mensagens.length, enviando]);

  const mandar = async (corpo: { texto?: string; pedirPessoa?: boolean }) => {
    if (enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/store/suporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d?.error || "A mensagem não foi. Tente de novo."); return false; }
      gravarLocal(CHAVE_USADO, "1");
      setEstado(d);
      return true;
    } catch {
      setErro("Sem conexão com o servidor. A mensagem não foi.");
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t) return;
    if (await mandar({ texto: t })) setTexto("");
  };

  // O robô vai responder: "digitando…" até a resposta chegar (ou 2 min, se algo falhou no caminho).
  const digitando = !!estado && estado.roboAtende && ultima?.de === "LOJA" && Date.now() - new Date(ultima.em).getTime() < 120_000;
  const vazio = !!estado && estado.mensagens.length === 0;

  const balaoDaEquipe = (m: Mensagem) => (
    <div key={m.id} style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
      <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#64748B", margin: "0 0 2px 4px", display: "flex", alignItems: "center", gap: 4 }}>
        {m.de === "ROBO" ? <Bot size={11} aria-hidden /> : <UserRound size={11} aria-hidden />}
        {m.de === "ROBO" ? "Assistente FireHub" : `${m.nome || "Equipe"} · equipe FireHub`}
      </div>
      <div style={{ background: "#fff", color: "#0F172A", padding: "8px 12px", borderRadius: "0 12px 12px 12px", fontSize: "0.82rem", lineHeight: 1.45, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", overflowWrap: "anywhere" }}>
        {textoRico(m.texto)}
        <div style={{ fontSize: "0.62rem", color: "#94A3B8", textAlign: "right", marginTop: 2 }}>{hora(m.em)}</div>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "#F8FAFC" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {!estado && !erro && <div style={{ textAlign: "center", color: "#94A3B8", fontSize: "0.8rem", padding: 30 }}>Abrindo o suporte…</div>}

        {estado && (
          // A saudação é da tela, não da conversa: não vai para o banco nem para o robô.
          balaoDaEquipe({
            id: "saudacao", de: "ROBO", nome: null, em: estado.mensagens[0]?.em || new Date().toISOString(),
            texto: "Oi! Sou o assistente do FireHub. Me conta o que você precisa: eu explico o passo a passo, mando o vídeo do assunto e, se for o caso, chamo alguém da equipe. Pode escolher um assunto abaixo ou escrever.",
          })
        )}

        {vazio && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 6px" }}>
            {ASSUNTOS.map((a) => (
              <button key={a.rotulo} disabled={enviando} onClick={() => void mandar({ texto: a.texto })}
                style={{ border: "1px solid #FECACA", background: "#fff", color: "#B71C1C", borderRadius: 999, padding: "6px 11px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                {a.rotulo}
              </button>
            ))}
            <a href="/tutoriais" target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #E2E8F0", background: "#fff", color: "#334155", borderRadius: 999, padding: "6px 11px", fontSize: "0.75rem", fontWeight: 700, textDecoration: "none" }}>
              <PlayCircle size={13} aria-hidden /> Ver todos os tutoriais
            </a>
          </div>
        )}

        {estado?.mensagens.map((m) =>
          m.de === "LOJA" ? (
            <div key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "#FFEDD5", color: "#0F172A", padding: "8px 12px", borderRadius: "12px 0 12px 12px", fontSize: "0.82rem", lineHeight: 1.45, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {m.texto}
              <div style={{ fontSize: "0.62rem", color: "#9A3412", textAlign: "right", marginTop: 2, opacity: 0.7 }}>{hora(m.em)}</div>
            </div>
          ) : m.de === "SISTEMA" ? (
            <div key={m.id} style={{ alignSelf: "center", maxWidth: "92%", background: "#F1F5F9", color: "#475569", padding: "6px 12px", borderRadius: 10, fontSize: "0.74rem", textAlign: "center" }}>
              {m.texto}
            </div>
          ) : (
            balaoDaEquipe(m)
          ),
        )}

        {digitando && (
          <div style={{ alignSelf: "flex-start", background: "#fff", color: "#64748B", padding: "7px 12px", borderRadius: "0 12px 12px 12px", fontSize: "0.76rem", fontStyle: "italic", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }}>
            Assistente digitando…
          </div>
        )}
        <div ref={fim} />
      </div>

      {estado?.aguardandoPessoa && (
        <div style={{ background: "#FFF7ED", borderTop: "1px solid #FED7AA", color: "#9A3412", fontSize: "0.74rem", fontWeight: 700, padding: "7px 12px", display: "flex", gap: 6, alignItems: "center" }}>
          <Hand size={14} aria-hidden style={{ flexShrink: 0 }} /> A equipe foi avisada. A resposta chega aqui, neste chat.
        </div>
      )}
      {erro && <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: "0.74rem", fontWeight: 700, padding: "6px 12px" }}>{erro}</div>}

      <div style={{ padding: "10px", background: "#fff", borderTop: "1px solid #E2E8F0" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            value={texto}
            rows={1}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
            placeholder="Escreva sua dúvida…"
            aria-label="Mensagem para o suporte do FireHub"
            maxLength={2000}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 18, border: "1px solid #CBD5E1", fontSize: "0.82rem", outline: "none", resize: "none", fontFamily: "inherit", maxHeight: 96 }}
          />
          <button onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar"
            style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "50%", background: "#C92E09", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: enviando || !texto.trim() ? 0.5 : 1 }}>
            <Send size={16} />
          </button>
        </div>
        {estado && !estado.aguardandoPessoa && (
          <button onClick={() => void mandar({ pedirPessoa: true })} disabled={enviando}
            style={{ marginTop: 6, background: "none", border: "none", color: "#64748B", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Hand size={12} aria-hidden /> {vazio ? "Prefiro falar com uma pessoa" : "Falar com uma pessoa da equipe"}
          </button>
        )}
      </div>
    </div>
  );
}
