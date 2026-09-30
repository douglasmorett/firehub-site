import type { DescontoDetalhado, ItemDaNota, PagamentoInformado, PedidoParaNota } from "./fiscal-emissao";
import { ratearEmCentavos } from "./rateio";
import { canalDoPedido } from "./canal-do-pedido";
import { ehPagoOnline } from "./pagamento-na-entrega";
import { separacaoDoDesconto99 } from "./desconto-99food";
import { documentoDeVerdade } from "./documento-do-cliente";
import { infoDaEntrega } from "./entrega-parceira";

// Reexportado para quem já importava daqui.
export { ratearEmCentavos };

/**
 * /src/lib/fiscal-itens.ts
 *
 * Transforma os itens do pedido nas LINHAS da nota fiscal — inclusive abrindo
 * os combos.
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
 *
 * A "Engenharia de Cardápio Fiscal" é vendida na home ("sai detalhado na nota
 * fiscal, maximizando a isenção de PIS e COFINS monofásico") e repetida na FAQ
 * da tela fiscal. O lojista abre o combo, informa que dentro dele vão um lanche
 * e um refrigerante, dá o NCM de cada um, e a tela responde "🟢 Engenharia
 * Discriminada Ativa".
 *
 * Só que `fiscalBreakdown` era apenas GRAVADO e EXIBIDO. Nenhum arquivo da
 * emissão sequer mencionava o campo: a nota saía com o combo em linha única,
 * com o NCM do combo. O lojista configurava, via o selo verde e recebia uma
 * nota que não tinha nada daquilo — pagando o imposto que a discriminação
 * existia justamente para evitar.
 *
 * ── POR QUE O RATEIO É OBRIGATÓRIO ──────────────────────────────────────────
 *
 * Os preços do breakdown são o valor "de tabela" de cada parte. O combo quase
 * sempre é vendido por MENOS que a soma das partes — é isso que faz dele um
 * combo. Jogar os preços do breakdown direto na nota faria o somatório dos
 * itens não bater com o total cobrado, e a SEFAZ rejeita por isso (regra 610:
 * "valor total difere do somatório dos itens").
 *
 * Então as partes entram RATEADAS na proporção que o lojista configurou, e a
 * sobra de arredondamento vai para a maior linha — a que absorve centavo sem
 * distorcer percentual. O total da nota continua exatamente o que o cliente
 * pagou; o que muda é como ele aparece discriminado.
 */

export type ProdutoDoItem = {
  id?: string | null;
  name?: string | null;
  isCombo?: boolean | null;
  fiscalBreakdown?: unknown;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | null;
  csosn?: string | null;
  pis?: string | null;
  cofins?: string | null;
};

export type ItemDoPedido = {
  id: string;
  productName?: string | null;
  quantity: number;
  price: number;
  menuProduct?: ProdutoDoItem | null;
};

type ParteDoCombo = {
  name: string;
  price: number;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | number | null;
  csosn?: string | null;
  pis?: string | null;
  cofins?: string | null;
};

/** O breakdown é JSON livre no banco. Só passa o que tem nome e preço usável. */
function lerBreakdown(bruto: unknown): ParteDoCombo[] {
  if (!Array.isArray(bruto)) return [];
  const partes: ParteDoCombo[] = [];
  for (const p of bruto) {
    if (!p || typeof p !== "object") continue;
    const nome = String((p as any).name ?? "").trim();
    const preco = Number((p as any).price);
    if (!nome || !Number.isFinite(preco) || preco < 0) continue;
    partes.push({
      name: nome,
      price: preco,
      ncm: (p as any).ncm ?? null,
      cest: (p as any).cest ?? null,
      cfop: (p as any).cfop ?? null,
      origem: (p as any).origem ?? null,
      csosn: (p as any).csosn ?? null,
      pis: (p as any).pis ?? null,
      cofins: (p as any).cofins ?? null,
    });
  }
  return partes;
}

/**
 * As linhas da nota, com os combos abertos quando houver discriminação.
 *
 * Um combo SEM `fiscalBreakdown` continua indo em linha única — é o que o
 * lojista configurou, e inventar uma abertura que ele não pediu seria pior que
 * não abrir.
 */
export function montarItensDaNota(itensDoPedido: ItemDoPedido[]): ItemDaNota[] {
  const linhas: ItemDaNota[] = [];

  for (const item of itensDoPedido) {
    const p = item.menuProduct;
    const situacaoDoProduto = String(p?.csosn ?? "").trim();

    // xProd da NFC-e tem 120 caracteres. Brendi e JotaJá gravam "Item | opção
    // | opção" em productName (as opções também em comboSelections): na nota
    // vai só o cabeçalho, senão um Box de Frango com quatro molhos estoura o
    // limite e a SEFAZ rejeita.
    const nomeCompleto = item.productName || p?.name || "Item";
    const descricao = ((item as any).comboSelections ? nomeCompleto.split(" | ")[0].trim() || nomeCompleto : nomeCompleto).slice(0, 120);

    const linhaSimples = (): ItemDaNota => ({
      codigo: p?.id ?? item.id,
      descricao,
      ncm: p?.ncm ?? "",
      cest: p?.cest ?? null,
      cfop: p?.cfop ?? "5102",
      unidadeComercial: "UN",
      quantidade: item.quantity,
      valorUnitario: item.price,
      valorTotal: item.price * item.quantity,
      origem: Number(p?.origem ?? 0) || 0,
      csosn: situacaoDoProduto || null,
      cst: situacaoDoProduto.length === 2 ? situacaoDoProduto : null,
      pis: p?.pis ?? null,
      cofins: p?.cofins ?? null,
    });

    const partes = p?.isCombo ? lerBreakdown(p?.fiscalBreakdown) : [];
    if (partes.length === 0) {
      linhas.push(linhaSimples());
      continue;
    }

    // O rateio é feito sobre o PREÇO UNITÁRIO do combo, não sobre o total.
    //
    // Isso não é detalhe de estilo: a SEFAZ confere item a item que
    // `valor_bruto = quantidade × valor_unitario`. Ratear o total e depois
    // dividir pela quantidade produz dízima (7,51 ÷ 2 = 3,755) que arredonda
    // para 3,76 e faz a linha não fechar consigo mesma. Rateando o unitário em
    // centavos inteiros, cada linha fecha, e a soma das linhas dá exatamente o
    // que o cliente pagou.
    const unitarios = ratearEmCentavos(
      Number(item.price.toFixed(2)),
      partes.map((parte) => parte.price)
    );

    // Parte que ficou em R$ 0,00 (combo barato dividido em muitas partes) não
    // vira linha de nota. Nesse caso a discriminação não cabe no valor, e sair
    // com item de valor zero é pior que sair em linha única.
    if (unitarios.some((v) => v <= 0)) {
      linhas.push(linhaSimples());
      continue;
    }

    partes.forEach((parte, i) => {
      // Toda parte fica com quantidade = a do combo vendido: 2 combos viram
      // 2 lanches e 2 refrigerantes, não 1 de cada.
      const quantidade = item.quantity;
      const valorUnitario = unitarios[i];
      const valorTotal = Number((valorUnitario * quantidade).toFixed(2));
      const situacaoDaParte = String(parte.csosn ?? situacaoDoProduto ?? "").trim();

      linhas.push({
        codigo: `${p?.id ?? item.id}-${i + 1}`,
        // O nome do combo fica junto: na DANFE o cliente precisa reconhecer o
        // que comprou, e "Refrigerante 350ml" solto não diz que veio do combo.
        descricao: `${parte.name} (${item.productName || p?.name || "Combo"})`.slice(0, 120),
        ncm: String(parte.ncm ?? p?.ncm ?? ""),
        cest: parte.cest ?? p?.cest ?? null,
        cfop: String(parte.cfop ?? p?.cfop ?? "5102"),
        unidadeComercial: "UN",
        quantidade,
        valorUnitario,
        valorTotal,
        origem: Number(parte.origem ?? p?.origem ?? 0) || 0,
        csosn: situacaoDaParte || null,
        cst: situacaoDaParte.length === 2 ? situacaoDaParte : null,
        pis: parte.pis ?? p?.pis ?? null,
        cofins: parte.cofins ?? p?.cofins ?? null,
      });
    });
  }

  return linhas;
}

// ─── O pedido inteiro vira a nota ───────────────────────────────────────────

/**
 * O pedido como o Prisma devolve (`customerOrder.findUnique` com
 * `include: { items: { include: { menuProduct: true } } }`). Só os campos que
 * a nota usa — o resto passa sem incomodar.
 */
export type PedidoDoBanco = {
  id: string;
  dailyOrderNumber?: number | null;
  items: ItemDoPedido[];
  totalAmount: number;
  deliveryFee?: number | null;
  discountTotal?: number | null;
  discountIfood?: number | null;
  discountMerchant?: number | null;
  discountDetails?: unknown;
  paymentMethod?: string | null;
  paymentMethods?: unknown;
  changeAmount?: number | null;
  customerCpfCnpj?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  deliveryType?: string | null;
  deliveryBy?: string | null;
  source?: string | null;
  status?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryReference?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  ifoodStoreMerchant?: string | null;
  food99AppShopId?: string | null;
  food99ShopId?: string | null;
  gatewayPaymentId?: string | null;
  [campo: string]: unknown;
};

/**
 * Tudo o que a NFC-e precisa saber do pedido, num lugar só.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * A rota do botão Emitir e a emissão automática montavam o objeto da nota à
 * mão, cada uma a sua cópia, com o mínimo: itens, total, taxa, desconto e o
 * texto da forma de pagamento. Ficava de fora justamente o que decide se a
 * SEFAZ aceita a nota: de qual canal veio (intermediador, rejeição 434/438),
 * o endereço e o CPF da entrega (787/788), o pagamento dividido e o troco
 * (865/866), quem pagou o cupom (iFood ou loja) e quem fez a entrega. Com
 * uma função só, a regra nova chega aos dois caminhos de uma vez.
 *
 * `loja` é para o identificador na plataforma quando o pedido não o traz:
 * `ifoodStoreMerchant` só vem preenchido em conta com mais de uma loja iFood
 * (na Hakim Centro, 101 de 1.622 pedidos em 30 dias); fora disso vale o
 * `User.ifoodMerchantId` da loja.
 */
export function pedidoParaNota(
  pedido: PedidoDoBanco,
  opcoes: {
    /** CPF/CNPJ digitado no modal de emissão; vale mais que o gravado. */
    documentoInformado?: string | null;
    loja?: { ifoodMerchantId?: string | null; food99MerchantId?: string | null } | null;
  } = {}
): PedidoParaNota {
  const canal = canalDoPedido(pedido as any);
  const tipo = String(pedido.deliveryType ?? "").toUpperCase().trim();

  const idNaPlataforma =
    canal.chave === "IFOOD"
      ? pedido.ifoodStoreMerchant || opcoes.loja?.ifoodMerchantId || null
      : canal.chave === "99FOOD"
      ? pedido.food99AppShopId || pedido.food99ShopId || opcoes.loja?.food99MerchantId || null
      : null;

  // Quem pagou o cupom do 99Food. O pedido do 99 grava `discountDetails` como
  // OBJETO (não a lista do iFood), e os 128 pedidos anteriores a 18/09/2026
  // não têm `discountIfood`/`discountMerchant`: lendo só a coluna, o cupom
  // pago pelo 99 virava desconto da loja e a nota declarava menos do que a
  // loja recebe (pedido cmtxn22ow073gn101rfhov71p: itens 65,00, cupom de
  // 25,00 do 99, nota de 35,01). `separacaoDoDesconto99` é a régua que recibo,
  // comanda e Assistente já usam: coluna quando há, `promocoes` quando não.
  const descontoDaPlataforma =
    canal.chave === "99FOOD"
      ? separacaoDoDesconto99(pedido as any)?.plataforma ?? 0
      : Number(pedido.discountIfood) || 0;

  // Quem LEVA a mercadoria: o transportador da NFC-e de entrega (grupo X,
  // lib/fiscal-emissao → transporteDaNota). A regra é a mesma do painel e da
  // comanda (lib/entrega-parceira): `deliveryBy` explícito ou entregador do
  // parceiro atribuído — nunca o código de coleta.
  const entrega = infoDaEntrega(pedido);

  return {
    id: pedido.id,
    numero: pedido.dailyOrderNumber ?? null,
    itens: montarItensDaNota(pedido.items ?? []),
    valorTotal: Number(pedido.totalAmount) || 0,
    taxaEntrega: Number(pedido.deliveryFee) || 0,
    desconto: Number(pedido.discountTotal) || 0,
    descontoDaPlataforma,
    descontosDetalhados: lerDescontosDetalhados(pedido.discountDetails),
    formaDePagamento: String(pedido.paymentMethod ?? ""),
    pagamentos: lerPagamentos(pedido.paymentMethods),
    trocoPara: pedido.changeAmount ?? null,
    // "00000000000" do JotaJá é "sem CPF", não um CPF errado (documentoDeVerdade).
    documentoDoCliente: documentoDeVerdade(opcoes.documentoInformado) ?? documentoDeVerdade(pedido.customerCpfCnpj),
    nomeDoCliente: pedido.customerName ?? null,
    // Só "DELIVERY" é entrega. RETIRADA/TAKEOUT/PICKUP e MESA são entregues
    // ao cliente dentro da loja.
    entregaEmDomicilio: tipo === "DELIVERY",
    // Entrega Parceira: o motoboy é do iFood e a taxa fica com o iFood.
    entregaPelaPlataforma: String(pedido.deliveryBy ?? "").toUpperCase() === "IFOOD",
    entregadorDaPlataforma: entrega.parceira ? entrega.parceiro || null : null,
    enderecoDoCliente: pedido.customerAddress ?? null,
    canal: canal.chave,
    referenciaNoCanal: canal.referencia,
    pagoOnline: ehPagoOnline(pedido as any),
    idNaPlataforma,
  };
}

/** `paymentMethods` é JSON livre: [{ method, amount }]. Só passa o que é usável. */
function lerPagamentos(bruto: unknown): PagamentoInformado[] | null {
  if (!Array.isArray(bruto)) return null;
  const lidos: PagamentoInformado[] = [];
  for (const p of bruto) {
    if (!p || typeof p !== "object") continue;
    const forma = String((p as any).method ?? (p as any).forma ?? "").trim();
    const valor = Number((p as any).amount ?? (p as any).valor);
    if (!forma || !Number.isFinite(valor) || valor <= 0) continue;
    lidos.push({ forma, valor });
  }
  return lidos.length > 0 ? lidos : null;
}

/** `discountDetails` do iFood/99: [{ target, value, ifood, merchant, description }]. */
function lerDescontosDetalhados(bruto: unknown): DescontoDetalhado[] | null {
  if (!Array.isArray(bruto)) return null;
  const lidos: DescontoDetalhado[] = [];
  for (const d of bruto) {
    if (!d || typeof d !== "object") continue;
    const plataforma = Number((d as any).ifood ?? 0);
    const loja = Number((d as any).merchant ?? 0);
    if (!Number.isFinite(plataforma) || !Number.isFinite(loja)) continue;
    lidos.push({ alvo: String((d as any).target ?? "CART"), plataforma: Math.max(0, plataforma), loja: Math.max(0, loja) });
  }
  return lidos.length > 0 ? lidos : null;
}
