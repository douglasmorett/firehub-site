/**
 * Registro dos últimos eventos recebidos do 99Food.
 *
 * Existe porque o formato exato do payload deles está atrás do login do portal
 * de desenvolvedores. Sabemos os NOMES dos eventos (orderNew, orderCancel,
 * orderFinish, deliveryStatus...) porque estão na documentação pública, mas não
 * a forma dos campos de dentro.
 *
 * Em vez de adivinhar a estrutura e escrever um parser que talvez não case, o
 * webhook guarda aqui o payload cru do que chegou. No primeiro pedido de
 * verdade a forma aparece, e o parser é terminado com base no que o 99Food
 * realmente manda — não no que a gente imaginou que ele mandaria.
 *
 * Em memória: o deploy é um container único e longevo. Some no restart, e tudo
 * bem — serve para ajustar o parser nos primeiros pedidos.
 */

export interface Evento99Food {
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
const eventos: Evento99Food[] = [];

export function registrar99Food(e: Omit<Evento99Food, "em" | "payload"> & { payload: unknown }) {
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

export function ler99Food(): Evento99Food[] {
  return [...eventos].reverse();
}
