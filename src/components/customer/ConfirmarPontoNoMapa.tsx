"use client";

/**
 * "Arraste o pino até a sua casa" — a confirmação do ponto de entrega.
 *
 * ── Por que ela existe ─────────────────────────────────────────────────────
 *
 * A área de entrega do FireHub decide por PONTO no mapa: raio, faixa de km e
 * área desenhada, todas. Quem transforma o endereço escrito em ponto é o
 * OpenStreetMap, e no Brasil ele erra dos dois jeitos — "Estrada Ananias, 570,
 * Nova Iguaçu" não existe para ele, e "Boa Vista, Nova Iguaçu" devolve uma RUA
 * Boa Vista em OUTRO bairro, a 2 km da loja. O primeiro caso deixou entrar um
 * pedido de 10,8 km numa loja que entrega até 4 km, com frete R$ 0,00
 * (R&D Pizzaria, 19/09/2026).
 *
 * Pedir o GPS do cliente resolveria e não serve: metade das pessoas nega a
 * permissão, e quem pede comida da casa da mãe teria o ponto errado de
 * qualquer jeito. O que sobra — e é o que o entregador já faz todo dia no
 * app — é OLHAR O MAPA: o cliente escreve o endereço, vê onde caiu e arrasta
 * o pino até a porta. Um toque, sem permissão nenhuma, e o ponto passa a ser
 * o que ele confirmou.
 *
 * ── O que esta tela NÃO faz ────────────────────────────────────────────────
 *
 * Ela não decide se a loja entrega ali. Ela devolve o ponto; quem decide é
 * sempre o servidor (lib/area-de-entrega.ts), com a mesma regra do robô e da
 * API de taxa. Tela que decide sozinha é como o cardápio passou a aceitar o
 * que a rota recusava.
 */

import { useEffect, useRef, useState } from "react";

type Ponto = { lat: number; lng: number };

export default function ConfirmarPontoNoMapa({
  centro,
  pontoInicial,
  enderecoEscrito,
  aoConfirmar,
  aoFechar,
}: {
  /** Onde a loja está — é por ela que o mapa abre quando não há palpite. */
  centro: Ponto;
  /** O melhor palpite que o servidor teve, quando teve algum. */
  pontoInicial?: Ponto | null;
  enderecoEscrito?: string;
  aoConfirmar: (ponto: Ponto) => void;
  aoFechar: () => void;
}) {
  const caixaDoMapa = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<any>(null);
  const pinoRef = useRef<any>(null);
  const [ponto, setPonto] = useState<Ponto>(pontoInicial || centro);
  const [pronto, setPronto] = useState(false);

  // O CSS do Leaflet vem do NOSSO domínio: o CSP bloqueia stylesheet de CDN, e
  // sem ele os tiles viram um embaralhado (mesma nota do mapa do painel).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (document.querySelector('link[href="/leaflet/leaflet.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/leaflet/leaflet.css";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    if (!caixaDoMapa.current || mapaRef.current) return;
    let vivo = true;
    import("leaflet").then((L) => {
      if (!vivo || !caixaDoMapa.current) return;
      const mapa = L.map(caixaDoMapa.current).setView([ponto.lat, ponto.lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapa);

      const icone = L.divIcon({
        className: "",
        html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-100%)">📍</div>',
        iconSize: [30, 30],
      });
      const pino = L.marker([ponto.lat, ponto.lng], { icon: icone, draggable: true }).addTo(mapa);
      pino.on("dragend", (e: any) => {
        const p = e.target.getLatLng();
        setPonto({ lat: p.lat, lng: p.lng });
      });
      // Tocar no mapa também move o pino: no celular, arrastar um alfinete de
      // 30 px com o dedo é mais difícil do que apontar onde ele deve ficar.
      mapa.on("click", (e: any) => {
        pino.setLatLng(e.latlng);
        setPonto({ lat: e.latlng.lat, lng: e.latlng.lng });
      });

      // A loja, para o cliente se situar ("minha casa é para lá da pizzaria").
      L.circleMarker([centro.lat, centro.lng], {
        radius: 7, color: "#C62828", fillColor: "#C62828", fillOpacity: 1, weight: 2,
      })
        .addTo(mapa)
        .bindTooltip("A loja", { permanent: false });

      mapaRef.current = mapa;
      pinoRef.current = pino;
      setPronto(true);
      // O mapa nasce dentro de um modal que ainda está abrindo: sem este
      // respiro ele calcula a largura da caixa fechada e desenha os tiles
      // pela metade.
      setTimeout(() => mapa.invalidateSize(), 250);
    });
    return () => {
      vivo = false;
      if (mapaRef.current) {
        mapaRef.current.remove();
        mapaRef.current = null;
      }
    };
    // Só na montagem: o pino é movido por evento, não por re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 4000,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      onClick={aoFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", width: "100%", maxWidth: 520, borderRadius: "16px 16px 0 0",
          padding: "14px 14px 16px", boxShadow: "0 -8px 30px rgba(0,0,0,0.25)",
          maxHeight: "92vh", overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: "1rem", color: "#0F172A", marginBottom: 2 }}>
          Onde fica a sua casa?
        </div>
        <div style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.45, marginBottom: 10 }}>
          Não achamos esse endereço no mapa. Toque no lugar certo ou arraste o pino até a sua porta —
          é isso que diz se a gente entrega aí.
          {enderecoEscrito ? (
            <div style={{ marginTop: 4, color: "#64748B" }}>
              Você escreveu: <b>{enderecoEscrito}</b>
            </div>
          ) : null}
        </div>

        <div
          ref={caixaDoMapa}
          style={{ width: "100%", height: 320, borderRadius: 12, overflow: "hidden", border: "1px solid #E2E8F0", background: "#F1F5F9" }}
        />

        {!pronto && (
          <div style={{ fontSize: "0.8rem", color: "#64748B", textAlign: "center", marginTop: 8 }}>
            Carregando o mapa...
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={aoFechar}
            style={{
              flex: 1, padding: "11px", borderRadius: 10, border: "1.5px solid #E2E8F0",
              background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.86rem",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => aoConfirmar(ponto)}
            style={{
              flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "#16A34A",
              color: "#fff", fontWeight: 800, fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ✓ É aqui, confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
