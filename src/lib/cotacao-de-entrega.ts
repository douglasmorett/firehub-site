/**
 * A COTAÇÃO DE ENTREGA que o cliente viu, assinada pelo servidor.
 *
 * O site cotava o frete em /api/delivery-fee e, ao finalizar, o POST do pedido
 * geocodificava o endereço DE NOVO. Quando a segunda consulta ao mapa falhava
 * (limite do Nominatim, prazo estourado), o pedido saía "endereço não
 * localizado" com a faixa mais cara. Na Divinos Burger, em 25/09/2026, 4 de 5
 * entregas foram cobradas a R$ 12 de clientes a 0,5–0,9 km, 51 segundos depois
 * de a cotação ter achado o bairro a 0,84 km (R$ 5).
 *
 * Agora a cotação ATENDE sai com um token assinado (HMAC) com o ponto, a
 * distância, a faixa, a taxa, o repasse e o prazo. O pedido que traz o token de
 * volta, para a mesma loja e o mesmo endereço, dentro da validade, usa esse
 * resultado — o cliente paga o que viu, e o ponto que decidiu a taxa é o que
 * vai para o motoboy e para o acerto dele.
 *
 * O token não é segredo (o cliente pode lê-lo), só não pode ser FORJADO: a
 * assinatura cobre o conteúdo inteiro. Trocar a taxa, o endereço ou a loja
 * invalida a assinatura.
 *
 * Sem banco e sem estado: funciona com o servidor reiniciado no meio da compra.
 * Teste: scripts/teste-cotacao-de-entrega.ts.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Quanto tempo a cotação vale. Checkout que demora mais que isso cota de novo. */
export const VALIDADE_DA_COTACAO_MS = 30 * 60 * 1000;

export type MedidaDaDistancia =
  /** Pelas ruas (roteador OSRM), no modo ROTA. */
  | "rota"
  /** Roteador indisponível: linha reta × fator de desvio da loja. Marcada no pedido. */
  | "estimada"
  /** Modo KM (raio): linha reta de propósito. */
  | "linha-reta";

export type OrigemDoPonto =
  /** O cliente arrastou o pino e confirmou no mapa. */
  | "pino"
  /** Coordenada do aparelho (GPS) ou localização enviada no WhatsApp. */
  | "gps"
  /** O mapa achou o endereço digitado (rua e número). */
  | "mapa"
  /** O mapa só achou o bairro: o ponto é o centro dele. */
  | "bairro";

export type CotacaoDeEntrega = {
  v: 1;
  /** franchiseeId da loja. */
  loja: string;
  /** chaveDoEndereco() do endereço cotado. */
  chave: string;
  lat: number | null;
  lng: number | null;
  origemDoPonto: OrigemDoPonto | null;
  distanciaKm: number | null;
  medida: MedidaDaDistancia | null;
  /** Km da faixa que decidiu a taxa (modo KM/ROTA). */
  faixaKm: number | null;
  taxa: number;
  taxaDoEntregador: number | null;
  tempoMin: number | null;
  /**
   * A taxa saiu PELO BAIRRO: o mapa achou o bairro que o cliente escreveu, não
   * a casa (lib/geocoding.ts, peloBairro). O pedido fecha sem o pino e vai
   * marcado para a loja conferir. Ausente nos tokens de antes (25/09/2026).
   */
  peloBairro?: boolean;
  /** Epoch em ms. */
  exp: number;
};

function segredo(): string {
  const s = process.env.COTACAO_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Sem segredo para assinar a cotação (COTACAO_SECRET ou NEXTAUTH_SECRET).");
  return s;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const deB64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const assinatura = (corpo: string, chave: string) => createHmac("sha256", chave).update(corpo).digest("base64url");

/** Normaliza o texto de um pedaço do endereço para a chave. */
function limpo(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A identidade do endereço cotado. Complemento e referência NÃO entram:
 * "apto 201" não muda a distância, e o cliente que completa o endereço depois
 * de ver a taxa não pode perder a cotação por isso. Rua, número, bairro e o
 * texto livre entram; o ponto (quando o cliente mandou) entra arredondado a
 * ~11 m, para arrastar o pino um milímetro não invalidar tudo.
 */
export function chaveDoEndereco(e: {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  const ponto =
    Number.isFinite(e.lat as number) && Number.isFinite(e.lng as number)
      ? `${(e.lat as number).toFixed(4)},${(e.lng as number).toFixed(4)}`
      : "";
  const partes = [limpo(e.street), limpo(e.number), limpo(e.neighborhood)].join("|");
  const texto = partes.replace(/\|/g, "") ? partes : limpo(e.address);
  return createHmac("sha256", "chave-do-endereco").update(`${texto}#${ponto}`).digest("base64url").slice(0, 22);
}

export function assinarCotacao(
  c: Omit<CotacaoDeEntrega, "v" | "exp">,
  agora: number = Date.now(),
  validadeMs: number = VALIDADE_DA_COTACAO_MS,
): string {
  const corpo: CotacaoDeEntrega = { v: 1, ...c, exp: agora + validadeMs };
  const txt = b64(JSON.stringify(corpo));
  return `${txt}.${assinatura(txt, segredo())}`;
}

/**
 * A cotação, se o token é autêntico, da mesma loja, do mesmo endereço e ainda
 * vale. Qualquer outra coisa devolve null — e quem chama cota de novo.
 */
export function lerCotacao(
  token: unknown,
  esperado: { loja: string; chave: string },
  agora: number = Date.now(),
): CotacaoDeEntrega | null {
  if (typeof token !== "string" || token.length > 4000) return null;
  const [txt, ass] = token.split(".");
  if (!txt || !ass) return null;
  let certa: Buffer, veio: Buffer;
  try {
    certa = Buffer.from(assinatura(txt, segredo()));
    veio = Buffer.from(ass);
  } catch {
    return null;
  }
  if (certa.length !== veio.length || !timingSafeEqual(certa, veio)) return null;
  let c: CotacaoDeEntrega;
  try {
    c = JSON.parse(deB64(txt));
  } catch {
    return null;
  }
  if (!c || c.v !== 1) return null;
  if (c.loja !== esperado.loja || c.chave !== esperado.chave) return null;
  if (!Number.isFinite(c.exp) || c.exp < agora) return null;
  if (!Number.isFinite(c.taxa) || c.taxa < 0) return null;
  return c;
}
