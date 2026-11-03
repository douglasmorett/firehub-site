/**
 * O FUNDO DO MAPA SEM O NOME DOS BAIRROS (roteirização e painel, 02/11/2026).
 *
 * As imagens prontas do OpenStreetMap escrevem o bairro com o nome que o OSM
 * deu, e em Cabo Frio ele chama Monte Alegre, Boca do Mato e Jardim Esperança
 * de "Vila …" — nome que o morador não usa (Divinos; Douglas: "não deveria
 * aparecer como vila"). Numa imagem pronta não dá para apagar só esse texto.
 *
 * Por isso o fundo agora é o mapa VETORIAL do OpenFreeMap (base OSM, sem
 * chave, sem cadastro, sem limite), desenhado pelo MapLibre, com a camada de
 * rótulo de bairro escondida. Ruas, avenidas e nome de rua continuam.
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

/** As camadas do estilo "liberty" que escrevem bairro, sublocalidade e povoado. */
const ROTULOS_DE_BAIRRO = ["label_other"];

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
          gl.on("styledata", () => {
            for (const id of ROTULOS_DE_BAIRRO) {
              if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", "none");
            }
          });
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
