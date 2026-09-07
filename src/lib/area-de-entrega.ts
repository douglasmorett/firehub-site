/**
 * src/lib/area-de-entrega.ts
 *
 * A REGRA ÚNICA de "a loja entrega neste endereço, e por quanto?".
 *
 * Por que existe: em 06/09/2026 o robô do WhatsApp fechou o pedido #64 da
 * Hakim Centro para o bairro Aquários — muito fora dos 5 km que a loja
 * entrega — cobrando R$ 5,99, a faixa dos 4 km. A área de entrega existia só
 * como TEXTO no prompt ("valide no mapa", "nunca invente taxa"); nada no código
 * impedia a gravação, e a taxa gravada era a que o modelo escrevesse. O site
 * tinha a checagem só no navegador, e a rota de pedido aceitava qualquer
 * endereço com qualquer taxa até R$ 300. E o serviço de mapa (Nominatim) não
 * conhece metade dos bairros de Rio das Ostras: "endereço não achado" virava
 * "atende, R$ 5,00".
 *
 * Aqui mora a decisão, e ela é a mesma para o site, para a API de taxa e para
 * o robô. Três respostas possíveis, e cada canal decide o que fazer com cada
 * uma:
 *
 *   ATENDE       — dentro do raio / bairro cadastrado. Taxa e tempo vêm daqui.
 *   FORA         — fora do raio, ou bairro que a loja não cadastrou.
 *   DESCONHECIDO — o mapa não localizou o endereço (ou a loja não tem pino no
 *                  mapa). Não é "atende": é "ninguém sabe". O robô não fecha
 *                  entrega sem saber; o site cobra a faixa mais cara e marca o
 *                  pedido para a loja conferir.
 *
 * Loja SEM área cadastrada não tem regra para aplicar: continua como sempre
 * (taxa padrão), porque bloquear venda de quem nunca configurou seria pior.
 */
import { verifyStoreDeliveryAddress } from "@/lib/geocoding";

export type LojaParaEntrega = {
  storeAddress?: string | null;
  storeLatLng?: unknown;
  city?: string | null;
  deliveryZones?: unknown;
  deliveryZoneType?: string | null;
  deliveryConfig?: unknown;
};

export type ModoDaArea = "BAIRRO" | "KM" | "SEM_AREA";

export type BairroAtendido = { name: string; fee: number; time: number };

export type VeredictoDeEntrega = {
  modo: ModoDaArea;
  resultado: "ATENDE" | "FORA" | "DESCONHECIDO";
  /** Taxa da faixa/bairro. null quando não há como saber (SEM_AREA sem taxa fixa, ou DESCONHECIDO). */
  taxa: number | null;
  tempoMin: number | null;
  distanciaKm?: number;
  raioMaxKm?: number;
  /** Bairro cadastrado que casou (modo BAIRRO). */
  bairro?: string;
  /** Como o mapa entendeu o endereço (modo KM). */
  enderecoNoMapa?: string;
  /** true quando a distância veio do CENTRO do bairro, não do endereço exato. */
  aproximado?: boolean;
  /** Para log e para a nota do pedido. */
  motivo: string;
};

export function normalizarTexto(texto: unknown): string {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function zonas(loja: LojaParaEntrega): any[] {
  const z = loja.deliveryZones;
  if (Array.isArray(z)) return z;
  if (typeof z === "string") { try { const p = JSON.parse(z); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function kmDaFaixa(z: any): number {
  return Number(z?.km ?? z?.radius ?? z?.maxKm ?? 0) || 0;
}

/** O que a loja cadastrou: bairros, raio em km, ou nada. O tipo gravado pela tela é "KM" ou "NEIGHBORHOOD". */
export function modoDaArea(loja: LojaParaEntrega): ModoDaArea {
  const lista = zonas(loja);
  const tipo = String(loja.deliveryZoneType || "").toUpperCase();
  const temBairro = lista.some((z) => z && z.name && !(kmDaFaixa(z) > 0));
  const temKm = lista.some((z) => kmDaFaixa(z) > 0);
  if (tipo === "NEIGHBORHOOD") return temBairro ? "BAIRRO" : "SEM_AREA";
  if (temKm) return "KM";
  if (temBairro) return "BAIRRO"; // cadastro antigo sem tipo
  return "SEM_AREA";
}

export function bairrosAtendidos(loja: LojaParaEntrega): BairroAtendido[] {
  return zonas(loja)
    .filter((z) => z && z.name)
    .map((z) => ({ name: String(z.name).trim(), fee: Number(z.fee) || 0, time: Number(z.time) || 45 }))
    .filter((z) => z.name);
}

export function raioMaximoKm(loja: LojaParaEntrega): number | null {
  const kms = zonas(loja).map(kmDaFaixa).filter((k) => k > 0);
  return kms.length ? Math.max(...kms) : null;
}

/** Taxa fixa, se a loja tiver uma. Nenhuma chave dessas é gravada pela tela hoje; fica por compatibilidade. */
export function taxaFixaDaLoja(loja: LojaParaEntrega): number | null {
  const dc: any = loja.deliveryConfig || {};
  const v = dc.deliveryFee ?? dc.defaultFee ?? dc.fixedFee ?? dc.fixedDeliveryFee ?? dc.fee;
  return v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * O bairro cadastrado que o texto do cliente indica.
 *
 * Casa por igualdade, ou pelo nome cadastrado aparecendo INTEIRO (palavras
 * inteiras) dentro do texto — "Rua X, 10, Jardim Mariléa" casa "Jardim
 * Mariléa". Não casa ao contrário: "Centro" digitado NÃO vira "Centro Norte"
 * cadastrado, que era o defeito da comparação por substring nos dois sentidos
 * (taxa errada e área errada). Havendo mais de um, o nome mais longo vence
 * ("Centro Norte" antes de "Centro").
 */
export function bairroCadastrado(texto: unknown, lista: BairroAtendido[] | LojaParaEntrega): BairroAtendido | null {
  const alvo = normalizarTexto(texto);
  if (!alvo) return null;
  const bairros = Array.isArray(lista) ? lista : bairrosAtendidos(lista);
  const candidatos = bairros
    .map((b) => ({ ...b, norm: normalizarTexto(b.name) }))
    .filter((b) => b.norm);

  const exato = candidatos.find((b) => b.norm === alvo);
  if (exato) return { name: exato.name, fee: exato.fee, time: exato.time };

  const contidos = candidatos
    .filter((b) => new RegExp(`(^|[^a-z0-9])${escapar(b.norm)}([^a-z0-9]|$)`).test(alvo))
    .sort((a, b) => b.norm.length - a.norm.length);
  return contidos[0] ? { name: contidos[0].name, fee: contidos[0].fee, time: contidos[0].time } : null;
}

/** Acima disto, o mapa achou um homônimo em outra cidade, não o cliente. */
const DISTANCIA_ABSURDA_KM = 60;

/**
 * A loja entrega neste endereço?
 *
 * `bairro` é o campo separado quando o canal tem um (site em modo bairro);
 * senão o bairro é procurado dentro do endereço. `coords` é o GPS do cliente,
 * quando ele usou "minha localização" — vale mais que o texto.
 */
export async function avaliarEntrega(
  loja: LojaParaEntrega,
  pedido: {
    endereco?: string | null;
    bairro?: string | null;
    coords?: { lat: number; lng: number } | null;
    partes?: { street?: string; number?: string; neighborhood?: string; city?: string };
  },
): Promise<VeredictoDeEntrega> {
  const modo = modoDaArea(loja);
  const endereco = String(pedido.endereco || "").trim();

  if (modo === "SEM_AREA") {
    const taxa = taxaFixaDaLoja(loja);
    return { modo, resultado: "ATENDE", taxa, tempoMin: null, motivo: "loja sem área de entrega cadastrada — sem regra para aplicar" };
  }

  if (modo === "BAIRRO") {
    const lista = bairrosAtendidos(loja);
    const achado =
      bairroCadastrado(pedido.bairro, lista) ||
      bairroCadastrado(pedido.partes?.neighborhood, lista) ||
      bairroCadastrado(endereco, lista);
    if (achado) {
      return { modo, resultado: "ATENDE", taxa: achado.fee, tempoMin: achado.time, bairro: achado.name, motivo: `bairro cadastrado: ${achado.name}` };
    }
    if (!pedido.bairro && !pedido.partes?.neighborhood && !endereco) {
      return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, motivo: "sem bairro informado" };
    }
    return { modo, resultado: "FORA", taxa: null, tempoMin: null, motivo: `bairro não cadastrado (${pedido.bairro || pedido.partes?.neighborhood || endereco})` };
  }

  // modo KM
  const coords = pedido.coords && Number.isFinite(pedido.coords.lat) && Number.isFinite(pedido.coords.lng) ? pedido.coords : null;
  if (!coords && endereco.length < 4) {
    return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, raioMaxKm: raioMaximoKm(loja) ?? undefined, motivo: "endereço vazio" };
  }

  let check: Awaited<ReturnType<typeof verifyStoreDeliveryAddress>> = null;
  try {
    check = await verifyStoreDeliveryAddress(
      loja.storeAddress ?? null,
      loja.storeLatLng as any,
      loja.city ?? null,
      zonas(loja),
      loja.deliveryZoneType ?? null,
      endereco,
      coords,
      loja.deliveryConfig,
      pedido.partes,
    );
  } catch (e: any) {
    return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, raioMaxKm: raioMaximoKm(loja) ?? undefined, motivo: `mapa indisponível: ${e?.message || e}` };
  }

  if (!check) {
    return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, raioMaxKm: raioMaximoKm(loja) ?? undefined, motivo: "loja sem localização no mapa (storeLatLng)" };
  }
  if (!check.addressFound || check.distanceKm == null) {
    return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, raioMaxKm: check.maxRadiusKm ?? raioMaximoKm(loja) ?? undefined, motivo: check.reason || "endereço não localizado no mapa" };
  }
  if (check.distanceKm > DISTANCIA_ABSURDA_KM) {
    // Rua Juriti "a 552 km" em 25/08: o pedido foi entregue normalmente — o
    // mapa achou uma rua homônima em outro estado. Isso não é "fora", é
    // "não sei".
    return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, raioMaxKm: check.maxRadiusKm, distanciaKm: check.distanceKm, enderecoNoMapa: check.matchedAddress, motivo: `mapa caiu longe demais (${check.distanceKm} km) — provável homônimo` };
  }

  const base = {
    modo,
    distanciaKm: check.distanceKm,
    raioMaxKm: check.maxRadiusKm,
    enderecoNoMapa: check.matchedAddress,
    aproximado: check.precisao === "bairro",
  };
  if (check.isWithinRadius) {
    return { ...base, resultado: "ATENDE", taxa: check.deliveryFee ?? null, tempoMin: check.estimatedTimeMin ?? null, motivo: `${check.distanceKm} km ≤ ${check.maxRadiusKm} km${check.precisao === "bairro" ? " (pelo centro do bairro)" : ""}` };
  }
  return { ...base, resultado: "FORA", taxa: null, tempoMin: null, motivo: `${check.distanceKm} km > raio de ${check.maxRadiusKm} km` };
}

/** Frase curta, para nota de pedido e log. */
export function descreverVeredicto(v: VeredictoDeEntrega): string {
  if (v.resultado === "ATENDE") {
    if (v.modo === "BAIRRO") return `bairro ${v.bairro}, taxa R$ ${(v.taxa ?? 0).toFixed(2).replace(".", ",")}`;
    if (v.modo === "KM") return `${v.distanciaKm} km${v.aproximado ? " (aprox.)" : ""} de ${v.raioMaxKm} km, taxa R$ ${(v.taxa ?? 0).toFixed(2).replace(".", ",")}`;
    return "sem área cadastrada";
  }
  if (v.resultado === "FORA") {
    return v.modo === "BAIRRO" ? "bairro não atendido" : `${v.distanciaKm} km, fora do raio de ${v.raioMaxKm} km`;
  }
  return `endereço não localizado no mapa (${v.motivo})`;
}
