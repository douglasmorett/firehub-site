/**
 * O PONTO DO PEDIDO NO MAPA — de onde ele vem, em que ordem, e quando NÃO vale.
 *
 * Regra única para a roteirização, o cron de distâncias pendentes e quem mais
 * desenha ou mede o pedido (app do motoboy, previsão). Pura: o navegador e o
 * servidor usam a mesma, e os testes rodam sem rede nem banco
 * (scripts/teste-ponto-do-pedido.ts).
 *
 * ── Por que existe (NIK Esfihas, Sobradinho/DF, 16/10/2026) ─────────────────
 *
 * "As rotas estão batendo bastante erradas", disse o gerente. O #30 da Wabiz,
 * "Avenida central conjunto 02, 17 - SOBRADINHO 2 - Brasília/DF - CEP
 * 73062892", apareceu na Asa Sul, a 20 km da loja. A Wabiz não manda ponto, os
 * Correios não conhecem esse CEP, o texto virou bairro "Brasília/DF" e o mapa
 * devolveu o "Instituto de Arquitetos de Brasília" (SGAS). O ponto passou
 * porque a única trava era "até 30 km da loja" — e a NIK entrega até ~7 km.
 * O #48, sem resposta do servidor a tempo, foi achado pelo navegador sem o CEP
 * e caiu no mesmo lugar: os dois pinos "2" e "3" lado a lado na Asa Sul.
 *
 * ── A ordem das fontes ─────────────────────────────────────────────────────
 *
 *   1. manual     o operador posicionou ESTE pedido no mapa da roteirização;
 *   2. parceiro   iFood, 99, Keeta, Brendi… (conferido na entrada, R8);
 *   3. cliente    pino arrastado pelo cliente, GPS do site, localização do robô;
 *   4. aprendido  o operador já posicionou um pedido deste endereço nesta loja;
 *   5. cep        rua e bairro dos Correios (ViaCEP) e a busca estruturada;
 *   6. texto      o endereço como foi escrito;
 *   7. bairro     o centro do bairro escrito — só se o mapa confirmar que é ele;
 *   8. google     só com a chave E a roteirização ligada (desligado: termos);
 *   9. nada       "localização incerta": o pedido NÃO vai para o mapa; vai para
 *                 a lista do operador posicionar.
 *
 * De 1 a 4 é a palavra de quem sabe onde é a casa. De 5 em diante é a NOSSA
 * leitura do texto, e só vale dentro da área da loja (`pontoPlausivel`): ponto
 * fora da área cai para a fonte seguinte e, sem nenhuma, fica incerto. Pino no
 * lugar errado é pior que pino nenhum — o operador monta a rota em cima dele.
 */
import { coordenadaGrosseira } from "./coordenadas-do-parceiro";
import { limitesDeAtendimento } from "./limite-de-atendimento";
import { cepDoEndereco, digitosDoCep } from "./cep";
import { isPointInSea, parseAddressDetails } from "./geocodificacao";

export type Ponto = { lat: number; lng: number };

export type FonteDoPonto =
  | "manual"
  | "parceiro"
  | "cliente"
  | "aprendido"
  | "cep"
  | "texto"
  | "bairro"
  | "google";

/** A ordem de confiança, da mais forte para a mais fraca (ver o topo do arquivo). */
export const ORDEM_DAS_FONTES: readonly FonteDoPonto[] = [
  "manual", "parceiro", "cliente", "aprendido", "cep", "texto", "bairro", "google",
];

/** Como o painel escreve cada fonte (selo do pino, lista de incertos, log). */
export const NOME_DA_FONTE: Record<FonteDoPonto, string> = {
  manual: "posicionado pela loja",
  parceiro: "ponto do app (parceiro)",
  cliente: "localização do cliente",
  aprendido: "posição salva deste endereço",
  cep: "pelo CEP",
  texto: "pelo endereço escrito",
  bairro: "centro do bairro (aproximado)",
  google: "Google",
};

/** Quem SABE onde é a casa: nunca é descartado pela área, só pelo absurdo. */
export function fonteConfiavel(f: FonteDoPonto): boolean {
  return f === "manual" || f === "parceiro" || f === "cliente" || f === "aprendido";
}

/** Acima disto não é entrega, é engano — o mesmo corte de lib/area-de-entrega.ts. */
export const RAIO_MAXIMO_KM = 60;
/** Loja por bairro (ou sem área cadastrada) não tem raio: vale isto. */
export const RAIO_SEM_AREA_KM = 15;
/** A área cadastrada tem folga: quem mora no fim da última faixa existe. */
export const FOLGA_DA_AREA = 1.5;
/** Área minúscula (faixa de 2 km) não pode virar régua de 3 km. */
export const RAIO_MINIMO_KM = 4;

export function distanciaKm(a: Ponto, b: Ponto): number {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const pontoValido = (p: unknown): p is Ponto => {
  const o = p as Ponto | null | undefined;
  return !!o && Number.isFinite(o.lat) && Number.isFinite(o.lng) && !(o.lat === 0 && o.lng === 0) && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180;
};

// ── A ÁREA DA LOJA ───────────────────────────────────────────────────────────

export type AreaDaLoja = {
  /** O ponto da loja. Sem ele não há régua, e nada é descartado pela distância. */
  centro: Ponto | null;
  /** Pedido dos canais da loja (site, robô, balcão): o alcance da área × 1,5. */
  raioKm: number;
  /**
   * Pedido de marketplace (iFood, 99, Wabiz…): a área do app costuma ser maior
   * que a cadastrada aqui — o iFood da Ragnar entrega a 10 km com faixas de
   * 3 km. Vale o maior entre o raio acima, 2 × o alcance e 15 km (o R8).
   */
  raioDoParceiroKm: number;
  /** De onde saiu o raio (aviso e log). */
  base: "faixas" | "area-desenhada" | "contorno" | "sem-raio";
};

const limitar = (km: number) => Math.min(RAIO_MAXIMO_KM, Math.max(RAIO_MINIMO_KM, km));

function listaDeZonas(bruto: unknown): any[] {
  let lista = bruto;
  if (typeof lista === "string") {
    try {
      lista = JSON.parse(lista);
    } catch {
      lista = [];
    }
  }
  return Array.isArray(lista) ? lista : [];
}

/**
 * Até onde um ponto ACHADO PELO TEXTO pode estar da loja. A régua:
 *   - KM/ROTA: a maior faixa × 1,5;
 *   - área desenhada (POLIGONO): o vértice mais longe × 1,5;
 *   - contorno de atendimento ligado (lib/limite-de-atendimento.ts): idem;
 *   - por bairro, ou sem nada cadastrado: 15 km.
 * Sempre entre 4 e 60 km.
 */
export function areaDaLoja(
  loja: { deliveryZoneType?: unknown; deliveryZones?: unknown; deliveryConfig?: unknown } | null | undefined,
  centro: Ponto | null | undefined,
): AreaDaLoja {
  const pontoDaLoja = pontoValido(centro) ? { lat: centro.lat, lng: centro.lng } : null;
  const tipo = String(loja?.deliveryZoneType || "").trim().toUpperCase();
  const zonas = listaDeZonas(loja?.deliveryZones);

  let faixa = 0;
  if (tipo === "KM" || tipo === "ROTA") {
    for (const z of zonas) {
      const k = Number(z?.km ?? z?.radius ?? z?.maxKm ?? 0);
      if (Number.isFinite(k) && k > faixa && k <= RAIO_MAXIMO_KM) faixa = k;
    }
  }
  const verticeMaisLonge = (pontos: unknown): number => {
    if (!pontoDaLoja || !Array.isArray(pontos)) return 0;
    let maior = 0;
    for (const p of pontos) {
      const lat = Number((p as any)?.[0] ?? (p as any)?.lat);
      const lng = Number((p as any)?.[1] ?? (p as any)?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) maior = Math.max(maior, distanciaKm(pontoDaLoja, { lat, lng }));
    }
    return maior;
  };
  let desenho = 0;
  if (tipo === "POLIGONO") for (const z of zonas) desenho = Math.max(desenho, verticeMaisLonge(z?.pontos));
  let contorno = 0;
  // No POLIGONO o contorno não vale (a própria área desenhada é o contorno).
  if (tipo !== "POLIGONO") {
    for (const c of limitesDeAtendimento(loja?.deliveryConfig)) {
      if (c.ativa !== false) contorno = Math.max(contorno, verticeMaisLonge(c.pontos));
    }
  }

  const alcance = Math.max(faixa, desenho, contorno);
  if (!(alcance > 0)) {
    return { centro: pontoDaLoja, raioKm: RAIO_SEM_AREA_KM, raioDoParceiroKm: RAIO_SEM_AREA_KM, base: "sem-raio" };
  }
  const raioKm = limitar(alcance * FOLGA_DA_AREA);
  return {
    centro: pontoDaLoja,
    raioKm,
    raioDoParceiroKm: limitar(Math.max(raioKm, 2 * alcance, RAIO_SEM_AREA_KM)),
    base: alcance === faixa ? "faixas" : alcance === desenho ? "area-desenhada" : "contorno",
  };
}

/**
 * Os dois raios que a tela do mapa recebe — só quando o ponto da loja é o
 * PINO salvo por ela (origem "cadastro", lib/ponto-da-loja-servidor.ts). O
 * ponto achado pelo endereço do cadastro pode ser o centro da cidade (a
 * Pizzaria 17 ficou a 26 km da porta), e medir a área dali recusaria o
 * cliente certo. As zonas não vão para o navegador, só os números.
 */
export function areaParaOMapa(
  loja: { deliveryZoneType?: unknown; deliveryZones?: unknown; deliveryConfig?: unknown } | null | undefined,
  noMapa: { ponto: Ponto | null; origem: string | null } | null | undefined,
): { raioKm: number; raioDoParceiroKm: number } | null {
  if (!noMapa?.ponto || noMapa.origem !== "cadastro") return null;
  const a = areaDaLoja(loja, noMapa.ponto);
  return { raioKm: a.raioKm, raioDoParceiroKm: a.raioDoParceiroKm };
}

/** O raio que vale para este pedido. */
export function raioDoPedido(area: AreaDaLoja, ehMarketplace: boolean): number {
  return ehMarketplace ? Math.max(area.raioKm, area.raioDoParceiroKm) : area.raioKm;
}

/**
 * Um ponto ACHADO PELO TEXTO (CEP, endereço, bairro, Google) vale para esta
 * loja? Sem o ponto da loja não há régua: vale (como antes).
 */
export function pontoPlausivel(p: Ponto | null | undefined, area: AreaDaLoja | null | undefined, ehMarketplace = false): boolean {
  if (!pontoValido(p)) return false;
  if (!area?.centro) return true;
  return distanciaKm(area.centro, p) <= raioDoPedido(area, ehMarketplace);
}

/** A frase do motivo quando o ponto achado fica fora da área (lista de incertos, log). */
export function motivoForaDaArea(p: Ponto, area: AreaDaLoja, ehMarketplace = false): string {
  const km = area.centro ? distanciaKm(area.centro, p) : 0;
  const r = (n: number) => n.toFixed(1).replace(".", ",");
  return `o mapa achou um ponto a ${r(km)} km da loja, fora da área (${r(raioDoPedido(area, ehMarketplace))} km)`;
}

// ── O PONTO QUE O PEDIDO JÁ TRAZ (customerLatLng) ──────────────────────────────

export type PontoGravado = {
  ponto: Ponto;
  fonte: FonteDoPonto;
  /** Centro do bairro: serve para a direção, não para a porta. */
  aproximado: boolean;
};

/**
 * O `customerLatLng` gravado, com a fonte. A origem é escrita por quem grava:
 * "manual" (a loja, na roteirização), "aprendido" (o cron, pela posição salva
 * do endereço), "pino"/"gps" (o cliente), "mapa"/"bairro" (o checkout ou o
 * cron achando o texto). Sem origem: o ponto do parceiro — e, nos canais da
 * loja, o GPS do site de antes de 25/09/2026, quando a origem não existia.
 * Ponto de enchimento (o (-23,-43) do 99Food) não é ponto.
 */
export function lerPontoGravado(bruto: unknown, ehMarketplace: boolean): PontoGravado | null {
  const o = bruto as any;
  if (!o || typeof o !== "object") return null;
  const lat = Number(o.lat ?? o.latitude);
  const lng = Number(o.lng ?? o.lon ?? o.longitude);
  const ponto = { lat, lng };
  if (!pontoValido(ponto) || coordenadaGrosseira(lat, lng)) return null;
  const origem = String(o.origem ?? "").trim().toLowerCase();
  if (origem === "manual") return { ponto, fonte: "manual", aproximado: false };
  if (origem === "aprendido") return { ponto, fonte: "aprendido", aproximado: false };
  if (origem === "pino" || origem === "gps") return { ponto, fonte: "cliente", aproximado: false };
  if (origem === "bairro") return { ponto, fonte: "bairro", aproximado: true };
  if (origem === "mapa") return { ponto, fonte: "texto", aproximado: false };
  if (!origem) return { ponto, fonte: ehMarketplace ? "parceiro" : "cliente", aproximado: false };
  return { ponto, fonte: "texto", aproximado: false };
}

/**
 * O ponto gravado serve para o mapa? A palavra de quem sabe (loja, parceiro,
 * cliente) vale até 60 km; o ponto que o checkout ou o cron acharam pelo texto
 * passa pela mesma régua da geocodificação.
 */
export function pontoGravadoVale(g: PontoGravado | null, area: AreaDaLoja | null | undefined, ehMarketplace: boolean): boolean {
  if (!g) return false;
  if (!area?.centro) return true;
  if (fonteConfiavel(g.fonte)) return distanciaKm(area.centro, g.ponto) <= RAIO_MAXIMO_KM;
  return pontoPlausivel(g.ponto, area, ehMarketplace);
}

/**
 * A fonte do que o geocodificador do servidor devolveu, pela origem dele
 * (lib/geocodificacao.ts e lib/geocodificacao-servidor.ts).
 */
export function fonteDaGeocodificacao(origem: string | null | undefined): FonteDoPonto {
  const o = String(origem || "").trim().toLowerCase();
  if (/aprendid|manual|salva pela loja/.test(o)) return "aprendido";
  if (/google/.test(o)) return "google";
  if (/^bairro|centr[oó]ide|dicion/.test(o)) return "bairro";
  if (/pelo cep/.test(o)) return "cep";
  return "texto";
}

// ── A POSIÇÃO QUE A LOJA ENSINOU (lib/ponto-aprendido.ts) ─────────────────────

/** O texto do endereço comparável: sem acento, caixa, pontuação nem espaço repetido. */
export function enderecoNormalizado(endereco: unknown): string {
  return String(endereco ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * O CEP serve de chave junto com o número? Não quando é o CEP da cidade
 * inteira (final 000) nem o de "grande usuário" / caixa postal (final 900 a
 * 999): o Alto da Boa Vista da NIK tem UM CEP (73130-900) para o condomínio
 * todo — "casa 21" de uma quadra não é a "casa 21" da outra.
 */
export function cepServeDeChave(cep: unknown): boolean {
  const d = digitosDoCep(cep);
  if (d.length !== 8) return false;
  const fim = Number(d.slice(5));
  return d.slice(5) !== "000" && fim < 900;
}

/**
 * As chaves com que a posição de um endereço é guardada e procurada, na ordem
 * de preferência: o texto inteiro ("t:…") e, com CEP de rua e número de casa,
 * "c:<CEP>|<número>" — o mesmo cliente às vezes escreve o complemento de outro
 * jeito, e o CEP com o número continua sendo a mesma porta.
 */
export function chavesDoAprendizado(endereco: unknown): string[] {
  const texto = enderecoNormalizado(endereco);
  if (texto.length < 4) return [];
  const chaves = [`t:${texto}`];
  const cep = cepDoEndereco(endereco);
  if (cep && cepServeDeChave(cep)) {
    const numero = String(parseAddressDetails(String(endereco ?? ""), "").houseNumber || "").replace(/^0+/, "");
    if (/^\d{1,6}$/.test(numero)) chaves.push(`c:${cep}|${numero}`);
  }
  return chaves;
}

// ── O QUE A ROTEIRIZAÇÃO DESENHA (components/customer/RoteirizacaoModal.tsx) ──

/** O que o servidor respondeu para um pedido nesta tela: o ponto, ou o motivo de não ter. */
export type Resolucao = {
  ponto: Ponto | null;
  fonte?: FonteDoPonto;
  aproximado?: boolean;
  /** Incerto: nada plausível. Sem motivo e sem ponto = o servidor não respondeu a tempo. */
  motivo?: string;
  /** Quando (ms) chegou a resposta — para não perguntar de novo a cada 8 s. */
  em: number;
};

export type PedidoNoMapa = {
  id: string;
  customerLatLng?: unknown;
  /** Campos soltos de integração antiga, lidos como antes. */
  latitude?: unknown;
  longitude?: unknown;
  franchiseeId?: string | null;
  ehMarketplace: boolean;
  /** O texto do endereço (vazio = não há o que procurar). */
  endereco: string;
};

export type PlanoDosPontos = {
  pontos: Record<string, Ponto>;
  info: Record<string, { fonte: FonteDoPonto; aproximado: boolean }>;
  /** id → por que não há ponto. Estes NÃO vão para o mapa. */
  incertos: Record<string, string>;
  /** Os ids a perguntar ao servidor agora. */
  perguntar: string[];
};

/** Sem resposta (prazo, fila), pergunta de novo em 15 s; incerto, de 5 em 5 min. */
export const ESPERA_SEM_RESPOSTA_MS = 15_000;
export const ESPERA_DO_INCERTO_MS = 5 * 60_000;

/**
 * Para cada pedido do mapa: o ponto que ele já traz (se vale), o que o
 * servidor já respondeu nesta tela, ou "perguntar". Ponto gravado que não
 * vale (achado pelo texto, fora da área) é tratado como ausente — o servidor
 * refaz pelo CEP e pela área de agora. Em "Todas as lojas", pedido de OUTRA
 * loja não passa pela área desta (o servidor mede com a dele).
 *
 * Pura: a tela chama a cada mudança da lista; o teste chama com os pedidos
 * reais (scripts/teste-ponto-do-pedido.ts).
 */
export function planoDosPontos(
  pedidos: PedidoNoMapa[],
  o: { area: AreaDaLoja | null; lojaDoMapa?: string | null; resolucoes: Map<string, Resolucao>; agora: number; emVoo?: Set<string> },
): PlanoDosPontos {
  const plano: PlanoDosPontos = { pontos: {}, info: {}, incertos: {}, perguntar: [] };
  for (const p of pedidos) {
    const area = o.lojaDoMapa && p.franchiseeId && p.franchiseeId !== o.lojaDoMapa ? null : o.area;
    const bruto =
      p.customerLatLng && typeof p.customerLatLng === "object"
        ? p.customerLatLng
        : p.latitude != null && p.longitude != null
        ? { lat: p.latitude, lng: p.longitude }
        : null;
    const gravado = lerPontoGravado(bruto, p.ehMarketplace);
    if (gravado && !isPointInSea(gravado.ponto.lat, gravado.ponto.lng) && pontoGravadoVale(gravado, area, p.ehMarketplace)) {
      plano.pontos[p.id] = gravado.ponto;
      plano.info[p.id] = { fonte: gravado.fonte, aproximado: gravado.aproximado };
      continue;
    }
    const r = o.resolucoes.get(p.id);
    if (r?.ponto) {
      plano.pontos[p.id] = r.ponto;
      plano.info[p.id] = { fonte: r.fonte || "texto", aproximado: !!r.aproximado };
      continue;
    }
    if (!String(p.endereco || "").trim()) {
      plano.incertos[p.id] = "pedido sem endereço";
      continue;
    }
    if (r?.motivo) plano.incertos[p.id] = r.motivo;
    if (o.emVoo?.has(p.id)) continue;
    const espera = r?.motivo ? ESPERA_DO_INCERTO_MS : ESPERA_SEM_RESPOSTA_MS;
    if (r && o.agora - r.em < espera) continue;
    plano.perguntar.push(p.id);
  }
  return plano;
}
