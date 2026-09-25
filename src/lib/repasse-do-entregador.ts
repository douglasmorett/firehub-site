/**
 * Quanto a loja paga ao entregador — a regra, num lugar só.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * A taxa de entrega tem DOIS números que quase nunca são iguais: o que o
 * cliente paga e o que o entregador recebe. Até 12/09/2026 só existia o
 * primeiro, e o relatório de entregas usava ele como se fosse o segundo. Em
 * pedido de iFood e 99Food isso é pior ainda, porque lá a taxa é dinheiro do
 * marketplace: o Lucas via "Taxa: R$ 6,94" numa entrega que ele paga R$ 2,00.
 *
 * ── As duas escolhas da loja ────────────────────────────────────────────────
 *
 * 1. `separado` — a loja informa os dois valores por faixa/bairro. Desligado,
 *    o que vale é o acerto cadastrado no próprio entregador.
 * 2. `marketplace` — em pedido de app, o entregador recebe o valor que VEIO DO
 *    APP ou o valor da TABELA da loja. São os dois modelos reais: quem repassa
 *    a entrega do iFood inteira ao motoboy, e quem paga sempre o mesmo,
 *    independente do que o app pagou.
 *
 * ── Onde cada número nasce ──────────────────────────────────────────────────
 *
 * Pedido do site/balcão/robô: o repasse é gravado NO PEDIDO na hora da venda
 * (`CustomerOrder.motoboyFee`) — história, e não regra que muda quando a loja
 * reajusta a tabela.
 *
 * Pedido de marketplace: a distância só é conhecida depois, na roteirização,
 * então o relatório aplica a regra na hora de fechar o acerto.
 */

export type OrigemDoRepasseNoApp = "APP" | "TABELA" | "FIXO";

export type RegraDeRepasse = {
  /** A loja informa separadamente o que paga ao entregador. */
  separado: boolean;
  /** Em pedido de iFood/99Food: paga o que veio do app, o da sua tabela, ou um valor fixo. */
  marketplace: OrigemDoRepasseNoApp;
  /**
   * O valor fixo por entrega de app, quando `marketplace === "FIXO"`.
   *
   * É o terceiro modelo real, e o mais comum entre quem tem entregador próprio:
   * no pedido do site o motoboy leva a taxa que o cliente pagou (que varia por
   * bairro), mas no pedido de app leva sempre o mesmo — a Delicias de Casa paga
   * R$ 4,00 em toda entrega de iFood e 99Food, não importa o que o app cobrou
   * do cliente nem a que distância foi.
   *
   * Zero é resposta VÁLIDA (loja em que o app manda o próprio entregador e o
   * motoboy da casa não recebe nada). Nulo é "a loja não preencheu", e aí o
   * repasse volta a ser o acerto individual do entregador.
   */
  valorFixoApp: number | null;
};

export const REPASSE_PADRAO: RegraDeRepasse = { separado: false, marketplace: "TABELA", valorFixoApp: null };

/** Número >= 0 ou nulo. Texto vazio, NaN e negativo contam como "não preenchido". */
function valorOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function lerRegraDeRepasse(deliveryConfig: unknown): RegraDeRepasse {
  const bruto = ((deliveryConfig as any)?.repasseDoEntregador ?? {}) as Partial<RegraDeRepasse>;
  const marketplace: OrigemDoRepasseNoApp =
    bruto.marketplace === "APP" ? "APP" : bruto.marketplace === "FIXO" ? "FIXO" : "TABELA";
  return {
    separado: bruto.separado === true,
    marketplace,
    valorFixoApp: valorOuNulo((bruto as any).valorFixoApp),
  };
}

/** A faixa de km de uma zona, seja qual for o nome do campo no cadastro antigo. */
export function kmDaZona(z: any): number {
  return Number(z?.km ?? z?.radius ?? z?.maxKm ?? z?.distance ?? 0) || 0;
}

/**
 * O repasse cadastrado numa zona. `null` = a loja não preencheu nesta faixa.
 *
 * ZERO É RESPOSTA, não ausência: a faixa em que o motoboy da casa não recebe
 * nada de propósito (o cliente da esquina que a loja leva a pé, por exemplo).
 * Vazio, espaço em branco, texto e negativo contam como "não preenchido".
 */
export function repasseDaZona(z: any): number | null {
  const bruto = z?.motoboyFee;
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto !== "number" && typeof bruto !== "string") return null;
  if (typeof bruto === "string" && bruto.trim() === "") return null;
  const v = Number(bruto);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

/** `deliveryZones` como lista — o JSONB às vezes volta serializado em texto. */
function listaDeZonas(zonas: unknown): any[] {
  if (Array.isArray(zonas)) return zonas;
  if (typeof zonas === "string") {
    try {
      const lido = JSON.parse(zonas);
      return Array.isArray(lido) ? lido : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** As faixas de km da loja, em ordem, com o repasse de cada uma (null = sem valor). */
function faixasDeKm(zonas: unknown): { km: number; repasse: number | null }[] {
  return listaDeZonas(zonas)
    .map((z: any) => ({ km: kmDaZona(z), repasse: repasseDaZona(z) }))
    .filter((f) => f.km > 0)
    .sort((a, b) => a.km - b.km);
}

/**
 * O repasse da faixa que cobre esta distância — a MESMA faixa que decide a
 * taxa do cliente: limite inclusivo ("até 1,5 km"), distância arredondada a
 * 0,01 km antes de comparar (lib/geocoding.ts faz igual).
 *
 * ── Faixa sem valor NÃO pega o valor da vizinha ────────────────────────────
 *
 * Até 25/09/2026 as faixas sem repasse eram descartadas ANTES da busca, e a
 * entrega de 1,8 km numa faixa de 2 km sem valor pagava, calada, o repasse da
 * faixa de 2,5 km. Agora a faixa que cobre a distância responde — e, se ela
 * não tem valor, a resposta é `null`: o acerto cai na regra seguinte (o
 * acordo do entregador, depois a taxa do cliente), e a tela de Entrega exige
 * preencher todas quando a loja usa repasse por faixa (`faixasSemRepasse`).
 *
 * Distância 0 é entrega de verdade (cliente na porta da loja) e cai na
 * primeira faixa. Além da última faixa vale a última: devolver nulo faria a
 * entrega mais longa cair na taxa do cliente enquanto todas as outras usam o
 * repasse — o pior dos dois mundos, e justamente na entrega que a loja mais
 * paga.
 */
export function repasseDaFaixaKm(zonas: unknown, km: number | null | undefined): number | null {
  const faixas = faixasDeKm(zonas);
  if (!faixas.some((f) => f.repasse != null)) return null;
  if (km === null || km === undefined || (km as unknown) === "") return null;
  const d = Number(km);
  if (!Number.isFinite(d) || d < 0) return null;
  const distancia = Math.round(d * 100) / 100;
  const faixa = faixas.find((f) => distancia <= f.km) ?? faixas[faixas.length - 1];
  return faixa.repasse;
}

/**
 * A loja paga o entregador pela TABELA de faixas de km? (separou os valores e
 * preencheu o repasse em pelo menos uma faixa.) É o que faz a distância do
 * pedido virar dinheiro mesmo quando nenhum entregador tem faixa própria — e
 * o cron de distâncias pendentes precisa saber disso para não pular a loja.
 */
export function temRepassePorFaixa(deliveryConfig: unknown, zonas: unknown): boolean {
  if (!lerRegraDeRepasse(deliveryConfig).separado) return false;
  return faixasDeKm(zonas).some((f) => f.repasse != null);
}

/**
 * Os km das faixas que estão sem o valor do motoboy. Para a tela e o servidor
 * de configuração recusarem a tabela pela metade quando a loja usa repasse
 * por faixa: faixa em branco é entrega paga pela regra de outro lugar.
 */
export function faixasSemRepasse(zonas: unknown): number[] {
  return faixasDeKm(zonas).filter((f) => f.repasse == null).map((f) => f.km);
}

/**
 * A faixa de km cuja TAXA AO CLIENTE é este valor — para a correção de taxa
 * de um pedido já feito (api/store/orders/[id]/taxa-de-entrega): "cobrei
 * R$ 12, era R$ 5" diz qual faixa valia. Mais de uma faixa com a mesma taxa e
 * repasses diferentes é ambíguo, e ambíguo devolve null.
 */
export function faixaDaTaxa(zonas: unknown, taxa: number | null | undefined): { km: number; repasse: number | null } | null {
  const t = Number(taxa);
  if (taxa === null || taxa === undefined || !Number.isFinite(t) || t < 0) return null;
  const alvo = Math.round(t * 100) / 100;
  const iguais = listaDeZonas(zonas)
    .filter((z: any) => kmDaZona(z) > 0 && Number.isFinite(Number(z?.fee)) && Math.abs(Math.round(Number(z.fee) * 100) / 100 - alvo) < 0.005)
    .map((z: any) => ({ km: kmDaZona(z), repasse: repasseDaZona(z) }))
    .sort((a, b) => a.km - b.km);
  if (!iguais.length) return null;
  if (iguais.some((f) => f.repasse !== iguais[0].repasse)) return null;
  return iguais[0];
}

/** O repasse cadastrado no bairro, comparando pelo nome já casado pela área de entrega. */
export function repasseDoBairro(zonas: unknown, nomeDoBairro: string | null | undefined): number | null {
  const alvo = String(nomeDoBairro || "").trim().toLowerCase();
  if (!alvo) return null;
  const z = listaDeZonas(zonas).find(
    (x: any) => String(x?.name || "").trim().toLowerCase() === alvo,
  );
  return z ? repasseDaZona(z) : null;
}

/**
 * Quanto o entregador recebe por ESTE pedido, pela regra da loja.
 *
 * `null` quando a loja não deu resposta para o caso — aí quem decide é o acerto
 * individual do entregador, e o relatório avisa na tela quando nem isso existe.
 */
export function repasseDoPedido(args: {
  regra: RegraDeRepasse;
  zonas: unknown;
  /** Distância da entrega, quando conhecida. */
  km?: number | null;
  /** Bairro cadastrado que casou, no modo por bairro. */
  bairro?: string | null;
  /** O que o cliente (ou o app) pagou de entrega neste pedido. */
  taxaDaEntrega?: number | null;
  /** O pedido veio de iFood, 99Food, Brendi, JotaJá ou Wabiz. */
  ehMarketplace?: boolean;
}): number | null {
  const { regra, zonas, km, bairro, taxaDaEntrega, ehMarketplace } = args;

  // Pedido de app com a escolha "pagar o que veio do app": a taxa do pedido é
  // a resposta, mesmo que a loja tenha tabela cadastrada.
  if (ehMarketplace && regra.marketplace === "APP") {
    const t = Number(taxaDaEntrega || 0);
    return t > 0 ? Math.round(t * 100) / 100 : null;
  }

  // Valor fixo por entrega de app: não olha taxa, não olha bairro, não olha km.
  // É o caso de quem paga o mesmo em toda entrega de marketplace. Vem ANTES do
  // `separado` de propósito — a loja pode ter valor fixo no app sem ter tabela
  // de repasse por bairro nenhuma, que é justamente a Delicias de Casa: no site
  // o motoboy leva a taxa do pedido, no app leva R$ 4,00.
  if (ehMarketplace && regra.marketplace === "FIXO") {
    return regra.valorFixoApp;
  }

  if (!regra.separado) return null;

  const doBairro = repasseDoBairro(zonas, bairro);
  if (doBairro != null) return doBairro;
  return repasseDaFaixaKm(zonas, km);
}

/**
 * A frase que a tela mostra para a loja conferir a escolha do app.
 *
 * Texto gerado da configuração, não escrito à mão: a loja troca a opção e a
 * explicação troca junto.
 */
export function explicarRegraDoApp(regra: RegraDeRepasse): string {
  if (regra.marketplace === "APP") {
    return "Nos pedidos de iFood, 99Food e outros apps, o entregador recebe a taxa de entrega que veio do app.";
  }
  if (regra.marketplace === "FIXO") {
    return regra.valorFixoApp == null
      ? "Falta preencher quanto você paga por entrega de app. Enquanto estiver vazio, vale o acerto individual de cada entregador."
      : `Nos pedidos de iFood, 99Food e outros apps, o entregador recebe sempre ${regra.valorFixoApp.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por entrega — não importa a taxa que o app cobrou do cliente nem a distância. Nos pedidos do seu site continua valendo a taxa do próprio pedido.`;
  }
  return "Nos pedidos de iFood, 99Food e outros apps, o entregador recebe o valor da sua tabela — a taxa que o app mostra é dinheiro do marketplace, não o que você paga.";
}
