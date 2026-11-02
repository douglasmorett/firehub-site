"use client";

/**
 * O bloco "Mapa do Google" da roteirização (lib/google-maps-da-loja.ts): só
 * para a loja que JÁ conectou a própria conta do Google — "Mapa do Google
 * conectado ✓", com o uso do mês e o Desconectar. A chave nunca volta para cá
 * depois de salva: só o final ("••••1234").
 *
 * O convite para conectar ("Problemas no mapa?", o passo a passo, o vídeo e o
 * campo da chave) saiu da tela em 02/11/2026, por decisão do Douglas: o Google
 * cobra da loja, e os endereços passaram a sair da base do IBGE
 * (lib/enderecos-ibge.ts), de graça. O servidor segue aceitando a chave de
 * quem já conectou (api/store/google-maps).
 */
import { useEffect, useState } from "react";


type Estado = { conectado: boolean; final: string | null; buscasNoMes: number; podeEditar: boolean };

const LIMITE_GRATIS = 10000;

export default function GoogleMapsDaLoja() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aberto, setAberto] = useState(false);
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

  // Antes de saber o estado, nada; sem a conta conectada, nada também (o
  // painel aberto fica até fechar, para mostrar o "Desconectado").
  if (!estado || (!conectado && !aberto)) return null;

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
      ) : null}

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
            ) : null}

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
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
