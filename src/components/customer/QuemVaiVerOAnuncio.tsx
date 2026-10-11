"use client";

/**
 * "Quem vai ver" — o público do anúncio, no passo de configurar a campanha.
 *
 * No Gerenciador de Anúncios do Facebook isto é uma tela inteira de
 * segmentação: locais, idade, gênero, idiomas, interesses, Advantage+. Para o
 * dono de pizzaria que nunca abriu aquilo, sobra o que decide delivery de
 * bairro: até onde o anúncio vai, que idade e que gênero. Tudo já vem
 * marcado — a loja no centro, o raio da área de entrega, público aberto —
 * então quem não quer mexer só confere o mapa e segue.
 *
 * O centro é a loja e não se arrasta: anúncio de delivery centrado em outro
 * lugar paga clique de quem não recebe o pedido. A regra (e o que vai para a
 * Meta) mora em lib/publico-do-anuncio.ts.
 */

import { useEffect, useRef } from "react";
import { MapPin, Users, AlertTriangle } from "lucide-react";
import {
  RAIO_MINIMO_KM,
  RAIO_MAXIMO_KM,
  FAIXAS_DE_IDADE,
  GENEROS,
  type FaixaDeIdade,
  type GeneroDoPublico,
  type PublicoDoAnuncio,
} from "@/lib/publico-do-anuncio";

export type LocalDaLoja = {
  centro: { lat: number; lng: number } | null;
  endereco: string;
  raioSugerido: number;
};

const ATALHOS_DE_RAIO = [2, 5, 10, 20];

export default function QuemVaiVerOAnuncio({
  local,
  publico,
  onChange,
}: {
  local: LocalDaLoja;
  publico: PublicoDoAnuncio;
  onChange: (p: PublicoDoAnuncio) => void;
}) {
  const caixaDoMapa = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<any>(null);
  const circuloRef = useRef<any>(null);

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

  const centro = local.centro;

  useEffect(() => {
    if (!caixaDoMapa.current || mapaRef.current || !centro) return;
    let vivo = true;
    import("leaflet").then((L) => {
      if (!vivo || !caixaDoMapa.current) return;
      // Sem zoom por rolagem: o mapa fica no meio de uma página que rola, e
      // a roda do mouse passando por cima prendia a página no mapa.
      const mapa = L.map(caixaDoMapa.current, { scrollWheelZoom: false });
      // A vista vem ANTES do círculo: camada vetorial adicionada a um mapa
      // sem centro e zoom estoura ("Set map center and zoom first") e o mapa
      // fica cinza, sem tiles.
      mapa.setView([centro.lat, centro.lng], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapa);
      const circulo = L.circle([centro.lat, centro.lng], {
        radius: publico.radiusKm * 1000,
        color: "#C92E09",
        weight: 2,
        fillColor: "#C92E09",
        fillOpacity: 0.12,
      }).addTo(mapa);
      L.marker([centro.lat, centro.lng], {
        icon: L.divIcon({
          className: "",
          html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-100%)">📍</div>',
          iconSize: [30, 30],
        }),
        interactive: false,
      }).addTo(mapa);
      mapa.fitBounds(circulo.getBounds(), { padding: [16, 16] });
      mapaRef.current = mapa;
      circuloRef.current = circulo;
      setTimeout(() => mapa.invalidateSize(), 250);
    });
    return () => {
      vivo = false;
      if (mapaRef.current) {
        mapaRef.current.remove();
        mapaRef.current = null;
        circuloRef.current = null;
      }
    };
    // Só na montagem: o raio muda pelo efeito abaixo, sem recriar o mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro?.lat, centro?.lng]);

  useEffect(() => {
    const circulo = circuloRef.current;
    const mapa = mapaRef.current;
    if (!circulo || !mapa) return;
    circulo.setRadius(publico.radiusKm * 1000);
    mapa.fitBounds(circulo.getBounds(), { padding: [16, 16] });
  }, [publico.radiusKm]);

  const mudar = (parcial: Partial<PublicoDoAnuncio>) => onChange({ ...publico, ...parcial });

  const chip = (ativo: boolean) => ({
    padding: "8px 12px",
    borderRadius: 10,
    border: ativo ? "2px solid #C92E09" : "1.5px solid #E2E8F0",
    background: ativo ? "#FEF2F2" : "#fff",
    color: ativo ? "#C92E09" : "#334155",
    fontWeight: 700,
    fontSize: "0.8rem",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.25,
  } as const);

  const rotuloDoGrupo = { fontSize: "0.78rem", color: "#64748B", fontWeight: 700, marginBottom: 6 } as const;

  return (
    <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
      <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <Users size={18} color="#C92E09" /> Quem vai ver o anúncio
      </div>
      <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "0 0 1rem", lineHeight: 1.5 }}>
        Já deixamos marcado em volta da sua loja, no tamanho da sua área de entrega. Se estiver bom, é só seguir.
      </p>

      {!centro ? (
        <div style={{ background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "0.9rem 1rem", fontSize: "0.84rem", color: "#92400E", lineHeight: 1.55 }}>
          <div style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <AlertTriangle size={15} /> Falta marcar sua loja no mapa
          </div>
          O anúncio aparece para quem está perto da sua loja, e ainda não sabemos onde ela fica.
          Marque o ponto em{" "}
          <a href="/store/minha-loja" style={{ color: "#92400E", fontWeight: 800 }}>Minha Loja → Área de entrega</a>{" "}
          e volte aqui.
        </div>
      ) : (
        <>
          <div ref={caixaDoMapa} style={{ height: 240, borderRadius: 12, overflow: "hidden", border: "1px solid #E2E8F0", marginBottom: 8, background: "#F1F5F9" }} />
          {local.endereco && (
            <div style={{ fontSize: "0.75rem", color: "#64748B", display: "flex", alignItems: "flex-start", gap: 5, marginBottom: "1rem" }}>
              <MapPin size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {local.endereco}
            </div>
          )}

          <div style={{ marginBottom: "1.1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={rotuloDoGrupo}>Até onde o anúncio vai</span>
              <strong style={{ fontSize: "1.05rem", color: "#111" }}>{publico.radiusKm} km</strong>
            </div>
            <input
              type="range"
              min={RAIO_MINIMO_KM}
              max={RAIO_MAXIMO_KM}
              step={1}
              value={publico.radiusKm}
              onChange={(e) => mudar({ radiusKm: Number(e.target.value) })}
              aria-label="Raio do anúncio em quilômetros"
              style={{ width: "100%", accentColor: "#C92E09", cursor: "pointer" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <button type="button" onClick={() => mudar({ radiusKm: local.raioSugerido })} style={chip(publico.radiusKm === local.raioSugerido)}>
                Minha área de entrega ({local.raioSugerido} km)
              </button>
              {ATALHOS_DE_RAIO.filter((km) => km !== local.raioSugerido).map((km) => (
                <button key={km} type="button" onClick={() => mudar({ radiusKm: km })} style={chip(publico.radiusKm === km)}>
                  {km} km
                </button>
              ))}
            </div>
            {publico.radiusKm > local.raioSugerido && (
              <div style={{ fontSize: "0.74rem", color: "#B45309", marginTop: 8, lineHeight: 1.45 }}>
                Esse raio passa da sua área de entrega ({local.raioSugerido} km). Quem estiver fora dela vai ver o
                anúncio e não vai conseguir pedir — só aumente se você entrega mais longe.
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginBottom: "1.1rem" }}>
        <div style={rotuloDoGrupo}>Idade</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
          {(Object.keys(FAIXAS_DE_IDADE) as FaixaDeIdade[]).map((k) => (
            <button key={k} type="button" onClick={() => mudar({ faixaDeIdade: k })} style={{ ...chip(publico.faixaDeIdade === k), textAlign: "left" }}>
              {FAIXAS_DE_IDADE[k].rotulo}
              <span style={{ display: "block", fontWeight: 500, fontSize: "0.7rem", color: "#64748B" }}>
                {FAIXAS_DE_IDADE[k].detalhe}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={rotuloDoGrupo}>Gênero</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(GENEROS) as GeneroDoPublico[]).map((k) => (
            <button key={k} type="button" onClick={() => mudar({ genero: k })} style={{ ...chip(publico.genero === k), flex: "1 1 90px" }}>
              {GENEROS[k].rotulo}
            </button>
          ))}
        </div>
      </div>

      {(publico.faixaDeIdade !== "todas" || publico.genero !== "todos") ? (
        <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 12, lineHeight: 1.45 }}>
          Público fechado: o anúncio só aparece para quem você marcou. Se não tiver certeza, deixe em
          &quot;Todas as idades&quot; e &quot;Todos&quot; — o Facebook acha sozinho quem mais pede na sua região.
        </div>
      ) : (
        <div style={{ fontSize: "0.74rem", color: "#0F766E", marginTop: 12, lineHeight: 1.45 }}>
          ✓ Recomendado: com o público aberto, o Facebook aprende sozinho quem mais pede na sua região.
        </div>
      )}
    </div>
  );
}
