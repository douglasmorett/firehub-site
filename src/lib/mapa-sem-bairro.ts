/**
 * O FUNDO DO MAPA SEM O "VILA" NO NOME DOS BAIRROS (roteirização e painel, 02/11/2026).
 *
 * As imagens prontas do OpenStreetMap escrevem o bairro com o nome que o OSM
 * deu, e em Cabo Frio ele chama Monte Alegre, Boca do Mato e Jardim Esperança
 * de "Vila …" — nome que o morador não usa (Divinos; Douglas: "não deveria
 * aparecer como vila"). Numa imagem pronta não dá para apagar só esse texto.
 *
 * Por isso o fundo agora é o mapa VETORIAL do OpenFreeMap (base OSM, sem
 * chave, sem cadastro, sem limite), desenhado pelo MapLibre, e dentro de Cabo
 * Frio o nome do bairro vem do IBGE: a localidade do CNEFE 2022, o nome que o
 * morador usa ("MONTE ALEGRE", "BOCA DO MATO"), num ponto no meio dos
 * endereços dela (public/mapa/bairros-3300704.json). O OpenFreeMap nem tem
 * vários desses bairros, com ou sem "Vila". Fora de Cabo Frio, os nomes do
 * OSM, como sempre — lá "Vila Mariana" é nome de verdade. Esconder todos os
 * nomes (a primeira versão, 02/11 23h) não serviu: quem atende à noite não
 * conhece os bairros e usa o nome no mapa para juntar entregas (Luiz).
 *
 * O arquivo do IBGE: mediana da latitude/longitude dos endereços com
 * coordenada (NV_GEO_COORD 1–3) de cada DSC_LOCALIDADE, só localidade com 50+
 * endereços (as grafias erradas ficam de fora) e acento devolvido à mão.
 *
 * Mesmo molde do fundo do Google (lib/mapa-do-google-no-leaflet.ts): o
 * MapLibre fica numa div atrás das camadas do Leaflet, sem receber clique, e o
 * Leaflet manda — a cada movimento ele leva o MapLibre para o mesmo centro e
 * zoom. Pinos, rotas e arrastar continuam sendo do Leaflet.
 *
 * Sem WebGL, ou se o estilo não carregar, `aoFalhar` é chamado uma vez e quem
 * chama põe as imagens do OpenStreetMap de antes. O mapa que usa esta camada
 * nasce com `zoomAnimation: false`, como o do Google: a animação de zoom do
 * Leaflet move só as camadas dele, e o fundo ficaria meio segundo para trás.
 */

export const ESTILO_DO_MAPA = "https://tiles.openfreemap.org/styles/liberty";

/** A camada do estilo "liberty" que escreve bairro, sublocalidade e povoado. */
const ROTULO_DE_BAIRRO = "label_other";
const ROTULO_DO_IBGE = "label_bairro_ibge";

/**
 * As cidades com o nome dos bairros vindo do IBGE: um retângulo em volta do
 * município e o arquivo dos bairros dele. Dentro do retângulo, o rótulo de
 * bairro do OSM some e entra o do IBGE.
 */
const BAIRROS_DO_IBGE = [
  { arquivo: "/mapa/bairros-3300704.json", oeste: -42.13, sul: -22.97, leste: -41.88, norte: -22.55 }, // Cabo Frio/RJ
];

const retangulo = (c: (typeof BAIRROS_DO_IBGE)[number]) => ({
  type: "Polygon",
  coordinates: [[[c.oeste, c.sul], [c.leste, c.sul], [c.leste, c.norte], [c.oeste, c.norte], [c.oeste, c.sul]]],
});

/** Põe os bairros do IBGE da cidade onde o mapa abriu (uma vez por mapa). */
function bairrosDoIbge(gl: any, lat: number, lng: number) {
  if (!gl.getLayer(ROTULO_DE_BAIRRO) || gl.getLayer(ROTULO_DO_IBGE)) return;
  const cidade = BAIRROS_DO_IBGE.find((c) => lng >= c.oeste && lng <= c.leste && lat >= c.sul && lat <= c.norte);
  if (!cidade) return;
  const camadas: any[] = gl.getStyle()?.layers || [];
  const original = camadas.find((l) => l.id === ROTULO_DE_BAIRRO);
  if (!original) return;
  gl.setFilter(ROTULO_DE_BAIRRO, ["all", original.filter ?? true, ["!", ["within", retangulo(cidade)]]]);
  gl.addSource(ROTULO_DO_IBGE, { type: "geojson", data: cidade.arquivo });
  gl.addLayer({
    id: ROTULO_DO_IBGE,
    type: "symbol",
    source: ROTULO_DO_IBGE,
    minzoom: 11,
    layout: { ...original.layout, "text-field": ["get", "nome"] },
    paint: original.paint,
  });
}

export const CREDITO_DO_MAPA =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

function temWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * A camada "fundo sem bairro" para um mapa Leaflet. `aoFalhar` é chamado uma
 * vez se o mapa vetorial não abrir: quem chama tira a camada e põe as imagens
 * de antes.
 */
export function camadaSemBairro(L: any, aoFalhar: () => void): any {
  const Camada = L.Layer.extend({
    getAttribution() {
      return CREDITO_DO_MAPA;
    },
    onAdd(this: any, map: any) {
      const div = document.createElement("div");
      // Atrás das camadas do Leaflet (tile 200, sobreposição 400, controles 1000).
      div.style.cssText = "position:absolute;inset:0;z-index:0;pointer-events:none;";
      const container = map.getContainer();
      container.insertBefore(div, container.firstChild);
      this._div = div;
      let falhou = false;
      const falhar = () => {
        if (falhou || !this._div) return;
        falhou = true;
        aoFalhar();
      };
      if (!temWebGL()) {
        setTimeout(falhar, 0);
        return;
      }
      import("maplibre-gl")
        .then((mod: any) => {
          if (!this._div) return;
          const maplibregl = mod.default || mod;
          const c = map.getCenter();
          // O MapLibre desenha em blocos de 512 px; o Leaflet, de 256: o mesmo
          // enquadramento é um zoom a menos no MapLibre.
          const gl = new maplibregl.Map({
            container: div,
            style: ESTILO_DO_MAPA,
            center: [c.lng, c.lat],
            zoom: map.getZoom() - 1,
            interactive: false,
            attributionControl: false,
            fadeDuration: 0,
          });
          this._gl = gl;
          let abriu = false;
          gl.on("styledata", () => bairrosDoIbge(gl, c.lat, c.lng));
          gl.on("load", () => { abriu = true; });
          // Erro antes de abrir (estilo fora do ar, rede) = volta o de antes.
          // Depois de aberto, um bloco que falha não derruba o mapa.
          gl.on("error", () => { if (!abriu) falhar(); });
          this._sincronizar = (e?: { type?: string }) => {
            if (!this._gl) return;
            // O modal abre e muda de tamanho: o MapLibre só mede a div quando pedem.
            if (e?.type === "resize" || e?.type === "viewreset") this._gl.resize();
            const centro = map.getCenter();
            this._gl.jumpTo({ center: [centro.lng, centro.lat], zoom: map.getZoom() - 1 });
          };
          map.on("move zoom moveend zoomend resize viewreset", this._sincronizar);
          this._sincronizar();
        })
        .catch(() => falhar());
    },
    onRemove(this: any, map: any) {
      if (this._sincronizar) map.off("move zoom moveend zoomend resize viewreset", this._sincronizar);
      try { this._gl?.remove(); } catch {}
      this._gl = null;
      this._div?.remove();
      this._div = null;
    },
  });
  return new Camada();
}
