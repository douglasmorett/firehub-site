/**
 * src/lib/entrega-do-pedido.ts — o que o PEDIDO faz com a entrega: qual
 * resultado vale (a cotação que o cliente viu ou uma avaliação nova), quando o
 * site recusa, e o que fica gravado para o motoboy e o acerto dele.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 25/09/2026, na Divinos Burger (modo ROTA), 4 de 5 entregas do site foram
 * cobradas a R$ 12 — a faixa mais cara — de clientes a 0,5–0,9 km. A cotação
 * tinha achado o bairro a 0,84 km (R$ 5); 51 segundos depois o POST do pedido
 * geocodificou de novo, o mapa não respondeu, e "não sei" virou "faixa mais
 * cara". Nenhum daqueles pedidos gravou a distância, o ponto ou o repasse, e
 * o motoboy recebeu a taxa do cliente.
 *
 * As três decisões que corrigem isso moram aqui, puras (sem banco e sem rede),
 * para o site (api/customer-order) e o balcão (api/store/orders/presencial)
 * lerem a MESMA regra — e para terem teste (scripts/teste-entrega-do-pedido.ts):
 *
 *   1. COTAÇÃO PRIMEIRO. O token que /api/delivery-fee assinou
 *      (lib/cotacao-de-entrega.ts), da mesma loja e do mesmo endereço, é o
 *      resultado: ponto, distância, faixa, taxa e repasse, sem mapa de novo.
 *   2. "NÃO SEI" NÃO VIRA FAIXA MAIS CARA. Em KM/ROTA o site recusa o pedido
 *      sem ponto confiável e pede o pino no mapa — o mesmo fluxo da área
 *      desenhada. O balcão não recusa (a taxa lá é do atendente), só avisa.
 *   3. O PONTO QUE DECIDIU A TAXA VAI PARA O PEDIDO, com a origem e a medida:
 *      a roteirização, o app do motoboy e o acerto usam o mesmo lugar.
 */
import {
  chaveDoEndereco,
  lerCotacao,
  type CotacaoDeEntrega,
  type MedidaDaDistancia,
  type OrigemDoPonto,
} from "./cotacao-de-entrega";
import type { ModoDaArea, VeredictoDeEntrega } from "./area-de-entrega";
import { coordenadaGrosseira, limiteDoParceiroKm } from "./coordenadas-do-parceiro";
import {
  faixaDaTaxa,
  kmDaZona,
  repasseDaFaixaKm,
  repasseDaZona,
  repasseDoPedido,
  type RegraDeRepasse,
} from "./repasse-do-entregador";

/** Acima disto não é entrega, é homônimo — o mesmo corte de area-de-entrega.ts. */
const DISTANCIA_ABSURDA_KM = 60;

const centavos = (n: number) => Math.round(n * 100) / 100;

export type PontoDoCliente = { lat: number; lng: number; origem: OrigemDoPonto };

/** O que vai em `CustomerOrder.customerLatLng`. Quem lê `{lat,lng}` continua lendo. */
export type PontoGravado = { lat: number; lng: number; origem: OrigemDoPonto; medida?: MedidaDaDistancia };

/**
 * O ponto é de ENCHIMENTO? O 99Food manda (-23,-43) quando não sabe o ponto:
 * 33 de 270 pedidos em 20 dias, e a Brazza Burguer gravou 54,34 km em ~17
 * deles. A régua é a do R8 (lib/coordenadas-do-parceiro.ts): grau inteiro em
 * qualquer um dos dois, ou os dois com menos de 3 casas — uma régua só para
 * o parceiro, o corpo do pedido e o cron.
 */
export function pontoDeEnchimento(p: { lat: number; lng: number } | null | undefined): boolean {
  if (!p) return false;
  return coordenadaGrosseira(Number(p.lat), Number(p.lng));
}

/**
 * A coordenada que veio no CORPO do pedido (GPS do aparelho ou pino
 * confirmado no mapa). Coordenada do corpo é palpite, não prova: esta rota é
 * pública e ela decide a área inteira. Fora da faixa válida, (0,0) e ponto de
 * enchimento saem daqui.
 *
 * A origem vem junto quando o checkout manda (`{lat, lng, origem: "pino"}`);
 * sem ela, é "gps" — as duas valem igual para a regra, a diferença é só para
 * quem lê o pedido saber que o cliente arrastou o pino.
 */
export function coordenadaDoCorpo(bruto: unknown, origemInformada?: unknown): PontoDoCliente | null {
  const o = bruto as any;
  if (!o || typeof o !== "object") return null;
  const lat = Number(o.lat ?? o.latitude);
  const lng = Number(o.lng ?? o.lon ?? o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null;
  if (pontoDeEnchimento({ lat, lng })) return null;
  const origem = String(origemInformada ?? o.origem ?? "").toLowerCase() === "pino" ? "pino" : "gps";
  return { lat, lng, origem };
}

export type EnderecoDoCorpo = {
  street?: unknown;
  number?: unknown;
  neighborhood?: unknown;
  address?: unknown;
};

const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * As chaves de endereço com que a cotação pode ter sido assinada.
 *
 * 1. Endereço + ponto, como o checkout cota o endereço digitado (com o GPS,
 *    quando houver).
 * 2. Só o ponto, quando o pedido traz coordenada: é como o checkout cota
 *    depois de o cliente confirmar o pino (manda só lat/lng). Aceitar esta é
 *    seguro — com coordenada a taxa depende só do ponto, e ele é o mesmo
 *    (a chave arredonda a ~11 m).
 *
 * NÃO existe a terceira (endereço sem o ponto quando o pedido traz ponto): a
 * cotação do texto usaria o ponto que o MAPA achou, e o cliente acabou de
 * mandar um melhor.
 */
export function chavesDoPedido(endereco: EnderecoDoCorpo, coords: { lat: number; lng: number } | null): string[] {
  const completa = chaveDoEndereco({
    street: texto(endereco.street),
    number: texto(endereco.number),
    neighborhood: texto(endereco.neighborhood),
    address: texto(endereco.address),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });
  const chaves = [completa];
  if (coords) {
    const soPonto = chaveDoEndereco({ lat: coords.lat, lng: coords.lng });
    if (soPonto !== completa) chaves.push(soPonto);
  }
  return chaves;
}

/** A cotação que veio no pedido, se é desta loja, deste endereço e ainda vale. */
export function cotacaoDoPedido(
  token: unknown,
  esperado: { loja: string; endereco: EnderecoDoCorpo; coords: { lat: number; lng: number } | null },
  agora: number = Date.now(),
): CotacaoDeEntrega | null {
  if (typeof token !== "string" || !token) return null;
  for (const chave of chavesDoPedido(esperado.endereco, esperado.coords)) {
    const c = lerCotacao(token, { loja: esperado.loja, chave }, agora);
    if (c) return c;
  }
  return null;
}

/** Distância pronta para gravar: 0 vale (cliente na porta da loja), negativo e absurdo não. */
export function distanciaParaGravar(km: unknown): number | null {
  if (km === null || km === undefined || km === "") return null;
  const n = Number(km);
  if (!Number.isFinite(n) || n < 0 || n > DISTANCIA_ABSURDA_KM) return null;
  return centavos(n);
}

/** Tudo o que o pedido precisa saber da entrega, venha da cotação ou do mapa. */
export type EntregaDoPedido = {
  /** De onde saiu: a cotação assinada, uma avaliação agora, ou nada (avaliação falhou). */
  fonte: "cotacao" | "avaliacao" | "nenhuma";
  modo: ModoDaArea | null;
  resultado: "ATENDE" | "FORA" | "DESCONHECIDO" | null;
  taxa: number | null;
  distanciaKm: number | null;
  medida: MedidaDaDistancia | null;
  faixaKm: number | null;
  /** O ponto que decidiu a taxa (ou, sem ponto que decida, o que o cliente mandou). */
  ponto: PontoDoCliente | null;
  taxaDoEntregador: number | null;
  tempoMin: number | null;
  bairro: string | null;
  /** Ponto aproximado sem o cliente ter confirmado no mapa (R3). */
  pedeConfirmacao: boolean;
  /** Os porquês do aproximado, do motor ("centro do bairro", "rua homônima"...). */
  motivosDaConfirmacao: string[];
  raioMaxKm: number | null;
  areaDeRisco: string | null;
  /**
   * "Não sei" porque o ponto da PRÓPRIA LOJA é desconhecido (sem pino e o
   * endereço dela não achado no mapa) — e não o do cliente. É o único "não
   * sei" em KM/ROTA que o site aceita: sem a loja no mapa, nem o pino do
   * cliente mede nada.
   */
  lojaSemPonto: boolean;
  motivo: string;
};

/**
 * O veredicto disse "não sei" porque a LOJA não tem ponto? É a resposta de
 * lib/area-de-entrega.ts quando `verifyStoreDeliveryAddress` devolve null
 * (sem `storeLatLng` e o endereço da loja não achado): o motivo é "loja sem
 * localização no mapa (storeLatLng)". O motor não tem campo próprio para
 * isso — o texto é o contrato; mudou lá, mude aqui (o teste
 * scripts/teste-entrega-do-pedido.ts prova o texto atual).
 */
export function pontoDaLojaDesconhecido(v: { resultado?: string | null; motivo?: string | null } | null | undefined): boolean {
  if (!v || v.resultado !== "DESCONHECIDO") return false;
  return /loja sem localiza/i.test(String(v.motivo || ""));
}

/**
 * A taxa da loja por km que está SEM ponto no mapa: a da primeira faixa (a
 * menor distância), ou a taxa fixa. Nunca a faixa mais cara (R2): sem medir,
 * cobrar R$ 20 de quem mora a 300 m era o defeito que abriu esta frente. A
 * loja confere e corrige pela rota de correção de taxa (R10); o pedido vai
 * marcado.
 */
export function taxaDaLojaSemPonto(zonas: unknown, taxaFixa: number | null | undefined): number {
  const primeira = faixasDaLoja(zonas)[0];
  if (primeira) return primeira.taxa;
  const fixa = Number(taxaFixa);
  return Number.isFinite(fixa) && fixa > 0 ? centavos(fixa) : 0;
}

function pontoValido(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A entrega a partir da cotação assinada. Ela só existe quando a cotação
 * ATENDEU — é o resultado que o cliente viu, com a taxa que ele aceitou.
 *
 * Com coordenada no pedido, o ponto gravado é o dela (a chave da cotação já
 * garantiu que é o mesmo lugar) com a origem que o checkout informou.
 */
export function entregaDaCotacao(
  c: CotacaoDeEntrega,
  modo: ModoDaArea | null,
  coords: PontoDoCliente | null,
): EntregaDoPedido {
  const doToken = pontoValido(c.lat, c.lng);
  const ponto: PontoDoCliente | null = coords
    ?? (doToken ? { ...doToken, origem: c.origemDoPonto ?? "mapa" } : null);
  return {
    fonte: "cotacao",
    modo,
    resultado: "ATENDE",
    taxa: numeroOuNulo(c.taxa),
    distanciaKm: distanciaParaGravar(c.distanciaKm),
    medida: c.medida ?? null,
    faixaKm: numeroOuNulo(c.faixaKm),
    ponto,
    taxaDoEntregador: numeroOuNulo(c.taxaDoEntregador),
    tempoMin: numeroOuNulo(c.tempoMin),
    bairro: null,
    // A cotação só sai assinada quando ATENDE, mas "atende pelo centro do
    // bairro" ainda é ponto que o cliente não confirmou.
    pedeConfirmacao: !coords && c.origemDoPonto === "bairro",
    motivosDaConfirmacao: !coords && c.origemDoPonto === "bairro" ? ["centro do bairro"] : [],
    raioMaxKm: null,
    areaDeRisco: null,
    lojaSemPonto: false,
    motivo: "cotação assinada",
  };
}

/** A entrega a partir de uma avaliação feita agora (sem cotação válida). */
export function entregaDoVeredicto(
  v: VeredictoDeEntrega | null | undefined,
  coords: PontoDoCliente | null,
  modoDaLoja: ModoDaArea | null = null,
): EntregaDoPedido {
  if (!v) {
    return {
      fonte: "nenhuma", modo: modoDaLoja, resultado: null, taxa: null, distanciaKm: null, medida: null,
      faixaKm: null, ponto: coords, taxaDoEntregador: null, tempoMin: null, bairro: null,
      pedeConfirmacao: false, motivosDaConfirmacao: [], raioMaxKm: null, areaDeRisco: null,
      lojaSemPonto: false,
      motivo: "avaliação da entrega falhou",
    };
  }
  const doVeredicto = pontoValido(v.ponto?.lat, v.ponto?.lng);
  const ponto: PontoDoCliente | null = coords
    ?? (doVeredicto ? { ...doVeredicto, origem: v.ponto?.origem ?? "mapa" } : null);
  // Com coordenada do cliente (pino/GPS) NÃO se pede confirmação (R3): ele já
  // confirmou. Pedir de novo seria prender o cliente num laço — confirma o
  // pino, o servidor pede o pino.
  const aproximado = v.pedeConfirmacao === true || v.aproximado === true || v.ponto?.origem === "bairro";
  const pedeConfirmacao = !coords && aproximado;
  // Lido sem depender do tipo: o motor ganhou o campo no mesmo dia, e o pedido
  // não pode quebrar se ele vier ausente.
  const brutos = (v as { motivosDaConfirmacao?: unknown }).motivosDaConfirmacao;
  const motivosDoMotor = Array.isArray(brutos) ? brutos.filter((m): m is string => typeof m === "string" && m.trim() !== "") : [];
  return {
    fonte: "avaliacao",
    modo: v.modo,
    resultado: v.resultado,
    taxa: numeroOuNulo(v.taxa),
    distanciaKm: distanciaParaGravar(v.distanciaKm),
    medida: v.medida ?? null,
    faixaKm: numeroOuNulo(v.faixaKm),
    ponto,
    taxaDoEntregador: numeroOuNulo(v.taxaDoEntregador),
    tempoMin: numeroOuNulo(v.tempoMin),
    bairro: v.bairro ?? null,
    pedeConfirmacao,
    motivosDaConfirmacao: !pedeConfirmacao
      ? []
      : motivosDoMotor.length ? motivosDoMotor : v.ponto?.origem === "bairro" ? ["centro do bairro"] : [],
    raioMaxKm: numeroOuNulo(v.raioMaxKm),
    areaDeRisco: v.areaDeRisco ?? null,
    lojaSemPonto: pontoDaLojaDesconhecido(v),
    motivo: v.motivo,
  };
}

const km = (n: number) => String(centavos(n)).replace(".", ",");
const reais = (n: number) => `R$ ${centavos(n).toFixed(2).replace(".", ",")}`;

/** Os modos em que o PONTO decide a taxa — e em que "não sei o ponto" não fecha. */
const MODO_DE_PONTO = (m: ModoDaArea | null) => m === "KM" || m === "POLIGONO";

export type RecusaDoSite = {
  status: number;
  corpo: {
    error: string;
    precisaConfirmarNoMapa?: true;
    podeConfirmarNoMapa?: true;
    /** A taxa pelo ponto aproximado, para a tela mostrar enquanto o cliente confere. */
    taxaEstimada?: number;
    /** Onde abrir o pino: o ponto aproximado que o mapa achou. */
    pontoAproximado?: { lat: number; lng: number };
    /**
     * Não há onde abrir o mapa (sem palpite e loja sem pino): o caminho é o
     * botão "Usar minha localização atual (GPS)".
     */
    pedirGps?: true;
  };
};

/**
 * O pedido do SITE pode seguir com esta entrega? `null` = pode.
 *
 * `lojaTemPonto` (a loja tem pino, `storeLatLng`) NÃO decide mais se recusa —
 * só o texto. A primeira versão aceitava o "não sei" e o ponto aproximado da
 * loja sem pino ("sem pino o checkout não mostra o mapa"), e isso não
 * conferia: o checkout abre o mapa no palpite do servidor ou no GPS do
 * cliente, sem precisar da loja. O efeito era o defeito original, só que
 * nessas lojas — "não sei" cobrado pela faixa mais cara, e a rua homônima a
 * 4,95 km (pedido #5 da Divinos) gravada como a casa, com o repasse de R$ 19.
 *
 * Sem palpite e sem pino da loja, o mapa não tem onde abrir: a mensagem manda
 * para o GPS. O único "não sei" aceito é o da LOJA sem ponto (`lojaSemPonto`):
 * aí nem o pino do cliente mede, e recusar fecharia a loja para entrega.
 */
export function recusaDoSite(
  e: EntregaDoPedido,
  opts: { temCoordenadaDoCliente: boolean; lojaTemPonto?: boolean },
): RecusaDoSite | null {
  const { temCoordenadaDoCliente } = opts;
  const lojaTemPonto = opts.lojaTemPonto !== false;

  if (e.resultado === "FORA") {
    if (e.areaDeRisco) {
      return { status: 400, corpo: { error: "A loja não entrega nesse endereço. Revise o endereço ou escolha retirar no balcão." } };
    }
    const pelasRuas = e.medida === "rota" || e.medida === "estimada" ? " pelas ruas" : "";
    const detalhe = e.modo === "KM" && e.distanciaKm != null && e.raioMaxKm != null
      ? ` (${km(e.distanciaKm)} km${pelasRuas} até a loja; entregamos até ${km(e.raioMaxKm)} km)`
      : e.modo === "BAIRRO" ? " (bairro não atendido)" : "";
    return {
      status: 400,
      corpo: {
        error: `Endereço fora da área de entrega${detalhe}. Revise o endereço ou escolha retirar no balcão.`,
        // O mapa pode ter posto o cliente no lugar errado (rua homônima): com
        // o ponto do texto, ele ainda pode corrigir no pino.
        ...(MODO_DE_PONTO(e.modo) && !temCoordenadaDoCliente && lojaTemPonto ? { podeConfirmarNoMapa: true as const } : {}),
      },
    };
  }

  if (!MODO_DE_PONTO(e.modo)) return null;

  const naoSei = e.resultado === "DESCONHECIDO" || e.resultado === null;
  if (naoSei) {
    // Área desenhada nunca fechou sem ponto (R&D Pizzaria, 19/09/2026).
    // KM/ROTA passa a fazer o mesmo (R2): "não sei" não é "faixa mais cara".
    // A exceção é a LOJA sem ponto: o pedido segue pela 1ª faixa, marcado
    // (customer-order, taxaDaLojaSemPonto).
    if (e.modo === "KM" && e.lojaSemPonto) return null;
    if (temCoordenadaDoCliente) {
      // O cliente já mandou o ponto e ainda assim não deu para medir (mapa
      // fora do ar, ponto a mais de 60 km). Pedir o pino de novo seria um laço.
      return {
        status: 400,
        corpo: { error: "Não conseguimos calcular a entrega para esse ponto agora. Tente de novo em instantes ou escolha retirar no balcão." },
      };
    }
    // O motor às vezes tem um palpite (o centro do bairro que caiu além do
    // raio): o pino abre nele. Palpite a mais de 60 km (homônimo em outra
    // cidade) não — lá o mapa abriria longe da casa do cliente.
    const palpite = e.ponto && e.distanciaKm != null ? { lat: e.ponto.lat, lng: e.ponto.lng } : null;
    // Sem palpite e sem a loja no mapa, o pino não tem onde abrir: o
    // checkout avisa "use o GPS" — a mensagem já diz isso de uma vez.
    const soGps = !palpite && !lojaTemPonto;
    return {
      status: 400,
      corpo: {
        error: palpite
          ? "Achamos o seu endereço só de forma aproximada. Confirme no mapa onde fica a sua casa (ou escolha retirar no balcão) para fechar o pedido."
          : soGps
            ? 'Não localizamos o seu endereço no mapa. Toque em "Usar minha localização atual (GPS)" para marcarmos onde fica a sua casa (ou escolha retirar no balcão).'
            : "Não localizamos o seu endereço no mapa. Confirme no mapa onde fica a sua casa (ou escolha retirar no balcão) para fechar o pedido.",
        precisaConfirmarNoMapa: true,
        ...(palpite ? { pontoAproximado: palpite } : {}),
        ...(soGps ? { pedirGps: true as const } : {}),
      },
    };
  }

  if (e.resultado === "ATENDE" && e.pedeConfirmacao && !temCoordenadaDoCliente) {
    return {
      status: 400,
      corpo: {
        error: e.taxa != null
          ? `Achamos o seu endereço só de forma aproximada (entrega estimada em ${reais(e.taxa)}). Confirme no mapa onde fica a sua casa para fechar o pedido.`
          : "Achamos o seu endereço só de forma aproximada. Confirme no mapa onde fica a sua casa para fechar o pedido.",
        precisaConfirmarNoMapa: true,
        ...(e.taxa != null ? { taxaEstimada: centavos(e.taxa) } : {}),
        ...(e.ponto ? { pontoAproximado: { lat: e.ponto.lat, lng: e.ponto.lng } } : {}),
        ...(!e.ponto && !lojaTemPonto ? { pedirGps: true as const } : {}),
      },
    };
  }
  return null;
}

/** "Não sei" não decidiu taxa nenhuma: o palpite do mapa não é o cliente. */
const semDecisao = (e: EntregaDoPedido) => e.resultado === "DESCONHECIDO" || e.resultado === null;
const pontoDoProprioCliente = (e: EntregaDoPedido) => e.ponto?.origem === "pino" || e.ponto?.origem === "gps";

/**
 * O ponto para `customerLatLng`, ou null.
 *
 * Em "não sei" só vale o ponto que o PRÓPRIO cliente deu (pino/GPS): o
 * palpite do mapa — o centro de bairro que caiu fora, a rua homônima a 500 km
 * — iria para a roteirização e para o app do motoboy como se fosse a casa.
 */
export function pontoParaGravar(e: EntregaDoPedido): PontoGravado | null {
  if (!e.ponto) return null;
  if (semDecisao(e) && !pontoDoProprioCliente(e)) return null;
  const p = pontoValido(e.ponto.lat, e.ponto.lng);
  if (!p || pontoDeEnchimento(p)) return null;
  return { lat: p.lat, lng: p.lng, origem: e.ponto.origem, ...(e.medida && !semDecisao(e) ? { medida: e.medida } : {}) };
}

/**
 * Quanto a loja paga ao entregador por esta entrega, pela tabela dela.
 *
 * Só quando a loja SEPARA os dois valores (tela de Entrega). O valor que veio
 * da faixa que decidiu a taxa (cotação ou avaliação) vence; sem ele, a faixa
 * é procurada pela distância. Faixa sem valor devolve null (R6) — e aí o
 * acerto é o do próprio entregador, nunca o da faixa vizinha. Em "não sei"
 * não há faixa: a distância do palpite pagaria a faixa errada.
 */
export function repasseDaEntrega(e: EntregaDoPedido, regra: RegraDeRepasse, zonas: unknown): number | null {
  if (!regra.separado) return null;
  if (semDecisao(e)) return null;
  if (e.taxaDoEntregador != null && e.taxaDoEntregador >= 0) return centavos(e.taxaDoEntregador);
  // Sem distância nem bairro não há faixa para procurar.
  if (e.faixaKm == null && e.distanciaKm == null && !e.bairro) return null;
  return repasseDoPedido({ regra, zonas, km: e.faixaKm ?? e.distanciaKm, bairro: e.bairro });
}

/**
 * As etiquetas que o pedido leva na observação — é o que a loja lê no painel
 * e na comanda. Ficam só as que exigem conferência: distância estimada, ponto
 * aproximado, endereço não localizado, fora da área (balcão), taxa trocada na
 * mão (balcão).
 */
export function notasDaEntrega(
  e: EntregaDoPedido,
  opts: { canal: "site" | "balcao"; taxaCobrada?: number | null } = { canal: "site" },
): string[] {
  const notas: string[] = [];
  if (e.lojaSemPonto) {
    // Não é o endereço do cliente que falhou: é a loja que não está no mapa.
    // Dizer "endereço não localizado" mandaria a loja ligar para o cliente
    // atrás de um defeito que é do cadastro dela.
    const comoSaiu = opts.canal === "site" ? " e saiu pela 1ª faixa" : "";
    notas.push(`[⚠️ Loja sem localização no mapa: a entrega não foi medida${comoSaiu} — marque o ponto da loja na tela de Entrega e corrija a taxa deste pedido se precisar]`);
  } else if (e.resultado === null) {
    // A avaliação não respondeu (prazo do balcão, mapa fora do ar): não é
    // "o mapa não achou", é "não deu para conferir".
    notas.push("[⚠️ Não deu para conferir o endereço no mapa agora — confira a área de entrega e a taxa]");
  } else if (e.resultado === "DESCONHECIDO") {
    notas.push("[⚠️ Endereço não localizado no mapa — confira a área de entrega e a taxa]");
  } else if (e.resultado === "FORA") {
    const onde = e.areaDeRisco
      ? `área que a loja não atende: ${e.areaDeRisco}`
      : e.distanciaKm != null && e.raioMaxKm != null
        ? `${km(e.distanciaKm)} km; a loja entrega até ${km(e.raioMaxKm)} km`
        : "fora da área cadastrada";
    notas.push(`[⚠️ Fora da área de entrega (${onde}) — entrega combinada no balcão]`);
  }
  if (e.pedeConfirmacao && e.resultado !== "DESCONHECIDO") {
    const porque = e.motivosDaConfirmacao.length
      ? e.motivosDaConfirmacao.join("; ")
      : e.ponto?.origem === "bairro" ? "centro do bairro" : "ponto não confirmado no mapa";
    notas.push(`[📍 Endereço localizado só de forma aproximada (${porque}) — confira com o cliente]`);
  }
  if (e.medida === "estimada" && e.distanciaKm != null) {
    notas.push(`[📏 Distância estimada: ${km(e.distanciaKm)} km — o mapa de ruas não respondeu; confira a faixa]`);
  }
  if (
    opts.canal === "balcao" && e.resultado === "ATENDE" && e.taxa != null &&
    opts.taxaCobrada != null && Math.abs(centavos(e.taxa) - centavos(opts.taxaCobrada)) >= 0.01
  ) {
    notas.push(`[Taxa de entrega combinada no balcão: ${reais(opts.taxaCobrada)} (a tabela dá ${reais(e.taxa)})]`);
  }
  return notas;
}

/**
 * A origem do ponto que o geocodificador do servidor devolveu
 * (lib/geocodificacao.ts: "rua (busca estruturada)", "bairro (OSM)",
 * "centróide do bairro", "dicionário de bairros"...), no vocabulário do
 * pedido. Centro de bairro é "bairro" — aproximado; o resto é "mapa".
 */
export function origemDaGeocodificacao(origem: string | null | undefined): OrigemDoPonto {
  // "rua + número + bairro" tem a palavra bairro e é rua: por isso o começo.
  return /^bairro|centr[oó]ide|dicion/i.test(String(origem || "").trim()) ? "bairro" : "mapa";
}

/**
 * O geocodificador do servidor ACHOU o endereço? Ele nunca devolve vazio:
 * sem achar, devolve o centro da loja ("loja (endereço não localizado)") —
 * e, se o ponto caiu no mar sem dicionário, também ("… → caiu no mar →
 * loja"). Gravar qualquer um dos dois daria ~0 km e pagaria a faixa mais
 * barata em TODA entrega que o mapa perdeu.
 */
export function geocodificacaoAchou(origem: string | null | undefined): boolean {
  const o = String(origem || "");
  return !/não localizado|caiu no mar → loja/i.test(o);
}

/**
 * O repasse que o cron de distâncias pendentes grava junto com a distância.
 *
 * Pedido PRÓPRIO (site, balcão, robô) que nasceu sem distância — endereço não
 * localizado, balcão sem cotação — e loja que paga pela tabela de faixas: o
 * repasse devia ter sido gravado na venda e não foi, porque faltava o km. O
 * cron completa com a faixa da distância medida agora (minutos depois da
 * venda, com a mesma tabela).
 *
 * Pedido de APP não: lá a regra do app (valor do app, tabela ou fixo) é
 * aplicada no fechamento (lib/ganho-do-entregador.ts). Repasse já gravado
 * também não: é história.
 *
 * PEDIDO VELHO TAMBÉM NÃO (`REPASSE_DO_CRON_ATE_HORAS`). O cron olha 30 dias
 * para trás, e `motoboyFee` gravado é o passo 1 do acerto — vence o acordo do
 * entregador. Completar o repasse de um pedido de semanas atrás, com a tabela
 * de HOJE, reescrevia semana já paga: a loja cadastra o repasse por faixa em
 * 25/09 e o pedido de 05/09, pago como "por entrega R$ 6" no fechamento de
 * 07/09, passava a mostrar "R$ 7 · valor gravado na venda". Pedido velho
 * ganha só a distância; o fechamento aplica a regra no passo 3.
 */
export const REPASSE_DO_CRON_ATE_HORAS = 6;

export function repasseQueOCronCompleta(args: {
  regra: RegraDeRepasse;
  zonas: unknown;
  km: number | null;
  ehMarketplace: boolean;
  motoboyFeeAtual: number | null | undefined;
  /** Quando o pedido foi feito. Sem data, não completa (não dá para saber se é velho). */
  criadoEm: Date | string | number | null | undefined;
  agora?: number;
}): number | null {
  if (args.ehMarketplace || args.motoboyFeeAtual != null || !args.regra.separado || args.km == null) return null;
  const criado = args.criadoEm == null ? NaN : new Date(args.criadoEm).getTime();
  if (!Number.isFinite(criado)) return null;
  const idadeMs = (args.agora ?? Date.now()) - criado;
  if (idadeMs > REPASSE_DO_CRON_ATE_HORAS * 60 * 60_000) return null;
  return repasseDoPedido({ regra: args.regra, zonas: args.zonas, km: args.km });
}

// ── O PONTO GRAVADO QUE NÃO É O CLIENTE (R8, no cron) ───────────────────────

const linhaRetaKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (g: number) => (g * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * Até onde a loja entrega, para o corte de ponto (R8): a maior faixa de km ou
 * o vértice mais longe da área desenhada. É a mesma leitura do cadastro que
 * lib/distancia-da-entrega.ts usa para recusar o ponto na medida — as duas
 * têm de concordar, senão o cron deixa de apagar o que a medida recusa.
 */
export function raioDaLojaParaOCorte(zonas: unknown, pontoDaLoja: { lat: number; lng: number } | null): number | null {
  let lista: unknown = zonas;
  if (typeof lista === "string") {
    try { lista = JSON.parse(lista); } catch { lista = []; }
  }
  let maior = 0;
  for (const z of Array.isArray(lista) ? (lista as any[]) : []) {
    const k = Number(z?.km ?? z?.radius ?? z?.maxKm ?? 0);
    if (Number.isFinite(k) && k > maior) maior = k;
    if (pontoDaLoja && Array.isArray(z?.pontos)) {
      for (const p of z.pontos) {
        const lat = Number(p?.[0] ?? p?.lat);
        const lng = Number(p?.[1] ?? p?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) maior = Math.max(maior, linhaRetaKm(pontoDaLoja, { lat, lng }));
      }
    }
  }
  return maior > 0 ? maior : null;
}

export type DescarteDoPontoGravado =
  /** Ponto de parceiro (99Food manda -23,-43): apagar e geocodificar o texto. */
  | "enchimento"
  /** Longe demais da loja e não foi o cliente que deu: apagar e geocodificar o texto. */
  | "longe"
  /** Longe demais, mas é o pino/GPS do próprio cliente: não se apaga — só log. */
  | "longe-do-cliente";

/**
 * O `customerLatLng` gravado serve para medir a entrega? `null` = serve.
 *
 * A medida (lib/distancia-da-entrega.ts) recusa ponto a mais de
 * max(2 × raio, 15 km) da loja (R8). Sem apagar esse ponto, o cron o relia em
 * todo ciclo, ocupando vaga, e a fase 2 — que só geocodifica pedido SEM ponto
 * — nunca chegava ao texto: o pedido do 99Food com o ponto do app a 120 km de
 * Cabo Frio ficava sem distância até sair da janela, e o motoboy pago por
 * faixa recebia R$ 0 "sem distância" nele.
 *
 * O ponto que o próprio cliente deu (origem "pino" ou "gps") não se apaga: a
 * palavra dele vale mais que a geocodificação do texto.
 */
export function descarteDoPontoGravado(
  gravado: unknown,
  loja: { ponto: { lat: number; lng: number } | null; zonas: unknown },
): DescarteDoPontoGravado | null {
  const o = gravado as any;
  if (!o || typeof o !== "object") return null;
  const lat = Number(o.lat ?? o.latitude);
  const lng = Number(o.lng ?? o.lon ?? o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (pontoDeEnchimento({ lat, lng })) return "enchimento";
  if (!loja.ponto) return null;
  // O mesmo corte da medida: o limite do parceiro, nunca acima dos 60 km.
  const limite = Math.min(DISTANCIA_ABSURDA_KM, limiteDoParceiroKm(raioDaLojaParaOCorte(loja.zonas, loja.ponto)));
  if (linhaRetaKm(loja.ponto, { lat, lng }) <= limite) return null;
  const origem = String(o.origem ?? "").toLowerCase();
  return origem === "pino" || origem === "gps" ? "longe-do-cliente" : "longe";
}

// ── CORREÇÃO DA TAXA DE UM PEDIDO JÁ FEITO (R10) ─────────────────────────

export type FaixaDaLoja = { km: number; taxa: number; repasse: number | null; tempoMin: number | null };

/** As faixas de km da loja, em ordem (o JSONB às vezes volta em texto). */
export function faixasDaLoja(zonas: unknown): FaixaDaLoja[] {
  let lista: unknown = zonas;
  if (typeof lista === "string") {
    try { lista = JSON.parse(lista); } catch { lista = []; }
  }
  return (Array.isArray(lista) ? lista : [])
    .filter((z: any) => z && kmDaZona(z) > 0)
    .map((z: any) => ({
      km: kmDaZona(z),
      taxa: centavos(Number(z.fee) || 0),
      repasse: repasseDaZona(z),
      tempoMin: numeroOuNulo(z.time),
    }))
    .sort((a, b) => a.km - b.km);
}

/**
 * A faixa que esta distância paga — a regra das faixas (R5), a mesma de
 * lib/geocoding.ts: limite inclusivo ("até 1,5 km"), distância arredondada a
 * 0,01 km, folga de 50 m só na última faixa; acima disso é FORA (null). Sem
 * km mínimo: 0 km cai na primeira.
 *
 * É a SUGESTÃO da correção de taxa: com a distância gravada no pedido, a
 * tela mostra qual faixa valia.
 */
export function faixaDaDistancia(zonas: unknown, km: unknown): FaixaDaLoja | null {
  const d = distanciaParaGravar(km);
  if (d == null) return null;
  const faixas = faixasDaLoja(zonas);
  if (!faixas.length) return null;
  const faixa = faixas.find((f) => d <= f.km);
  if (faixa) return faixa;
  const ultima = faixas[faixas.length - 1];
  return d <= centavos(ultima.km + 0.05) ? ultima : null;
}

/** De onde saiu o repasse depois da correção — para o rastro e para a tela. */
export type RepasseDoAjuste =
  /** A loja não separa o repasse: o campo não é mexido. */
  | "sem-tabela"
  /** O repasse gravado não seguia a tabela (foi decidido de outro jeito): fica. */
  | "mantido"
  /** Recalculado pela faixa da distância (a nova, informada, ou a gravada). */
  | "faixa-da-distancia"
  /** Recalculado pela faixa cuja taxa ao cliente é a nova taxa. */
  | "faixa-da-taxa";

export type AjusteDaTaxa = {
  taxaDepois: number;
  totalDepois: number;
  motoboyFeeDepois: number | null;
  deliveryDistanceDepois: number | null;
  repasse: RepasseDoAjuste;
  /** Alguma coisa muda de fato? Sem mudança a rota não grava rastro vazio. */
  mudou: boolean;
};

/**
 * A conta da correção de taxa: o total, o repasse e a distância depois.
 *
 * O caso que pediu isto: a mensagem do "não localizado" dizia "a loja
 * confirma a entrega", mas o cliente a 300 m que pagou R$ 12 (a faixa mais
 * cara) não tinha como ser acertado pelo sistema — e o relatório e o repasse
 * ficavam com o valor errado para sempre.
 *
 * TOTAL: muda exatamente a diferença da taxa (total − taxa antiga + taxa
 * nova). Recalcular pelos itens refaria contas antigas (combos, desconto de
 * cupom) que não são assunto desta correção.
 *
 * REPASSE: só é refeito se SEGUIA a tabela — não havia repasse gravado, ou o
 * gravado era o da faixa da distância/da taxa antiga. Aí o novo vem, nesta
 * ordem:
 *   1. da faixa da distância INFORMADA na correção (a loja diz que a medida
 *      estava errada e sabe a certa);
 *   2. da faixa cuja taxa é a nova, se a loja pediu (`repassePelaTaxa`: "a
 *      medida estava errada, a faixa certa é a de R$ 5");
 *   3. da faixa da distância GRAVADA — o que o motoboy rodou não muda porque
 *      a loja deu desconto;
 *   4. só sem distância nenhuma, da faixa cuja taxa é a nova ("cobrei 12,
 *      era 5" do pedido "não localizado" diz que a faixa era a de R$ 5).
 *
 * A primeira versão punha o 4 antes do 3, e o valor da cortesia decidia o
 * repasse: R$ 20 → 19 numa corrida de 4,9 km caía na faixa de R$ 19 e o
 * motoboy perdia R$ 1; R$ 12 → 10 a 2,3 km, R$ 2. Na tabela da Divinos (5,
 * 8, 10, 12, 15, 17, 18, 19, 20) quase toda cortesia redonda bate numa faixa.
 *
 * Faixa sem valor dá null (R6): vale o acordo do entregador.
 */
export function ajusteDaTaxa(args: {
  totalAntes: number;
  taxaAntes: number;
  taxaNova: number;
  motoboyFeeAntes: number | null;
  distanciaAntes: number | null;
  /** Distância corrigida junto, quando a loja sabe onde o cliente mora. */
  distanciaNova?: number | null;
  /**
   * A medida gravada estava errada e a loja não sabe a distância certa: o
   * repasse acompanha a faixa da taxa nova. Sem isto, com distância gravada,
   * o repasse é o da distância.
   */
  repassePelaTaxa?: boolean;
  regra: RegraDeRepasse;
  zonas: unknown;
}): AjusteDaTaxa {
  const taxaAntes = centavos(Number(args.taxaAntes) || 0);
  const taxaDepois = centavos(Math.max(0, Number(args.taxaNova) || 0));
  const totalDepois = centavos(Math.max(0, (Number(args.totalAntes) || 0) - taxaAntes + taxaDepois));
  const distanciaAntes = distanciaParaGravar(args.distanciaAntes);
  const distanciaInformada = distanciaParaGravar(args.distanciaNova);
  const deliveryDistanceDepois = distanciaInformada ?? distanciaAntes;
  const motoboyFeeAntes =
    args.motoboyFeeAntes == null || !Number.isFinite(Number(args.motoboyFeeAntes)) ? null : centavos(Number(args.motoboyFeeAntes));

  let motoboyFeeDepois = motoboyFeeAntes;
  let repasse: RepasseDoAjuste = "sem-tabela";
  if (args.regra.separado) {
    const daDistanciaAntes = distanciaAntes != null ? repasseDaFaixaKm(args.zonas, distanciaAntes) : null;
    const daTaxaAntes = faixaDaTaxa(args.zonas, taxaAntes);
    const seguia =
      motoboyFeeAntes == null ||
      (daDistanciaAntes != null && daDistanciaAntes === motoboyFeeAntes) ||
      (daTaxaAntes != null && daTaxaAntes.repasse === motoboyFeeAntes);
    repasse = "mantido";
    if (seguia) {
      const daTaxaNova = faixaDaTaxa(args.zonas, taxaDepois);
      if (distanciaInformada != null) {
        motoboyFeeDepois = repasseDaFaixaKm(args.zonas, distanciaInformada);
        repasse = "faixa-da-distancia";
      } else if (args.repassePelaTaxa === true && daTaxaNova) {
        motoboyFeeDepois = daTaxaNova.repasse;
        repasse = "faixa-da-taxa";
      } else if (distanciaAntes != null) {
        motoboyFeeDepois = daDistanciaAntes;
        repasse = "faixa-da-distancia";
      } else if (daTaxaNova) {
        motoboyFeeDepois = daTaxaNova.repasse;
        repasse = "faixa-da-taxa";
      }
    }
  }

  const mudou =
    taxaDepois !== taxaAntes ||
    deliveryDistanceDepois !== distanciaAntes ||
    motoboyFeeDepois !== motoboyFeeAntes;
  return { taxaDepois, totalDepois, motoboyFeeDepois, deliveryDistanceDepois, repasse, mudou };
}

/** Como o dinheiro do pedido está, para a correção dizer o que fazer com a diferença. */
export type SituacaoDoPagamento = {
  /** Gateway ou app (lib/pagamento-na-entrega.ts, ehPagoOnline). */
  pagoOnline: boolean;
  /** ENTREGUE/ENCERRADO: o entregador já recebeu (ou o cliente já pagou). */
  finalizado: boolean;
  /** `paymentPaidAt` preenchido: o pagamento foi confirmado. */
  pagamentoConfirmado: boolean;
  /** Lançado no balcão (source PRESENCIAL): pode ter sido pago no ato. */
  balcao: boolean;
  /** Pagamento dividido gravado (paymentMethods): as partes somam o total antigo. */
  dividido: boolean;
};

/**
 * O aviso da correção de taxa sobre a DIFERENÇA de total — `undefined` quando
 * não há o que avisar.
 *
 * A primeira versão só avisava o pago online. O pedido ENTREGUE pago em
 * dinheiro (o motoboy recebeu R$ 42) e a venda de balcão paga no ato perdiam
 * R$ 7 em silêncio: o total caía e ninguém era orientado a devolver nada — e
 * no fechamento do caixa sobrava dinheiro sem explicação.
 */
export function avisoDaDiferencaDeTotal(diferenca: number, totalDepois: number, s: SituacaoDoPagamento): string | undefined {
  const d = centavos(diferenca);
  if (d === 0) return undefined;
  const valor = reais(Math.abs(d));
  if (s.pagoOnline) {
    return d < 0
      ? `O cliente já pagou online: devolva ${valor} a ele por fora (Pix ou estorno). O sistema não devolve sozinho.`
      : `O cliente já pagou online: os ${valor} a mais precisam ser cobrados na entrega.`;
  }
  if (s.finalizado || s.pagamentoConfirmado || s.dividido) {
    return d < 0
      ? `Este pedido já foi pago: devolva ${valor} ao cliente por fora. O sistema não devolve sozinho.`
      : `Este pedido já foi pago: os ${valor} a mais precisam ser cobrados do cliente por fora.`;
  }
  if (s.balcao) {
    return d < 0
      ? `Se o cliente já pagou no balcão, devolva ${valor} a ele. Se ele paga na entrega, o entregador cobra o total novo: ${reais(totalDepois)}.`
      : `Se o cliente já pagou no balcão, cobre os ${valor} a mais. Se ele paga na entrega, o entregador cobra o total novo: ${reais(totalDepois)}.`;
  }
  return `O entregador cobra o total novo: ${reais(totalDepois)}. A comanda que já saiu impressa mostra o total antigo.`;
}

/** Os campos de entrega do pedido, prontos para o `data` do Prisma. */
export function camposDaEntrega(
  e: EntregaDoPedido,
  regra: RegraDeRepasse,
  zonas: unknown,
): { deliveryDistance: number | null; customerLatLng: PontoGravado | null; motoboyFee: number | null } {
  return {
    // A distância de um palpite ("não sei") não é a da entrega: o cron mede
    // depois, pelo ponto do cliente ou pelo texto.
    deliveryDistance: semDecisao(e) ? null : e.distanciaKm,
    customerLatLng: pontoParaGravar(e),
    motoboyFee: repasseDaEntrega(e, regra, zonas),
  };
}
