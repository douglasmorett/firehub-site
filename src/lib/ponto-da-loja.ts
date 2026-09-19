/**
 * Onde a loja fica no mapa — a leitura do campo, sem banco e sem rede.
 *
 * `storeLatLng` é um Json? do Prisma e chegou a ser gravado de três jeitos ao
 * longo do tempo: objeto {lat,lng}, o mesmo objeto em TEXTO (JSON.stringify) e,
 * de importação antiga, {latitude,longitude}. Cada tela que precisava do ponto
 * escreveu a sua leitura — e a da roteirização (`storeLatLng.lat && .lng`)
 * devolvia "não tem ponto" para as duas últimas formas, mandando o mapa para o
 * padrão de Rio das Ostras. Aqui é a leitura única, e ela é PURA de propósito:
 * o navegador também precisa dela (ver RoteirizacaoModal).
 */
export type Ponto = { lat: number; lng: number };

/**
 * Leitura de um par de coordenadas vindo do banco ou de um parceiro, em
 * qualquer das formas que aparecem por aí. Serve para a loja e para o cliente
 * (`customerLatLng`, que o iFood manda em toda entrega).
 */
export function lerPonto(valor: unknown): Ponto | null {
  let bruto: any = valor;

  if (typeof bruto === "string") {
    const t = bruto.trim();
    if (!t) return null;
    try {
      bruto = JSON.parse(t);
    } catch {
      // "-22.52,-41.94" também aparece em cadastro feito na mão.
      const par = t.split(",").map((p) => Number(p.trim()));
      if (par.length === 2 && par.every((n) => Number.isFinite(n))) bruto = { lat: par[0], lng: par[1] };
      else return null;
    }
  }

  if (Array.isArray(bruto) && bruto.length === 2) bruto = { lat: bruto[0], lng: bruto[1] };
  if (!bruto || typeof bruto !== "object") return null;

  const lat = Number(bruto.lat ?? bruto.latitude);
  const lng = Number(bruto.lng ?? bruto.lon ?? bruto.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0,0) é o Atlântico: é "não sei" disfarçado de coordenada.
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** O ponto da loja é só um caso de `lerPonto` — o nome diz quem está lendo. */
export const lerPontoDaLoja = lerPonto;
