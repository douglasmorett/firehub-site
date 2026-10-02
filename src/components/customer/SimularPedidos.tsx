"use client";

/**
 * "▶ Simular pedidos" — só na loja de demonstração do vendedor (lib/pedidos-simulados.ts).
 *
 * Um botão só para os dois sentidos: sem simulação na tela ele joga os pedidos;
 * com simulação, o mesmo botão vira "Retirar simulação" e apaga só o que ele
 * criou. A tela de pedidos busca os novos sozinha (e toca o aviso de pedido
 * novo, que faz parte da demonstração); para tirar, a página recarrega — o
 * painel não tem como saber de pedido apagado até a próxima lista completa.
 */
import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";

export default function SimularPedidos() {
  const [quantos, setQuantos] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/store/simular-pedidos")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setQuantos(Number(d.quantidade) || 0); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  if (quantos === null) return null;
  const temSimulacao = quantos > 0;

  const clicar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const res = await fetch("/api/store/simular-pedidos", { method: temSimulacao ? "DELETE" : "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ texto: d.error || "Não deu certo. Tente de novo.", erro: true });
        return;
      }
      if (temSimulacao) {
        setQuantos(0);
        window.location.reload();
        return;
      }
      setQuantos(Number(d.quantidade) || 0);
      setAviso({ texto: `${d.quantidade} pedidos simulados entrando na tela${d.caixaAberto ? " (o caixa foi aberto para eles)" : ""}.` });
      // Fora da tela de pedidos não há o que ver: leva para lá.
      if (!window.location.pathname.startsWith("/store/pedidos-clientes")) {
        window.location.href = "/store/pedidos-clientes";
      }
    } catch {
      setAviso({ texto: "Sem conexão. Tente de novo.", erro: true });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        title={temSimulacao ? "Apaga os pedidos de demonstração da tela" : "Joga 20 pedidos de demonstração (iFood, 99Food, site, retirada, mesa, balcão...) na tela"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20,
          border: "1.5px solid rgba(255,255,255,0.45)",
          background: temSimulacao ? "rgba(0,0,0,0.28)" : "#fff",
          color: temSimulacao ? "#fff" : "#C92E09",
          fontWeight: 800, fontSize: "0.75rem", cursor: ocupado ? "wait" : "pointer",
          fontFamily: "inherit", whiteSpace: "nowrap", opacity: ocupado ? 0.7 : 1,
        }}
      >
        {temSimulacao ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
        {ocupado
          ? (temSimulacao ? "Retirando..." : "Simulando...")
          : temSimulacao ? `Retirar simulação (${quantos})` : "Simular pedidos"}
      </button>
      {aviso && (
        <div
          role="status"
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 600, minWidth: 240, maxWidth: 320,
            padding: "10px 12px", borderRadius: 12, background: aviso.erro ? "#FEF2F2" : "#F0FDFA",
            border: `1px solid ${aviso.erro ? "#FECACA" : "#99F6E4"}`, color: aviso.erro ? "#991B1B" : "#115E59",
            fontSize: "0.8rem", fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          }}
        >
          {aviso.texto}
        </div>
      )}
    </div>
  );
}
