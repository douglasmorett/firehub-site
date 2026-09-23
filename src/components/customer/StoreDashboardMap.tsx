"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { MapPin, Navigation, Flame, Loader2 } from "lucide-react";
import { parseAddressDetails, cleanAddressForGeocoding } from "@/lib/geocodificacao";
import { lerPonto, type Ponto } from "@/lib/ponto-da-loja";

/**
 * ── OS PONTOS DESTE MAPA ERAM INVENTADOS ──────────────────────────────────
 *
 * Até 19/09/2026 este mapa não geocodificava nada. Ele tinha um dicionário de
 * 42 bairros de Rio das Ostras escrito aqui dentro, procurava o nome do bairro
 * dentro do texto do endereço e, achando, jogava o pedido no centro daquele
 * bairro com um deslocamento tirado de um hash do id — para os pontos não se
 * empilharem. Não achando nada, o pedido caía no centro de Rio das Ostras.
 * Havia até uma "trava de continente" com a linha da costa de lá.
 *
 * Para as 9 lojas de Rio das Ostras aquilo era um desenho aproximado. Para
 * todas as outras era ficção: a pizzaria de São Paulo abria Relatórios e via
 * as próprias entregas espalhadas pelo litoral fluminense, com "Bairro nº 1:
 * Centro" porque "Centro" estava no dicionário de lá.
 *
 * Agora o ponto de cada pedido vem, nesta ordem:
 *   1. a coordenada que o parceiro mandou junto com o pedido (o iFood manda em
 *      toda entrega — ver customerLatLng);
 *   2. o cache de endereços deste navegador, o MESMO que a roteirização
 *      preenche (firehub_geo_cache_v3): quem já roteirizou hoje não paga nada;
 *   3. /api/geocodificar — servidor, com fila e cache no banco, um endereço
 *      resolvido uma vez para todas as lojas.
 *
 * Endereço que não resolve não vira pino: some do mapa e aparece na contagem
 * ("X de Y"). Ponto inventado num mapa de calor não é enfeite — é a loja
 * decidindo onde abrir a próxima unidade em cima de um desenho falso.
 */

type Order = {
  id: string;
  totalAmount: number;
  status: string;
  deliveryType: string;
  paymentMethod?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  customerLatLng?: unknown;
  ifoodReference?: string;
  openDeliveryReference?: string;
  source?: string;
  notes?: string;
  createdAt: string;
};

/** Chave de cache de endereço — a mesma forma que o mapa da roteirização usa. */
const chaveDoEndereco = (endereco: string, cidade: string) =>
  `${cleanAddressForGeocoding(endereco)}_${parseAddressDetails(endereco, cidade).neighborhood}_${cidade}`
    .toLowerCase()
    .trim();

const CHAVE_DO_CACHE = "firehub_geo_cache_v3";
/** O teto por chamada da rota é 15; 14 deixa folga. */
const TAMANHO_DO_LOTE = 14;
/**
 * O limite é de TEMPO, não de quantidade — e o motivo é o cache do banco.
 *
 * Endereço que já foi resolvido uma vez (por qualquer loja) volta numa consulta
 * indexada: um lote de 14 conhecidos leva alguns décimos de segundo. Endereço
 * inédito custa pelo menos 1,1 s, que é o limite do Nominatim. Com teto em
 * "8 rodadas", a loja grande — o Hakim Centro tem 4.101 endereços diferentes em
 * 90 dias — levaria dezenas de aberturas até o mapa encher, mesmo com tudo em
 * cache. Com teto de tempo, o que é cache entra quase todo na primeira vez e
 * só o que é novo fica para a próxima.
 */
const PRAZO_TOTAL_MS = 45_000;
const MAXIMO_DE_RODADAS = 40;

export default function StoreDashboardMap({
  orders,
  dateFilterLabel,
  pontoDaLoja = null,
  cidadeDaLoja = "",
}: {
  orders: Order[];
  dateFilterLabel: string;
  /** Onde fica a loja. Ver lib/ponto-da-loja-servidor. */
  pontoDaLoja?: Ponto | null;
  cidadeDaLoja?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const leafletRef = useRef<any>(null);
  const ajustandoRef = useRef(false);
  const [usuarioMexeu, setUsuarioMexeu] = useState(false);
  const [coordenadas, setCoordenadas] = useState<Record<string, Ponto>>({});
  const [resolvendo, setResolvendo] = useState(false);

  // Filtrar apenas pedidos válidos de entrega (excluir cancelados e retiradas)
  const deliveryOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.status === "CANCELADO") return false;
      const type = (o.deliveryType || "").toUpperCase();
      if (type === "RETIRADA" || type === "TAKEOUT" || type === "PRESENCIAL") return false;
      const addr = o.customerAddress || "";
      if (!addr || addr.toLowerCase().includes("retirada") || addr.toLowerCase().includes("balcao")) return false;
      return true;
    });
  }, [orders]);

  /** Só os pedidos que já têm um ponto de verdade. */
  const pedidosNoMapa = useMemo(
    () => deliveryOrders.filter((o) => coordenadas[o.id]),
    [deliveryOrders, coordenadas],
  );

  // ── ESTATÍSTICAS ────────────────────────────────────────────────────────
  //
  // O bairro sai de parseAddressDetails, a MESMA leitura da roteirização: ela
  // já sabe que a cidade da loja não é bairro e só usa a lista de Rio das
  // Ostras quando a loja é de lá.
  const stats = useMemo(() => {
    const contagem: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;

    deliveryOrders.forEach(o => {
      const { neighborhood } = parseAddressDetails(o.customerAddress || "", cidadeDaLoja);
      const bairro = (neighborhood || "").trim();
      if (bairro) {
        if (!contagem[bairro]) contagem[bairro] = { count: 0, total: 0 };
        contagem[bairro].count += 1;
        contagem[bairro].total += o.totalAmount;
      }
      totalRevenue += o.totalAmount;
    });

    let topNeighborhood = "Nenhum";
    let topCount = 0;
    Object.entries(contagem).forEach(([bairro, dados]) => {
      if (dados.count > topCount) {
        topCount = dados.count;
        topNeighborhood = bairro;
      }
    });

    return {
      totalDeEntregas: deliveryOrders.length,
      totalRevenue,
      topNeighborhood,
      topCount,
    };
  }, [deliveryOrders, cidadeDaLoja]);

  // ── DE ONDE VEM O PONTO DE CADA PEDIDO ──────────────────────────────────
  useEffect(() => {
    if (deliveryOrders.length === 0) return;

    let vivo = true;

    const resolver = async () => {
      const achados: Record<string, Ponto> = {};
      const cacheLocal: Record<string, Ponto> = (() => {
        try {
          return JSON.parse(localStorage.getItem(CHAVE_DO_CACHE) || "{}");
        } catch {
          return {};
        }
      })();

      // Endereços que ainda faltam, um por endereço ÚNICO: dez pedidos do
      // mesmo cliente no mês são uma busca, não dez.
      const faltam = new Map<string, { endereco: string; pedidos: string[] }>();

      for (const o of deliveryOrders) {
        const doParceiro = lerPonto(o.customerLatLng);
        if (doParceiro) {
          achados[o.id] = doParceiro;
          continue;
        }
        const endereco = o.customerAddress || "";
        const chave = chaveDoEndereco(endereco, cidadeDaLoja);
        const doCache = cacheLocal[chave];
        if (doCache && Number.isFinite(doCache.lat) && Number.isFinite(doCache.lng)) {
          achados[o.id] = { lat: doCache.lat, lng: doCache.lng };
          continue;
        }
        const grupo = faltam.get(chave);
        if (grupo) grupo.pedidos.push(o.id);
        else faltam.set(chave, { endereco, pedidos: [o.id] });
      }

      if (!vivo) return;
      if (Object.keys(achados).length > 0) setCoordenadas((atual) => ({ ...atual, ...achados }));

      // Sem o ponto da loja não há âncora para a busca (a rota recusa, e com
      // razão: é dela que saem o viés e o raio). É o caso da visão "todas as
      // lojas" do admin — ali entram só os pedidos que já vêm com coordenada.
      if (!pontoDaLoja || faltam.size === 0) return;

      const pendentes = [...faltam.entries()];
      const prazo = Date.now() + PRAZO_TOTAL_MS;
      setResolvendo(true);
      try {
        for (let rodada = 0; rodada < MAXIMO_DE_RODADAS && vivo; rodada++) {
          if (Date.now() > prazo) break;
          const lote = pendentes.slice(rodada * TAMANHO_DO_LOTE, (rodada + 1) * TAMANHO_DO_LOTE);
          if (lote.length === 0) break;

          const res = await fetch("/api/geocodificar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              // O id que mandamos é a CHAVE do endereço: a resposta volta
              // casada com ela e vale para todos os pedidos daquele endereço.
              enderecos: lote.map(([chave, g]) => ({ id: chave, endereco: g.endereco })),
            }),
          });
          if (!res.ok) {
            console.warn("[MapaDeCalor] servidor não geocodificou:", res.status);
            break;
          }
          const { resultados } = await res.json();
          if (!vivo) return;

          const novos: Record<string, Ponto> = {};
          for (const r of resultados || []) {
            const grupo = faltam.get(r.id);
            if (!grupo) continue;
            // "caiu na loja" é o jeito do geocodificador dizer que NÃO achou:
            // ele devolve o ponto da própria loja como último recurso. Para a
            // roteirização isso ainda serve de referência na tela; aqui viraria
            // um monte de pino empilhado em cima da loja — exatamente o ponto
            // inventado que este mapa deixou de fazer. Fica de fora, e o
            // pedido aparece no "X de Y" como endereço não localizado.
            if (/não localizado/i.test(String(r.origem || ""))) continue;
            cacheLocal[r.id] = { lat: r.lat, lng: r.lng };
            for (const idDoPedido of grupo.pedidos) novos[idDoPedido] = { lat: r.lat, lng: r.lng };
          }
          if (Object.keys(novos).length > 0) {
            setCoordenadas((atual) => ({ ...atual, ...novos }));
            try {
              localStorage.setItem(CHAVE_DO_CACHE, JSON.stringify(cacheLocal));
            } catch {}
          }
        }
      } catch (e: any) {
        console.warn("[MapaDeCalor] geocodificação falhou:", e?.message);
      } finally {
        if (vivo) setResolvendo(false);
      }
    };

    resolver();
    return () => {
      vivo = false;
    };
  }, [deliveryOrders, cidadeDaLoja, pontoDaLoja]);

  // ── O MAPA ──────────────────────────────────────────────────────────────
  const enquadrar = useCallback(() => {
    const map = mapInstanceRef.current;
    const Leaflet = leafletRef.current;
    if (!map || !Leaflet) return;

    const pontos: [number, number][] = pedidosNoMapa.map((o) => {
      const c = coordenadas[o.id];
      return [c.lat, c.lng] as [number, number];
    });
    if (pontoDaLoja) pontos.push([pontoDaLoja.lat, pontoDaLoja.lng]);
    if (pontos.length === 0) return;

    ajustandoRef.current = true;
    try {
      map.fitBounds(Leaflet.latLngBounds(pontos), { padding: [40, 40], maxZoom: 15 });
    } catch {}
    setTimeout(() => { ajustandoRef.current = false; }, 300);
  }, [pedidosNoMapa, coordenadas, pontoDaLoja]);

  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;

    const desenhar = async () => {
      try {
        const Leaflet = (await import("leaflet")).default;
        leafletRef.current = Leaflet;

        // Injetar CSS do Leaflet se não estiver presente no head
        if (!document.getElementById("leaflet-css")) {
          const link = document.createElement("link");
          link.id = "leaflet-css";
          link.rel = "stylesheet";
          // Do nosso domínio: o CSP bloqueia stylesheet do unpkg (style-src),
          // e sem o CSS do Leaflet os tiles do mapa viram um embaralhado.
          link.href = "/leaflet/leaflet.css";
          document.head.appendChild(link);
        }

        if (!mapInstanceRef.current) {
          const map = Leaflet.map(mapContainerRef.current!, {
            // Onde a loja está. Sem ponto nenhum (a visão de todas as lojas do
            // admin), abre no país — nunca mais numa cidade escolhida a dedo.
            center: pontoDaLoja ? [pontoDaLoja.lat, pontoDaLoja.lng] : [-14.235, -51.925],
            zoom: pontoDaLoja ? 12 : 4,
            // Os + e − são os botões da tela, no canto de baixo à direita.
            zoomControl: false,
          });

          Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap",
            maxZoom: 19,
          }).addTo(map);

          // Quem mexeu no mapa manda nele: a partir daí o enquadramento
          // automático para de puxar a visão a cada endereço que chega.
          map.on("dragstart", () => setUsuarioMexeu(true));
          map.on("zoomstart", () => { if (!ajustandoRef.current) setUsuarioMexeu(true); });

          mapInstanceRef.current = map;
        }

        const map = mapInstanceRef.current;

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        // Pino da loja — só quando se sabe onde ela fica.
        if (pontoDaLoja) {
          const casinha = Leaflet.divIcon({
            className: "",
            html: `<div style="background:#1C1917;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(28, 25, 23,0.5);font-size:1rem;">🏠</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });
          markersRef.current.push(
            Leaflet.marker([pontoDaLoja.lat, pontoDaLoja.lng], { icon: casinha, zIndexOffset: 900 })
              .addTo(map)
              .bindTooltip("Sua loja", { direction: "top", offset: [0, -10] }),
          );
        }

        pedidosNoMapa.forEach((o) => {
          const coords = coordenadas[o.id];

          // Determinar cor do pino baseado no canal
          const isIfood = (o.source || "").toUpperCase() === "IFOOD" || Boolean(o.ifoodReference);
          const isJotaja = (o.source || "").toUpperCase() === "JOTAJA" || Boolean(o.openDeliveryReference);

          const pinBg = isIfood ? "#EA1D2C" : isJotaja ? "#FF6C00" : "#0F766E";
          const displayNum = o.ifoodReference ? `#${o.ifoodReference}` : o.openDeliveryReference ? `#${o.openDeliveryReference}` : `#${o.id.slice(-4).toUpperCase()}`;

          const popupContent = `
            <div style="font-family: system-ui, sans-serif; padding: 6px; min-width: 190px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 14px; color: #0F172A;">${displayNum}</strong>
                <span style="background: ${pinBg}; color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 12px;">
                  ${isIfood ? "iFood" : isJotaja ? "Jotajá" : "Site"}
                </span>
              </div>
              <div style="font-size: 13px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">
                👤 ${o.customerName || "Cliente"}
              </div>
              <div style="font-size: 11px; color: #64748B; margin-bottom: 6px; line-height: 1.3;">
                🏠 ${o.customerAddress || "Endereço não informado"}
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #E2E8F0; padding-top: 6px; margin-top: 6px;">
                <span style="font-size: 12px; font-weight: 800; color: #0F766E;">R$ ${o.totalAmount.toFixed(2)}</span>
                <span style="font-size: 10px; font-weight: 700; color: #475569; background: #F1F5F9; padding: 2px 6px; border-radius: 4px;">${o.status}</span>
              </div>
            </div>
          `;

          // Usar CircleMarker super elegante (dots de densidade ultra-limpos) que não poluem o mapa
          const circleMarker = Leaflet.circleMarker([coords.lat, coords.lng], {
            radius: pedidosNoMapa.length > 80 ? 6 : 7,
            fillColor: pinBg,
            color: "#FFFFFF",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.85,
          })
            .bindTooltip(`<b>${displayNum}</b> — ${o.customerName || "Cliente"}`, { direction: "top", offset: [0, -5] })
            .bindPopup(popupContent)
            .addTo(map);

          markersRef.current.push(circleMarker);
        });

        if (!usuarioMexeu) enquadrar();

        // Forçar resize após 200ms para renderizar sem cortes
        setTimeout(() => map.invalidateSize(), 200);
      } catch (err) {
        console.error("[StoreDashboardMap] Erro ao renderizar mapa:", err);
      }
    };

    desenhar();
  }, [pedidosNoMapa, coordenadas, pontoDaLoja, usuarioMexeu, enquadrar]);

  // Trocar o filtro de data é começar de novo: a visão volta a se ajustar
  // sozinha aos pedidos do novo período.
  useEffect(() => {
    setUsuarioMexeu(false);
  }, [dateFilterLabel]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => { try { m.remove(); } catch {} });
      markersRef.current = [];
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch {}
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const aproximar = () => { try { mapInstanceRef.current?.zoomIn(); } catch {} };
  const afastar = () => { try { mapInstanceRef.current?.zoomOut(); } catch {} };

  const faltamNoMapa = stats.totalDeEntregas - pedidosNoMapa.length;

  return (
    <div style={{
      background: "#ffffff",
      borderRadius: "16px",
      border: "1px solid #E2E8F0",
      boxShadow: "0 4px 20px -2px rgba(0,0,0,0.05)",
      overflow: "hidden",
      marginTop: "1.5rem",
      marginBottom: "1.5rem"
    }}>
      {/* Header do Mapa */}
      <div style={{
        padding: "1rem 1.5rem",
        background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "1rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            background: "rgba(239, 68, 68, 0.2)",
            color: "#C92E09",
            padding: "8px",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <MapPin size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#F8FAFC", display: "flex", alignItems: "center", gap: "8px" }}>
              Mapa de Calor & Distribuição de Entregas
              <span style={{ background: "rgba(255,255,255,0.15)", fontSize: "0.75rem", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
                {dateFilterLabel}
              </span>
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: "0.8rem", color: "#94A3B8" }}>
              Visualização geográfica das entregas para identificar bairros fortes e áreas de expansão
            </p>
          </div>
        </div>

        {/* Resumo Rápido Geográfico */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {resolvendo ? <Loader2 size={16} color="#A8A29E" className="animate-spin" /> : <Navigation size={16} color="#A8A29E" />}
            <span style={{ fontSize: "0.85rem", color: "#CBD5E1" }}>
              {/* "Mapeados: 40 pedidos" com 12 no desenho era mentira silenciosa.
                  Agora o número é o que está NO mapa, e o resto aparece ao lado. */}
              No mapa: <strong style={{ color: "#F8FAFC", fontWeight: 700 }}>{pedidosNoMapa.length} de {stats.totalDeEntregas}</strong>
              {faltamNoMapa > 0 && (
                <span style={{ color: "#94A3B8" }}>
                  {" "}· {resolvendo ? "localizando endereços…" : `${faltamNoMapa} sem endereço localizado`}
                </span>
              )}
            </span>
          </div>

          {stats.topNeighborhood !== "Nenhum" && (
            <div style={{
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              padding: "4px 10px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <Flame size={15} color="#B45309" />
              <span style={{ fontSize: "0.8rem", color: "#FDE68A", fontWeight: 700 }}>
                Bairro nº 1: {stats.topNeighborhood} ({stats.topCount})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Container do Mapa Leaflet */}
      <div style={{ position: "relative", width: "100%", height: "420px", background: "#F1F5F9" }}>
        <div ref={mapContainerRef} style={{ width: "100%", height: "100%", zIndex: 1 }} />

        {/* Ampliar / diminuir e voltar o enquadramento */}
        <div style={{
          position: "absolute", right: "12px", bottom: "12px", zIndex: 500,
          display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px",
        }}>
          {usuarioMexeu && pedidosNoMapa.length > 0 && (
            <button
              type="button"
              onClick={() => { setUsuarioMexeu(false); enquadrar(); }}
              title="Voltar a visão para todas as entregas"
              style={{
                background: "#FFFFFF", color: "#0F172A", border: "1.5px solid #CBD5E1",
                borderRadius: "8px", padding: "7px 11px", fontSize: "0.78rem", fontWeight: 800,
                cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "6px",
              }}
            >
              <Navigation size={14} style={{ transform: "rotate(45deg)", color: "#1C1917" }} />
              Centralizar
            </button>
          )}
          <div style={{
            display: "flex", flexDirection: "column", background: "#FFFFFF",
            border: "1.5px solid #CBD5E1", borderRadius: "10px", overflow: "hidden",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}>
            <button
              type="button"
              onClick={aproximar}
              title="Ampliar o mapa (aproximar)"
              aria-label="Ampliar o mapa"
              style={{
                width: "40px", height: "38px", border: "none", borderBottom: "1px solid #E2E8F0",
                background: "#FFFFFF", color: "#0F172A", fontSize: "1.3rem", fontWeight: 800,
                lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              +
            </button>
            <button
              type="button"
              onClick={afastar}
              title="Diminuir o mapa (afastar)"
              aria-label="Diminuir o mapa"
              style={{
                width: "40px", height: "38px", border: "none",
                background: "#FFFFFF", color: "#0F172A", fontSize: "1.3rem", fontWeight: 800,
                lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              −
            </button>
          </div>
        </div>

        {deliveryOrders.length === 0 && (
          <div style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(248, 250, 252, 0.85)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            color: "#64748B"
          }}>
            <MapPin size={36} color="#94A3B8" style={{ marginBottom: "8px" }} />
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Nenhum pedido de entrega encontrado no período ({dateFilterLabel})</span>
            <span style={{ fontSize: "0.8rem" }}>Selecione "Ontem" ou "7 dias" nos filtros acima para visualizar a distribuição dos pinos.</span>
          </div>
        )}

        {/* Tem pedido, não tem pino: ou os endereços ainda estão sendo
            localizados, ou falta dizer onde fica a loja — sem ela o mapa não
            tem âncora para procurar endereço nenhum. */}
        {deliveryOrders.length > 0 && pedidosNoMapa.length === 0 && (
          <div style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(248, 250, 252, 0.88)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            color: "#64748B",
            textAlign: "center",
            padding: "1rem",
          }}>
            {resolvendo ? (
              <>
                <Loader2 size={32} color="#94A3B8" className="animate-spin" style={{ marginBottom: "8px" }} />
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Localizando os endereços das entregas…</span>
                <span style={{ fontSize: "0.8rem" }}>Cada endereço é resolvido uma vez e fica guardado — da próxima vez o mapa abre pronto.</span>
              </>
            ) : pontoDaLoja ? (
              <>
                <MapPin size={32} color="#94A3B8" style={{ marginBottom: "8px" }} />
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Nenhum endereço deste período foi localizado no mapa</span>
              </>
            ) : (
              <>
                <MapPin size={32} color="#B45309" style={{ marginBottom: "8px" }} />
                <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#92400E" }}>Falta dizer onde fica sua loja</span>
                <span style={{ fontSize: "0.82rem" }}>
                  Abra <a href="/store/minha-loja" style={{ color: "#B45309", fontWeight: 800 }}>Minha loja → Área de entrega</a>, marque o ponto e salve. Sem ele o mapa não consegue localizar os endereços.
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
