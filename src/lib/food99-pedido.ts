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
export function centavosParaReais(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) ? n / 100 : 0;
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
      return { texto: "99Food", pagoOnline: false };
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
  if (numero && rua && new RegExp(`(^|[\\s,])${numero}\\s*$`).test(rua)) partes[1] = "";

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
  const fone = a.phone ? String(a.phone).trim() : "";
  if (!fone) return "";
  return ddi && !fone.startsWith(ddi) ? `${ddi} ${fone}` : fone;
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
  pagamento: { texto: string; pagoOnline: boolean };
  entreguePor: "99FOOD" | "MERCHANT";
  total: number;
  taxaEntrega: number;
  observacoes: string;
  itens: ItemTraduzido[];
}

/**
 * Traduz o OrderModel inteiro.
 *
 * `order` é o objeto do pedido — pode chegar solto no evento ou dentro de
 * `event.order`; quem chama resolve isso antes.
 */
export function traduzirPedido99Food(order: any): PedidoTraduzido {
  const o = order || {};
  const preco = o.price || {};
  const loja = o.shop || {};
  const endereco = o.receive_address || {};

  // `real_pay_price` é o total do pedido depois de descontos e cupom — é o
  // número que a nota do 99Food chama de "Total do pedido". Os outros dois
  // são reserva para app antigo que não mande esse campo.
  const totalCentavos =
    preco.real_pay_price ?? preco.customer_need_paying_money ?? preco.real_price ?? preco.order_price ?? 0;

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
    pagamento: formaDePagamento99(o.pay_type),
    entreguePor: quemEntrega99(o.delivery_type),
    total: centavosParaReais(totalCentavos),
    taxaEntrega: centavosParaReais(preco.delivery_price),
    observacoes: String(o.remark ?? "").trim(),
    itens: Array.isArray(o.order_items) ? o.order_items.map(traduzirItem) : [],
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
    // A observação do item entra junto dos complementos porque é ali que a
    // comanda da cozinha lê o que veio escrito para o prato.
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
