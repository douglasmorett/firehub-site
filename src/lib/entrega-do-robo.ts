/**
 * A entrega no pedido do ROBÔ do WhatsApp: as mesmas regras do site, no mesmo
 * lugar, com teste.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Auditoria de 25/09/2026 (entrega por km da Divinos Burger, modo ROTA). O
 * robô cotava e gravava a entrega por um caminho próprio, e em cada ponto ele
 * divergia do site:
 *
 *  - Frete grátis: o prompt prometia "grátis acima de R$ 60" sempre que o
 *    VALOR estivesse gravado (`freeShippingActive !== false`), enquanto o site
 *    só isenta com o interruptor LIGADO (`freeShippingActive === true`). A tela
 *    de configuração grava 60,00 como padrão: loja que nunca ligou a regra
 *    ouvia o robô prometer isenção que o pedido não dava.
 *  - O rascunho que virava pedido (o caminho comum: o robô anota, o cliente
 *    confirma) NÃO gravava distância, ponto nem repasse do motoboy — só o
 *    pedido criado de uma vez gravava a distância. O acerto do entregador por
 *    faixa de km caía em "sem distância" justamente nos pedidos do robô.
 *  - Ponto aproximado (centro do bairro) e endereço que o mapa não achou não
 *    tinham saída melhor que "chamar atendente": o robô não pedia o dado que
 *    resolve, que é a localização do próprio aparelho do cliente.
 *
 * Aqui ficam as decisões puras; quem grava é `syncAiOrderToDatabase`
 * (lib/chatbot-ai.ts). Sem imports de valor: o teste carrega o arquivo sozinho
 * (scripts/teste-entrega-do-robo.mjs).
 */
import type { VeredictoDeEntrega } from "./area-de-entrega";
import type { MedidaDaDistancia, OrigemDoPonto } from "./cotacao-de-entrega";

type Coordenada = { lat: number; lng: number };

/**
 * O mínimo do frete grátis, com a MESMA régua do site
 * (api/customer-order: `freeShippingActive === true || === "true"` e mínimo
 * maior que zero). `null` = a loja não dá frete grátis.
 */
export function minimoDoFreteGratis(deliveryConfig: unknown): number | null {
  const dc: any = deliveryConfig && typeof deliveryConfig === "object" ? deliveryConfig : {};
  const ligado = dc.freeShippingActive === true || dc.freeShippingActive === "true";
  if (!ligado) return null;
  const minimo = Number(dc.freeShippingMinValue);
  return Number.isFinite(minimo) && minimo > 0 ? Math.round(minimo * 100) / 100 : null;
}

/** O subtotal dos itens alcança o frete grátis da loja? Devolve o mínimo que valeu, ou null. */
export function freteGratisQueVale(deliveryConfig: unknown, subtotalDosItens: number): number | null {
  const minimo = minimoDoFreteGratis(deliveryConfig);
  if (minimo == null) return null;
  return Number(subtotalDosItens) >= minimo ? minimo : null;
}

/** O que vai para `CustomerOrder.customerLatLng`. `{lat,lng}` continua legível por quem só lê isso. */
export type PontoDoPedido = {
  lat: number;
  lng: number;
  origem: OrigemDoPonto;
  medida?: MedidaDaDistancia;
};

function coordenadaUsavel(c: unknown): c is Coordenada {
  const o = c as any;
  if (!o || typeof o !== "object") return false;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

/**
 * O ponto que vai gravado no pedido: o que DECIDIU a taxa.
 *
 * O veredito traz o ponto quando o motor o conhece (`ponto`, com a origem); a
 * localização que o cliente mandou pelo WhatsApp vem em seguida (origem
 * "gps"). Sem nenhum dos dois, nada é gravado — a roteirização segue
 * geocodificando pelo texto, como antes, em vez de receber um ponto inventado.
 *
 * Só no ATENDE: ponto de endereço recusado não é destino de entrega.
 */
export function pontoParaGravar(
  veredito: Pick<VeredictoDeEntrega, "resultado" | "ponto" | "medida"> | null | undefined,
  coordsDoCliente: Coordenada | null | undefined,
): PontoDoPedido | null {
  if (veredito && veredito.resultado !== "ATENDE") return null;
  const medida = veredito?.medida;
  if (veredito?.ponto && coordenadaUsavel(veredito.ponto)) {
    return {
      lat: Number(veredito.ponto.lat),
      lng: Number(veredito.ponto.lng),
      origem: veredito.ponto.origem || (coordsDoCliente ? "gps" : "mapa"),
      ...(medida ? { medida } : {}),
    };
  }
  if (coordenadaUsavel(coordsDoCliente)) {
    return { lat: Number(coordsDoCliente.lat), lng: Number(coordsDoCliente.lng), origem: "gps", ...(medida ? { medida } : {}) };
  }
  return null;
}

/**
 * O ponto já gravado num rascunho, se ele veio do CLIENTE (GPS/localização ou
 * pino) — e só esse: ponto de geocodificação se recalcula, não se herda.
 */
export function pontoDoClienteGravado(customerLatLng: unknown): Coordenada | null {
  const origem = (customerLatLng as any)?.origem;
  if (origem !== "gps" && origem !== "pino") return null;
  if (!coordenadaUsavel(customerLatLng)) return null;
  return { lat: Number(customerLatLng.lat), lng: Number(customerLatLng.lng) };
}

const palavrasDoEndereco = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/**
 * O mesmo lugar de entrega, ignorando caixa, acento, pontuação e espaço — e
 * aceitando que um dos dois só ACRESCENTE palavras ao outro.
 *
 * O modelo reescreve o endereço a cada tag: "Travessa Canaã, 6 - Boca do Mato"
 * vira "Travessa Canaã, 6, Boca do Mato, Cabo Frio", ganha "casa 2", ou o
 * "Centro" do rascunho vira "Rua A, 10, Centro". Exigir o texto idêntico
 * jogava fora o ponto do aparelho que o rascunho guardava (revisão de
 * 25/09/2026). A comparação é por PALAVRA inteira: "Rua Itajuru, 12" não está
 * dentro de "Rua Itajuru, 120".
 */
export function mesmoEnderecoDeEntrega(a: unknown, b: unknown): boolean {
  const x = palavrasDoEndereco(a);
  const y = palavrasDoEndereco(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
  // Uma palavra só ("centro") é pouco para dizer que é o mesmo lugar.
  if (curto.length < 2 || !curto.some((p) => /[a-z]{3,}/.test(p))) return false;
  for (let i = 0; i + curto.length <= longo.length; i++) {
    if (curto.every((p, j) => longo[i + j] === p)) return true;
  }
  return false;
}

/**
 * O endereço de reserva que o pedido leva quando o cliente só mandou a
 * localização (sem rua escrita): o motoboy não sai sem endereço nenhum.
 */
export function enderecoDaLocalizacaoDoCliente(loc: { lat: number; lng: number; endereco?: string }): string {
  return `📍 Localização enviada pelo WhatsApp${loc.endereco ? `: ${loc.endereco}` : ""} (${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)})`;
}

/**
 * O pedido de quem só mandou a localização é de ENTREGA? Então ele leva o
 * endereço de reserva — sem ele, "sem endereço e frete zero" vira retirada
 * (lib/tipo-do-pedido-do-robo.ts).
 *
 * Sinais de entrega: frete cobrado, a tag dizendo que é entrega, ou o frete
 * grátis da loja valendo para o subtotal. Este último é o caso da revisão de
 * 25/09/2026: com frete grátis o modelo escreve deliveryFee 0 ("Frete Grátis"
 * no resumo), e o cliente que só mandou a localização caía no balcão, sem
 * motoboy. Tag que diz retirada nunca leva endereço de reserva.
 */
export function levaEnderecoDaLocalizacao(e: {
  temLocalizacao: boolean;
  frete: number;
  tipoInformado?: unknown;
  freteGratisVale: boolean;
}): boolean {
  if (!e.temLocalizacao) return false;
  const tipo = String(e.tipoInformado ?? "");
  if (/retirad|balc[ãa]o|buscar|pickup|takeout/i.test(tipo)) return false;
  return Number(e.frete) > 0 || /deliv|entreg/i.test(tipo) || e.freteGratisVale;
}

/** O endereço é o de reserva da localização (não foi digitado pelo cliente)? */
export function ehEnderecoDaLocalizacao(endereco: unknown): boolean {
  return typeof endereco === "string" && endereco.trim().startsWith("📍 Localização enviada pelo WhatsApp");
}

/**
 * A régua do "o cliente escreveu um endereço", para separar o endereço do
 * resto da conversa depois que ele mandou a localização.
 *
 * Mais estreita que a que dispara a validação de área no robô: lá "bairro" e
 * "km" contam ("vcs entregam no meu bairro?"); aqui não, porque essas
 * perguntas não são endereço. E mais larga num ponto: "Jardim Esperança, 45"
 * não tem tipo de rua, e é o endereço novo de quem vai pedir na casa da mãe.
 */
export function pareceEnderecoEscrito(texto: unknown): boolean {
  if (typeof texto !== "string" || !texto.trim()) return false;
  return (
    /\b(?:rua|r\.|avenida|av\.|estrada|est\.|alameda|travessa|tv\.|pra[çc]a|rodovia|rod\.|beco|servid[ãa]o|viela|ladeira|quadra|qd|lote|lt|condom[íi]nio|loteamento)(?![a-zà-úç])/i.test(texto) ||
    /\b(?:we|sn)\s*-?\s*\d{1,4}\b/i.test(texto) ||
    /\b(?:jardim|jd\.|vila|parque|conjunto|residencial|recanto|ch[áa]cara|s[íi]tio)\s+[a-zà-ú]/i.test(texto) ||
    /\bn[º°]\s*\d|\bn[úu]mero\s+\d/i.test(texto) ||
    (/\bbairro\b/i.test(texto) && /\d/.test(texto))
  );
}

type PartesDoEndereco = { street?: string; number?: string; neighborhood?: string; city?: string };

const TIPO_DE_RUA = /\b(?:rua|r\.|avenida|av\.?|travessa|tv\.?|trav\.?|alameda|al\.|estrada|estr\.?|est\.|rodovia|rod\.|pra[çc]a|largo|beco|servid[ãa]o|viela|ladeira)\s+/i;
/** Pedaço que é complemento da casa, não bairro. */
const COMPLEMENTO = /^(?:casa|c\.|apto?\.?|apartamento|bloco|bl\.?|fundos|frente|lote|lt\.?|quadra|qd\.?|sala|loja|andar|kitnet|perto|pr[óo]x|em frente|ao lado|esquina|refer[êe]ncia|ponto de|port[ãa]o|cep|condom[íi]nio|cond\.?|edif[íi]cio|ed\.|entre|atr[áa]s|depois|antes|n[º°o]?\.?\s*\d)/i;

/**
 * Rua, número e bairro tirados do que o cliente DIGITOU, para a cotação da
 * conversa.
 *
 * A gravação do pedido recebe as partes na tag (o modelo separa); a cotação,
 * que roda antes de o modelo responder, não tinha partes nem bairro — e sem o
 * bairro o mapa nunca tentava o centro do bairro. "Travessa canaã, 6 - Boca do
 * mato" (Divinos) dava "não achei, manda a localização" na conversa e, na
 * gravação, com o bairro separado, virava ATENDE: a taxa mudava no fechamento
 * (revisão de 25/09/2026). Só devolve algo quando acha o tipo de rua (ou o
 * "bairro X" escrito): palpite em texto solto é pior que nenhum.
 */
export function partesDoEnderecoDigitado(texto: unknown, cidade?: string | null): PartesDoEndereco | undefined {
  if (typeof texto !== "string") return undefined;
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) return undefined;
  const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const daCidade = cidade ? semAcento(cidade) : "";
  const tiraPontuacao = (s: string) => s.replace(/^[\s.:,-]+|[\s.?!:,;-]+$/g, "").trim();

  const partes: PartesDoEndereco = {};
  const explicito = limpo.match(/\bbairro\s*:?\s+([^,;\n–—?!.]{3,40})/i);
  if (explicito) {
    const b = tiraPontuacao(explicito[1].split(/\s-\s/)[0]);
    if (b) partes.neighborhood = b;
  }

  const inicio = limpo.search(TIPO_DE_RUA);
  if (inicio >= 0) {
    const pedacos = limpo
      .slice(inicio)
      .split(/\s*(?:[,;\n]|\s[-–—]\s)\s*/)
      .map((p) => tiraPontuacao(p))
      .filter(Boolean);
    let rua = pedacos.shift() || "";
    // "Rua Tal 45 Centro": o número (e o que vem depois) dentro do pedaço da rua.
    const comNumero = rua.match(/^(.*?[a-zà-úç.])\s+(?:n[º°o]?\.?\s*)?(\d{1,5}[a-z]?)(?:\s+(.*))?$/i);
    // Só quando sobra NOME antes do número: em "Rua 7" o 7 é o nome da rua.
    if (comNumero && `${comNumero[1]} `.replace(TIPO_DE_RUA, "").trim()) {
      rua = comNumero[1].trim();
      partes.number = comNumero[2];
      if (comNumero[3]) pedacos.unshift(tiraPontuacao(comNumero[3]));
    }
    if (`${rua} `.replace(TIPO_DE_RUA, "").trim()) partes.street = rua;
    if (partes.street && !partes.number && pedacos.length) {
      const n = pedacos[0].match(/^(?:n[º°o]?\.?\s*|n[úu]mero\s*)?(\d{1,5}[a-z]?|s\/?n)(?:\s+(.*))?$/i);
      if (n) {
        pedacos.shift();
        partes.number = n[1];
        if (n[2]) pedacos.unshift(tiraPontuacao(n[2]));
      }
    }
    if (partes.street && !partes.neighborhood) {
      const bairro = pedacos.find((p) => {
        const s = semAcento(p);
        if (!/[a-z]{3,}/.test(s) || /^\d/.test(s)) return false;
        if (COMPLEMENTO.test(p)) return false;
        if (/^[a-z]{2}$/.test(s) || /\bcep\b/.test(s)) return false;
        if (daCidade && (s === daCidade || s.startsWith(`${daCidade} `))) return false;
        return true;
      });
      if (bairro) partes.neighborhood = bairro.replace(/^bairro\s*:?\s*/i, "");
    }
  }
  if (cidade && (partes.street || partes.neighborhood)) partes.city = String(cidade).trim();
  return partes.street || partes.neighborhood ? partes : undefined;
}

/**
 * Longe assim, o endereço digitado depois da localização é OUTRO lugar, não o
 * complemento do ponto. Abaixo disso a diferença é o mapa: sem número de casa
 * no OSM, a rua achada fica no meio do trecho, a centenas de metros da casa.
 */
export const DISTANCIA_QUE_TROCA_O_PONTO_KM = 1;

function distanciaEmKm(a: Coordenada, b: Coordenada): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Localização do aparelho ou endereço digitado DEPOIS dela: qual decide?
 *
 * O ponto do aparelho, salvo quando o texto foi achado no mapa com CERTEZA
 * (não é centro de bairro, não pede confirmação) e cai a mais de
 * `DISTANCIA_QUE_TROCA_O_PONTO_KM` dele — aí é outro lugar ("entrega no Jardim
 * Esperança, 45, casa da minha mãe"), e medir pelo alfinete de casa cobraria a
 * faixa errada e mandaria o motoboy ao endereço errado. Texto que o mapa não
 * acha, que só acha aproximado, ou que cai perto é complemento do mesmo ponto.
 */
export function pontoDaEntregaDoRobo(
  vereditoDoTexto: Pick<VeredictoDeEntrega, "resultado" | "ponto" | "pedeConfirmacao" | "aproximado"> | null | undefined,
  gps: Coordenada | null | undefined,
): "gps" | "texto" {
  if (!coordenadaUsavel(gps)) return "texto";
  const v = vereditoDoTexto;
  if (!v || v.resultado === "DESCONHECIDO") return "gps";
  if (v.pedeConfirmacao === true || v.aproximado === true) return "gps";
  if (!v.ponto || !coordenadaUsavel(v.ponto)) return "gps";
  if (v.ponto.origem && v.ponto.origem !== "mapa") return "gps";
  const km = distanciaEmKm({ lat: Number(v.ponto.lat), lng: Number(v.ponto.lng) }, { lat: Number(gps.lat), lng: Number(gps.lng) });
  return km > DISTANCIA_QUE_TROCA_O_PONTO_KM ? "texto" : "gps";
}

/** Quem avalia a entrega (lib/area-de-entrega.ts `avaliarEntrega`, já com a loja). */
export type AvaliadorDaEntrega = (pedido: {
  endereco?: string | null;
  bairro?: string | null;
  coords?: Coordenada | null;
  partes?: PartesDoEndereco;
}) => Promise<VeredictoDeEntrega>;

/**
 * A avaliação da entrega do robô — a MESMA na cotação da conversa e na
 * gravação do pedido, para a taxa não mudar no fechamento (R1).
 *
 * Com a localização do cliente e um endereço digitado depois dela, as duas
 * medidas correm juntas (o mesmo prazo, não o dobro) e `pontoDaEntregaDoRobo`
 * escolhe. `coords` devolvido é o ponto do cliente que ficou valendo (null se
 * o texto venceu): é ele que decide se ainda se pede localização e o que vai
 * gravado no pedido.
 */
export async function avaliarEntregaDoRobo(
  avaliar: AvaliadorDaEntrega,
  pedido: {
    endereco: string;
    bairro?: string | null;
    partes?: PartesDoEndereco;
    gps?: Coordenada | null;
    /** O endereço digitado DEPOIS da localização, se houve (e a loja mede por ponto). */
    textoDepoisDoPonto?: string | null;
  },
): Promise<{ veredito: VeredictoDeEntrega; coords: Coordenada | null; trocouPeloTexto: boolean }> {
  const gps = coordenadaUsavel(pedido.gps) ? { lat: Number(pedido.gps.lat), lng: Number(pedido.gps.lng) } : null;
  const base = { endereco: pedido.endereco, bairro: pedido.bairro ?? null, partes: pedido.partes };
  const texto = String(pedido.textoDepoisDoPonto || "").trim();
  if (!gps || !texto) {
    return { veredito: await avaliar({ ...base, coords: gps }), coords: gps, trocouPeloTexto: false };
  }
  const [peloTexto, peloPonto] = await Promise.all([
    avaliar({ ...base, endereco: texto, coords: null }).catch(() => null),
    avaliar({ ...base, coords: gps }),
  ]);
  if (peloTexto && pontoDaEntregaDoRobo(peloTexto, gps) === "texto") {
    return { veredito: peloTexto, coords: null, trocouPeloTexto: true };
  }
  return { veredito: peloPonto, coords: gps, trocouPeloTexto: false };
}

/**
 * O "não sei" veio da LOJA, não do endereço: ela não tem o próprio ponto no
 * mapa (sem pino e sem endereço que o mapa ache). A localização do cliente não
 * resolve isso — com ela o motor devolve o mesmo DESCONHECIDO.
 *
 * Quem diz é o campo `semPontoDaLoja` do veredito (lib/area-de-entrega.ts):
 * quando ele vem (true OU false), decide. A frase fixa do motivo ("loja sem
 * localização no mapa") ficou só como reserva, para veredito sem o campo —
 * antes ela era a regra, e reescrever o log trocava o que o robô fazia.
 * Mesma leitura de `pontoDaLojaDesconhecido` (lib/entrega-do-pedido.ts),
 * repetida aqui porque este arquivo não tem imports de valor.
 */
export function faltaOPontoDaLoja(
  veredito: Partial<Pick<VeredictoDeEntrega, "resultado" | "motivo" | "semPontoDaLoja">> | null | undefined,
): boolean {
  if (veredito?.resultado !== "DESCONHECIDO") return false;
  if (typeof veredito.semPontoDaLoja === "boolean") return veredito.semPontoDaLoja;
  return /loja sem localiza[çc][ãa]o no mapa/i.test(String(veredito.motivo || ""));
}

/**
 * Por que o robô precisa da localização do cliente, se precisa.
 *
 *  - "desconhecido": o mapa não achou o endereço (KM/ROTA ou área desenhada).
 *    Regra R2: "não sei" nunca vira "faixa mais cara" — pede o ponto.
 *  - "aproximado": achou só o centro do bairro, a rua existe em mais de um
 *    trecho, ou o roteador arrastou o ponto (`pedeConfirmacao`/`aproximado`).
 *    Regra R3: taxa estimada não fecha pedido sem confirmar.
 *
 * Com a coordenada do cliente na mão não se pede de novo — é justamente ela
 * que resolve, e pedir outra vez prenderia a conversa num laço. Loja por
 * bairro não mede distância: lá o que falta é o nome do bairro, não o ponto.
 * E quando quem não tem ponto é a LOJA (`faltaOPontoDaLoja`), pedir o do
 * cliente é um turno inútil: o pedido é segurado direto.
 */
export function motivoParaPedirLocalizacao(
  veredito:
    | (Pick<VeredictoDeEntrega, "modo" | "resultado" | "pedeConfirmacao" | "aproximado"> & Partial<Pick<VeredictoDeEntrega, "motivo" | "semPontoDaLoja">>)
    | null
    | undefined,
  temCoordsDoCliente: boolean,
): "desconhecido" | "aproximado" | null {
  if (!veredito || temCoordsDoCliente) return null;
  if (veredito.modo !== "KM" && veredito.modo !== "POLIGONO") return null;
  if (faltaOPontoDaLoja(veredito)) return null;
  if (veredito.resultado === "DESCONHECIDO") return "desconhecido";
  if (veredito.resultado === "ATENDE" && (veredito.pedeConfirmacao === true || veredito.aproximado === true)) {
    return "aproximado";
  }
  return null;
}

/**
 * O que a nota do pedido precisa contar sobre como a taxa foi medida (R7): a
 * loja confere antes de despachar quando a distância foi ESTIMADA (roteador
 * fora do ar) ou o ponto é APROXIMADO.
 */
export function avisosDaEntregaNaNota(
  veredito: Pick<VeredictoDeEntrega, "resultado" | "medida" | "pedeConfirmacao" | "aproximado"> | null | undefined,
  temCoordsDoCliente: boolean,
): string[] {
  if (!veredito || veredito.resultado !== "ATENDE") return [];
  const avisos: string[] = [];
  if (veredito.medida === "estimada") avisos.push("⚠️ distância estimada (mapa de ruas fora do ar) — confira a taxa");
  if (!temCoordsDoCliente && (veredito.pedeConfirmacao === true || veredito.aproximado === true)) {
    avisos.push("⚠️ ponto aproximado (sem localização do cliente) — confira a taxa");
  }
  if (temCoordsDoCliente) avisos.push("📍 localização enviada pelo cliente");
  return avisos;
}

/**
 * Rua, número, bairro e cidade SEPARADOS, quando o modelo mandou na tag.
 *
 * É o que o mapa precisa para achar a casa em vez do bairro: o texto corrido
 * ("rua tal 10 perto da praça, bairro x") é onde a geocodificação erra. Aceita
 * os nomes em português que o modelo às vezes usa.
 */
export function partesDoEnderecoDaTag(payload: any):
  | { street?: string; number?: string; neighborhood?: string; city?: string }
  | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const pega = (...chaves: string[]) => {
    for (const c of chaves) {
      const v = payload[c];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) return String(v).trim().slice(0, 160);
    }
    return undefined;
  };
  const partes = {
    street: pega("street", "rua", "logradouro"),
    number: pega("number", "numero", "número"),
    neighborhood: pega("neighborhood", "bairro"),
    city: pega("city", "cidade"),
  };
  const algum = Object.values(partes).some(Boolean);
  if (!algum) return undefined;
  return Object.fromEntries(Object.entries(partes).filter(([, v]) => v)) as any;
}

/**
 * A distância dita ao cliente, no idioma da loja: em ROTA é o caminho da moto
 * pelas ruas, e chamar isso de "raio" confundia o cliente que mora a 900 m em
 * linha reta e 2 km pela rua (e o próprio modelo, que "corrigia" a taxa).
 */
export function frasesDaDistancia(
  veredito: Pick<VeredictoDeEntrega, "distanciaKm" | "raioMaxKm" | "medida"> | null | undefined,
  ehRota: boolean,
): { distancia: string; limite: string } | null {
  const km = Number(veredito?.distanciaKm);
  if (!veredito || !Number.isFinite(km)) return null;
  const numero = (n: number) => n.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  const max = Number(veredito.raioMaxKm);
  const temMax = Number.isFinite(max) && max > 0;
  if (ehRota) {
    const estimada = veredito.medida === "estimada";
    return {
      distancia: `${numero(km)} km de percurso da moto pelas ruas${estimada ? " (distância estimada: o mapa de ruas não respondeu)" : ""}`,
      limite: temMax ? `a loja entrega até ${numero(max)} km de percurso` : "",
    };
  }
  return {
    distancia: `${numero(km)} km da loja`,
    limite: temMax ? `a loja entrega até ${numero(max)} km` : "",
  };
}
