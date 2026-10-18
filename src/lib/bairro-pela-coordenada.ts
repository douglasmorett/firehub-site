/**
 * O BAIRRO pelo ponto do cliente, quando o endereço escrito não diz qual é.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Divinos Burguer (Cabo Frio, 18/10/2026 00:22), pedido 25: o cliente mandou a
 * LOCALIZAÇÃO no WhatsApp e escreveu só "Em frente à Dolcice". A taxa saiu
 * certa pelo ponto (0,32 km), mas a linha "BAIRRO: …" da comanda da cozinha
 * (lib/bairro-na-comanda.ts) não saiu: ela lê o bairro do TEXTO do endereço
 * (lib/endereco-impresso.ts), e o texto não tinha bairro. É por essa linha que
 * o Luiz divide os pedidos entre os motoboys.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * Só pedido de ENTREGA, só com o ponto que o PRÓPRIO cliente (ou a loja) deu
 * — GPS/localização do WhatsApp, pino confirmado, ponto posicionado à mão. O
 * ponto que o mapa achou pelo texto não serve: se o texto não tem bairro, a rua
 * achada pode ser a homônima do outro lado da cidade, e o bairro dela mandaria
 * o motoboy para o lugar errado.
 *
 * E só quando o endereço não tem bairro que a comanda reconheça — a MESMA
 * régua da linha BAIRRO (`camposDoEnderecoParaImpressao`). Endereço com bairro
 * não é tocado.
 *
 * O bairro, nesta ordem:
 *   1. o bairro CADASTRADO da loja que entrega por bairro, quando um dos nomes
 *      do ponto (Correios ou mapa) casa com ele — o nome que a loja usa;
 *   2. o bairro dos Correios (ViaCEP) da rua do ponto, quando a rua tem um
 *      bairro só na cidade. O OSM chama de "Vila Porto do Carro"/"Gamboa" o que
 *      os Correios e o cliente chamam de Porto do Carro;
 *   3. o bairro do mapa, na ordem do checkout (enderecoDoReverso).
 * Nada disso respondeu: o pedido segue como hoje, sem bairro.
 *
 * Onde fica: no próprio `customerAddress`, no formato que já funciona
 * ("Em frente à Dolcice - Porto do Carro") — o pedido não tem campo de bairro,
 * e o texto é o que o painel, a comanda, a via do entregador e o app do
 * motoboy já leem. O texto novo só é aceito se a régua da comanda ler nele
 * exatamente esse bairro.
 *
 * Sem banco e sem rede: quem busca é injetado (lib/bairro-pela-coordenada-servidor.ts).
 * Teste: scripts/teste-bairro-pela-coordenada.ts.
 */
import { camposDoEnderecoParaImpressao } from "@/lib/endereco-impresso";
import { enderecoDoReverso } from "@/lib/entrega-no-checkout";
import { bairroPeloEndereco } from "@/lib/bairro-pelo-endereco";
import { mesmoBairroSemPrefixo, ufDoEstado } from "@/lib/bairro-dos-correios";

export type PontoDoCliente = { lat: number; lng: number };

/** As origens de ponto que são do cliente (ou da loja), não palpite do mapa. */
const ORIGENS_DO_CLIENTE = new Set(["gps", "pino", "manual"]);

/** O ponto gravado em `customerLatLng`, se ele veio do cliente. */
export function pontoDoClienteParaBairro(customerLatLng: unknown): PontoDoCliente | null {
  const c = customerLatLng as any;
  if (!c || typeof c !== "object") return null;
  if (!ORIGENS_DO_CLIENTE.has(String(c.origem ?? ""))) return null;
  const lat = Number(c.lat);
  const lng = Number(c.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null; // 0,0: ponto de enchimento
  return { lat, lng };
}

type PedidoDaRegua = { customerAddress?: string | null; source?: string | null; [k: string]: unknown };

/** O bairro que a comanda já lê neste endereço, ou null. */
export function bairroQueAComandaLe(pedido: PedidoDaRegua, cidadeDaLoja?: string | null): string | null {
  const b = camposDoEnderecoParaImpressao({ ...pedido, deliveryType: "DELIVERY" } as any, cidadeDaLoja).bairroDoPedido;
  return b && b.trim() ? b.trim() : null;
}

const normal = (t: string) =>
  String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const LOCALIZACAO_RE =
  /^(📍\s*Localiza[çc][ãa]o enviada pelo WhatsApp)(?::\s*(.*?))?\s*(\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\))\s*$/u;

/**
 * O endereço com o bairro, no formato que a comanda lê — ou null quando não
 * há jeito seguro (a régua não leria esse bairro no texto novo).
 *
 *   "Em frente à Dolcice"            → "Em frente à Dolcice - Porto do Carro"
 *   "Rua andorinha N°9 Monte Alegre" → "Rua andorinha N°9 - Monte Alegre" (o nome
 *                                      já estava no fim, sem separador)
 *   "📍 …WhatsApp (-22.8, -42.0)"     → "📍 …WhatsApp: Bairro: Porto do Carro (-22.8, -42.0)"
 *   "📍 …WhatsApp: Dolcice (…)"       → "📍 …WhatsApp: Dolcice - Porto do Carro (…)"
 */
export function enderecoComOBairro(
  pedido: PedidoDaRegua,
  bairro: string,
  cidadeDaLoja?: string | null,
): string | null {
  const original = String(pedido.customerAddress ?? "").replace(/\s+/g, " ").trim();
  const b = String(bairro || "").replace(/\s+/g, " ").trim();
  if (!b) return null;

  const candidatos: string[] = [];
  const loc = original.match(LOCALIZACAO_RE);
  if (loc) {
    const lugar = (loc[2] || "").trim();
    candidatos.push(lugar ? `${loc[1]}: ${lugar} - ${b} ${loc[3]}` : `${loc[1]}: Bairro: ${b} ${loc[3]}`);
  } else if (!original) {
    return null;
  } else {
    // O nome já no fim do texto, sem separador: só põe o " - " antes dele,
    // para não escrever o bairro duas vezes. Só com um número antes ("N°9"),
    // senão "Rua Monte Alegre" perderia a rua.
    const nb = normal(b);
    const palavras = original.split(" ");
    for (let k = palavras.length - 1; k >= 1; k--) {
      const fim = palavras.slice(k).join(" ");
      if (normal(fim) !== nb && !mesmoBairroSemPrefixo(fim, b)) continue;
      const antes = palavras.slice(0, k).join(" ").replace(/[\s,;\-–—]+$/, "");
      if (/\d/.test(antes)) candidatos.push(`${antes} - ${fim}`);
      break;
    }
    candidatos.push(`${original} - ${b}`);
  }

  for (const c of candidatos) {
    const lido = bairroQueAComandaLe({ ...pedido, customerAddress: c }, cidadeDaLoja);
    if (lido && (normal(lido) === normal(b) || mesmoBairroSemPrefixo(lido, b))) return c;
  }
  return null;
}

/** O que o reverse do mapa diz do ponto, já lido. */
export type PontoNoMapa = {
  rua: string;
  /** Os nomes de área do OSM, do mais específico ao mais largo. */
  areas: string[];
  /** O bairro na ordem do checkout (suburb → … → residential). */
  bairroDoMapa: string;
  cidade: string;
  uf: string | null;
};

/** Lê o `address` cru do reverse do Nominatim. */
export function lerPontoNoMapa(address: unknown): PontoNoMapa | null {
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const txt = (k: string) => (typeof a[k] === "string" ? String(a[k]).trim() : "");
  const cidade = txt("city") || txt("town") || txt("municipality") || txt("village");
  const ehCidade = (n: string) => !!cidade && normal(n) === normal(cidade);
  const areas = [...new Set(["residential", "neighbourhood", "quarter", "suburb", "city_district", "hamlet"].map(txt))]
    .filter((n) => n && !ehCidade(n));
  const { rua, bairro } = enderecoDoReverso(a);
  return {
    rua,
    areas,
    bairroDoMapa: bairro && !ehCidade(bairro) ? bairro : "",
    cidade,
    uf: ufDoEstado(txt("ISO3166-2-lvl4")) || ufDoEstado(txt("state")),
  };
}

export type LojaDoBairro = {
  city?: string | null;
  deliveryZones?: unknown;
  deliveryZoneType?: string | null;
};

export type BuscasDoBairro = {
  /** O `address` do reverse do ponto; null = o mapa não respondeu ou não tem nada ali. */
  reverso(ponto: PontoDoCliente): Promise<unknown | null>;
  /** O bairro da rua nos Correios (um só na cidade), ou null. */
  correios?(rua: string, cidade: string, uf: string): Promise<string | null>;
};

export type BairroDoPonto = { bairro: string; fonte: "zona-da-loja" | "correios" | "mapa" };

/** O bairro do ponto, pela ordem da regra. Nunca lança: falha = null. */
export async function bairroDoPonto(
  ponto: PontoDoCliente,
  loja: LojaDoBairro,
  buscas: BuscasDoBairro,
): Promise<BairroDoPonto | null> {
  let lido: PontoNoMapa | null = null;
  try {
    lido = lerPontoNoMapa(await buscas.reverso(ponto));
  } catch {
    return null;
  }
  if (!lido) return null;

  let dosCorreios: string | null = null;
  if (buscas.correios && lido.rua && lido.cidade && lido.uf) {
    try {
      dosCorreios = (await buscas.correios(lido.rua, lido.cidade, lido.uf)) || null;
    } catch {
      dosCorreios = null;
    }
  }

  // 1. O bairro cadastrado da loja (só loja por bairro responde).
  const nomes = [dosCorreios, ...lido.areas].filter((n): n is string => !!n);
  for (const nome of nomes) {
    const z = bairroPeloEndereco(nome, loja.deliveryZones, { tipo: loja.deliveryZoneType, cidades: [loja.city, lido.cidade] });
    if (z) return { bairro: z.name, fonte: "zona-da-loja" };
  }
  // 2. Os Correios. 3. O mapa.
  if (dosCorreios) return { bairro: dosCorreios, fonte: "correios" };
  if (lido.bairroDoMapa) return { bairro: lido.bairroDoMapa, fonte: "mapa" };
  return null;
}

export type PedidoParaOBairro = {
  customerAddress?: string | null;
  customerLatLng?: unknown;
  deliveryType?: string | null;
  source?: string | null;
  [k: string]: unknown;
};

export type DecisaoDoBairro =
  | { mudar: true; endereco: string; bairro: string; fonte: BairroDoPonto["fonte"] }
  | { mudar: false; motivo: "nao-e-entrega" | "sem-ponto-do-cliente" | "ja-tem-bairro" | "sem-bairro-no-ponto" | "texto-nao-fecha" };

/** O pedido precisa do bairro pelo ponto? Sem rede: diz o ponto, ou o porquê de não. */
export function pontoQuePedeBairro(
  pedido: PedidoParaOBairro,
  cidadeDaLoja?: string | null,
): { ponto: PontoDoCliente } | { motivo: "nao-e-entrega" | "sem-ponto-do-cliente" | "ja-tem-bairro" } {
  if (String(pedido.deliveryType || "").toUpperCase() !== "DELIVERY") return { motivo: "nao-e-entrega" };
  const ponto = pontoDoClienteParaBairro(pedido.customerLatLng);
  if (!ponto) return { motivo: "sem-ponto-do-cliente" };
  if (bairroQueAComandaLe(pedido, cidadeDaLoja)) return { motivo: "ja-tem-bairro" };
  return { ponto };
}

/** O endereço novo deste pedido, com o bairro do ponto — ou por que fica como está. */
export async function decidirBairroDoPedido(
  pedido: PedidoParaOBairro,
  loja: LojaDoBairro,
  buscas: BuscasDoBairro,
): Promise<DecisaoDoBairro> {
  const precisa = pontoQuePedeBairro(pedido, loja.city);
  if (!("ponto" in precisa)) return { mudar: false, motivo: precisa.motivo };
  const achado = await bairroDoPonto(precisa.ponto, loja, buscas);
  if (!achado) return { mudar: false, motivo: "sem-bairro-no-ponto" };
  const endereco = enderecoComOBairro(pedido, achado.bairro, loja.city);
  if (!endereco) return { mudar: false, motivo: "texto-nao-fecha" };
  return { mudar: true, endereco, bairro: achado.bairro, fonte: achado.fonte };
}
