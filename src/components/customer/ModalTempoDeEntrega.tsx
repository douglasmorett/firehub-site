"use client";

import { useEffect, useState } from "react";
import DeliveryZoneMap from "./DeliveryZoneMap";

/**
 * "MUDAR TEMPO DE ENTREGA" — o botão da barra do painel de pedidos.
 *
 * Pedido do Douglas (15/10/2026): no movimento o lojista quer subir o tempo de
 * entrega sem sair do painel, e o tempo mora no mapa de Minha Loja › Entrega —
 * cada faixa de km, bairro ou área desenhada tem o seu (`deliveryZones[].time`).
 * Aqui abre o MESMO mapa (DeliveryZoneMap), por cima do painel.
 *
 * O cadastro é lido na hora em que o pop-up abre (GET /api/store-settings), não
 * do `user` do painel: a página de pedidos não carrega as zonas, e o mapa
 * gravado de outra aba seria sobrescrito por uma cópia velha. O GET devolve
 * também as áreas de risco e o contorno de atendimento — o PUT grava os dois
 * do jeito que chegam, e sem eles o pop-up apagaria o que a loja desenhou.
 */
type Cadastro = {
  deliveryZoneType: string | null;
  deliveryZones: any[] | null;
  storeLatLng: { lat: number; lng: number } | null;
  storeAddress: string | null;
  areasDeRisco?: any[];
  limiteDeAtendimento?: any[];
  repasseDoEntregador?: { separado?: boolean };
};

export default function ModalTempoDeEntrega({ nomeDaLoja, onClose }: { nomeDaLoja: string; onClose: () => void }) {
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/store-settings")
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.entrega) throw new Error(d?.error || `erro ${r.status}`);
        if (vivo) setCadastro(d.entrega);
      })
      .catch(e => vivo && setErro(String(e?.message || e)));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "2vh 1rem", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "1100px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "18px 22px", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: 42, height: 42, borderRadius: "12px", background: "#B45309", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>🛵</div>
            <div>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0, color: "#0F172A" }}>Mudar tempo de entrega</h3>
              <p style={{ fontSize: "0.8rem", color: "#64748B", margin: 0 }}>
                Mude os minutos (ou use o <strong>+5 / −5 min</strong>) e clique em <strong>Salvar</strong>, no quadro Entrega. O cliente vê o tempo novo no cardápio na hora.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.6rem", color: "#94A3B8", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "18px 22px" }}>
          {erro ? (
            <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "12px", padding: "14px", color: "#B71C1C", fontWeight: 600, fontSize: "0.88rem" }}>
              Não consegui abrir o cadastro de entrega ({erro}). Feche e tente de novo, ou mude em Minha Loja › Entrega.
            </div>
          ) : !cadastro ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: "#64748B", fontWeight: 600 }}>Abrindo o mapa da entrega…</div>
          ) : (
            <DeliveryZoneMap
              initialAddress={cadastro.storeAddress || ""}
              nomeDaLoja={nomeDaLoja}
              initialLatLng={cadastro.storeLatLng}
              initialZones={Array.isArray(cadastro.deliveryZones) ? cadastro.deliveryZones : []}
              zoneType={(cadastro.deliveryZoneType || "KM") as any}
              initialAreasDeRisco={cadastro.areasDeRisco || []}
              initialLimiteDeAtendimento={cadastro.limiteDeAtendimento || []}
              initialRepasseSeparado={cadastro.repasseDoEntregador ? cadastro.repasseDoEntregador.separado === true : null}
              onSave={async data => {
                // Só a entrega: o PUT grava o que vier no corpo, e nome,
                // telefone e capa da loja não são assunto deste pop-up.
                const res = await fetch("/api/store-settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    storeAddress: data.storeAddress,
                    storeLatLng: data.storeLatLng,
                    deliveryZones: data.deliveryZones,
                    deliveryZoneType: data.deliveryZoneType,
                    areasDeRisco: data.areasDeRisco || [],
                    limiteDeAtendimento: data.limiteDeAtendimento || [],
                  }),
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(result?.error || `erro ${res.status}`);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
