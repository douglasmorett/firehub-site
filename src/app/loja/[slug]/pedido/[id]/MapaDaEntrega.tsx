"use client";

/**
 * O entregador andando no mapa, como no iFood — só enquanto o pedido está na
 * rua. A posição chega pela rota de status (lib/entrega-ao-vivo.ts), que a
 * página já consulta; aqui só se desenha e se move o pino.
 */
import { useEffect, useRef } from "react";
import type { EntregaAoVivo } from "@/lib/entrega-ao-vivo";

const pino = (emoji: string, tamanho: number) =>
  `<div style="font-size:${tamanho}px;line-height:${tamanho}px;transform:translate(-50%,-60%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">${emoji}</div>`;

export default function MapaDaEntrega({ aoVivo }: { aoVivo: EntregaAoVivo }) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<any>(null);
  const motoRef = useRef<any>(null);
  const casaRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const enquadrou = useRef(false);

  // O CSS do Leaflet vem do nosso domínio: o CSP bloqueia stylesheet de CDN.
  useEffect(() => {
    if (document.querySelector('link[href="/leaflet/leaflet.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/leaflet/leaflet.css";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    let vivo = true;
    import("leaflet").then((L) => {
      if (!vivo || !caixa.current || mapaRef.current) return;
      LRef.current = L;
      const inicio = aoVivo.entregador || aoVivo.destino!;
      const mapa = L.map(caixa.current, { zoomControl: false, attributionControl: true }).setView([inicio.lat, inicio.lng], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(mapa);
      mapaRef.current = mapa;
      desenhar();
      setTimeout(() => mapa.invalidateSize(), 200);
    });
    return () => {
      vivo = false;
      mapaRef.current?.remove();
      mapaRef.current = null;
      motoRef.current = null;
      casaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { desenhar(); });

  function desenhar() {
    const L = LRef.current;
    const mapa = mapaRef.current;
    if (!L || !mapa) return;
    const { entregador, destino } = aoVivo;

    if (destino && !casaRef.current) {
      casaRef.current = L.marker([destino.lat, destino.lng], {
        icon: L.divIcon({ className: "", html: pino("🏠", 28), iconSize: [28, 28] }),
      }).addTo(mapa);
    }
    if (entregador) {
      if (!motoRef.current) {
        motoRef.current = L.marker([entregador.lat, entregador.lng], {
          icon: L.divIcon({ className: "", html: pino("🛵", 34), iconSize: [34, 34] }),
          zIndexOffset: 1000,
        }).addTo(mapa);
      } else {
        motoRef.current.setLatLng([entregador.lat, entregador.lng]);
      }
    } else if (motoRef.current) {
      motoRef.current.remove();
      motoRef.current = null;
    }

    // Enquadra a moto e a casa uma vez; depois o cliente mexe no mapa à vontade.
    if (!enquadrou.current && entregador && destino) {
      mapa.fitBounds([[entregador.lat, entregador.lng], [destino.lat, destino.lng]], { padding: [40, 40], maxZoom: 17 });
      enquadrou.current = true;
    } else if (!enquadrou.current && entregador) {
      mapa.setView([entregador.lat, entregador.lng], 16);
    }
  }

  const km = aoVivo.distanciaKm;
  const legenda = !aoVivo.entregador
    ? "Aguardando a localização do entregador…"
    : km == null
      ? `${aoVivo.entregador.nome || "O entregador"} está a caminho`
      : km < 0.15
        ? `${aoVivo.entregador.nome || "O entregador"} chegou! 🎉`
        : `${aoVivo.entregador.nome || "O entregador"} está a ${km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`} de você`;

  return (
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.08)", marginBottom: "1rem" }}>
      <div ref={caixa} style={{ height: 260, width: "100%", background: "#E2E8F0" }} />
      <div style={{ padding: ".75rem 1rem", display: "flex", alignItems: "center", gap: 8, fontSize: ".9rem", fontWeight: 700, color: "#0F172A" }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: aoVivo.entregador ? "#16A34A" : "#94A3B8", flexShrink: 0 }} />
        {legenda}
      </div>
    </div>
  );
}
