/**
 * O relatório "Vendas por área de entrega" — o da Saipos, com a área decidida
 * pela MESMA régua que cobra a taxa.
 *
 * ── A pergunta ──────────────────────────────────────────────────────────────
 *
 * "Qual bairro ou área pede mais — em pedidos, em valor e em ticket?" É o que
 * o lojista usa para decidir onde anunciar, quantos motoboys pôr em cada lado
 * da cidade e se a taxa de uma área está barata demais.
 *
 * ── De onde vem a área ──────────────────────────────────────────────────────
 *
 * A área do pedido é decidida como a taxa é decidida (lib/area-de-entrega.ts,
 * a regra única do /api/delivery-fee — ver a memória "Taxa de entrega tem uma
 * regra só"): se a loja entrega por RAIO, a área é a faixa de km; por BAIRRO,
 * o bairro cadastrado; por ÁREA DESENHADA, o contorno em que o ponto cai. Uma
 * segunda régua aqui seria o relatório dizer "Centro" para o pedido que a
 * taxa cobrou como "Até 4 km".
 *
 *   - Com o ponto do cliente (`customerLatLng`, que o iFood, a 99 e a Brendi
 *     mandam): a área sai do ponto — faixa pela distância até a loja, ou o
 *     contorno que o contém. Área de risco vence tudo, como na taxa.
 *   - Sem ponto: o bairro escrito no endereço, casado com os bairros
 *     cadastrados (`bairroCadastrado`, a mesma função da taxa). No raio, a
 *     distância gravada no pedido na hora da venda substitui o ponto.
 *   - Não casou: agrupa pelo bairro tirado do texto, marcado "fora das áreas
 *     cadastradas" — o lojista vê para onde está entregando sem ter área.
 *   - Sem bairro legível: "Sem endereço identificado".
 *
 * A configuração usada é a de HOJE. Mudar as áreas reclassifica o histórico —
 * a tela avisa. Guardar a área no pedido resolveria, mas nenhum pedido antigo
 * a teria, e o relatório existe justamente para olhar o passado.
 *
 * ── O que entra ─────────────────────────────────────────────────────────────
 *
 * Só ENTREGA (`tipoDeVenda` === "DELIVERY"). Mesa, balcão e totem não têm
 * endereço e não entram — nem o valor da MESA, que mora em TableSession
 * (totalPaid, taxa de serviço, gorjeta) e não tem área nenhuma. O pedido com
 * `tableSessionId` é mesa mesmo que tenha deliveryType DELIVERY (é a régua de
 * lib/origem-da-venda.ts). A RETIRADA sai numa linha à parte, fora do 100%:
 * serve de régua ("quanto do meu delivery é entrega de verdade"), não é área.
 *
 * Valor = `totalAmount`, com a taxa de entrega dentro (a taxa entra no total
 * do pedido — memória "Taxa de entrega tem uma regra só"). Pagamento dividido
 * não muda nada: o pedido é um só, numa área só.
 *
 * Cancelado não soma venda (STATUS_FORA_DA_VENDA, lib/relatorios/base.ts),
 * mas é CONTADO por área: área com muito cancelamento é área com problema
 * (endereço que o motoboy não acha, área de risco). Pedido esperando
 * pagamento e rascunho do robô não entram em nada.
 *
 * O ACRÉSCIMO (pedido filho, `parentOrderId`: a Coca a mais que o cliente do
 * iFood pediu por telefone) é a mesma viagem: o valor soma na área do pedido
 * original, mas não conta como outro pedido — senão a área ganhava duas
 * entregas por uma e o ticket médio caía pela metade. O acréscimo cancelado
 * segue a mesma regra: o valor vai para o cancelado da área, sem contar outro
 * cancelamento.
 *
 * ── Entrega do parceiro ─────────────────────────────────────────────────────
 *
 * Quando o iFood ou a 99 mandam o entregador deles (`infoDaEntrega`, a régua
 * do painel e da comanda), a área e a taxa são da PLATAFORMA — a loja não
 * escolheu entregar ali. Esses pedidos saem numa tabela separada, pelo bairro
 * do endereço, e somam no total de entregas.
 *
 * Puro: não lê banco. A rota (api/store/relatorios/areas-de-entrega) busca os
 * pedidos e as lojas e chama `vendasPorArea`. Testado em
 * scripts/teste-areas-de-entrega.ts.
 */
import {
  areasDesenhadas, bairroCadastrado, bairrosAtendidos, modoDaArea, normalizarTexto,
  type BairroAtendido, type LojaParaEntrega, type ModoDaArea,
} from "@/lib/area-de-entrega";
import { areaDeRiscoDoPonto, dentroDoPoligono } from "@/lib/area-de-risco";
import { haversineDistanceKm } from "@/lib/geocoding";
import { lerPonto, lerPontoDaLoja, type Ponto } from "@/lib/ponto-da-loja";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { c2, canalDoRelatorio, ehCancelado, STATUS_FORA_DA_VENDA, tipoDeVenda } from "@/lib/relatorios/base";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type LojaParaAreas = LojaParaEntrega & { id: string; nome: string };

export type PedidoParaAreas = {
  id: string;
  franchiseeId: string;
  status: string;
  totalAmount: number;
  deliveryType?: string | null;
  source?: string | null;
  tableSessionId?: string | null;
  totemLicenseId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  deliveryFee?: number | null;
  deliveryDistance?: number | null;
  customerAddress?: string | null;
  customerLatLng?: unknown;
  deliveryBy?: string | null;
  ifoodDriverName?: string | null;
  ifoodDriverStatus?: string | null;
  parentOrderId?: string | null;
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

/**
 * Como a área da linha foi decidida.
 *   AREA          área cadastrada (faixa de km, bairro, contorno desenhado)
 *   RISCO         o ponto caiu numa área de risco da loja
 *   FORA          fora das áreas cadastradas — agrupado pelo bairro do texto
 *   SEM_PONTO     a loja decide por ponto/distância e o pedido não tem — bairro do texto
 *   BAIRRO        a loja não tem área cadastrada — bairro do texto
 *   SEM_ENDERECO  nem ponto que decida, nem bairro legível
 *   PARCEIRO      o iFood/99 entregou: a área é da plataforma
 */
export type SituacaoDaArea = "AREA" | "RISCO" | "FORA" | "SEM_PONTO" | "BAIRRO" | "SEM_ENDERECO" | "PARCEIRO";

export const ROTULO_DA_SITUACAO: Record<SituacaoDaArea, string> = {
  AREA: "Área cadastrada",
  RISCO: "Área de risco",
  FORA: "Fora das áreas cadastradas",
  SEM_PONTO: "Sem ponto no mapa",
  BAIRRO: "Bairro do endereço",
  SEM_ENDERECO: "Sem endereço identificado",
  PARCEIRO: "Entrega do parceiro",
};

export const SEM_ENDERECO = "Sem endereço identificado";
/** O ponto caiu fora das áreas e o endereço não diz o bairro. */
export const FORA_SEM_BAIRRO = "Fora das áreas (sem bairro no endereço)";

export type NumerosDaArea = {
  /** Entregas (o acréscimo não conta: é a mesma viagem). */
  pedidos: number;
  /** Soma do total dos pedidos, com a taxa de entrega dentro. */
  valor: number;
  /** Participação no total de entregas (loja + parceiro), 0 a 100, pela métrica escolhida. */
  pct: number;
  ticketMedio: number | null;
  /** Soma e média da taxa de entrega cobrada (`deliveryFee`), por entrega. */
  taxaTotal: number;
  taxaMedia: number | null;
  /** Entregas com taxa zero (grátis, cupom de frete, canal que não mandou a taxa). */
  semTaxa: number;
  /** Distância média, em km, dos pedidos que têm distância. */
  distanciaMedia: number | null;
  comDistancia: number;
  /** Decididos sem o ponto do cliente (pela distância gravada ou pelo nome do bairro). */
  aproximados: number;
  /** Entregas canceladas (o acréscimo cancelado não conta: é a mesma viagem). */
  cancelados: number;
  /** Tudo o que foi cancelado na área, com o valor dos acréscimos cancelados. */
  valorCancelado: number;
};

export type LinhaDaArea = NumerosDaArea & {
  chave: string;
  nome: string;
  lojaId: string;
  loja: string;
  situacao: SituacaoDaArea;
  /** "iFood" / "99Food" quando a entrega foi do parceiro. */
  parceiro: string | null;
  /** A taxa da área na configuração de HOJE (só nas áreas cadastradas). */
  taxaDaArea: number | null;
  /** Ordem natural da área (faixa de km, ordem do cadastro). null = sem ordem. */
  ordem: number | null;
  /** Pedidos por canal, do maior para o menor: "iFood 30 · Wabiz 5". */
  canais: { nome: string; pedidos: number }[];
  /** Mesmo recorte no período anterior (null quando não se pediu a comparação). */
  anterior: { pedidos: number; valor: number } | null;
};

export type TotaisDasAreas = Omit<NumerosDaArea, "pct">;

export type ComparacaoComAnterior = {
  /** Todas as entregas do período anterior (loja + parceiro). */
  pedidos: number;
  valor: number;
  propria: { pedidos: number; valor: number };
  doParceiro: { pedidos: number; valor: number };
  /**
   * Áreas que venderam no período anterior e NADA neste. As cadastradas já
   * aparecem nas linhas (zeradas, com o anterior ao lado); estas são as que
   * não têm linha — o bairro que parou de pedir. Somar só as linhas deixaria
   * o subtotal do anterior menor que o total (NIK, 10 a 16/09: 164 contra 165).
   */
  pararam: { nome: string; loja: string; situacao: SituacaoDaArea; parceiro: string | null; pedidos: number; valor: number }[];
};

export type LojaDoResultado = {
  id: string;
  nome: string;
  modo: ModoDaArea;
  /** "raio em km", "bairros", "área desenhada", "sem área cadastrada". */
  rotuloDoModo: string;
  areasCadastradas: number;
  temPontoDaLoja: boolean;
};

export type ResultadoDasAreas = {
  /** Entregas feitas pela loja, por área. Inclui as áreas cadastradas sem pedido (zeradas). */
  linhas: LinhaDaArea[];
  /** Entregas feitas pelo parceiro (iFood/99), pelo bairro do endereço. */
  parceiro: LinhaDaArea[];
  /**
   * Todas as entregas (loja + parceiro), e cada bloco. O `pct` sai daqui, pela
   * mesma conta das linhas, para a planilha e a tela não fazerem a sua: a
   * planilha escrevia 100% fixo no total e, no período sem entrega nenhuma,
   * mostrava "0 pedidos, R$ 0, 100%" logo abaixo do subtotal com 0%.
   */
  total: NumerosDaArea;
  propria: NumerosDaArea;
  doParceiro: NumerosDaArea;
  /** A linha "Retirada (sem entrega)" — null quando o filtro de tipo não inclui retirada. */
  retirada: { pedidos: number; valor: number; ticketMedio: number | null } | null;
  /** O período anterior de mesmo tamanho (null sem comparação). */
  anterior: ComparacaoComAnterior | null;
  /** Como cada loja decide a área (o campo `lojas` é do cabeçalho comum: os nomes). */
  cadastroDasLojas: LojaDoResultado[];
  pctPor: "valor" | "pedidos";
};

export type OpcoesDasAreas = {
  /** Pedidos do período anterior, para a coluna "vs. anterior". */
  anteriores?: PedidoParaAreas[] | null;
  /** O filtro de tipo inclui retirada (ou não filtra tipo)? Aí sai a linha "Retirada". */
  incluirRetirada?: boolean;
  /** Percentual pelo valor (padrão) ou pela quantidade de pedidos. */
  pctPor?: "valor" | "pedidos";
};

// ── O BAIRRO ESCRITO NO ENDEREÇO ────────────────────────────────────────────

const UFS = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr",
  "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
]);

const semAcento = (t: string) => normalizarTexto(t);

/** Parte que é complemento ou referência, nunca bairro ("Comp: Casa 2", "Ref: portão azul"). */
const COMPLEMENTO_RE = /^(comp(lemento)?|ref(er[eê]ncia)?|obs(erva[cç][aã]o)?|ponto de refer[eê]ncia)\b\s*[:.]?/i;

/** Pedaço separado por vírgula que é pedaço da casa, não do bairro ("casa 3", "apto 201", "LT 12"). */
const PEDACO_DA_CASA_RE = /^(casa|ap|apt|apto|apartamento|bloco|bl|lote|lt|sala|loja|fundos|sobrado|port[aã]o|s\/?n|sn|km)\b/i;

function ehCep(parte: string): boolean {
  const n = semAcento(parte);
  return /\bcep\b/.test(n) || /^\d{5}-?\d{3}$/.test(n);
}

function ehNumero(parte: string): boolean {
  return /^[\d\s./-]*\d[\d\s./-]*[a-z]?$/i.test(parte.trim()) || /^s\/?n$/i.test(parte.trim()) || /^sem n[uú]mero$/i.test(parte.trim());
}

function ehUf(parte: string): boolean {
  return UFS.has(semAcento(parte));
}

/**
 * A parte é a cidade (ou "cidade/UF", "UF", "Brasil")? `cidades` são as que
 * se sabe: a da loja e a que o formato do canal põe no fim.
 */
function ehCidadeOuPais(parte: string, cidades: string[]): boolean {
  const n = semAcento(parte);
  if (!n) return true;
  if (n === "brasil" || n === "brazil") return true;
  if (ehUf(n)) return true;
  // "Brasília/DF", "Rio das Ostras/RJ" — o jeito da Wabiz escrever a cidade.
  if (/^[^/]{2,}\/\s*[a-z]{2}$/.test(n)) return true;
  return cidades.some((c) => n === c || n.startsWith(`${c}/`));
}

function limparParte(parte: string): string {
  return parte
    .replace(/^\s*(bairro|b\.)\s*:?\s*/i, "")
    .replace(/[|•]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:\-]+|[\s.,;:\-]+$/g, "")
    .trim();
}

/** Tem cara de bairro: tem letra e não é longo demais para ser nome de lugar. */
function pareceBairro(parte: string): boolean {
  if (!/[a-zà-ú]/i.test(parte)) return false;
  if (parte.length < 2 || parte.length > 40) return false;
  return parte.split(" ").length <= 6;
}

/**
 * O bairro escrito no endereço, sem mapa: o texto livre de cada canal.
 *
 * Os formatos que chegam (medidos em produção em 24/09/2026):
 *   iFood   "Q 11 Cl, 10 - Comp: Apto 102 - Ref: Academia - Sobradinho - Brasília"
 *   Brendi  "Rua Caravelas, 59 - Sobrado - Trindade - São Gonçalo"
 *   JotaJá  "Rua da Fonte, 512, Portão marrom, Nova Cidade - Rio das Ostras - Brasil - Rio das Ostras"
 *   Wabiz   "Quadra 16 conjunto G, Sn - Casa 10 - QUADRA 16 - Brasília/DF - CEP 73050167"
 *   99Food  "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco"
 *   Site    "Rua das Casuarinas, 20 - Âncora (Apartamento 201)"
 *   Robô    "Rua Paranaíba, 470, Operário, Rio das Ostras"
 *
 * A regra: quebra no " - ", joga fora complemento, referência, CEP, cidade,
 * UF e número; o bairro é a ÚLTIMA parte que sobra depois da rua (todos os
 * canais põem o bairro logo antes da cidade). Parte com vírgula ("Liberdade,
 * Rio das Ostras", da 99) vale pelo primeiro pedaço. Nada depois da rua? Tenta
 * os pedaços da própria rua separados por vírgula (o robô e a JotaJá escrevem
 * "rua, número, bairro").
 *
 * `ultimaParteEhCidade`: no iFood, na Brendi e na JotaJá a última parte é
 * SEMPRE a cidade do cliente — que pode não ser a da loja (Hakim Unamar
 * entrega em Cabo Frio), e aí só o formato diz que aquilo não é bairro.
 *
 * Não acha bairro = null. Nunca chuta a rua como bairro.
 */
export function bairroDoEndereco(
  texto: string | null | undefined,
  opcoes: { cidades?: (string | null | undefined)[]; ultimaParteEhCidade?: boolean } = {},
): string | null {
  let t = String(texto || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // O complemento do site vem entre parênteses: "Âncora (Apartamento 201)".
  t = t.replace(/\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  // Rodovia escrita com o hífen espaçado ("DF - 425", "BR - 101") não é duas partes.
  t = t.replace(/\b([a-z]{2})\s+-\s+(\d{2,3})\b/gi, (m, uf: string, n: string) => (UFS.has(uf.toLowerCase()) || uf.toLowerCase() === "br" ? `${uf}-${n}` : m));

  const cidades = (opcoes.cidades || []).map((c) => semAcento(String(c || ""))).filter(Boolean);
  const partes = t.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);

  if (opcoes.ultimaParteEhCidade && partes.length >= 2) {
    const cidadeDoCliente = semAcento(partes[partes.length - 1]);
    if (cidadeDoCliente) cidades.push(cidadeDoCliente);
    partes.pop();
  }

  const descartavel = (p: string) => COMPLEMENTO_RE.test(p) || ehCep(p) || ehNumero(p) || ehCidadeOuPais(p, cidades);

  // O primeiro pedaço útil de uma parte com vírgula ("Liberdade, Rio das Ostras").
  const daParte = (p: string): string | null => {
    for (const pedaco of p.split(",").map(limparParte)) {
      if (!pedaco || descartavel(pedaco) || PEDACO_DA_CASA_RE.test(pedaco)) continue;
      return pareceBairro(pedaco) ? pedaco : null;
    }
    return null;
  };

  const candidatos = partes.slice(1)
    .filter((p) => !descartavel(p) && !descartavel(p.split(",")[0].trim()))
    .map(daParte)
    .filter((p): p is string => Boolean(p));
  if (candidatos.length) return candidatos[candidatos.length - 1];

  // Nada depois da rua: "Rua Paranaíba, 470, Operário, Rio das Ostras".
  const pedacos = (partes[0] || "").split(",").map(limparParte).filter(Boolean);
  for (let i = pedacos.length - 1; i >= 1; i--) {
    const p = pedacos[i];
    if (descartavel(p) || PEDACO_DA_CASA_RE.test(p)) continue;
    if (pareceBairro(p)) return p;
    break;
  }
  return null;
}

/**
 * A chave de agrupamento de um bairro escrito à mão: sem acento, sem caixa,
 * sem pontuação, "02" = "2" e "II" = "2". Na NIK o mesmo bairro chega
 * "Sobradinho II" pelo iFood e "SOBRADINHO 2" pela Wabiz, e "Quadra 02" e
 * "QUADRA 2" são a mesma quadra. A abreviação na frente de um nome vira a
 * palavra: o iFood mandou "St. Oeste" numa semana e "Setor Oeste" na outra.
 *
 * O numeral romano vira algarismo em QUALQUER palavra depois da primeira, e
 * não só na última, porque esta chave também é tirada do endereço INTEIRO em
 * `bairroAchadoNoTexto`, e lá o numeral fica no meio: "Tv. We 77 Cidade Nova
 * VI, 762 - Ananindeua". Só no fim, a Ragnar Burger tinha 27 endereços
 * "Cidade Nova <romano>" em 400 dias (24/09/2026), e os deduzidos caíam em
 * "Cidade Nova" em vez de "Cidade Nova 6": o mesmo bairro dividido pelo jeito
 * de escrever a rua. A primeira palavra fica como está ("Vi" sozinho não é
 * seis), e "I", "V" e "X" também: em "Conjunto I" ou "Quadra V" a letra é
 * tão provável quanto o número.
 */
const ABREVIACOES: Record<string, string> = {
  st: "setor", jd: "jardim", jdm: "jardim", pq: "parque", pqe: "parque", vl: "vila", qd: "quadra", qda: "quadra",
  cj: "conjunto", conj: "conjunto", res: "residencial", resid: "residencial", cond: "condominio", sta: "santa", sto: "santo",
};
const ROMANOS: Record<string, string> = { ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9" };

export function chaveDoBairro(nome: string): string {
  return semAcento(nome)
    .replace(/[.,;:|/\\'"`´]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((p, i, todas) => {
      if (/^\d+$/.test(p)) return String(Number(p));
      if (i > 0 && ROMANOS[p]) return ROMANOS[p];
      if (i < todas.length - 1 && ABREVIACOES[p]) return ABREVIACOES[p];
      return p;
    })
    .join(" ");
}

/**
 * A chave que JUNTA as linhas: a de `chaveDoBairro` sem os espaços e sem
 * letra dobrada. O site da Hakim Centro gravou "JardimBelaVista" e "Jardim
 * Bela Vista" na mesma semana, e o iFood da Delicias de Casa manda "Costazul"
 * para o bairro que ela cadastrou como "Costa Azul" (medido em 24/09/2026).
 * Só LETRA dobrada: "Quadra 11" e "Quadra 1" continuam duas quadras.
 */
export function chaveDeGrupo(nome: string): string {
  return chaveDoBairro(nome).replace(/ /g, "").replace(/([a-z])\1+/g, "$1");
}

/**
 * O ponto do cliente, quando dá para confiar nele. A 99 manda (-23, -44) —
 * número redondo, no meio do mar — no pedido que ela não localizou (31 pedidos
 * em 60 dias, 24/09/2026). Coordenada inteira nos dois eixos não é endereço.
 */
function pontoDoCliente(valor: unknown): Ponto | null {
  const p = lerPonto(valor);
  if (!p) return null;
  if (Number.isInteger(p.lat) && Number.isInteger(p.lng)) return null;
  return p;
}

const PALAVRAS_MIUDAS = new Set(["de", "da", "do", "das", "dos", "e", "d"]);

/** "QUADRA 16" → "Quadra 16". Só mexe no que veio TODO em maiúscula (a Wabiz grita). */
function nomeLegivel(nome: string): string {
  if (nome !== nome.toUpperCase() || !/[A-Z]/.test(nome)) return nome;
  return nome.toLowerCase().split(" ").map((p, i) => {
    if (i > 0 && PALAVRAS_MIUDAS.has(p)) return p;
    // Numeral romano ("Sobradinho II") e rodovia ("DF-425") continuam em maiúscula.
    if (/^(i{1,3}|iv|vi{0,3}|ix)$/.test(p) || /^[a-z]{2}-\d+$/.test(p)) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(" ");
}

// ── A CONFIGURAÇÃO DA LOJA, LIDA UMA VEZ ────────────────────────────────────

/** Acima disto, a distância é de um homônimo em outra cidade (a mesma régua de lib/area-de-entrega.ts). */
const DISTANCIA_ABSURDA_KM = 60;

type Faixa = { km: number; fee: number; nome: string; ordem: number };
type Contorno = { nome: string; pontos: [number, number][]; fee: number; ordem: number };

export type ConfigDaLoja = {
  id: string;
  nome: string;
  cidade: string;
  modo: ModoDaArea;
  medePorRota: boolean;
  faixas: Faixa[];
  contornos: Contorno[];
  bairros: BairroAtendido[];
  pontoDaLoja: Ponto | null;
  deliveryConfig: unknown;
};

function zonasDaLoja(loja: LojaParaEntrega): any[] {
  const z = loja.deliveryZones;
  if (Array.isArray(z)) return z;
  if (typeof z === "string") { try { const p = JSON.parse(z); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

const fmtKm = (km: number) => km.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * As faixas de km, como lib/geocoding.ts (`verifyStoreDeliveryAddress`) as lê:
 * `km`, `radius` ou `maxKm`, maiores que zero, da menor para a maior.
 */
function faixasDaLoja(loja: LojaParaEntrega): Faixa[] {
  const lidas = zonasDaLoja(loja)
    .filter((z) => z && (z.km !== undefined || z.radius !== undefined || z.maxKm !== undefined))
    .map((z) => ({ km: Number(z.km !== undefined ? z.km : z.radius !== undefined ? z.radius : z.maxKm), fee: Number(z.fee || 0) }))
    .filter((z) => Number.isFinite(z.km) && z.km > 0)
    .sort((a, b) => a.km - b.km);
  const unicas = lidas.filter((z, i) => i === 0 || z.km !== lidas[i - 1].km);
  return unicas.map((z, i) => ({
    ...z,
    ordem: i,
    nome: i === 0 ? `Até ${fmtKm(z.km)} km` : `${fmtKm(unicas[i - 1].km)} a ${fmtKm(z.km)} km`,
  }));
}

function prepararLoja(loja: LojaParaAreas): ConfigDaLoja {
  const modo = modoDaArea(loja);
  return {
    id: loja.id,
    nome: loja.nome,
    cidade: String(loja.city || ""),
    modo,
    medePorRota: String(loja.deliveryZoneType || "").toUpperCase() === "ROTA",
    faixas: modo === "KM" ? faixasDaLoja(loja) : [],
    contornos: modo === "POLIGONO" ? areasDesenhadas(loja).map((a, i) => ({ nome: a.nome, pontos: a.pontos, fee: a.fee, ordem: i })) : [],
    bairros: modo === "BAIRRO" ? bairrosAtendidos(loja) : [],
    pontoDaLoja: lerPontoDaLoja(loja.storeLatLng as any),
    deliveryConfig: loja.deliveryConfig,
  };
}

const ROTULO_DO_MODO: Record<ModoDaArea, string> = {
  KM: "raio em km",
  BAIRRO: "bairros",
  POLIGONO: "área desenhada no mapa",
  SEM_AREA: "sem área cadastrada",
};

/**
 * A faixa que cobre a distância — a conta de `verifyStoreDeliveryAddress`:
 * a primeira faixa que alcança; além da última, com 50 m de tolerância, ainda
 * é a última; mais longe que isso, fora.
 */
function faixaDaDistancia(km: number, faixas: Faixa[]): Faixa | null {
  if (!faixas.length) return null;
  const achada = faixas.find((f) => km <= f.km);
  if (achada) return achada;
  const ultima = faixas[faixas.length - 1];
  return km <= ultima.km + 0.05 ? ultima : null;
}

// ── A ÁREA DE UM PEDIDO ─────────────────────────────────────────────────────

export type AreaDoPedido = {
  chave: string;
  nome: string;
  situacao: SituacaoDaArea;
  parceiro: string | null;
  taxaDaArea: number | null;
  ordem: number | null;
  aproximado: boolean;
  distanciaKm: number | null;
};

const CANAIS_COM_CIDADE_NO_FIM = new Set(["IFOOD", "BRENDI", "JOTAJA"]);
const NOME_DO_CANAL = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));

function distanciaValida(km: unknown): number | null {
  const n = Number(km);
  return Number.isFinite(n) && n > 0 && n <= DISTANCIA_ABSURDA_KM ? n : null;
}

/** O bairro escrito no endereço do pedido, com o formato do canal dele. */
export function bairroDoPedido(pedido: PedidoParaAreas, cidadeDaLoja: string | null | undefined): string | null {
  return bairroDoEndereco(pedido.customerAddress, {
    cidades: [cidadeDaLoja],
    ultimaParteEhCidade: CANAIS_COM_CIDADE_NO_FIM.has(canalDoRelatorio(pedido as any)),
  });
}

/** Um bairro que o relatório já viu escrito em outro pedido da mesma loja. */
export type BairroVisto = { nome: string; chave: string };

/**
 * O bairro já visto que aparece no MEIO do texto, como palavras inteiras (o
 * mais longo vence: "Sobradinho 2" antes de "Sobradinho").
 *
 * Existe por causa do iFood: ele tira o bairro do endereço quando o bairro já
 * está no nome da rua (lib/ifood-eventos.ts, `parts[0].includes(neighborhood)`).
 * "Sh Mansões Sobradinho Ar 1 Conjunto 4, casa 17 - Brasília" não tem parte de
 * bairro — mas "Sobradinho" está ali dentro, e é o bairro que outros 139
 * pedidos da NIK escreveram (17 a 23/09/2026: 7 dos 202 pedidos iam para "Sem
 * endereço identificado" por isso). O balcão da NIK escreve só "quadra 05", que
 * é a "QUADRA 5" que a Wabiz manda.
 *
 * O texto e os bairros vistos passam pela mesma `chaveDoBairro`, que troca o
 * numeral romano em qualquer posição: "…Cidade Nova VI, 762…" acha o "Cidade
 * Nova 6" já visto, e não para no "Cidade Nova" mais curto.
 */
export function bairroAchadoNoTexto(texto: string | null | undefined, vistos: BairroVisto[]): string | null {
  if (!texto || !vistos.length) return null;
  const alvo = ` ${chaveDoBairro(String(texto).replace(/[-–—()]/g, " "))} `;
  let melhor: BairroVisto | null = null;
  for (const v of vistos) {
    if (v.chave.length < 3) continue;
    if (alvo.includes(` ${v.chave} `) && (!melhor || v.chave.length > melhor.chave.length)) melhor = v;
  }
  return melhor ? melhor.nome : null;
}

/**
 * A área de UM pedido de entrega, pela configuração atual da loja. Exportada
 * para o teste e para quem quiser a mesma resposta em outra tela. `vistos` são
 * os bairros que o relatório leu nos outros pedidos da loja (ver
 * `bairroAchadoNoTexto`).
 */
export function areaDoPedido(pedido: PedidoParaAreas, cfg: ConfigDaLoja, vistos: BairroVisto[] = []): AreaDoPedido {
  const bairroEscrito = bairroDoPedido(pedido, cfg.cidade);
  const bairroAchado = bairroEscrito ? null : bairroAchadoNoTexto(pedido.customerAddress, vistos);
  const bairroDoTexto = bairroEscrito || bairroAchado;
  const ponto = pontoDoCliente(pedido.customerLatLng);
  const gravada = distanciaValida(pedido.deliveryDistance);
  const emLinhaReta = ponto && cfg.pontoDaLoja
    ? distanciaValida(haversineDistanceKm(cfg.pontoDaLoja.lat, cfg.pontoDaLoja.lng, ponto.lat, ponto.lng))
    : null;
  // A distância para a MÉDIA: a gravada na venda (a que a taxa usou, e a que o
  // iFood mede), senão a linha reta entre a loja e o ponto do cliente.
  const distanciaKm = gravada ?? emLinhaReta;

  const pelosBairros = (situacao: SituacaoDaArea, parceiro: string | null = null): AreaDoPedido => {
    if (!bairroDoTexto) {
      // Fora da área SABIDO (o ponto disse) continua fora, mesmo sem bairro:
      // "Sem endereço" esconderia que a loja entregou onde não cadastrou.
      if (situacao === "FORA") {
        return { chave: `${cfg.id}|FORA||`, nome: FORA_SEM_BAIRRO, situacao, parceiro, taxaDaArea: null, ordem: null, aproximado: false, distanciaKm };
      }
      return { chave: `${cfg.id}|SEM_ENDERECO|${parceiro || ""}`, nome: SEM_ENDERECO, situacao: parceiro ? "PARCEIRO" : "SEM_ENDERECO", parceiro, taxaDaArea: null, ordem: null, aproximado: false, distanciaKm };
    }
    return { chave: `${cfg.id}|${situacao}|${parceiro || ""}|${chaveDeGrupo(bairroDoTexto)}`, nome: bairroDoTexto, situacao, parceiro, taxaDaArea: null, ordem: null, aproximado: Boolean(bairroAchado), distanciaKm };
  };
  const naArea = (chave: string, nome: string, taxa: number | null, ordem: number | null, aproximado: boolean): AreaDoPedido =>
    ({ chave: `${cfg.id}|AREA|${chave}`, nome, situacao: "AREA", parceiro: null, taxaDaArea: taxa, ordem, aproximado, distanciaKm });

  // Entrega do parceiro: a área é da plataforma, não da loja.
  const entrega = infoDaEntrega(pedido);
  if (entrega.parceira) {
    const parceiro = entrega.parceiro === "IFOOD" ? "iFood" : entrega.parceiro === "99FOOD" ? "99Food" : NOME_DO_CANAL.get(entrega.parceiro) || entrega.parceiro;
    return pelosBairros("PARCEIRO", parceiro);
  }

  // Área de risco vence tudo — como em `avaliarEntrega`. Só com o ponto.
  const risco = ponto ? areaDeRiscoDoPonto(ponto, cfg.deliveryConfig) : null;
  if (risco) {
    return { chave: `${cfg.id}|RISCO|${chaveDeGrupo(risco)}`, nome: risco, situacao: "RISCO", parceiro: null, taxaDaArea: null, ordem: null, aproximado: false, distanciaKm };
  }

  if (cfg.modo === "SEM_AREA") return pelosBairros("BAIRRO");

  if (cfg.modo === "BAIRRO") {
    // O bairro tirado do texto primeiro (o campo "bairro" que a taxa recebe
    // separado), o endereço inteiro depois — a ordem de `avaliarEntrega`. Por
    // último, o mesmo nome sem os espaços ("Costazul" do iFood = "Costa Azul"
    // cadastrado): o pedido de marketplace nunca passou pela régua da taxa, e
    // chamar de "fora" o bairro que a loja cadastrou seria mentir para ela.
    const grupo = bairroDoTexto ? chaveDeGrupo(bairroDoTexto) : "";
    const achado = bairroCadastrado(bairroDoTexto, cfg.bairros)
      || bairroCadastrado(pedido.customerAddress, cfg.bairros)
      || (grupo ? cfg.bairros.find((b) => chaveDeGrupo(b.name) === grupo) || null : null);
    if (achado) {
      const ordem = cfg.bairros.findIndex((b) => b.name === achado.name);
      return naArea(`b:${chaveDeGrupo(achado.name)}`, achado.name, achado.fee, ordem >= 0 ? ordem : null, false);
    }
    return pelosBairros("FORA");
  }

  if (cfg.modo === "POLIGONO") {
    if (ponto) {
      // Contornos sobrepostos: vale o de MENOR taxa, como na taxa.
      const dentro = cfg.contornos.filter((c) => dentroDoPoligono(ponto, c.pontos)).sort((a, b) => a.fee - b.fee);
      if (dentro[0]) return naArea(`p:${dentro[0].ordem}`, dentro[0].nome, dentro[0].fee, dentro[0].ordem, false);
      return pelosBairros("FORA");
    }
    // Sem ponto a geometria não decide. O contorno com o NOME do bairro escrito
    // ("Centro" desenhado, "... - Centro - ..." no endereço) é o palpite que
    // resta — marcado como aproximado, porque a fronteira desenhada pode não
    // ser a do bairro.
    const porNome = bairroCadastrado(bairroDoTexto, cfg.contornos.map((c) => ({ name: c.nome, fee: c.fee, time: 0 })));
    const contorno = porNome ? cfg.contornos.find((c) => c.nome === porNome.name) : null;
    if (contorno) return naArea(`p:${contorno.ordem}`, contorno.nome, contorno.fee, contorno.ordem, true);
    return pelosBairros("SEM_PONTO");
  }

  // Raio (KM, e ROTA medido pelas ruas).
  let km: number | null = emLinhaReta;
  let aproximado = false;
  // Loja que mede pela rota cobra pela distância das ruas; a gravada no pedido
  // é a que valeu. Rota menor que a linha reta é resposta ruim (a mesma
  // conferência de lib/geocoding.ts).
  if (km != null && cfg.medePorRota && gravada != null && gravada >= km - 0.05) km = gravada;
  if (km == null && gravada != null) { km = gravada; aproximado = true; }
  if (km == null) return pelosBairros("SEM_PONTO");
  const faixa = faixaDaDistancia(km, cfg.faixas);
  if (faixa) return naArea(`k:${faixa.km}`, faixa.nome, faixa.fee, faixa.ordem, aproximado);
  return pelosBairros("FORA");
}

// ── A SOMA ──────────────────────────────────────────────────────────────────

type Acumulador = {
  chave: string;
  lojaId: string;
  situacao: SituacaoDaArea;
  parceiro: string | null;
  taxaDaArea: number | null;
  ordem: number | null;
  /** Grafias vistas do nome, com quantas vezes — vence a mais comum. */
  grafias: Map<string, number>;
  pedidos: number;
  valor: number;
  taxaTotal: number;
  semTaxa: number;
  distSoma: number;
  comDistancia: number;
  aproximados: number;
  cancelados: number;
  valorCancelado: number;
  canais: Map<string, number>;
};

function novoAcumulador(a: Pick<AreaDoPedido, "chave" | "situacao" | "parceiro" | "taxaDaArea" | "ordem">, lojaId: string): Acumulador {
  return {
    chave: a.chave, lojaId, situacao: a.situacao, parceiro: a.parceiro, taxaDaArea: a.taxaDaArea, ordem: a.ordem,
    grafias: new Map(), pedidos: 0, valor: 0, taxaTotal: 0, semTaxa: 0, distSoma: 0, comDistancia: 0,
    aproximados: 0, cancelados: 0, valorCancelado: 0, canais: new Map(),
  };
}

type Soma = {
  areas: Map<string, Acumulador>;
  retirada: { pedidos: number; valor: number };
};

const statusForaDaVenda = new Set(STATUS_FORA_DA_VENDA.map((s) => s.toUpperCase()));

function somar(pedidos: PedidoParaAreas[], cfgs: Map<string, ConfigDaLoja>, vistos: Map<string, BairroVisto[]>, semear: boolean): Soma {
  const areas = new Map<string, Acumulador>();
  const retirada = { pedidos: 0, valor: 0 };

  // As áreas cadastradas entram mesmo sem pedido: "o Centro não pediu nada
  // esta semana" é resposta, e a Saipos simplesmente não mostra.
  if (semear) {
    for (const cfg of cfgs.values()) {
      const semente = (chave: string, nome: string, taxa: number, ordem: number) => {
        const k = `${cfg.id}|AREA|${chave}`;
        if (areas.has(k)) return;
        const acc = novoAcumulador({ chave: k, situacao: "AREA", parceiro: null, taxaDaArea: taxa, ordem }, cfg.id);
        acc.grafias.set(nome, 0);
        areas.set(k, acc);
      };
      cfg.faixas.forEach((f) => semente(`k:${f.km}`, f.nome, f.fee, f.ordem));
      cfg.bairros.forEach((b, i) => semente(`b:${chaveDeGrupo(b.name)}`, b.name, b.fee, i));
      cfg.contornos.forEach((c) => semente(`p:${c.ordem}`, c.nome, c.fee, c.ordem));
    }
  }

  // id do pedido original → chave da área dele, para o acréscimo achar o pai.
  // Separados porque o acréscimo VENDIDO só se junta a um pai vendido (pai
  // cancelado: o acréscimo foi a única coisa entregue ali, e conta como
  // entrega), enquanto o acréscimo CANCELADO vai para o pai em qualquer caso.
  const areaDoVendido = new Map<string, string>();
  const areaDoCancelado = new Map<string, string>();
  const acrescimos: PedidoParaAreas[] = [];

  /** Uma entrega na área dela: vendida soma a venda, cancelada soma o cancelamento. */
  const acumular = (p: PedidoParaAreas, area: AreaDoPedido) => {
    let acc = areas.get(area.chave);
    if (!acc) { acc = novoAcumulador(area, p.franchiseeId); areas.set(area.chave, acc); }
    acc.grafias.set(area.nome, (acc.grafias.get(area.nome) || 0) + 1);
    const valor = Number(p.totalAmount) || 0;
    if (ehCancelado(p.status)) {
      acc.cancelados += 1;
      acc.valorCancelado += valor;
      return;
    }
    acc.valor += valor;
    acc.pedidos += 1;
    const taxa = Number(p.deliveryFee) || 0;
    acc.taxaTotal += taxa;
    if (!(taxa > 0)) acc.semTaxa += 1;
    if (area.distanciaKm != null) { acc.distSoma += area.distanciaKm; acc.comDistancia += 1; }
    if (area.aproximado) acc.aproximados += 1;
    const canal = NOME_DO_CANAL.get(canalDoRelatorio(p as any)) || "Outro canal";
    acc.canais.set(canal, (acc.canais.get(canal) || 0) + 1);
  };

  for (const p of pedidos) {
    const status = String(p.status || "").toUpperCase();
    const cancelado = ehCancelado(status);
    // Esperando pagamento e rascunho do robô não são venda nem cancelamento.
    if (statusForaDaVenda.has(status) && !cancelado) continue;
    const cfg = cfgs.get(p.franchiseeId);
    if (!cfg) continue;

    const tipo = tipoDeVenda(p as any);
    if (tipo === "RETIRADA") {
      if (!cancelado) {
        retirada.valor += Number(p.totalAmount) || 0;
        if (!p.parentOrderId) retirada.pedidos += 1;
      }
      continue;
    }
    // Mesa, balcão e totem não têm entrega (e o valor da mesa mora na
    // TableSession, que também não tem área).
    if (tipo !== "DELIVERY") continue;

    // O acréscimo espera o pai, que pode vir depois dele na lista.
    if (p.parentOrderId) { acrescimos.push(p); continue; }
    const area = areaDoPedido(p, cfg, vistos.get(p.franchiseeId));
    (cancelado ? areaDoCancelado : areaDoVendido).set(p.id, area.chave);
    acumular(p, area);
  }

  // O acréscimo vai para a área do pedido original, sem contar outra entrega.
  //   - Vendido: soma o valor na venda do pai.
  //   - Cancelado: soma o valor no cancelado do pai, sem +1 em "cancelados".
  //     Pedido de R$ 60 e acréscimo de R$ 10 cancelados são UMA viagem que
  //     não aconteceu ("1 cancelado, R$ 70"), não duas. E o acréscimo
  //     cancelado de um pedido entregue não é entrega cancelada nenhuma: a
  //     viagem aconteceu; só o valor dele aparece como cancelado na área.
  // Pai fora da lista (outro período, filtrado pelo canal; ou cancelado, para
  // o acréscimo vendido): é pedido naquele endereço e conta como próprio.
  for (const p of acrescimos) {
    const valor = Number(p.totalAmount) || 0;
    const idDoPai = p.parentOrderId!;
    if (ehCancelado(p.status)) {
      const chaveDoPai = areaDoVendido.get(idDoPai) ?? areaDoCancelado.get(idDoPai);
      const pai = chaveDoPai ? areas.get(chaveDoPai) : undefined;
      if (pai) { pai.valorCancelado += valor; continue; }
    } else {
      const chaveDoPai = areaDoVendido.get(idDoPai);
      const pai = chaveDoPai ? areas.get(chaveDoPai) : undefined;
      if (pai) { pai.valor += valor; continue; }
    }
    const cfg = cfgs.get(p.franchiseeId)!;
    acumular(p, areaDoPedido(p, cfg, vistos.get(p.franchiseeId)));
  }

  return { areas, retirada };
}

function totais(accs: Acumulador[]): TotaisDasAreas {
  const t = accs.reduce((s, a) => ({
    pedidos: s.pedidos + a.pedidos, valor: s.valor + a.valor, taxaTotal: s.taxaTotal + a.taxaTotal, semTaxa: s.semTaxa + a.semTaxa,
    distSoma: s.distSoma + a.distSoma, comDistancia: s.comDistancia + a.comDistancia, aproximados: s.aproximados + a.aproximados,
    cancelados: s.cancelados + a.cancelados, valorCancelado: s.valorCancelado + a.valorCancelado,
  }), { pedidos: 0, valor: 0, taxaTotal: 0, semTaxa: 0, distSoma: 0, comDistancia: 0, aproximados: 0, cancelados: 0, valorCancelado: 0 });
  return {
    pedidos: t.pedidos,
    valor: c2(t.valor),
    ticketMedio: t.pedidos ? c2(t.valor / t.pedidos) : null,
    taxaTotal: c2(t.taxaTotal),
    taxaMedia: t.pedidos ? c2(t.taxaTotal / t.pedidos) : null,
    semTaxa: t.semTaxa,
    distanciaMedia: t.comDistancia ? c2(t.distSoma / t.comDistancia) : null,
    comDistancia: t.comDistancia,
    aproximados: t.aproximados,
    cancelados: t.cancelados,
    valorCancelado: c2(t.valorCancelado),
  };
}

/**
 * Ordem: as áreas com venda, pelo valor (ou pedidos); depois "Sem endereço
 * identificado", que não é lugar; depois as que só tiveram cancelamento; e
 * por último as áreas cadastradas que não tiveram nada no período.
 */
function pesoDaLinha(l: LinhaDaArea): number {
  if (!l.pedidos && !l.valor) return l.cancelados ? 2 : 3;
  return l.nome === SEM_ENDERECO ? 1 : 0;
}

/**
 * O relatório inteiro: as entregas por área, as do parceiro à parte, os
 * totais, a retirada e a comparação com o período anterior.
 */
export function vendasPorArea(pedidos: PedidoParaAreas[], lojas: LojaParaAreas[], opcoes: OpcoesDasAreas = {}): ResultadoDasAreas {
  const pctPor = opcoes.pctPor === "pedidos" ? "pedidos" : "valor";
  const cfgs = new Map(lojas.map((l) => [l.id, prepararLoja(l)]));

  // Os bairros escritos nas entregas de cada loja (dos dois períodos), para
  // achar o bairro no meio do texto de quem não o escreveu separado.
  const vistos = new Map<string, BairroVisto[]>();
  for (const p of [...pedidos, ...(opcoes.anteriores || [])]) {
    const cfg = cfgs.get(p.franchiseeId);
    const status = String(p.status || "").toUpperCase();
    if (!cfg || tipoDeVenda(p as any) !== "DELIVERY" || (statusForaDaVenda.has(status) && !ehCancelado(status))) continue;
    const nome = bairroDoPedido(p, cfg.cidade);
    if (!nome) continue;
    const lista = vistos.get(p.franchiseeId) || [];
    const chave = chaveDoBairro(nome);
    if (!lista.some((v) => v.chave === chave)) lista.push({ nome, chave });
    vistos.set(p.franchiseeId, lista);
  }

  const atual = somar(pedidos, cfgs, vistos, true);
  const anterior = opcoes.anteriores ? somar(opcoes.anteriores, cfgs, vistos, false) : null;

  const todos = [...atual.areas.values()];
  const total = totais(todos);
  const base = pctPor === "valor" ? total.valor : total.pedidos;
  // Sem entrega nenhuma, tudo é 0% (inclusive o total): 100% de nada é o
  // Excel dizendo que houve venda.
  const comPct = (t: TotaisDasAreas): NumerosDaArea => ({
    ...t,
    pct: base > 0 ? c2(((pctPor === "valor" ? t.valor : t.pedidos) / base) * 100) : 0,
  });
  const nomeDaLoja = new Map(lojas.map((l) => [l.id, l.nome]));

  /** O nome da linha: a grafia mais vista (a do cadastro, nas áreas cadastradas). */
  const nomeDe = (a: Acumulador): string => {
    let nome = SEM_ENDERECO;
    let maior = -1;
    for (const [grafia, n] of a.grafias) if (n > maior) { maior = n; nome = grafia; }
    return a.situacao === "AREA" || a.situacao === "RISCO" ? nome : nomeLegivel(nome);
  };

  const linha = (a: Acumulador): LinhaDaArea => {
    const ant = anterior ? anterior.areas.get(a.chave) : undefined;
    return {
      chave: a.chave,
      nome: nomeDe(a),
      lojaId: a.lojaId,
      loja: nomeDaLoja.get(a.lojaId) || "Loja",
      situacao: a.situacao,
      parceiro: a.parceiro,
      taxaDaArea: a.taxaDaArea,
      ordem: a.ordem,
      ...comPct(totais([a])),
      canais: [...a.canais.entries()].map(([n, q]) => ({ nome: n, pedidos: q })).sort((x, y) => y.pedidos - x.pedidos || x.nome.localeCompare(y.nome)),
      anterior: anterior ? { pedidos: ant?.pedidos || 0, valor: c2(ant?.valor || 0) } : null,
    };
  };

  const ordenar = (x: LinhaDaArea, y: LinhaDaArea) =>
    pesoDaLinha(x) - pesoDaLinha(y)
    || (pctPor === "valor" ? y.valor - x.valor || y.pedidos - x.pedidos : y.pedidos - x.pedidos || y.valor - x.valor)
    || y.cancelados - x.cancelados
    || (x.ordem ?? 1e9) - (y.ordem ?? 1e9)
    || x.nome.localeCompare(y.nome, "pt-BR");

  const linhas = todos.filter((a) => a.situacao !== "PARCEIRO").map(linha).sort(ordenar);
  const parceiro = todos.filter((a) => a.situacao === "PARCEIRO").map(linha).sort(ordenar);

  let comparacao: ComparacaoComAnterior | null = null;
  if (anterior) {
    const antes = [...anterior.areas.values()];
    const soma = (lista: Acumulador[]) => { const t = totais(lista); return { pedidos: t.pedidos, valor: t.valor }; };
    comparacao = {
      ...soma(antes),
      propria: soma(antes.filter((a) => a.situacao !== "PARCEIRO")),
      doParceiro: soma(antes.filter((a) => a.situacao === "PARCEIRO")),
      pararam: antes
        .filter((a) => a.pedidos > 0 && !atual.areas.has(a.chave))
        .map((a) => ({ nome: nomeDe(a), loja: nomeDaLoja.get(a.lojaId) || "Loja", situacao: a.situacao, parceiro: a.parceiro, pedidos: a.pedidos, valor: c2(a.valor) }))
        .sort((x, y) => y.valor - x.valor || x.nome.localeCompare(y.nome, "pt-BR")),
    };
  }

  return {
    linhas,
    parceiro,
    total: comPct(total),
    propria: comPct(totais(todos.filter((a) => a.situacao !== "PARCEIRO"))),
    doParceiro: comPct(totais(todos.filter((a) => a.situacao === "PARCEIRO"))),
    retirada: opcoes.incluirRetirada
      ? { pedidos: atual.retirada.pedidos, valor: c2(atual.retirada.valor), ticketMedio: atual.retirada.pedidos ? c2(atual.retirada.valor / atual.retirada.pedidos) : null }
      : null,
    anterior: comparacao,
    cadastroDasLojas: lojas.map((l) => {
      const cfg = cfgs.get(l.id)!;
      return {
        id: l.id,
        nome: l.nome,
        modo: cfg.modo,
        rotuloDoModo: ROTULO_DO_MODO[cfg.modo],
        areasCadastradas: cfg.faixas.length + cfg.bairros.length + cfg.contornos.length,
        temPontoDaLoja: Boolean(cfg.pontoDaLoja),
      };
    }),
    pctPor,
  };
}

/** Para o teste: a configuração pronta de uma loja (a mesma que `vendasPorArea` monta). */
export const configDaLoja = prepararLoja;
