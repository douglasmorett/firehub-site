/**
 * PEDIDO MÍNIMO POR BAIRRO — 09/10/2026.
 *
 * Pedido da Sabor da Praça (Emerson): "consigo configurar pedido mínimo para
 * certos bairros?". O bairro longe custa mais para entregar, e a loja quer um
 * mínimo maior só lá — sem subir o de todo mundo.
 *
 * O mínimo mora na linha do bairro, ao lado da taxa e do tempo
 * (`deliveryZones[i].minimo`, gravado por lib/cadastro-da-entrega.ts):
 *   - ausente → vale o mínimo geral da loja (`deliveryConfig.minimumOrderValue`);
 *   - número  → vale este, maior OU menor que o da loja; 0 = sem mínimo ali.
 *
 * Só no modo POR BAIRRO: é o único em que a loja dá nome a cada linha. Faixa
 * de km e área desenhada seguem com o mínimo da loja.
 *
 * Quem usa: o cardápio (CustomerStorePage) e o robô do WhatsApp (o prompt e a
 * trava do fechamento em lib/chatbot-ai.ts). Uma regra, os dois lugares.
 *
 * Teste: scripts/teste-minimo-do-bairro.ts
 */
import { bairroCadastrado, bairrosAtendidos, modoDaArea, type LojaParaEntrega } from "@/lib/area-de-entrega";

/** Os bairros que têm mínimo próprio, para o prompt do robô e a tela. Vazio fora do modo bairro. */
export function bairrosComMinimoProprio(loja: LojaParaEntrega): { name: string; minimo: number }[] {
  if (modoDaArea(loja) !== "BAIRRO") return [];
  return bairrosAtendidos(loja)
    .filter((b) => b.minimo != null)
    .map((b) => ({ name: b.name, minimo: b.minimo as number }));
}

/**
 * O pedido mínimo da ENTREGA para este bairro: o do bairro, se ele tiver um;
 * senão o da loja. Bairro desconhecido (ou loja fora do modo bairro) = o da loja.
 */
export function minimoDaEntregaNoBairro(loja: LojaParaEntrega, bairro: unknown, minimoDaLoja: number): number {
  const daLoja = Number(minimoDaLoja) > 0 ? Number(minimoDaLoja) : 0;
  if (modoDaArea(loja) !== "BAIRRO") return daLoja;
  const achado = bairroCadastrado(bairro, loja);
  return achado && achado.minimo != null ? achado.minimo : daLoja;
}

/**
 * O MENOR mínimo de entrega que algum cliente pode ter. É o que vale antes de
 * se saber o bairro (sacola, botão de seguir para o endereço): travar pelo da
 * loja barraria quem mora no bairro de mínimo menor.
 */
export function menorMinimoDeEntrega(loja: LojaParaEntrega, minimoDaLoja: number): number {
  const daLoja = Number(minimoDaLoja) > 0 ? Number(minimoDaLoja) : 0;
  const proprios = bairrosComMinimoProprio(loja);
  if (proprios.length === 0) return daLoja;
  // Bairro SEM mínimo próprio segue o da loja: ele só conta se existir algum.
  const algumSegueALoja = bairrosAtendidos(loja).some((b) => b.minimo == null);
  const candidatos = proprios.map((b) => b.minimo);
  if (algumSegueALoja) candidatos.push(daLoja);
  return Math.min(...candidatos);
}
