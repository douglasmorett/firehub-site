"use client";
/**
 * Integrações → Foody Delivery / Voe Delivery: colar o token, testar, e dizer
 * QUANDO o FireHub chama o motoboy. Servidor: /api/store/integracoes/foody.
 *
 * O token nunca volta do servidor: a tela só sabe se há um salvo.
 */
import { useEffect, useState } from "react";
import { GATILHOS, type GatilhoFoody } from "@/lib/foody-delivery";

type Estado = { conectada: boolean; gatilho: GatilhoFoody; marcarEntregue: boolean; conectadoEm: string | null; podeEditar: boolean };
type Mensagem = { tipo: "ok" | "erro" | "info"; texto: string } | null;

const COR: Record<"ok" | "erro" | "info", { bg: string; borda: string; texto: string }> = {
  ok: { bg: "#F0FDFA", borda: "#99F6E4", texto: "#0F766E" },
  erro: { bg: "#FEF2F2", borda: "#FECACA", texto: "#B91C1C" },
  info: { bg: "#F8FAFC", borda: "#E2E8F0", texto: "#475569" },
};

export default function FoodyDeliveryConfig({ onMudou }: { onMudou?: (conectada: boolean) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [token, setToken] = useState("");
  const [gatilho, setGatilho] = useState<GatilhoFoody>("MANUAL");
  const [marcarEntregue, setMarcarEntregue] = useState(false);
  const [ocupado, setOcupado] = useState<"" | "testar" | "salvar" | "desconectar">("");
  const [msg, setMsg] = useState<Mensagem>(null);

  const aplicar = (d: Estado) => {
    setEstado(d);
    setGatilho(d.gatilho);
    setMarcarEntregue(d.marcarEntregue);
    onMudou?.(d.conectada);
  };

  useEffect(() => {
    fetch("/api/store/integracoes/foody", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && aplicar(d))
      .catch(() => setMsg({ tipo: "erro", texto: "Não consegui ler a integração agora. Feche e abra de novo." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testar = async () => {
    setOcupado("testar");
    setMsg(null);
    try {
      const r = await fetch("/api/store/integracoes/foody", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "testar", token: token.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      setMsg(d.ok
        ? { tipo: "ok", texto: `Conexão OK. A Foody respondeu${typeof d.pedidosHoje === "number" ? ` (${d.pedidosHoje} pedido(s) nas últimas 12 h)` : ""}.` }
        : { tipo: "erro", texto: d.erro || "A Foody não aceitou o token." });
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    }
    setOcupado("");
  };

  const salvar = async () => {
    setOcupado("salvar");
    setMsg(null);
    try {
      const r = await fetch("/api/store/integracoes/foody", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "salvar", token: token.trim() || undefined, gatilho, marcarEntregue }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: "erro", texto: d.error || "Não salvou." });
      } else {
        aplicar(d);
        setToken("");
        setMsg({ tipo: "ok", texto: "Salvo. Os pedidos de entrega já podem chamar o motoboy da Foody/Voe." });
      }
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    }
    setOcupado("");
  };

  const desconectar = async () => {
    if (!window.confirm("Desconectar a Foody/Voe? O FireHub para de chamar o motoboy por lá.")) return;
    setOcupado("desconectar");
    setMsg(null);
    try {
      const r = await fetch("/api/store/integracoes/foody", { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        aplicar(d);
        setMsg({ tipo: "info", texto: "Desconectado." });
      } else setMsg({ tipo: "erro", texto: d.error || "Não desconectou." });
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    }
    setOcupado("");
  };

  const podeEditar = estado?.podeEditar !== false;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #EA580C, #9A3412)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
          🛵
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Foody Delivery / Voe Delivery</h2>
          <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Chame o motoboy terceirizado direto do pedido, sem redigitar</span>
        </div>
      </div>

      {!estado ? (
        <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#475569" }}>Carregando…</div>
      ) : (
        <>
          <div style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 14, fontSize: "0.84rem", fontWeight: 700, ...(estado.conectada ? { background: "#F0FDFA", color: "#0F766E", border: "1px solid #99F6E4" } : { background: "#F8FAFC", color: "#64748B", border: "1px solid #E2E8F0" }) }}>
            {estado.conectada ? "🟢 Conectada — o token está salvo (cifrado)." : "⚪ Não conectada."}
          </div>

          <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "10px 12px", fontSize: "0.8rem", color: "#7C2D12", lineHeight: 1.5, marginBottom: 14 }}>
            <b>Onde pegar o token:</b> no painel da Foody (ou da Voe), abra <b>Menu ➡ Minha Conta ➡ APIs e Hooks</b> e copie o token de autorização. Cole aqui embaixo.
          </div>

          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>
            {estado.conectada ? "Trocar o token (deixe vazio para manter o atual)" : "Token da Foody / Voe"}
          </label>
          <input
            type="password"
            autoComplete="off"
            value={token}
            disabled={!podeEditar}
            onChange={(e) => setToken(e.target.value)}
            placeholder={estado.conectada ? "•••••••• (salvo)" : "Cole o token aqui"}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", marginBottom: 14, boxSizing: "border-box" }}
          />

          <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>Quando chamar o motoboy</div>
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {GATILHOS.map((g) => (
              <label key={g.valor} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${gatilho === g.valor ? "#EA580C" : "#E2E8F0"}`, background: gatilho === g.valor ? "#FFF7ED" : "#fff", cursor: podeEditar ? "pointer" : "default", fontSize: "0.84rem", color: "#1E293B" }}>
                <input type="radio" name="gatilho-foody" checked={gatilho === g.valor} disabled={!podeEditar} onChange={() => setGatilho(g.valor)} style={{ marginTop: 3 }} />
                <span>{g.rotulo}</span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: "0.76rem", color: "#64748B", marginBottom: 14, lineHeight: 1.45 }}>
            Só pedidos de <b>entrega da própria loja</b> vão para a Foody — retirada, mesa e pedido que o iFood/99 entrega com o entregador deles ficam de fora. Se o pedido for cancelado no FireHub, a entrega é cancelada na Foody.
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.84rem", color: "#1E293B", marginBottom: 16, cursor: podeEditar ? "pointer" : "default" }}>
            <input type="checkbox" checked={marcarEntregue} disabled={!podeEditar} onChange={(e) => setMarcarEntregue(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Quando a Foody marcar <b>entregue</b>, concluir o pedido no FireHub (pedidos do cardápio, WhatsApp e balcão).</span>
          </label>

          {msg && (
            <div style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 14, fontSize: "0.84rem", fontWeight: 700, background: COR[msg.tipo].bg, color: COR[msg.tipo].texto, border: `1px solid ${COR[msg.tipo].borda}` }}>
              {msg.texto}
            </div>
          )}

          {!podeEditar && (
            <div style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: 12 }}>Só o dono da loja muda esta integração.</div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={testar} disabled={Boolean(ocupado) || (!token.trim() && !estado.conectada)}
              style={{ padding: "10px 16px", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", color: "#0F172A" }}>
              {ocupado === "testar" ? "Testando…" : "Testar conexão"}
            </button>
            {podeEditar && (
              <button type="button" onClick={salvar} disabled={Boolean(ocupado) || (!token.trim() && !estado.conectada)}
                style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#EA580C", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}>
                {ocupado === "salvar" ? "Salvando…" : estado.conectada ? "Salvar" : "Conectar"}
              </button>
            )}
            {podeEditar && estado.conectada && (
              <button type="button" onClick={desconectar} disabled={Boolean(ocupado)}
                style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#F1F5F9", color: "#B91C1C", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", marginLeft: "auto" }}>
                {ocupado === "desconectar" ? "Desconectando…" : "Desconectar"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
