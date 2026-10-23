/**
 * Tradução de um pedido do 99Food para o formato do FireHub.
 *
 * Escrito contra o `OrderModel` do swagger.yaml oficial (baixado do portal de
 * desenvolvedores), e não contra um payload imaginado. Isso importa porque o
 * parser anterior lia campos que o 99Food nunca mandou: procurava
 * `order.customer`, `order.delivery`, `order.items`, `order.totalPrice` e
 * `order.payments` — nomes do iFood e do OpenDelivery. O 99Food manda
 * `receive_address`, `order_items`, `price` e `pay_type`. Um pedido real
 * entraria como cliente "Cliente 99Food", endereço vazio, nenhum item e total
 * zero, sem erro nenhum no log.
 *
 * ── Dinheiro vem em centavos ────────────────────────────────────────────────
 * O PriceModel diz: "Price of the item in the lowest local currency
 * denomination, e.g. cents". Todo valor é inteiro em centavos. Tratá-los como
 * reais multiplica a conta por 100 — o pedido de R$ 29,99 da Brasa Burguer
 * viraria R$ 2.999,00 no painel e na comanda.
 */

/** Centavos (inteiro) → reais. É assim que todo valor do 99Food chega. */

import { repartirDesconto99 } from "@/lib/desconto-99food";
export function centavosParaReais(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Um campo do `price` em centavos inteiros; ausente ou lixo vira 0. */
function emCentavos(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * O que o 99Food cobra DO CLIENTE além dos itens e da entrega, em centavos —
 * o `price.others_fees`.
 *
 * - `service_price`: a taxa de serviço do app (fica com o 99).
 * - `meal_top_up_price`: o complemento até o PEDIDO MÍNIMO da loja. Nos 13
 *   pedidos em que veio até 11/10/2026, ele leva o valor dos itens a um número
 *   redondo: R$ 24,90 + 4,10 = R$ 29,00 na Showrrascão, R$ 39,90 + 10,10 =
 *   R$ 50,00 na Pizzaria 17. Ficar fora da conta era a diferença inteira entre
 *   o total montado e o `real_pay_price` (R$ 23,90 na Showrrascão e R$ 2,30
 *   na NIK, no mês).
 * - `small_order_price` e `total_tip_money`: nunca vieram diferentes de zero,
 *   mas são cobrança ao cliente pelo nome e entram na conta igual.
 *
 * `others_fees.coupon_discount` NÃO entra: é a parte da LOJA nas promoções
 * (bate com a soma do `shop_subside_price` em 396 de 500 pedidos), e esse
 * dinheiro já está dentro de `items_discount`/`delivery_discount`. Somá-lo
 * descontaria o mesmo cupom duas vezes.
 */
export function taxasDoCliente99(preco: unknown): { servico: number; complementoMinimo: number; pedidoPequeno: number; gorjeta: number } {
  const p = preco && typeof preco === "object" ? (preco as Record<string, unknown>) : {};
  const o = p.others_fees && typeof p.others_fees === "object" ? (p.others_fees as Record<string, unknown>) : {};
  return {
    servico: emCentavos(o.service_price),
    complementoMinimo: emCentavos(o.meal_top_up_price),
    pedidoPequeno: emCentavos(o.small_order_price),
    gorjeta: emCentavos(o.total_tip_money),
  };
}

/**
 * O desconto do pedido, em centavos: o MAIOR entre os campos do `price`
 * (`items_discount` + `delivery_discount` + `coupon_discount`) e a soma das
 * promoções (`promotions[].promo_discount`).
 *
 * Os dois são o mesmo número em 777 de 778 pedidos com promoção. O que
 * difere é o da NIK de 26/09/2026: `items_discount` 24,83 e duas promoções do
 * 99 de 20,00 + 5,00 — e o cliente pagou com R$ 25,00 abatidos (o
 * `real_pay_price` só fecha com 25,00). Os R$ 0,17 do cupom de R$ 5 que não
 * couberam nos itens caíram fora dos campos, mas saíram do bolso do 99.
 */
export function descontoDoPreco99(preco: unknown, promocoes: unknown): number {
  const p = preco && typeof preco === "object" ? (preco as Record<string, unknown>) : {};
  const pelosCampos = emCentavos(p.items_discount) + emCentavos(p.delivery_discount) + emCentavos(p.coupon_discount);
  const lista = Array.isArray(promocoes) ? promocoes : [];
  const pelasPromocoes = lista.reduce((s: number, pr: any) => s + Math.max(0, emCentavos(pr?.promo_discount)), 0);
  return Math.max(0, pelosCampos, pelasPromocoes);
}

/**
 * O que o CLIENTE pagou, em centavos — o "Total do pedido" da nota do 99.
 *
 * ── Quando o 99 não manda o total ──────────────────────────────────────────
 *
 * `real_pay_price` (e o gêmeo `customer_need_paying_money`, igual em 500 de
 * 500 pedidos) é o total depois de cupom e promoção. Só que o `order/detail`
 * NÃO o manda quando quem entrega é o motoboy do 99 (`delivery_type` 1):
 * faltou em 328 de 328 pedidos de entrega do 99 até 11/10/2026, e veio em 500
 * de 500 de entrega da loja. Junto somem `real_price` e `delivery_price`.
 *
 * O código caía então em `order_price` — os itens CHEIOS, sem desconto, sem
 * entrega e sem taxa do app. O pedido gravava o que o cliente NÃO pagou, e o
 * caixa, que soma `totalAmount` + a parte do 99 (`discountIfood`), contava o
 * subsídio do 99 duas vezes: na Brazza, 146 pedidos em 30 dias gravaram
 * R$ 8.815,80 contra R$ 6.125,98 pagos; o cmv3axi01020trq013j1ullg6 gravou
 * R$ 39,80 com o cliente pagando R$ 25,20, e a nota dizia "a loja recebe
 * R$ 56,39" (eram R$ 41,79). Na semana de 05/10, 177 dos 349 pedidos do 99.
 *
 * Sem o total pronto, ele é montado pelas partes, na conta que bate no
 * centavo com o `real_pay_price` nos 500 pedidos que trazem os dois:
 *
 *   itens (order_price) − desconto + entrega cobrada + taxas ao cliente
 *
 * `real_price` NÃO serve de reserva: é o total SEM a parte que o 99 bancou
 * (diferente do pago em todo pedido com cupom do 99).
 */
export function totalPagoDoPreco99(preco: unknown, promocoes: unknown): { centavos: number; calculado: boolean } {
  const p = preco && typeof preco === "object" ? (preco as Record<string, unknown>) : {};
  if (p.real_pay_price != null) return { centavos: emCentavos(p.real_pay_price), calculado: false };
  if (p.customer_need_paying_money != null) return { centavos: emCentavos(p.customer_need_paying_money), calculado: false };
  if (p.order_price == null) return { centavos: 0, calculado: false };
  const t = taxasDoCliente99(p);
  const entrega = emCentavos(p.store_charged_delivery_price ?? p.delivery_price);
  const centavos =
    emCentavos(p.order_price) - descontoDoPreco99(p, promocoes) + entrega +
    t.servico + t.complementoMinimo + t.pedidoPequeno + t.gorjeta;
  return { centavos: Math.max(0, centavos), calculado: true };
}

/**
 * pay_type do 99Food → texto de forma de pagamento do FireHub.
 *
 * 1 = online, 2 = dinheiro, 3 = POS (maquininha na entrega), 4 = carteira DiDi
 * (que também é pagamento online). Só 2 e 3 são cobrados do cliente na porta;
 * marcar um pedido já pago como "a cobrar" faz a loja cobrar duas vezes.
 */
export function formaDePagamento99(payType: unknown): { texto: string; pagoOnline: boolean } {
  switch (Number(payType)) {
    case 1:
      return { texto: "Pago Online (99Food)", pagoOnline: true };
    case 4:
      return { texto: "Carteira DiDi (99Food Pago Online)", pagoOnline: true };
    case 2:
      return { texto: "Dinheiro (cobrar na entrega)", pagoOnline: false };
    case 3:
      return { texto: "Cartão na maquininha (cobrar na entrega)", pagoOnline: false };
    default:
      // Tipo que o 99 não documenta: a forma é DESCONHECIDA, e o texto tem de
      // dizer isso. Era "99Food", e o "food" do nome fazia o caixa
      // (apuracao-do-turno.ts) e o relatório Formas de pagamento
      // (formaDoTexto) lerem VALE-REFEIÇÃO — o pedido da NIK de 26/09/2026
      // (R$ 195,29) entrou no vale de um caixa que não recebeu vale nenhum. E
      // a NFC-e sairia com "99Food" como meio de pagamento (tPag 99).
      // "Não informado" é o rótulo que o resto do sistema já reconhece como
      // forma desconhecida: o caixa põe em "não identificada", o relatório em
      // "Outros / Não identificado" e a nota fiscal pede que a loja defina a
      // forma antes de emitir (fiscal-emissao.ts, formaDaNota). Sem "food" e
      // sem parêntese no texto, de propósito: os dois desfazem essa leitura.
      return { texto: "Não informado", pagoOnline: false };
  }
}

/**
 * delivery_type → quem leva o pedido.
 *
 * 1 = entrega pela DiDi/99, 2 = entrega pela loja. Errar aqui manda motoboy
 * próprio para um pedido que o entregador do 99 já vem buscar, ou deixa a
 * loja esperando um entregador que nunca foi chamado.
 */
export function quemEntrega99(deliveryType: unknown): "99FOOD" | "MERCHANT" {
  return Number(deliveryType) === 2 ? "MERCHANT" : "99FOOD";
}

// ─── O "TROCO PARA" DO DINHEIRO ─────────────────────────────────────────────
//
// Showrrascão, 17/10/2026 ~20h: pedido do 99Food em dinheiro, total R$ 72,23,
// o cliente pediu troco para R$ 100. A comanda saiu com "COBRAR DO CLIENTE NA
// ENTREGA: R$ 72,23" e nenhuma linha de troco; o motoboy chegou sem os
// R$ 27,77 e o cliente cobrou na porta.
//
// A comanda, o painel e o WhatsApp do motoboy JÁ sabem mostrar o troco: leem
// `changeAmount` (a NOTA que o cliente entrega — lib/pagamento-na-entrega.ts),
// igual para iFood, site e robô. O que faltava era o 99: este tradutor não
// tinha campo de troco e o webhook/importação nunca gravavam `changeAmount`.
// Um leitor assim foi escrito em 30/09 (06385e95, branch auditoria-xml) e não
// chegou ao master.
//
// O `OrderModel` do swagger que este tradutor segue NÃO documenta o troco, e
// o FireHub não guarda o `order/detail` cru (só o `price`). Então o nome do
// campo é desconhecido: o leitor procura os nomes prováveis e, sem achar,
// varre as chaves com "change"/"troco" no nome. Só aceita o que se prova —
// pedido em dinheiro e valor ACIMA do total (a nota que o cliente entrega).
// Quando é dinheiro e nada aparece, o tradutor loga as chaves que o pedido
// REALMENTE tem: o próximo pedido em dinheiro fecha o assunto, como fechou o
// código de coleta e as coordenadas.

/** Nomes prováveis do "troco para", em ordem — o objeto de cima e o `price`/`pay_info`. */
const TROCO_CANDIDATOS: ((o: any) => unknown)[] = [
  (o) => o?.change_for, (o) => o?.cash_change_for, (o) => o?.change_for_amount, (o) => o?.pay_with,
  (o) => o?.cash_amount, (o) => o?.cash_paid, (o) => o?.customer_cash,
  (o) => o?.price?.change_for, (o) => o?.price?.cash_amount, (o) => o?.price?.cash_change_for,
  (o) => o?.pay_info?.change_for, (o) => o?.pay_info?.cash_amount, (o) => o?.pay_info?.pay_with,
  (o) => o?.payment?.change_for, (o) => o?.payment?.cash_amount,
];
/** Chave que fala de troco pelo nome — e não é hora, status nem id (`last_change_time` não é dinheiro). */
const CHAVE_DE_TROCO = /change|troco/i;
const CHAVE_QUE_NAO_E_DINHEIRO = /time|date|_at$|status|state|type|_id$|^id$|reason|count|num/i;

/** Valor em centavos (como todo dinheiro do 99) → reais, se for número de verdade. */
function centavosOuNada(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean" || typeof v === "object") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
}

/**
 * "Troco para" (a nota que o cliente vai entregar) do pedido em dinheiro, em
 * reais — ou null quando não é dinheiro, o cliente não pediu troco, ou o 99
 * não mandou nada que se prove.
 *
 * Aceita só valor acima do total e até R$ 500 acima dele: ninguém pede troco
 * para mais de R$ 500 de diferença, e é essa trava que impede um timestamp ou
 * um id numérico de virar troco na comanda.
 */
export function trocoPara99(o: any, total: number): number | null {
  if (Number(o?.pay_type) !== 2) return null;
  const aceita = (reais: number | null) =>
    reais != null && reais > total + 0.009 && reais - total <= 500 ? Math.round(reais * 100) / 100 : null;

  for (const ler of TROCO_CANDIDATOS) {
    const v = aceita(centavosOuNada(ler(o)));
    if (v != null) return v;
  }

  // Varredura: qualquer chave com "change"/"troco" no nome, até 3 níveis.
  const varrer = (obj: unknown, nivel: number): number | null => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || nivel > 3) return null;
    for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
      if (valor && typeof valor === "object") {
        const dentro = varrer(valor, nivel + 1);
        if (dentro != null) return dentro;
      } else if (CHAVE_DE_TROCO.test(chave) && !CHAVE_QUE_NAO_E_DINHEIRO.test(chave)) {
        const v = aceita(centavosOuNada(valor));
        if (v != null) return v;
      }
    }
    return null;
  };
  return varrer(o, 0);
}

/**
 * Campos que o 99Food MASCARA em vez de deixar em branco.
 *
 * Visto num pedido real da Brasa Burguer (#403010): `name`, `house_number` e
 * `poi_display_name` vieram todos com o texto literal "privacy protection".
 * Tratar isso como valor normal imprime na comanda um cliente chamado
 * "privacy protection" e o endereço
 * "Rua Rio das Ostras, 116 - Nova Cidade, …, privacy protection, privacy
 * protection, Rio das Ostras". O entregador é quem paga essa conta.
 */
const MASCARADO = /^(privacy\s*protection|protected|hidden|n\/?a|null|undefined|-+)$/i;

/** Texto útil, ou vazio quando o 99Food mascarou o campo. */
function util(valor: unknown): string {
  const s = valor == null ? "" : String(valor).trim();
  return MASCARADO.test(s) ? "" : s;
}

/**
 * Endereço do cliente em uma linha, na ordem que a comanda imprime.
 *
 * Duas limpezas, e as duas vieram de pedido real:
 *
 * 1. `house_number` só entra se `poi_address` ainda não terminar com ele — o
 *    99Food manda "Rua José de Almeida, 893" e repete "893" à parte, o que
 *    imprimiria "…, 893, 893".
 * 2. Nada que já esteja escrito antes entra de novo. O `city` costuma vir
 *    repetido ("… Rio das Ostras - RJ, Rio das Ostras"), e campo mascarado
 *    apareceria duas vezes seguidas.
 */
export function enderecoDoCliente(receiveAddress: any): string {
  const a = receiveAddress || {};
  const partes = [a.poi_address, a.house_number, a.poi_display_name, a.city].map(util);

  const [rua, numero] = partes;
  // Comparação de texto, não RegExp montada com o número: o house_number vem
  // do pedido da 99 sem assinatura, e um "(a+)+$" ali travava o servidor inteiro.
  const fimDaRua = rua?.trimEnd() || "";
  if (numero && fimDaRua.endsWith(numero) && /(^|[\s,])$/.test(fimDaRua.slice(0, fimDaRua.length - numero.length))) partes[1] = "";

  const juntas: string[] = [];
  for (const p of partes) {
    if (!p) continue;
    const jaEscrito = juntas.join(", ").toLowerCase();
    if (jaEscrito.includes(p.toLowerCase())) continue;
    juntas.push(p);
  }
  return juntas.join(", ");
}

/** Telefone com o código do país quando ele vem separado. */
export function telefoneDoCliente(receiveAddress: any): string {
  const a = receiveAddress || {};
  const ddi = a.calling_code ? String(a.calling_code).trim() : "";
  // O 99 passou a mandar o número em `virtual_phone_number` (doc de 2026);
  // `phone` continua na frente porque é o que as lojas em produção recebem.
  const fone = String(a.phone || a.virtual_phone_number || "").trim();
  if (!fone) return "";
  const base = ddi && !fone.startsWith(ddi) ? `${ddi} ${fone}` : fone;
  // O número do 99 é VIRTUAL e o mesmo para todo pedido ("+55 40202499" em
  // todos os pedidos de 10/09/2026): sem o localizador de 8 dígitos como
  // ramal, a ligação não chega ao cliente. É o mesmo papel do "(ID: …)" que
  // o iFood já carrega neste campo — e o localizador também é o que o
  // entregador digita no link de confirmação do 99.
  const locator = a.locator ? String(a.locator).trim() : "";
  return locator ? `${base} (ramal ${locator})` : base;
}

export interface ItemTraduzido {
  nome: string;
  quantidade: number;
  precoUnitario: number;
  observacao: string;
  /** Complementos escolhidos, já achatados — inclui os sub-níveis. */
  complementos: { name: string; quantity: number; price: number }[];
}

/**
 * Achata `sub_item_list`, que é recursivo no schema deles.
 *
 * Um adicional pode ter adicionais próprios (o swagger define
 * OrderSubItemModel contendo outro sub_item_list). Se só o primeiro nível for
 * lido, a cozinha não vê o que o cliente pediu no segundo — e é justamente ali
 * que moram coisas como o ponto da carne dentro de um combo.
 */
function achatarComplementos(lista: any[], profundidade = 0): ItemTraduzido["complementos"] {
  if (!Array.isArray(lista) || profundidade > 6) return [];
  return lista.flatMap((s) => [
    {
      name: String(s?.name ?? "").trim(),
      quantity: Number(s?.amount ?? 1) || 1,
      price: centavosParaReais(s?.total_price ?? s?.sku_price ?? 0),
    },
    ...achatarComplementos(s?.sub_item_list, profundidade + 1),
  ]);
}

/** Um item do pedido, com preço já em reais e complementos achatados. */
export function traduzirItem(item: any): ItemTraduzido {
  const quantidade = Number(item?.amount ?? 1) || 1;

  // `total_price` é a linha inteira; o FireHub guarda preço UNITÁRIO. Dividir
  // pela quantidade é o que mantém a conta fechando quando o cliente pede 3.
  // `sku_price` já é unitário e serve de reserva.
  const totalLinha = centavosParaReais(item?.total_price);
  const precoUnitario =
    totalLinha > 0 ? totalLinha / quantidade : centavosParaReais(item?.sku_price);

  return {
    nome: String(item?.name ?? "Item 99Food").trim() || "Item 99Food",
    quantidade,
    precoUnitario,
    observacao: String(item?.remark ?? "").trim(),
    complementos: achatarComplementos(item?.sub_item_list),
  };
}

export interface PedidoTraduzido {
  orderId: string;
  numeroNoParceiro: string;
  shopId: string | null;
  appShopId: string | null;
  cliente: { nome: string; telefone: string; endereco: string };
  /**
   * O ponto que o 99Food mandou junto do endereço, quando manda.
   *
   * Vale mais que geocodificar o texto: é onde o cliente marcou no app. Sem
   * ele, todo pedido do 99 caía na geocodificação e o pino ia para onde o
   * mapa achasse — foi a reclamação do Frangoso em 13/09/2026.
   */
  coordenadas?: { lat: number; lng: number };
  pagamento: { texto: string; pagoOnline: boolean };
  entreguePor: "99FOOD" | "MERCHANT";
  /**
   * Código que o entregador do 99Food fala no balcão para retirar o pedido.
   * Nulo quando não veio (ou quando quem entrega é a própria loja, que não
   * tem código nenhum). Ver lib/codigo-de-coleta.ts.
   */
  codigoDeColeta: string | null;
  total: number;
  taxaEntrega: number;
  /**
   * Tudo que foi abatido do pedido, em reais — cupom do 99Food, promoção de
   * item, desconto na entrega. `total` é o que o cliente pagou; a mensalidade
   * do FireHub é sobre o bruto (total + descontos), então isto precisa ser
   * gravado, não só subtraído.
   */
  descontos: {
    total: number; itens: number; entrega: number; cupom: number; promocoes: unknown[];
    /**
     * Taxa de serviço que o 99Food cobra DO CLIENTE (`others_fees.service_price`).
     * Não é desconto — está aqui porque este objeto vira `discountDetails`, o
     * único Json do pedido que já guarda a conta do 99, e criar coluna para
     * R$ 2,15 não se justifica. Sem ela a nota não fechava: no Frangoso
     * (17/09/2026) item 44,99 − desconto 14,00 dava 30,99 e o total dizia
     * 41,14; a diferença era serviço + entrega que o 99 cobrou e o FireHub
     * não mostrava, e o lojista lia isso como "o cupom não deduz".
     */
    taxaServico: number;
    /**
     * Complemento até o pedido mínimo da loja (`others_fees.meal_top_up_price`),
     * em reais: o cliente paga, entra no total e não é item, entrega nem taxa
     * do app. Guardado para a nota poder explicar a diferença — ver
     * `taxasDoCliente99`.
     */
    complementoMinimo: number;
    /**
     * O total foi MONTADO pelas partes (o 99 não mandou `real_pay_price`, o que
     * acontece em todo pedido entregue pelo motoboy do 99) — ver
     * `totalPagoDoPreco99`.
     */
    totalCalculado: boolean;
    /**
     * Quem bancou o desconto — a separação que faltava.
     *
     * O 99Food manda `promotions[]` com `promo_discount` (o desconto) e
     * `shop_subside_price` (a parte que a LOJA paga). O que sobra é o 99
     * pagando do bolso dele. Sem separar, o pedido #266003 do Frangoso
     * (17/09/2026) saiu com "Desconto (Cupom - Loja) R$ 70,00" e "Total
     * R$ 1,97": a loja tinha dado R$ 20 (R$ 12 no item + R$ 8 de frete) e o
     * 99Food R$ 50 — e a loja RECEBIA R$ 50,98, não R$ 1,97. O dono leu como
     * se tivesse pago o combo inteiro para o cliente.
     *
     * É o mesmo par que o iFood já usa: `loja` vira `discountMerchant`,
     * `plataforma` vira `discountIfood` (o nome do campo é histórico; o
     * sistema o lê como "desconto da plataforma" no caixa e na comanda).
     */
    loja: number;
    plataforma: number;
    /** O que a LOJA recebe deste pedido (antes da comissão): pago + plataforma − serviço. */
    recebeLoja: number;
  };
  /**
   * O objeto `price` do 99Food, como veio.
   *
   * Guardado porque em 12/09/2026 os valores de 12 pedidos em 12 não
   * fechavam (item 59,99 - desconto 25,00 + taxa 1,00, total 48,52) e não
   * havia como conferir o que eles mandaram: o evento era lido, traduzido e
   * jogado fora. Sem isto, toda dúvida sobre valor do 99Food vira
   * arqueologia por aritmética.
   *
   * São poucos campos numéricos — cabe de sobra no Json que já existe.
   */
  precoCru: Record<string, unknown> | null;
  observacoes: string;
  itens: ItemTraduzido[];
  /**
   * "Troco para" do pagamento em dinheiro, em reais (vira `changeAmount`).
   * Null quando não é dinheiro ou o 99 não mandou — ver `trocoPara99`.
   */
  trocoPara: number | null;
}

/**
 * Traduz o OrderModel inteiro.
 *
 * `order` é o objeto do pedido — pode chegar solto no evento ou dentro de
 * `event.order`; quem chama resolve isso antes.
 */
import { chavesDoEndereco, coordenadasDoParceiro } from "./coordenadas-do-parceiro";
import { codigoDeColetaDo99, chavesParaLog } from "@/lib/codigo-de-coleta";

export function traduzirPedido99Food(order: any): PedidoTraduzido {
  const o = order || {};
  const preco = o.price || {};
  const loja = o.shop || {};
  const endereco = o.receive_address || {};

  // ── O PONTO DO CLIENTE, E O LOG DE QUANDO ELE NAO VEM ──────────────────
  //
  // O Frangoso reclamou em 13/09/2026 que as localizacoes do 99Food batiam
  // erradas, e o banco confirmou: NENHUM pedido do 99 tinha coordenada — todos
  // caiam na geocodificacao do texto, que erra bairro homonimo e rua repetida.
  //
  // O leitor tolerante procura os nomes conhecidos (lib/coordenadas-do-
  // parceiro.ts). Se mesmo assim nao achar, o log abaixo lista as chaves que o
  // endereco REALMENTE tem: sem isso, "o 99 nao manda coordenada" e um beco —
  // ninguem sabe se o campo nao veio ou se veio com um nome que o leitor nao
  // conhece. Com a lista no log, o proximo pedido de verdade fecha o assunto.
  // ── O CÓDIGO DE COLETA, E O LOG DE QUANDO ELE NÃO VEM ──────────────────
  //
  // Quando quem leva é o motoboy do 99Food, ele chega no balcão e diz um
  // código. Sem esse número na comanda, o atendente entrega o lanche sem ter
  // contra o que conferir. O contrato deles não declara o campo, então vale o
  // mesmo desenho das coordenadas: leitor tolerante (lib/codigo-de-coleta.ts)
  // e, quando não acha em pedido de entrega parceira, o log com as chaves que
  // o objeto REALMENTE tem — é o que fecha o assunto no próximo pedido real,
  // sem depender de acesso ao ambiente deles.
  const entreguePor = quemEntrega99(o.delivery_type);
  const codigoDeColeta = codigoDeColetaDo99(o);
  if (!codigoDeColeta && entreguePor === "99FOOD") {
    console.warn(
      `[99Food] pedido ${o.order_id ?? "?"} com entrega do 99 e SEM código de coleta; ` +
      `chaves do pedido: ${chavesParaLog(o)}`,
    );
  }

  const coordenadas = coordenadasDoParceiro(endereco, o.delivery, o);
  if (!coordenadas && Object.keys(endereco).length > 0) {
    console.warn(
      `[99Food] pedido ${o.order_id ?? "?"} sem coordenada; chaves do endereco: ${chavesDoEndereco(endereco)}`,
    );
  }

  const promocoes = Array.isArray(o.promotions) ? o.promotions : [];

  // O que o cliente pagou: `real_pay_price` quando o 99 manda; montado pelas
  // partes quando não manda (todo pedido entregue pelo motoboy do 99). Antes a
  // reserva era `order_price`, os itens cheios — ver `totalPagoDoPreco99`.
  const pago = totalPagoDoPreco99(preco, promocoes);

  // Os três descontos que o swagger separa no `price`: `items_discount`
  // (promoção de item), `delivery_discount` (na entrega) e `coupon_discount`
  // (cupom no pedido). O `real_pay_price` já vem com todos abatidos.
  const descontoItens = centavosParaReais(preco.items_discount);
  const descontoEntrega = centavosParaReais(preco.delivery_discount);
  const descontoCupom = centavosParaReais(preco.coupon_discount);
  // A taxa de serviço que o 99 cobra do cliente entra no `real_pay_price` mas
  // não é item, não é entrega e não é desconto. Sem carregá-la, a nota do
  // painel não fecha (Frangoso, 17/09/2026: sobrava exatamente o service_price).
  const taxas = taxasDoCliente99(preco);
  const taxaServico = centavosParaReais(taxas.servico);
  // O desconto que o total abate — o mesmo número da conta de cima, para
  // "itens − desconto + entrega + taxas = total" fechar na nota.
  const descontoTotal = centavosParaReais(descontoDoPreco99(preco, promocoes));

  // Quem bancou: a LOJA paga `shop_subside_price` de cada promoção; o resto é
  // o 99Food. A conta mora em lib/desconto-99food.ts — a MESMA que o recibo e
  // a comanda usam para pedido antigo, que não tem as colunas gravadas.
  const totalPago = centavosParaReais(pago.centavos);
  const reparticao = repartirDesconto99({ descontoTotal, promocoes, taxaServico, totalPago });

  const descontos = {
    total: descontoTotal,
    itens: descontoItens,
    entrega: descontoEntrega,
    cupom: descontoCupom,
    promocoes,
    taxaServico,
    complementoMinimo: centavosParaReais(taxas.complementoMinimo),
    totalCalculado: pago.calculado,
    loja: reparticao.loja,
    plataforma: reparticao.plataforma,
    recebeLoja: reparticao.recebeLoja,
  };

  // O "troco para" do dinheiro (Showrrascão, 17/10/2026: saiu sem troco e o
  // motoboy não levou os R$ 27,77). Sem achar em pedido em dinheiro, o log
  // lista as chaves do pedido — é o que revela o nome do campo no próximo.
  const trocoPara = trocoPara99(o, totalPago);
  if (trocoPara == null && Number(o.pay_type) === 2) {
    console.warn(
      `[99Food] pedido ${o.order_id ?? "?"} em DINHEIRO sem "troco para" reconhecido ` +
      `(ou o cliente não pediu troco); chaves do pedido: ${chavesParaLog(o)}`,
    );
  }

  // order_index é o número sequencial do dia na loja, que é o que o lojista vê
  // no app do 99Food e o que ele vai procurar quando ligar reclamando.
  const numeroNoParceiro = String(o.order_index ?? o.order_id ?? "");

  return {
    orderId: String(o.order_id ?? ""),
    numeroNoParceiro,
    shopId: loja.shop_id != null ? String(loja.shop_id) : null,
    appShopId: loja.app_shop_id ? String(loja.app_shop_id) : null,
    cliente: {
      // `util` derruba o "privacy protection" que o 99Food manda no lugar do
      // nome. Sem isso a comanda sai com o cliente chamado "privacy protection"
      // — e o número do 99 no lugar dá à cozinha algo que ela consegue casar
      // com a tela do app deles.
      nome:
        util(endereco.name) ||
        [util(endereco.first_name), util(endereco.last_name)].filter(Boolean).join(" ").trim() ||
        (numeroNoParceiro ? `Cliente 99Food #${numeroNoParceiro}` : "Cliente 99Food"),
      telefone: telefoneDoCliente(endereco),
      endereco: enderecoDoCliente(endereco),
    },
    coordenadas,
    pagamento: formaDePagamento99(o.pay_type),
    entreguePor,
    codigoDeColeta,
    total: totalPago,
    // `store_charged_delivery_price` é o que a LOJA cobrou de entrega; é sobre
    // ele que o `delivery_discount` (frete grátis) incide. `delivery_price`
    // vinha 0 nos pedidos do Frangoso enquanto a loja cobrava R$ 8,00 e dava
    // R$ 8,00 de desconto — o desconto entrava em `discountTotal` e a cobrança
    // nunca entrava em `deliveryFee`, e a nota fechava R$ 8,00 abaixo do total.
    taxaEntrega: centavosParaReais(preco.store_charged_delivery_price ?? preco.delivery_price),
    descontos,
    precoCru: preco && typeof preco === "object" ? (preco as Record<string, unknown>) : null,
    observacoes: String(o.remark ?? "").trim(),
    itens: Array.isArray(o.order_items) ? o.order_items.map(traduzirItem) : [],
    trocoPara,
  };
}

/**
 * Itens do 99Food no formato de `create` aninhado do Prisma.
 *
 * Estava escrito duas vezes, igual, no webhook e na importação manual — e agora
 * uma terceira precisaria dele (o cancelamento parcial, que refaz os itens).
 * Três cópias da mesma regra é onde uma delas começa a divergir em silêncio: a
 * observação do item some de uma, o preço unitário fica errado na outra.
 *
 * O `id` do produto é derivado do NOME porque o 99Food não manda o id do nosso
 * cardápio. Um id fixo casaria com um produto real de outra loja; este não sai
 * do par (loja, nome).
 */
export function itens99ParaPrisma(itens: ItemTraduzido[], lojaId: string) {
  return itens.map((i) => ({
    price: i.precoUnitario,
    quantity: i.quantidade,
    // O nome como o 99Food mandou neste pedido. Sem ele, a comanda cai no nome
    // do cadastro, que é de outro dia — ver src/lib/nome-do-item.ts.
    productName: i.nome,
    // A observação vai na COLUNA do item, que é de onde a comanda e a notinha
    // tiram a linha embaixo do prato. Eram 0 de 366 itens em 30 dias — a
    // observação existia, mas só como pseudo-complemento "Obs: ...", que o
    // rodapé de complementos imprime e a linha de observação não.
    notes: i.observacao || null,
    // Continua TAMBÉM junto dos complementos: o Assistente antigo, instalado
    // na maioria das lojas, imprime a lista de complementos e ainda não lê a
    // observação do item. Tirar daqui agora apagaria a observação do papel de
    // quem não atualizou.
    comboSelections:
      i.complementos.length > 0 || i.observacao
        ? JSON.stringify([
            ...i.complementos,
            ...(i.observacao ? [{ name: `Obs: ${i.observacao}`, quantity: 1, price: 0 }] : []),
          ])
        : null,
    menuProduct: {
      connectOrCreate: {
        where: { id: `99food_${lojaId}_${i.nome}`.slice(0, 190) },
        create: {
          id: `99food_${lojaId}_${i.nome}`.slice(0, 190),
          name: i.nome,
          price: i.precoUnitario,
          description: "",
          category: "99Food",
          franchiseeId: lojaId,
        },
      },
    },
  }));
}
