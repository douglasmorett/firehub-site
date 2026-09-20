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
import { verifyStoreDeliveryAddress, haversineDistanceKm } from "@/lib/geocoding";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { areaDeRiscoDoPonto, dentroDoPoligono } from "@/lib/area-de-risco";
import { repasseDaFaixaKm, repasseDoBairro } from "@/lib/repasse-do-entregador";

export type LojaParaEntrega = {
  storeAddress?: string | null;
  storeLatLng?: unknown;
  city?: string | null;
  deliveryZones?: unknown;
  deliveryZoneType?: string | null;
  deliveryConfig?: unknown;
};

export type ModoDaArea = "BAIRRO" | "KM" | "POLIGONO" | "SEM_AREA";

/**
 * Uma área de entrega DESENHADA no mapa: o lojista liga os pontinhos até
 * fechar o contorno, e cada contorno tem a sua taxa e o seu tempo.
 *
 * ── Por que não basta o raio ───────────────────────────────────────────────
 *
 * O círculo não conhece geografia: ele atravessa o rio, sobe o morro e pula a
 * linha do trem. A loja que entrega "até o fim da avenida, mas não do outro
 * lado dela" não tem como dizer isso com um raio, e com bairro só consegue se
 * o mapa souber onde o bairro começa — que é justamente o que falha.
 *
 * O desenho é a única forma em que a resposta não depende de o mapa conhecer
 * nome nenhum: é geometria pura sobre o ponto do cliente.
 */
export type AreaDesenhada = {
  /** O nome que o lojista deu ("Centro", "Até a BR"). Aparece no pedido. */
  nome: string;
  /** Os vértices, em [lat, lng]. Mínimo 3 — três pontos fecham um triângulo. */
  pontos: [number, number][];
  fee: number;
  time: number;
  /** Quanto a loja paga ao entregador nesta área. Nulo = usa a regra geral. */
  repasse?: number | null;
};

export type BairroAtendido = { name: string; fee: number; time: number };

export type VeredictoDeEntrega = {
  modo: ModoDaArea;
  resultado: "ATENDE" | "FORA" | "DESCONHECIDO";
  /** Taxa da faixa/bairro. null quando não há como saber (SEM_AREA sem taxa fixa, ou DESCONHECIDO). */
  taxa: number | null;
  /**
   * Quanto a LOJA paga ao entregador nesta mesma faixa/bairro.
   *
   * Sai daqui e não de outra função porque é a MESMA zona que decide os dois:
   * calcular o repasse noutro lugar seria casar o endereço duas vezes, com
   * duas implementações que divergem na primeira mudança de cadastro.
   * `null` = a loja não separou os dois valores (lib/repasse-do-entregador.ts).
   */
  taxaDoEntregador?: number | null;
  tempoMin: number | null;
  distanciaKm?: number;
  raioMaxKm?: number;
  /** Bairro cadastrado que casou (modo BAIRRO). */
  bairro?: string;
  /** Como o mapa entendeu o endereço (modo KM). */
  enderecoNoMapa?: string;
  /** true quando a distância veio do CENTRO do bairro, não do endereço exato. */
  aproximado?: boolean;
  /** O nome da área de risco que recusou, quando foi esse o motivo. */
  areaDeRisco?: string;
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

/**
 * As áreas desenhadas, já validadas. Vive ao lado das outras zonas, no mesmo
 * `deliveryZones`: contorno com menos de 3 pontos não é área e cai fora aqui,
 * antes de qualquer decisão.
 */
function pontosDaZona(z: any): any[] {
  // O contorno pode voltar do banco como STRING (um backup, um import, uma
  // integração que serializou o JSONB duas vezes). Ler o texto aqui é o que
  // impede a loja de "perder" a área sem ninguém saber — e, pior, de cair no
  // modo SEM_AREA, que atende o mundo inteiro.
  const bruto = z?.pontos;
  if (Array.isArray(bruto)) return bruto;
  if (typeof bruto === "string") {
    try {
      const lido = JSON.parse(bruto);
      return Array.isArray(lido) ? lido : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** A loja CHAMOU o cadastro de áreas desenhadas, mesmo que o conteúdo esteja ilegível. */
function temCadastroDeDesenho(loja: LojaParaEntrega): boolean {
  if (String(loja.deliveryZoneType || "").toUpperCase() === "POLIGONO") return true;
  return zonas(loja).some((z) => z && (Array.isArray(z.pontos) || typeof z.pontos === "string"));
}

export function areasDesenhadas(loja: LojaParaEntrega): AreaDesenhada[] {
  return zonas(loja)
    .filter((z) => z && pontosDaZona(z).length >= 3)
    .map((z) => ({
      nome: String(z.nome || z.name || "Área de entrega").trim(),
      pontos: pontosDaZona(z)
        .map((p) => [Number(p?.[0] ?? p?.lat), Number(p?.[1] ?? p?.lng)] as [number, number])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
      fee: Number(z.fee) || 0,
      time: Number(z.time) || 45,
      repasse: z.repasse == null || z.repasse === "" ? null : Number(z.repasse),
    }))
    .filter((a) => a.pontos.length >= 3);
}

/** O que a loja cadastrou: bairros, raio em km, áreas desenhadas, ou nada. O tipo gravado pela tela é "KM", "NEIGHBORHOOD", "ROTA" ou "POLIGONO". */
export function modoDaArea(loja: LojaParaEntrega): ModoDaArea {
  const lista = zonas(loja);
  const tipo = String(loja.deliveryZoneType || "").toUpperCase();
  const temBairro = lista.some((z) => z && z.name && !(kmDaFaixa(z) > 0) && !Array.isArray(z.pontos));
  const temKm = lista.some((z) => kmDaFaixa(z) > 0);
  const temDesenho = areasDesenhadas(loja).length > 0;
  // O desenho vem ANTES dos outros na leitura do tipo: quem desenhou escolheu
  // a forma mais específica que existe, e ela não convive com raio no mesmo
  // cadastro (a tela troca um pelo outro).
  //
  // POLIGONO declarado continua POLIGONO mesmo com o conteúdo ilegível ou
  // vazio. O contrário — cair em SEM_AREA — trocaria "a loja desenhou onde
  // entrega" por "a loja não tem regra, atende todo mundo": um `pontos`
  // gravado como string por um backup faria a loja aceitar pedido de outro
  // estado. Área ilegível é motivo para não fechar pedido, nunca para abrir.
  if (tipo === "POLIGONO") return "POLIGONO";
  if (tipo === "NEIGHBORHOOD") return temBairro ? "BAIRRO" : "SEM_AREA";
  // "ROTA" é o mesmo cadastro do raio — faixas em km — medido pelas ruas em
  // vez de em linha reta (lib/distancia-por-rota.ts). Para a regra de área é
  // o modo KM, e tem que ser: tratar como tipo desconhecido faria a loja que
  // escolheu rota cair em SEM_AREA e passar a entregar em qualquer lugar.
  if (tipo === "ROTA") return temKm ? "KM" : "SEM_AREA";
  if (temDesenho) return "POLIGONO";
  if (temKm) return "KM";
  // Cadastro que TEM a chave `pontos` mas nenhum contorno legível: é loja de
  // área desenhada com o dado corrompido, não loja sem área.
  if (temCadastroDeDesenho(loja)) return "POLIGONO";
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

  // ── ÁREA DE RISCO VENCE TUDO ─────────────────────────────────────────
  //
  // Checada ANTES do modo, e de propósito: raio e bairro não sabem dizer
  // "aqui não". A rua do outro lado da avenida está a 900 m e cai dentro do
  // raio de 3 km; o bairro inteiro está cadastrado mas há três ruas onde o
  // entregador não sobe. Se a exclusão fosse checada depois, a loja
  // desenharia a área e continuaria recebendo o pedido.
  //
  // Sem coordenada não se recusa ninguém: endereço que o mapa não achou não
  // pode virar pedido negado.
  const riscoDireto = areaDeRiscoDoPonto(pedido.coords ?? null, loja.deliveryConfig);
  if (riscoDireto) {
    return {
      modo, resultado: "FORA", taxa: null, tempoMin: null, areaDeRisco: riscoDireto,
      motivo: `endereço dentro da área que a loja não atende (${riscoDireto})`,
    };
  }

  // ── ÁREA DESENHADA ────────────────────────────────────────────────────
  //
  // Geometria pura: o ponto do cliente está dentro do contorno ou não está.
  // Não depende de o mapa conhecer o nome do bairro nem de a rua existir na
  // base — que é o que falha hoje e deixou entrar pedido de 10,8 km numa loja
  // de raio 4 km (R&D Pizzaria, 19/09/2026).
  //
  // O PREÇO DE TUDO ISSO É A COORDENADA. Sem ponto não há geometria, e aqui
  // "não sei" é a única resposta honesta — nunca "atende". Quem chama decide
  // o que fazer com o DESCONHECIDO (o site pede a confirmação no mapa).
  //
  // Áreas sobrepostas: vale a de MENOR taxa. O lojista desenhou as duas em
  // cima do mesmo lugar; cobrar a mais cara seria escolher contra o cliente
  // por um descuido de cadastro dele.
  if (modo === "POLIGONO") {
    const areas = areasDesenhadas(loja);

    // Nenhum contorno legível: a loja escolheu decidir por desenho e não há
    // desenho. Recusar é a única resposta segura — "atende" aqui seria
    // entregar em qualquer lugar por acidente de cadastro.
    if (areas.length === 0) {
      return {
        modo, resultado: "FORA", taxa: null, tempoMin: null,
        motivo: "a loja usa área desenhada no mapa e não há nenhuma área válida cadastrada",
      };
    }
    const ponto = pedido.coords && Number.isFinite(pedido.coords.lat) && Number.isFinite(pedido.coords.lng)
      ? pedido.coords
      : null;

    let pontoFinal = ponto;
    let enderecoNoMapa: string | undefined;
    if (!pontoFinal) {
      // Sem coordenada na mão, tenta o mapa uma vez — o mesmo caminho do modo
      // KM. Se o mapa também não souber, para aqui.
      if (endereco.length < 4) {
        return { modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null, motivo: "endereço vazio" };
      }
      try {
        const check = await verifyStoreDeliveryAddress(
          loja.storeAddress ?? null, loja.storeLatLng as any, loja.city ?? null,
          [], loja.deliveryZoneType ?? null, endereco, null, loja.deliveryConfig, pedido.partes,
        );
        // PRECISÃO DE BAIRRO NÃO SERVE PARA GEOMETRIA.
        //
        // Quando o mapa só acha o CENTRO DO BAIRRO, esse ponto pode estar
        // dentro do contorno com a casa do cliente do lado de fora (e vice-
        // versa). No raio isso vira uma aproximação tolerável; numa área
        // desenhada é decidir a fronteira com o ponto errado. Aqui a resposta
        // honesta é "não sei" — e quem resolve é o cliente, confirmando o pino.
        if (check?.addressFound && check.clienteLat != null && check.clienteLng != null && check.precisao !== "bairro") {
          pontoFinal = { lat: check.clienteLat, lng: check.clienteLng };
          enderecoNoMapa = check.matchedAddress;
        }
      } catch {
        // Mapa fora do ar: cai no DESCONHECIDO logo abaixo.
      }
    }

    if (!pontoFinal) {
      return {
        modo, resultado: "DESCONHECIDO", taxa: null, tempoMin: null,
        motivo: "endereço sem ponto no mapa — a área desenhada só decide com a localização confirmada",
      };
    }

    const risco = areaDeRiscoDoPonto(pontoFinal, loja.deliveryConfig);
    if (risco) {
      return {
        modo, resultado: "FORA", taxa: null, tempoMin: null, areaDeRisco: risco, enderecoNoMapa,
        motivo: `endereço dentro da área que a loja não atende (${risco})`,
      };
    }

    const dentro = areas.filter((a) => dentroDoPoligono(pontoFinal!, a.pontos));
    if (dentro.length === 0) {
      return {
        modo, resultado: "FORA", taxa: null, tempoMin: null, enderecoNoMapa,
        motivo: "endereço fora das áreas de entrega desenhadas pela loja",
      };
    }
    const escolhida = dentro.sort((a, b) => a.fee - b.fee)[0];
    // A distância não decide nada na geometria, mas é o insumo do repasse por
    // faixa de km do entregador, do relatório e do roteiro. Sem ela, quem paga
    // o motoboy por distância fecha o mês com zero em toda entrega.
    const pontoDaLoja = lerPontoDaLoja(loja.storeLatLng as any);
    const distanciaKm = pontoDaLoja
      ? haversineDistanceKm(pontoDaLoja.lat, pontoDaLoja.lng, pontoFinal.lat, pontoFinal.lng)
      : undefined;
    return {
      modo, resultado: "ATENDE", taxa: escolhida.fee, tempoMin: escolhida.time,
      bairro: escolhida.nome, enderecoNoMapa, distanciaKm,
      taxaDoEntregador: escolhida.repasse ?? null,
      motivo: `dentro da área desenhada "${escolhida.nome}"`,
    };
  }

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
      return {
        modo, resultado: "ATENDE", taxa: achado.fee, tempoMin: achado.time, bairro: achado.name,
        taxaDoEntregador: repasseDoBairro(zonas(loja), achado.name),
        motivo: `bairro cadastrado: ${achado.name}`,
      };
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
  // Segunda chance para a área de risco: no modo KM o endereço só ganha
  // coordenada AQUI, depois do mapa responder. Sem esta checagem, o pedido
  // digitado sem lat/lng (site, robô, balcão) passaria pela exclusão.
  if (!coords && check.clienteLat != null && check.clienteLng != null) {
    const risco = areaDeRiscoDoPonto({ lat: check.clienteLat, lng: check.clienteLng }, loja.deliveryConfig);
    if (risco) {
      return {
        modo, resultado: "FORA", taxa: null, tempoMin: null, areaDeRisco: risco,
        distanciaKm: check.distanceKm, enderecoNoMapa: check.matchedAddress,
        motivo: `endereço dentro da área que a loja não atende (${risco})`,
      };
    }
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
    return {
      ...base, resultado: "ATENDE", taxa: check.deliveryFee ?? null, tempoMin: check.estimatedTimeMin ?? null,
      taxaDoEntregador: repasseDaFaixaKm(zonas(loja), check.distanceKm),
      motivo: `${check.distanceKm} km ≤ ${check.maxRadiusKm} km${check.precisao === "bairro" ? " (pelo centro do bairro)" : ""}`,
    };
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
    // A área de risco tem motivo próprio: "fora do raio" seria mentira para um
    // endereço a 900 m, e quem lê o log ia procurar erro no cálculo.
    if (v.areaDeRisco) return `área não atendida pela loja (${v.areaDeRisco})`;
    return v.modo === "BAIRRO" ? "bairro não atendido" : `${v.distanciaKm} km, fora do raio de ${v.raioMaxKm} km`;
  }
  return `endereço não localizado no mapa (${v.motivo})`;
}
