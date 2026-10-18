/**
 * A rajada no webhook do robô: o cliente que escreve picado ("uma napolitana" /
 * "e uma meia brócolis" / "grande") recebe UMA resposta, e cada conversa é
 * atendida uma de cada vez. A fila em si está em lib/fila-da-conversa.ts.
 *
 * ── Por que agora ───────────────────────────────────────────────────────────
 *
 * Medido em 17/10/2026 (10 a 17/10, 10.313 respostas): 25% das chamadas ao
 * Gemini vinham menos de 20 s depois de outra da MESMA conversa (14% a menos
 * de 8 s). Cada pedaço pagava uma resposta inteira (~R$ 0,046), as respostas
 * se cruzavam — na Lá Casa o robô mandou o mesmo resumo de R$ 165 três vezes
 * seguidas — e, com o servidor cheio, a mensagem mais velha ficava para trás e
 * virava o falso "Tive uma instabilidade". E o cooldown de 3 s DESCARTAVA, sem
 * rastro, o pedaço que chegasse logo depois de uma resposta.
 *
 * ── Como o webhook usa ──────────────────────────────────────────────────────
 *
 * Depois de todas as porteiras (pediu atendente, reclamação, anti-loop, dono) —
 * cada mensagem continua passando por elas sozinha — e antes da IA:
 *
 *   1. a mensagem ENTRA na rajada e espera a janela (é o mesmo "tempo de
 *      leitura" de 3–5 s que já existia antes de chamar a IA);
 *   2. chegou outra depois dela? Sai de cena ("juntada"): a mais nova leva o
 *      texto dela. Áudio, foto e localização nunca saem assim — os bytes e o
 *      ponto só existem na chamada que os recebeu (são "barreira");
 *   3. espera a VEZ da conversa (quem está sendo atendido termina antes; teto
 *      para ninguém esperar para sempre) e TIRA tudo o que se acumulou;
 *   4. nada para tirar (outra mensagem já levou tudo) = "vazia", sai.
 *
 * Quem carrega chama `liberar()` quando a resposta foi ENTREGUE (ou o vigia
 * desistiu) — é o que faz a próxima mensagem ver a resposta no histórico.
 */
import { criarRajadas, juntarTextos, type Rajadas } from "./fila-da-conversa";

export type ItemDaRajada = {
  /** O texto que vai à IA (em áudio/foto, já com a instrução do anexo). */
  texto: string;
  /** Áudio, foto ou localização: não pode ser levado por outra mensagem. */
  barreira: boolean;
  /** Quando o cliente tinha escrito ANTES desta mensagem (anti-loop), para a saudação do dia. */
  mensagemAnteriorEm?: number | null;
};

export type VezDaRajada =
  | { papel: "juntada" }
  | { papel: "vazia" }
  | {
      papel: "carrega";
      /** Os textos da rajada, juntos, na ordem em que chegaram. */
      texto: string;
      /** Quantas mensagens do cliente esta resposta atende. */
      quantas: number;
      /** `mensagemAnteriorEm` da PRIMEIRA mensagem da rajada. */
      mensagemAnteriorEm: number | null | undefined;
      liberar: () => void;
    };

/** A fila do processo (globalThis: o Next carrega cada rota num bundle próprio). */
export function rajadasDoRobo(): Rajadas<ItemDaRajada> {
  const g = globalThis as any;
  if (!g.__firehubRajadasDoRobo) g.__firehubRajadasDoRobo = criarRajadas<ItemDaRajada>();
  return g.__firehubRajadasDoRobo as Rajadas<ItemDaRajada>;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export async function esperarAVezDaRajada(o: {
  rajadas: Rajadas<ItemDaRajada>;
  chave: string;
  item: ItemDaRajada;
  /** A janela de "leitura": quanto esperar por mais um pedaço. */
  janelaMs: number;
  /** Quanto esperar, no máximo, por quem está sendo atendido na frente. */
  tetoDaVezMs: number;
}): Promise<VezDaRajada> {
  const senha = o.rajadas.entrar(o.chave, o.item);
  await dormir(o.janelaMs);
  if (!o.item.barreira && o.rajadas.chegouOutraDepois(o.chave, senha)) return { papel: "juntada" };

  const liberar = await o.rajadas.vez(o.chave, o.tetoDaVezMs);
  const itens = o.rajadas.tirar(o.chave, senha, (i) => i.barreira);
  if (itens.length === 0) {
    liberar();
    return { papel: "vazia" };
  }
  return {
    papel: "carrega",
    texto: itens.length === 1 ? itens[0].texto : juntarTextos(itens.map((i) => i.texto)),
    quantas: itens.length,
    mensagemAnteriorEm: itens[0].mensagemAnteriorEm,
    liberar,
  };
}
