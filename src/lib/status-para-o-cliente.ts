/**
 * O status do pedido, dito do jeito que é VERDADE para aquele pedido.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O painel tem uma coluna só para "o pedido saiu das mãos da cozinha":
 * SAIU_ENTREGA. Na entrega, é o motoboy na rua. Na RETIRADA, é o pedido pronto
 * no balcão — e é esse o status que o cliente de retirada tem quando recebe o
 * aviso automático "Pedido PRONTO para Retirada" (lib/order-notifications.ts).
 *
 * O robô lia o mesmo status e dizia "saiu para entrega com o motoboy" para os
 * dois. Eram três lugares, nenhum olhando o tipo de entrega: o resumo de
 * pedidos que vai no prompt, a regra do prompt ("o entregador já está a
 * caminho") e a resposta fixa de emergência. Em 17/09/2026, na Hakim, um
 * cliente de retirada leu que o pedido dele estava a caminho com um motoboy
 * que não existia.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-status-para-o-cliente.mjs).
 */

/** RETIRADA, TAKEOUT (totem), BALCAO — tudo que o cliente vem buscar. */
export function ehRetirada(deliveryType: string | null | undefined): boolean {
  const t = String(deliveryType || "").toUpperCase();
  return t === "RETIRADA" || t === "TAKEOUT" || t === "BALCAO" || t === "PICKUP" || t.includes("RETIRADA");
}

export function ehMesa(deliveryType: string | null | undefined): boolean {
  return String(deliveryType || "").toUpperCase() === "MESA";
}

const EM_PREPARO = new Set(["ACEITO", "CONFIRMADO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO"]);
const NA_RUA = new Set(["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA"]);
const FINALIZADO = new Set(["ENTREGUE", "ENCERRADO", "CONCLUIDO"]);
const CANCELADO = new Set(["CANCELADO", "CANCELLED", "CANCELED"]);

/**
 * O rótulo que vai no resumo de pedidos do PROMPT. É texto para o modelo ler,
 * então diz com todas as letras o que ele não pode afirmar — modelo nenhum
 * deduz sozinho que "SAIU_ENTREGA" numa retirada não tem entregador.
 */
export function rotuloDeStatusParaOModelo(
  status: string | null | undefined,
  deliveryType: string | null | undefined,
): string {
  const s = String(status || "").toUpperCase();
  const retirada = ehRetirada(deliveryType);
  const mesa = ehMesa(deliveryType);

  if (CANCELADO.has(s)) return "Cancelado ❌";
  if (s === "AGUARDANDO_PAGAMENTO") return "Aguardando o pagamento para ir para a cozinha 💳";
  if (s === "NOVO" || s === "RECEBIDO" || s === "PENDENTE") {
    return "Novo (recebido no sistema, aguardando a cozinha confirmar)";
  }
  if (EM_PREPARO.has(s)) {
    if (retirada) return "Em preparação na cozinha 🔥 (pedido de RETIRADA no balcão — este pedido não tem entrega)";
    if (mesa) return "Em preparação na cozinha 🔥 (pedido de mesa)";
    return "Em preparação na cozinha 🔥";
  }
  if (s === "PRONTO") {
    if (retirada) return "PRONTO para o cliente RETIRAR no balcão 🛍️ (pedido de retirada — este pedido não tem entrega)";
    if (mesa) return "Pronto, indo para a mesa";
    return "Pronto na loja, aguardando o entregador pegar (AINDA NÃO saiu da loja)";
  }
  if (NA_RUA.has(s)) {
    if (retirada) return "PRONTO para o cliente RETIRAR no balcão 🛍️ (pedido de retirada — este pedido não tem entrega)";
    if (mesa) return "Servido na mesa";
    return "Saiu para entrega com o motoboy 🛵";
  }
  if (FINALIZADO.has(s)) {
    if (retirada) return "Retirado pelo cliente ✅";
    return "Entregue ✅";
  }
  return s || "Desconhecido";
}

/** "RETIRADA no balcão" / "ENTREGA" — para o modelo saber de que tipo de pedido está falando. */
export function rotuloDoTipoDeEntrega(deliveryType: string | null | undefined): string {
  if (ehRetirada(deliveryType)) return "RETIRADA no balcão";
  if (ehMesa(deliveryType)) return "MESA";
  return "ENTREGA";
}

/**
 * A frase da resposta fixa de emergência (a IA falhou e o cliente tem pedido
 * ativo). Devolve null quando não há o que afirmar com segurança — o chamador
 * cai na mensagem genérica em vez de inventar.
 *
 * Nenhuma promete prazo ("em instantes", "chega já"): o robô só sabe o status.
 */
export function fraseDeStatusDeEmergencia(e: {
  status: string | null | undefined;
  deliveryType: string | null | undefined;
  primeiroNome?: string | null;
  numero: string;
  itens?: string;
}): string | null {
  const s = String(e.status || "").toUpperCase();
  const retirada = ehRetirada(e.deliveryType);
  const oi = `Oi${e.primeiroNome ? `, ${e.primeiroNome}` : ""}!`;
  const pedido = `pedido ${e.numero}${e.itens ? ` (${e.itens})` : ""}`;

  if (ehMesa(e.deliveryType)) return null;
  if (NA_RUA.has(s) || (retirada && s === "PRONTO")) {
    return retirada
      ? `${oi} 🛍️ Seu ${pedido} já está PRONTO para retirada aqui no balcão! É só vir buscar. 😋`
      : `${oi} 🛵 Seu ${pedido} já saiu para entrega e está a caminho com o motoboy! 😋`;
  }
  if (s === "PRONTO") {
    return `${oi} 😊 Seu ${pedido} já está pronto aqui na loja e sai para entrega assim que o entregador pegar! 🛵`;
  }
  if (s === "NOVO" || EM_PREPARO.has(s)) {
    return retirada
      ? `${oi} 😊 Seu ${pedido} está em preparação na nossa cozinha! Assim que ficar pronto para retirada a gente te avisa por aqui. 🔥`
      : `${oi} 😊 Seu ${pedido} está em preparação na nossa cozinha! Assim que sair para entrega a gente te avisa por aqui. 🛵🔥`;
  }
  if (FINALIZADO.has(s)) {
    return retirada
      ? `${oi} ✅ Consta em nosso sistema que seu ${pedido} já foi retirado! Bom apetite!`
      : `${oi} ✅ Consta em nosso sistema que seu ${pedido} já foi entregue! Bom apetite!`;
  }
  return null;
}
