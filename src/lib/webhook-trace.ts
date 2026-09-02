/**
 * Rastro das últimas mensagens processadas pelo webhook do WhatsApp.
 *
 * Existe por um motivo prático: quando o robô não responde, os logs ficam no
 * Coolify e no Railway, e quem está depurando quase nunca tem as duas telas à
 * mão no momento em que o cliente reclama. "Mandei áudio e não veio nada" é
 * impossível de resolver sem saber ONDE parou — se a mensagem chegou, se o
 * áudio veio com bytes, se a IA respondeu, se o envio deu certo.
 *
 * Guarda em memória (o deploy é um container Docker único e longevo) as N
 * últimas mensagens com o estágio que cada uma alcançou. Some no restart, e
 * tudo bem: serve para depurar o que está acontecendo agora.
 *
 * Telefone entra mascarado — isto é acessível por uma rota, e o número inteiro
 * do cliente não precisa estar lá para dizer onde a mensagem parou.
 */

export type TraceStage =
  | "recebido"
  | "loja-nao-encontrada"
  | "loja-ok"
  | "audio-sem-bytes"
  | "audio-ok"
  | "robo-desativado"
  /** Telefone está na lista de números que o robô não atende. */
  | "numero-ignorado"
  /** Cliente reclamou do pedido: o robô saiu e chamou a equipe. */
  | "problema-no-pedido"
  | "guard-ignorou"
  | "guard-degradou"
  | "ia-chamada"
  | "ia-vazia"
  | "ia-timeout"
  | "pedido-gravado"
  | "pedido-nao-gravado"
  | "enviado"
  | "envio-falhou"
  | "erro";

export interface TraceEntry {
  em: string;
  instancia: string;
  telefone: string;
  tipo: "texto" | "audio" | "chamada" | "saida";
  estagio: TraceStage;
  detalhe?: string;
  /** Tamanho do base64 do áudio, quando houver. Zero denuncia download falho. */
  audioChars?: number;
  ms?: number;
}

// 60 cobria cerca de 80 minutos de movimento — e o incidente do "pedido
// fantasma" de 29/08 já tinha rolado para fora da janela quando fomos
// investigar, uma hora depois. 400 cobre um turno inteiro de jantar por poucas
// dezenas de KB de memória.
const LIMITE = 400;
const rastro: TraceEntry[] = [];

/** Mostra só os últimos dígitos: suficiente para identificar, sem expor. */
export function mascararTelefone(jid: string): string {
  const digitos = (jid || "").split("@")[0].replace(/\D/g, "");
  if (!digitos) return "?";
  return `…${digitos.slice(-4)}`;
}

export function registrarTrace(entry: Omit<TraceEntry, "em">) {
  rastro.push({ em: new Date().toISOString(), ...entry });
  if (rastro.length > LIMITE) rastro.splice(0, rastro.length - LIMITE);
}

export function lerTrace(): TraceEntry[] {
  return [...rastro].reverse(); // mais recente primeiro
}
