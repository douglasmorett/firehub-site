/**
 * src/lib/campanha-converter.ts
 *
 * Campanha "Converter para site próprio".
 *
 * A loja paga 12% a 27% de comissão em cada pedido do iFood e do 99Food. Esta
 * campanha imprime, no FIM da comanda desses pedidos, um bloco grande de
 * "VOCÊ GANHOU R$ X para lanchar conosco" com um QR code que abre o cardápio
 * próprio já com o cupom aplicado. A comanda vai grampeada no saco kraft: o
 * cliente que veio do marketplace lê o prêmio em casa e o próximo pedido dele
 * entra pelo site, sem comissão.
 *
 * Regras que moram AQUI, e só aqui, porque três lugares as aplicam:
 *
 *   1. print.ts (navegador) e print-queue (fila da nuvem) decidem SE o bloco
 *      sai e EM QUAL impressora — a mesma pergunta nos dois trilhos.
 *   2. loja/[slug]/page.tsx e customer-order/route.ts precisam do cupom que o
 *      QR carrega, em formato de cupom da loja, para o site aplicar o desconto
 *      e o servidor conferi-lo.
 *
 * Só sai em pedido do iFood ou do 99Food, de propósito: quem já compra pelo
 * site não precisa ser convertido, e dar o desconto ali seria pagar por uma
 * venda que já era da loja.
 */

export const VERSAO_ASSISTENTE_COM_CAMPANHA = "1.2.10";

/** A configuração que a loja salva em `User.storeLoyalty.converter`. */
export type CampanhaConverterConfig = {
  active: boolean;
  /** Valor fixo em reais ou porcentagem do pedido. */
  tipo: "fixo" | "percentual";
  valor: number;
  /** Só o primeiro pedido pelo site vale o cupom, ou todo pedido. */
  somentePrimeiroPedido: boolean;
  /** Pedido mínimo no site para o cupom valer (0 = sem mínimo). */
  pedidoMinimo: number;
  /** O código do cupom que o QR carrega (também digitável). */
  codigo: string;
  /** Nome (no Windows) da impressora que imprime o bloco. */
  impressora: string;
};

export const CAMPANHA_PADRAO: CampanhaConverterConfig = {
  active: false,
  tipo: "fixo",
  valor: 10,
  somentePrimeiroPedido: true,
  pedidoMinimo: 30,
  codigo: "VOLTAPELOSITE",
  impressora: "",
};

/** Normaliza o que veio do JSON (campo faltando, string onde era número). */
export function lerCampanha(storeLoyalty: unknown): CampanhaConverterConfig {
  const bruto = ((storeLoyalty as any)?.converter ?? {}) as Partial<CampanhaConverterConfig>;
  const valor = Number(bruto.valor);
  const minimo = Number(bruto.pedidoMinimo);
  return {
    active: bruto.active === true,
    tipo: bruto.tipo === "percentual" ? "percentual" : "fixo",
    valor: Number.isFinite(valor) && valor > 0 ? valor : CAMPANHA_PADRAO.valor,
    somentePrimeiroPedido: bruto.somentePrimeiroPedido !== false,
    pedidoMinimo: Number.isFinite(minimo) && minimo > 0 ? minimo : 0,
    codigo: normalizarCodigo(bruto.codigo) || CAMPANHA_PADRAO.codigo,
    impressora: String(bruto.impressora || "").trim(),
  };
}

/** Só letras e números, maiúsculo, até 20 — é o que o cliente vai digitar. */
export function normalizarCodigo(codigo: unknown): string {
  return String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}

/**
 * A campanha está pronta para imprimir? Ligada, com valor e com impressora.
 * Sem impressora escolhida não sai em lugar nenhum — melhor do que chutar a
 * da cozinha e o cliente nunca ver o prêmio.
 */
export function campanhaPronta(c: CampanhaConverterConfig): boolean {
  return c.active && c.valor > 0 && !!c.impressora && !!c.codigo;
}

/**
 * O pedido veio do iFood ou do 99Food?
 *
 * O `source` é a marca principal; o `openDeliveryChannel` é a segunda trava do
 * 99Food, que chega pelo Open Delivery. Nada mais entra: site, robô do
 * WhatsApp, balcão, mesa, JotaJá e Brendi ficam de fora (o dono decidiu iFood
 * e 99 — são os canais com comissão que ele quer esvaziar).
 */
export function pedidoDeMarketplace(pedido: { source?: string | null; openDeliveryChannel?: string | null } | null | undefined): boolean {
  if (!pedido) return false;
  const origem = String(pedido.source || "").toUpperCase().trim();
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  return origem === "IFOOD" || origem === "99FOOD" || canal === "99FOOD";
}

const mesmaImpressora = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Esta impressora é a que a loja escolheu para o bloco? */
export function campanhaSaiNestaImpressora(c: CampanhaConverterConfig, nomeDaImpressora: string | null | undefined): boolean {
  if (!campanhaPronta(c)) return false;
  return mesmaImpressora(c.impressora, String(nomeDaImpressora || ""));
}

export function formatarPremio(c: Pick<CampanhaConverterConfig, "tipo" | "valor">): string {
  if (c.tipo === "percentual") {
    const p = Number.isInteger(c.valor) ? String(c.valor) : String(c.valor).replace(".", ",");
    return `${p}% OFF`;
  }
  return `R$ ${Number(c.valor).toFixed(2).replace(".", ",")}`;
}

export function urlDaCampanha(slug: string, codigo: string, base = "https://firehubfood.com.br"): string {
  return `${String(base).replace(/\/+$/, "")}/loja/${slug}?cupom=${encodeURIComponent(codigo)}`;
}

/** O endereço curto que sai impresso abaixo do QR, para quem não escaneia. */
export function enderecoCurto(slug: string, base = "https://firehubfood.com.br"): string {
  return `${String(base).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/loja/${slug}`;
}

/**
 * O bloco que o Assistente imprime. Texto pronto, já decidido aqui, para o
 * Assistente não ter regra de negócio: ele só desenha o que recebe.
 */
export type BlocoDaCampanha = {
  titulo: string;
  premio: string;
  texto: string;
  codigo: string;
  url: string;
  endereco: string;
  regras: string[];
  /** A impressora escolhida, para o Assistente conferir quando o servidor não
   *  pôde (fila sem `destinos`, loja de impressora única). */
  impressora: string;
};

export function blocoDaCampanha(c: CampanhaConverterConfig, slug: string): BlocoDaCampanha {
  const regras: string[] = [];
  if (c.somentePrimeiroPedido) regras.push("Valido no seu PRIMEIRO pedido pelo site");
  else regras.push("Valido em todo pedido pelo site");
  if (c.pedidoMinimo > 0) regras.push(`Pedido minimo: R$ ${c.pedidoMinimo.toFixed(2).replace(".", ",")}`);
  return {
    titulo: "VOCE GANHOU",
    premio: formatarPremio(c),
    texto: "para lanchar conosco pelo nosso site!",
    codigo: c.codigo,
    url: urlDaCampanha(slug, c.codigo),
    endereco: enderecoCurto(slug),
    regras,
    impressora: c.impressora,
  };
}

/**
 * Para a fila da nuvem SEM `destinos` (loja sem impressora cadastrada: o
 * Assistente imprime na padrão do PC dele, que o servidor não conhece). O
 * bloco vai no pedido inteiro com `impressora` dentro, e é o Assistente que
 * confere o nome antes de desenhar.
 */
export function camposDaCampanhaSemDestino(
  pedido: { source?: string | null; openDeliveryChannel?: string | null } | null | undefined,
  storeLoyalty: unknown,
  slug: string | null | undefined
): { campanha?: BlocoDaCampanha } {
  if (!slug || !pedidoDeMarketplace(pedido)) return {};
  const c = lerCampanha(storeLoyalty);
  if (!campanhaPronta(c)) return {};
  return { campanha: blocoDaCampanha(c, slug) };
}

/**
 * Os campos para ESTE pedido nesta impressora — ou `{}` quando não sai.
 *
 * Mesma assinatura de espírito do `camposDoQrPuxar`: quem chama espalha o
 * resultado no payload e pronto. Comanda da cozinha (`semValores`) nunca leva
 * o bloco — é o papel que fica na chapa, não o que vai para o cliente.
 */
export function camposDaCampanha(
  pedido: { source?: string | null; openDeliveryChannel?: string | null; semValores?: boolean } | null | undefined,
  storeLoyalty: unknown,
  slug: string | null | undefined,
  nomeDaImpressora: string | null | undefined,
  semValores = false
): { campanha?: BlocoDaCampanha } {
  if (!slug || semValores || pedido?.semValores === true) return {};
  if (!pedidoDeMarketplace(pedido)) return {};
  const c = lerCampanha(storeLoyalty);
  if (!campanhaSaiNestaImpressora(c, nomeDaImpressora)) return {};
  return { campanha: blocoDaCampanha(c, slug) };
}

/** Marca que distingue o cupom da campanha dos cupons cadastrados à mão. */
export const ORIGEM_CUPOM_CAMPANHA = "converter";

/**
 * O cupom da campanha no formato dos cupons da loja (`User.storeCoupons`),
 * para o site e o checkout o tratarem como qualquer outro cupom. `null` quando
 * a campanha está desligada. A impressora NÃO importa aqui: o cupom vale
 * mesmo que a loja ainda não tenha escolhido onde imprimir (quem tem o código
 * é porque leu numa comanda que saiu).
 */
export function cupomDaCampanha(storeLoyalty: unknown): Record<string, unknown> | null {
  const c = lerCampanha(storeLoyalty);
  if (!c.active || c.valor <= 0 || !c.codigo) return null;
  return {
    code: c.codigo,
    type: c.tipo === "percentual" ? "percent" : "fixed",
    discount: c.valor,
    minOrderValue: c.pedidoMinimo > 0 ? c.pedidoMinimo : 0,
    active: true,
    origem: ORIGEM_CUPOM_CAMPANHA,
    somentePrimeiroPedido: c.somentePrimeiroPedido,
    descricao: c.somentePrimeiroPedido
      ? "Prêmio da comanda — vale no seu primeiro pedido pelo site"
      : "Prêmio da comanda — vale em todo pedido pelo site",
  };
}

/**
 * Cupons da loja MAIS o da campanha. O da campanha vai por último e não
 * atropela um cupom cadastrado à mão com o mesmo código: a loja que já usa
 * "VOLTAPELOSITE" na tela de Cupons continua com o dela.
 */
export function cuponsComCampanha(storeCoupons: unknown, storeLoyalty: unknown): any[] {
  const lista = Array.isArray(storeCoupons) ? [...storeCoupons] : [];
  const cupom = cupomDaCampanha(storeLoyalty);
  if (!cupom) return lista;
  const codigo = String(cupom.code).toUpperCase();
  const jaExiste = lista.some((c: any) => String(c?.code || "").toUpperCase() === codigo);
  return jaExiste ? lista : [...lista, cupom];
}

/**
 * Origens que NÃO contam como "pedido pelo site" para a regra do primeiro
 * pedido: marketplace (é justamente de onde o cliente está vindo) e salão
 * (quem comeu na mesa nunca pediu pelo site).
 */
export const FONTES_QUE_NAO_SAO_SITE = ["IFOOD", "99FOOD", "JOTAJA", "BRENDI", "PRESENCIAL", "PDV", "BALCAO", "MESA", "TOTEM"];

/** Só os dígitos do telefone, sem o 55 do país — para comparar com o que está gravado. */
export function digitosDoTelefone(telefone: unknown): string {
  let d = String(telefone || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d;
}

/** `a` é mais nova ou igual a `b`? ("1.2.10" >= "1.2.10" = true; "1.2.9" >= "1.2.10" = false). */
export function versaoAtende(versao: string | null | undefined, minima: string): boolean {
  const x = String(versao || "").split(".").map((n) => parseInt(n, 10) || 0);
  const y = String(minima).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true;
    if ((x[i] || 0) < (y[i] || 0)) return false;
  }
  return true;
}
