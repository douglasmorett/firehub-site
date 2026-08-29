/**
 * Quem vai entregar este pedido: o motoboy da loja ou o entregador do parceiro.
 *
 * Esta é a MESMA regra que o painel usa (`getPartnerDeliveryInfo` em
 * StoreOrdersDashboard.tsx). Ela mora aqui porque a comanda impressa também
 * precisa dela — e era justamente aí que as duas verdades divergiam: o painel
 * dizia "entrega da loja" e o papel saía com "MOTOBOY IFOOD (ENTREGA PARCEIRA)
 * — NAO USAR MOTOBOY DA LOJA!".
 *
 * ── O QUE PROVA ENTREGA PARCEIRA ────────────────────────────────────────────
 *
 * Quem entrega, e nada mais: `deliveryBy` explícito, `deliveryMode` de
 * logística, ou um entregador do parceiro já atribuído ao pedido.
 *
 * O código de coleta NÃO prova. O iFood emite código também em entrega
 * própria — é o número que o cliente informa para confirmar o recebimento.
 * Medido em produção na Hakim em 23/08/2026: 73 dos 80 pedidos do dia tinham
 * código e 70 eram entrega da própria loja. Tratar o código como prova é o que
 * mandava a loja não despachar motoboy num pedido que ninguém mais ia buscar.
 */

export type InfoDeEntrega = {
  parceira: boolean;
  parceiro: string;
  codigoDeColeta?: string;
};

export function infoDaEntrega(pedido: any): InfoDeEntrega {
  if (!pedido) return { parceira: false, parceiro: "" };

  const por = String(pedido.deliveryBy || pedido.deliveredBy || "").toUpperCase().trim();
  const modo = String(pedido.deliveryMode || "").toUpperCase().trim();
  const origem = String(pedido.source || "").toUpperCase().trim();
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  const codigoDeColeta = pedido.ifoodPickupCode || pedido.openDeliveryPickupCode || undefined;

  // 1. Entrega própria declarada encerra o assunto.
  if (por === "MERCHANT" || por === "LOJA" || por === "PROPRIO" || por === "MERCHANT_DELIVERY") {
    return { parceira: false, parceiro: "" };
  }

  const logistica = por === "LOGISTICS" || por === "PARTNER" || modo === "LOGISTIC" || modo === "PARTNER";

  // 2. 99Food
  if (origem === "99FOOD" || canal === "99FOOD" || origem.includes("99") || por.includes("99")) {
    if (por === "99FOOD" || por === "99_FOOD" || por.includes("99") || logistica) {
      return { parceira: true, parceiro: "99FOOD", codigoDeColeta };
    }
  }

  // 3. iFood — entregador atribuído é prova; código de coleta não é.
  if (origem === "IFOOD" || por.includes("IFOOD")) {
    const temEntregador =
      Boolean(pedido.ifoodDriverName) ||
      (pedido.ifoodDriverStatus && pedido.ifoodDriverStatus !== "UNASSIGNED");
    if (por.includes("IFOOD") || por.includes("LOGISTICS") || logistica || temEntregador) {
      return { parceira: true, parceiro: "IFOOD", codigoDeColeta };
    }
  }

  // 4. JotaJá e demais canais Open Delivery com logística do parceiro.
  if (logistica) {
    const nome = origem === "JOTAJA" ? "JOTAJA" : (canal || origem || "PARCEIRO");
    return { parceira: true, parceiro: nome, codigoDeColeta };
  }

  return { parceira: false, parceiro: "" };
}

/**
 * Prepara o pedido para sair daqui rumo ao Assistente de Impressão.
 *
 * O Assistente instalado hoje nas lojas decide sozinho se é entrega parceira, e
 * a regra dele aceita o código de coleta como prova (firehub-print-assistant/
 * server.js). Pior: o payload que saía daqui nem mandava `deliveryBy`, então
 * lá o campo chegava vazio e SOBRAVA o código para decidir — todo pedido do
 * iFood com código saía com o aviso de entrega parceira.
 *
 * Enquanto o Assistente novo não chega em todas as lojas, quem resolve é o que
 * a gente manda: o código só viaja quando a entrega É parceira. Sem código, a
 * regra antiga não tem como concluir errado. Os campos `deliveryBy` e
 * `entregaParceira` vão junto para o Assistente novo decidir direito — campo
 * que o Assistente antigo não conhece ele ignora sem erro.
 */
export function camposDeEntregaParaImpressao(pedido: any) {
  const info = infoDaEntrega(pedido);
  return {
    deliveryBy: pedido?.deliveryBy || (info.parceira ? info.parceiro : "MERCHANT"),
    deliveryMode: pedido?.deliveryMode || undefined,
    entregaParceira: info.parceira,
    parceiroDaEntrega: info.parceira ? info.parceiro : "",
    ifoodPickupCode: info.parceira ? (pedido?.ifoodPickupCode || undefined) : undefined,
    openDeliveryPickupCode: info.parceira ? (pedido?.openDeliveryPickupCode || undefined) : undefined,
  };
}
