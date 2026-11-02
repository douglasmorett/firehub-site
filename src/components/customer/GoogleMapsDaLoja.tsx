"use client";

/**
 * O bloco "Mapa do Google" da roteirização: a loja conecta a PRÓPRIA conta do
 * Google (lib/google-maps-da-loja.ts). Uma faixa no topo da tela — "Problemas
 * no mapa?" (texto do Douglas, 01/11/2026) para quem não conectou, "Mapa do
 * Google conectado ✓" para quem conectou; o painel mostra o passo a passo e
 * recebe a chave (api/store/google-maps). A chave nunca volta para cá depois
 * de salva: só o final ("••••1234").
 */
import { useEffect, useState } from "react";
import { testarMapaNoNavegador } from "@/lib/mapa-do-google-no-leaflet";
import { PASSOS_PARA_CONECTAR, TEXTO_DA_FAIXA, partesDoPasso } from "@/lib/google-maps-da-loja";


type Estado = { conectado: boolean; final: string | null; buscasNoMes: number; podeEditar: boolean };

const LIMITE_GRATIS = 10000;

export default function GoogleMapsDaLoja() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

  useEffect(() => {
    fetch("/api/store/google-maps")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEstado(d))
      .catch(() => undefined);
  }, []);

  async function conectar() {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const r = await fetch("/api/store/google-maps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chave }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d?.error || "Não deu para conectar agora. Tente de novo.");
      } else {
        setEstado(d);
        setChave("");
        // A Geocoding API o servidor já testou; a Maps JavaScript API só se
        // testa aqui, no navegador.
        const m = await fetch("/api/store/google-maps?mapa=1").then((x) => (x.ok ? x.json() : null)).catch(() => null);
        const falhaDoMapa = m?.chaveDoMapa ? await testarMapaNoNavegador(m.chaveDoMapa) : null;
        if (falhaDoMapa) {
          setErro(`A busca de endereços funcionou, mas o mapa não: ${falhaDoMapa}`);
        } else {
          setOk("Pronto! A chave funcionou e o mapa do Google está conectado. Os próximos endereços já saem pelo Google. Feche e abra a roteirização de novo para ver o mapa do Google.");
        }
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar() {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const r = await fetch("/api/store/google-maps", { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d?.error || "Não deu para desconectar agora.");
      else {
        setEstado(d);
        setOk("Desconectado. A loja voltou para o mapa de antes.");
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setSalvando(false);
      setConfirmarSaida(false);
    }
  }

  const conectado = !!estado?.conectado;
  const passo = { margin: "0 0 6px", fontSize: "0.84rem", color: "#334155", lineHeight: 1.45 } as const;

  // Antes de saber o estado, nada: a faixa não pisca para quem já conectou.
  if (!estado) return null;

  return (
    <>
      {conectado ? (
        <button
          onClick={() => setAberto(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 16px", border: "none", borderBottom: "1px solid #BBF7D0",
            background: "#F0FDF4", color: "#15803D", fontSize: "0.82rem", fontWeight: 800, cursor: "pointer", textAlign: "left", flexShrink: 0,
          }}
        >
          🗺️ Mapa do Google conectado ✓
        </button>
      ) : (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 16px", background: "#EFF6FF",
            borderBottom: "1px solid #BFDBFE", flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 260, fontSize: "0.83rem", color: "#1E293B", lineHeight: 1.4 }}>
            <b style={{ color: "#1D4ED8" }}>🗺️ Problemas no mapa?</b> {TEXTO_DA_FAIXA}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setAberto(true)}
              style={{ padding: "7px 12px", background: "#1D4ED8", color: "#FFF", border: "none", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Conectar mapa do Google
            </button>
            <a
              href="/tutoriais/google-maps"
              target="_blank"
              rel="noreferrer"
              style={{ padding: "7px 12px", background: "#FFF", color: "#1D4ED8", border: "1px solid #BFDBFE", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              ▶ Ver vídeo
            </a>
          </div>
        </div>
      )}

      {aberto && (
        <div
          onClick={() => setAberto(false)}
          style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#FFFFFF", borderRadius: "14px", width: "100%", maxWidth: "540px", maxHeight: "90vh", overflowY: "auto", padding: "20px 22px", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 900, color: "#1C1917" }}>🗺️ Mapa do Google</h3>
              <button onClick={() => setAberto(false)} style={{ border: "none", background: "transparent", fontSize: "1.2rem", cursor: "pointer", color: "#64748B" }}>
                ✕
              </button>
            </div>

            {conectado ? (
              <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "10px", padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontWeight: 900, color: "#15803D", fontSize: "0.95rem" }}>Mapa do Google conectado ✓</div>
                <div style={{ fontSize: "0.84rem", color: "#334155", marginTop: 4 }}>
                  Chave ••••{estado?.final || "????"} · <b>{(estado?.buscasNoMes || 0).toLocaleString("pt-BR")}</b> buscas no mês (de {LIMITE_GRATIS.toLocaleString("pt-BR")} grátis)
                </div>
                <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: 6 }}>
                  Os endereços novos (site, robô, balcão e esta tela) saem pelo Google, e a roteirização abre no mapa do Google. Se o Google falhar, o sistema usa o mapa de antes sozinho.
                </div>
              </div>
            ) : (
              <p style={{ margin: "0 0 12px", fontSize: "0.88rem", color: "#1E293B", lineHeight: 1.5 }}>
                <b>Problemas no mapa?</b> {TEXTO_DA_FAIXA}
              </p>
            )}

            {!conectado && (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontWeight: 800, fontSize: "0.86rem", color: "#1C1917", marginBottom: 8 }}>Como conectar (uns 10 minutos):</div>
                {PASSOS_PARA_CONECTAR.map((texto, n) => (
                  <p key={n} style={n === PASSOS_PARA_CONECTAR.length - 1 ? { ...passo, marginBottom: 0 } : passo}>
                    {n + 1}.{" "}
                    {partesDoPasso(texto).map((x, k) => (x.negrito ? <b key={k}>{x.t}</b> : <span key={k}>{x.t}</span>))}
                  </p>
                ))}
                <a
                  href="/tutoriais/google-maps"
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-block", marginTop: 10, fontSize: "0.84rem", fontWeight: 800, color: "#1D4ED8" }}
                >
                  ▶ Ver vídeo
                </a>
              </div>
            )}

            {erro && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", borderRadius: "8px", padding: "10px 12px", fontSize: "0.84rem", marginBottom: 10 }}>
                {erro}
              </div>
            )}
            {ok && (
              <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", color: "#15803D", borderRadius: "8px", padding: "10px 12px", fontSize: "0.84rem", marginBottom: 10 }}>
                {ok}
              </div>
            )}

            {estado && !estado.podeEditar ? (
              <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B" }}>Só o titular da loja pode conectar ou desconectar a conta do Google.</p>
            ) : conectado ? (
              confirmarSaida ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.84rem", color: "#334155" }}>Desconectar e voltar para o mapa de antes?</span>
                  <button
                    onClick={desconectar}
                    disabled={salvando}
                    style={{ padding: "8px 12px", background: "#C92E09", color: "#FFF", border: "none", borderRadius: "8px", fontWeight: 800, cursor: "pointer" }}
                  >
                    {salvando ? "Desconectando…" : "Sim, desconectar"}
                  </button>
                  <button
                    onClick={() => setConfirmarSaida(false)}
                    style={{ padding: "8px 12px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: "8px", fontWeight: 800, cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmarSaida(true)}
                  style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#C92E09", borderRadius: "8px", fontWeight: 800, cursor: "pointer" }}
                >
                  Desconectar
                </button>
              )
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  placeholder="Cole aqui a chave (AIza...)"
                  autoComplete="off"
                  spellCheck={false}
                  style={{ flex: 1, padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "0.88rem", fontFamily: "monospace" }}
                />
                <button
                  onClick={conectar}
                  disabled={salvando || !chave.trim()}
                  style={{
                    padding: "10px 14px", background: salvando || !chave.trim() ? "#94A3B8" : "#1D4ED8", color: "#FFF", border: "none",
                    borderRadius: "8px", fontWeight: 800, cursor: salvando || !chave.trim() ? "default" : "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {salvando ? "Testando…" : "Conectar mapa do Google"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
