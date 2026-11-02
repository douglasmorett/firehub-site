/**
 * O MAPA DO GOOGLE POR BAIXO DO LEAFLET (roteirização, 01/11/2026).
 *
 * A loja que conectou a própria conta do Google (lib/google-maps-da-loja.ts)
 * vê a roteirização no mapa do Google: o fundo é um google.maps.Map de
 * verdade (Maps JavaScript API, com a chave da loja, logo e termos do Google),
 * e o Leaflet continua por cima só com o que é nosso — pinos, rotas,
 * "📍 Posicionar", arrastar o pino. O Leaflet manda: a cada movimento ele
 * move a câmera do Google para o mesmo centro e zoom (é o que o
 * Leaflet.GridLayer.GoogleMutant faz, em 80 linhas). Assim nenhuma função da
 * tela precisou ser reescrita, e a loja sem chave segue com as imagens do
 * OpenStreetMap exatamente como antes.
 *
 * Ponto do Google em mapa que não é do Google é o que os termos vetam; com o
 * fundo do Google, a roteirização pode usar o ponto do Google
 * (lib/geocodificacao-servidor.ts, googleNaRoteirizacao).
 */

let carregando: Promise<any> | null = null;

/** Carrega a Maps JavaScript API uma vez por página. */
export function carregarMapsJs(chave: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.importLibrary) return w.google.maps.importLibrary("maps");
  if (carregando) return carregando;
  carregando = new Promise((resolve, reject) => {
    w.__fhMapaDaRoteirizacaoPronto = () => {
      Promise.resolve(w.google.maps.importLibrary ? w.google.maps.importLibrary("maps") : w.google.maps).then(resolve, reject);
    };
    const tag = document.createElement("script");
    tag.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&v=weekly&loading=async&language=pt-BR&region=BR&callback=__fhMapaDaRoteirizacaoPronto`;
    tag.async = true;
    tag.onerror = () => {
      carregando = null;
      reject(new Error("rede"));
    };
    document.head.appendChild(tag);
  });
  return carregando;
}

/** O que a tela diz quando o Google não abre o mapa. */
export const MOTIVO_DA_CHAVE_RECUSADA =
  "O Google recusou a chave da loja no mapa. No Google Cloud, confira se a Maps JavaScript API está ativada e se a chave permite essa API (Credenciais → sua chave → Restrições de API). Enquanto isso, o mapa de antes fica no lugar.";
export const MOTIVO_SEM_REDE = "O mapa do Google não carregou (internet ou bloqueio). Enquanto isso, o mapa de antes fica no lugar.";

/**
 * A camada "fundo do Google" para um mapa Leaflet. `aoFalhar` é chamado uma
 * vez se o Google não abrir (chave recusada, API desligada, sem rede): quem
 * chama tira a camada e põe as imagens de antes.
 */
export function camadaDoGoogle(L: any, chave: string, aoFalhar: (motivo: string) => void): any {
  const Camada = L.Layer.extend({
    onAdd(this: any, map: any) {
      const div = document.createElement("div");
      // Atrás das camadas do Leaflet (tile 200, sobreposição 400, controles 1000).
      div.style.cssText = "position:absolute;inset:0;z-index:0;pointer-events:none;";
      const container = map.getContainer();
      container.insertBefore(div, container.firstChild);
      this._div = div;
      let falhou = false;
      const falhar = (motivo: string) => {
        if (falhou || !this._div) return;
        falhou = true;
        aoFalhar(motivo);
      };
      (window as any).gm_authFailure = () => falhar(MOTIVO_DA_CHAVE_RECUSADA);
      carregarMapsJs(chave)
        .then((maps: any) => {
          if (!this._div) return;
          const MapaDoGoogle = maps?.Map || (window as any).google?.maps?.Map;
          const c = map.getCenter();
          this._google = new MapaDoGoogle(div, {
            center: { lat: c.lat, lng: c.lng },
            zoom: Math.round(map.getZoom()),
            disableDefaultUI: true,
            gestureHandling: "none",
            keyboardShortcuts: false,
            clickableIcons: false,
            styles: [
              { featureType: "poi.business", stylers: [{ visibility: "off" }] },
              { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
            ],
          });
          this._sincronizar = () => {
            if (!this._google) return;
            const centro = map.getCenter();
            this._google.moveCamera({ center: { lat: centro.lat, lng: centro.lng }, zoom: map.getZoom() });
          };
          map.on("move zoom moveend zoomend resize viewreset", this._sincronizar);
          this._sincronizar();
        })
        .catch(() => falhar(MOTIVO_SEM_REDE));
    },
    onRemove(this: any, map: any) {
      if (this._sincronizar) map.off("move zoom moveend zoomend resize viewreset", this._sincronizar);
      this._google = null;
      this._div?.remove();
      this._div = null;
    },
  });
  return new Camada();
}

/**
 * Logo depois de conectar: o mapa do Google abre com esta chave neste
 * navegador? (A Maps JavaScript API só se testa no navegador: o servidor só
 * consegue testar a Geocoding API.) null = abriu; senão, o motivo.
 */
export function testarMapaNoNavegador(chave: string, prazoMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let fim = false;
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;left:-9999px;top:0;width:64px;height:64px;";
    document.body.appendChild(div);
    const terminar = (motivo: string | null) => {
      if (fim) return;
      fim = true;
      div.remove();
      resolve(motivo);
    };
    (window as any).gm_authFailure = () => terminar(MOTIVO_DA_CHAVE_RECUSADA.replace(" Enquanto isso, o mapa de antes fica no lugar.", ""));
    setTimeout(() => terminar(null), prazoMs);
    carregarMapsJs(chave)
      .then((maps: any) => {
        const MapaDoGoogle = maps?.Map || (window as any).google?.maps?.Map;
        const m = new MapaDoGoogle(div, { center: { lat: -22.9, lng: -43.2 }, zoom: 12, disableDefaultUI: true });
        m.addListener("tilesloaded", () => setTimeout(() => terminar(null), 1500));
      })
      .catch(() => terminar(MOTIVO_SEM_REDE.replace(" Enquanto isso, o mapa de antes fica no lugar.", "")));
  });
}
