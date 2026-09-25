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
 *
 * ── Entrega por km (KM/ROTA) — 25/09/2026 ─────────────────────────────────
 *
 * A mesma tela passou a servir a loja que cobra por distância. Lá o ponto
 * decide a FAIXA: com faixas de 0,5 km (Divinos Burger, Cabo Frio), o centro
 * do bairro no lugar da porta do cliente já é R$ 3 a mais ou a menos. Por isso
 * o mapa abre no ponto APROXIMADO que o servidor achou (centro do bairro, a
 * rua homônima do outro lado da cidade) com a loja à vista, e nesse caso o
 * cliente tem de TOCAR onde mora — confirmar o centro do bairro sem olhar
 * seria o mesmo chute de antes, agora com carimbo de "confirmado".
 */

import { useEffect, useRef, useState } from "react";

type Ponto = { lat: number; lng: number };

/**
 * Por que o mapa abriu — muda o texto e se o ponto inicial já vale:
 *   nao-achou  — o mapa não achou o endereço; o pino nasce na loja.
 *   aproximado — achou só um ponto aproximado; a taxa na tela é estimada.
 *   conferir   — achou o endereço; o cliente quer conferir (opcional).
 *   gps-aproximado — o "Minha localização" veio com precisão ruim (celular
 *                com "Localização precisa" desligada, desktop por IP): o pino
 *                nasce no centro do círculo, e o cliente toca a porta.
 */
export type MotivoDoMapa = "nao-achou" | "aproximado" | "conferir" | "gps-aproximado";

/** Distância em linha reta, em km — só para enquadrar o mapa, nunca para cobrar. */
function kmEntre(a: Ponto, b: Ponto): number {
  const r = (g: number) => (g * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const TEXTOS: Record<MotivoDoMapa, string> = {
  "nao-achou":
    "Não achamos esse endereço no mapa. Toque no lugar certo ou arraste o pino até a sua porta — é isso que diz se a gente entrega aí e quanto custa.",
  aproximado:
    "O mapa só achou um ponto aproximado (o centro do bairro ou uma rua de mesmo nome). Toque no lugar exato da sua casa — a taxa é pela distância até a sua porta.",
  conferir:
    "Confira se o pino está na sua porta. Se não estiver, toque no lugar certo ou arraste o pino.",
  "gps-aproximado":
    "Seu celular informou só a localização aproximada (a opção \"Localização precisa\" pode estar desligada). O pino está perto de você, não na sua porta: toque no lugar exato da sua casa — a taxa é pela distância até ela.",
};

export default function ConfirmarPontoNoMapa({
  centro,
  pontoInicial,
  enderecoEscrito,
  motivo = "nao-achou",
  exigirToque,
  aoConfirmar,
  aoFechar,
}: {
  /** Onde a loja está (bolinha vermelha). Sem pino da loja, o mapa abre no palpite. */
  centro: Ponto | null;
  /** O melhor palpite que o servidor teve, quando teve algum. */
  pontoInicial?: Ponto | null;
  enderecoEscrito?: string;
  motivo?: MotivoDoMapa;
  /**
   * O ponto inicial só vale depois de o cliente tocar no mapa. Padrão: só
   * quando não há palpite (o pino nasceu na loja).
   */
  exigirToque?: boolean;
  aoConfirmar: (ponto: Ponto) => void;
  aoFechar: () => void;
}) {
  const caixaDoMapa = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<any>(null);
  const pinoRef = useRef<any>(null);
  const inicio = pontoInicial || centro;
  const [ponto, setPonto] = useState<Ponto | null>(inicio);
  const [pronto, setPronto] = useState(false);
  /**
   * O cliente JÁ disse onde mora?
   *
   * O pino nasce em cima da loja quando o mapa não achou o endereço — e o
   * botão verde nascia habilitado ali. Um toque sem arrastar confirmava a
   * coordenada DA PIZZARIA como sendo a casa do cliente: dentro do raio,
   * dentro de todos os contornos, frete da faixa mais barata. O pedido de
   * 10,8 km entraria de novo, agora com um "confirmado no mapa" em cima.
   *
   * Então: com palpite PRECISO do servidor, o ponto já vale (o mapa achou o
   * endereço, e o cliente está conferindo). Sem palpite, ou com palpite
   * aproximado, só vale depois que ele tocar.
   */
  const [confirmouOPonto, setConfirmouOPonto] = useState(
    exigirToque === undefined ? Boolean(pontoInicial) : !exigirToque,
  );

  // Esc fecha, como qualquer janela por cima da página.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

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
    if (!caixaDoMapa.current || mapaRef.current || !inicio) return;
    let vivo = true;
    import("leaflet").then((L) => {
      if (!vivo || !caixaDoMapa.current) return;
      const mapa = L.map(caixaDoMapa.current);
      // Palpite longe da loja (a rua homônima a 5 km): o mapa mostra os dois,
      // e o cliente que mora perto da loja vê na hora que o pino está errado.
      if (pontoInicial && centro && kmEntre(pontoInicial, centro) > 1.2) {
        mapa.fitBounds(
          [[pontoInicial.lat, pontoInicial.lng], [centro.lat, centro.lng]],
          { padding: [40, 40], maxZoom: 16 },
        );
      } else {
        mapa.setView([inicio.lat, inicio.lng], pontoInicial ? 16 : 15);
      }
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapa);

      const icone = L.divIcon({
        className: "",
        html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-100%)">📍</div>',
        iconSize: [30, 30],
      });
      const pino = L.marker([inicio.lat, inicio.lng], { icon: icone, draggable: true }).addTo(mapa);
      pino.on("dragend", (e: any) => {
        const p = e.target.getLatLng();
        setPonto({ lat: p.lat, lng: p.lng });
        setConfirmouOPonto(true);
      });
      // Tocar no mapa também move o pino: no celular, arrastar um alfinete de
      // 30 px com o dedo é mais difícil do que apontar onde ele deve ficar.
      mapa.on("click", (e: any) => {
        pino.setLatLng(e.latlng);
        setPonto({ lat: e.latlng.lat, lng: e.latlng.lng });
        setConfirmouOPonto(true);
      });

      // A loja, para o cliente se situar ("minha casa é para lá da pizzaria").
      if (centro) {
        L.circleMarker([centro.lat, centro.lng], {
          radius: 7, color: "#C62828", fillColor: "#C62828", fillOpacity: 1, weight: 2,
        })
          .addTo(mapa)
          .bindTooltip("A loja", { permanent: false });
      }

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

  // Sem loja e sem palpite não há onde abrir o mapa — quem chama não deveria
  // abrir; se abrir, não desenha um mapa no meio do oceano.
  if (!inicio) return null;

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
          {motivo === "conferir" ? "O pino está na sua porta?" : "Onde fica a sua casa?"}
        </div>
        <div style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.45, marginBottom: 10 }}>
          {TEXTOS[motivo]}
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
            disabled={!confirmouOPonto || !ponto}
            onClick={() => confirmouOPonto && ponto && aoConfirmar(ponto)}
            style={{
              flex: 2, padding: "11px", borderRadius: 10, border: "none",
              background: confirmouOPonto ? "#16A34A" : "#CBD5E1",
              color: "#fff", fontWeight: 800, fontSize: "0.88rem",
              cursor: confirmouOPonto ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}
          >
            {confirmouOPonto ? "✓ É aqui, confirmar" : "Toque no mapa onde você mora"}
          </button>
        </div>
      </div>
    </div>
  );
}
