"use client";
/**
 * "Chamar motoboy Voe/Foody" dentro de Informações da Entrega do pedido
 * (StoreOrdersDashboard). Loja sem a integração: não desenha nada.
 *
 * Depois de chamado: o status na Foody, o motoboy (nome e telefone) e o link de
 * rastreio. Enquanto a tela está aberta, relê a cada 30 s — quem atualiza de
 * verdade é o cron de acompanhamento (api/cron/foody-acompanhamento).
 */
import { useCallback, useEffect, useState } from "react";
import { rotuloDoStatus } from "@/lib/foody-delivery";

type EntregaTela = {
  estado: "ENVIANDO" | "ENVIADO" | "ERRO";
  status: string | null;
  idFoody: string | null;
  uid: string | null;
  trackerUrl: string | null;
  courierName: string | null;
  courierPhone: string | null;
  erro: string | null;
  origem: string | null;
  podeChamarDeNovo: boolean;
  podeCancelar: boolean;
};
type Estado = { ligada: boolean; pode?: boolean; motivo?: string | null; entrega?: EntregaTela | null };

export default function FoodyNoPedido({ pedidoId }: { pedidoId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ler = useCallback(() => {
    fetch(`/api/store/foody/pedido/${encodeURIComponent(pedidoId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEstado(d))
      .catch(() => {});
  }, [pedidoId]);

  useEffect(() => {
    ler();
    const t = setInterval(ler, 30_000);
    return () => clearInterval(t);
  }, [ler]);

  if (!estado?.ligada) return null;

  const agir = async (acao: "chamar" | "cancelar") => {
    if (acao === "cancelar" && !window.confirm("Cancelar a entrega na Foody/Voe? O pedido continua no FireHub.")) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch(`/api/store/foody/pedido/${encodeURIComponent(pedidoId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) setErro(d.erro || d.error || "A Foody não aceitou.");
      setEstado((e) => ({ ...(e || { ligada: true }), entrega: d.entrega ?? e?.entrega ?? null }));
    } catch {
      setErro("Sem conexão. Tente de novo.");
    }
    setOcupado(false);
  };

  const e = estado.entrega;
  const viva = e && e.estado !== "ERRO" && !e.podeChamarDeNovo;
  const fone = e?.courierPhone ? e.courierPhone.replace(/[^\d+]/g, "") : "";

  return (
    <div style={{ marginBottom: 16, border: "1.5px solid #FED7AA", background: "#FFF7ED", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#9A3412" }}>🛵 Motoboy Voe / Foody</div>
        {viva && e?.idFoody && <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#9A3412" }}>Pedido na Foody: {e.idFoody}</span>}
      </div>

      {viva ? (
        <div style={{ marginTop: 6, fontSize: "0.84rem", color: "#1E293B", lineHeight: 1.5 }}>
          <div><b>Status:</b> {e?.estado === "ENVIANDO" ? "Enviando…" : rotuloDoStatus(e?.status)}</div>
          {e?.courierName && (
            <div>
              <b>Entregador:</b> {e.courierName}
              {fone && <> · <a href={`tel:${fone}`} style={{ color: "#9A3412", fontWeight: 700 }}>{e.courierPhone}</a></>}
            </div>
          )}
          {e?.trackerUrl && (
            <div><a href={e.trackerUrl} target="_blank" rel="noreferrer" style={{ color: "#9A3412", fontWeight: 800 }}>Abrir o rastreio ↗</a></div>
          )}
          {e?.erro && <div style={{ color: "#B91C1C", fontWeight: 700, marginTop: 4 }}>{e.erro}</div>}
          {e?.podeCancelar && (
            <button type="button" disabled={ocupado} onClick={() => agir("cancelar")}
              style={{ marginTop: 8, padding: "6px 12px", borderRadius: 8, border: "1px solid #FECACA", background: "#fff", color: "#B91C1C", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer" }}>
              {ocupado ? "Cancelando…" : "Cancelar na Foody"}
            </button>
          )}
        </div>
      ) : estado.pode === false ? (
        <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#64748B" }}>{estado.motivo}</div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {e?.estado === "ERRO" && e.erro && (
            <div style={{ fontSize: "0.8rem", color: "#B91C1C", fontWeight: 700, marginBottom: 6 }}>Não foi: {e.erro}</div>
          )}
          {e && e.podeChamarDeNovo && e.estado !== "ERRO" && (
            <div style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: 6 }}>A entrega anterior ficou: {rotuloDoStatus(e.status)}.</div>
          )}
          <button type="button" disabled={ocupado} onClick={() => agir("chamar")}
            style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#EA580C", color: "#fff", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer" }}>
            {ocupado ? "Chamando…" : e ? "Chamar motoboy de novo" : "Chamar motoboy Voe/Foody"}
          </button>
        </div>
      )}

      {erro && <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#B91C1C", fontWeight: 700 }}>{erro}</div>}
    </div>
  );
}
