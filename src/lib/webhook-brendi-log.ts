/**
 * Registro dos últimos eventos recebidos da Brendi.
 *
 * Existe pela mesma razão do registro do 99Food: o formato exato do que a
 * Brendi manda no webhook não é público (evento único ou array? quais campos?
 * — pergunta aberta ao suporte deles). Sabemos que a API fala Open Delivery
 * (eventType CREATED, CONFIRMED, CANCELLED...), mas não a forma do push.
 *
 * Em vez de adivinhar a estrutura e escrever um parser que talvez não case, o
 * webhook guarda aqui o payload cru do que chegou. No primeiro pedido de
 * verdade a forma aparece, e o parser é terminado com base no que a Brendi
 * realmente manda — não no que a gente imaginou que ela mandaria.
 *
 * É também o que separa "a Brendi nunca chamou" de "chamou e a gente recusou":
 * os dois têm o MESMO sintoma (nenhum pedido na cozinha) e consertos em
 * lugares opostos — um é configuração no portal deles, o outro é código aqui.
 * Sem este registro, o diagnóstico não tem como distinguir os dois.
 *
 * Em memória: o deploy é um container único e longevo. Some no restart, e tudo
 * bem — serve para ajustar o parser nos primeiros pedidos.
 */

export interface EventoBrendi {
  em: string;
  tipo: string;
  reconhecido: boolean;
  pedidoCriado: boolean;
  motivo?: string;
  /** Payload cru, recortado. É o que permite terminar o parser. */
  payload: string;
}

const LIMITE = 25;
const MAX_PAYLOAD = 6000;
const eventos: EventoBrendi[] = [];

export function registrarBrendi(e: Omit<EventoBrendi, "em" | "payload"> & { payload: unknown }) {
  let bruto: string;
  try {
    bruto = JSON.stringify(e.payload);
  } catch {
    bruto = String(e.payload);
  }
  if (bruto.length > MAX_PAYLOAD) bruto = bruto.slice(0, MAX_PAYLOAD) + "…(cortado)";

  eventos.push({
    em: new Date().toISOString(),
    tipo: e.tipo,
    reconhecido: e.reconhecido,
    pedidoCriado: e.pedidoCriado,
    motivo: e.motivo,
    payload: bruto,
  });
  if (eventos.length > LIMITE) eventos.splice(0, eventos.length - LIMITE);
}

export function lerBrendi(): EventoBrendi[] {
  return [...eventos].reverse();
}
