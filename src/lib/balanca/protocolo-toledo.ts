/**
 * O PROTOCOLO DA BALANÇA TOLEDO (Prix 3 Fit, Prix 3, 9094 e as compatíveis) —
 * puro, sem porta: recebe os bytes que chegaram e devolve as leituras.
 *
 * Como a balança fala (manual Toledo da linha Prix III e logs do ACBrBAL,
 * conferidos em 05/11/2026 — confirmar com a balança na mão):
 *   - o computador manda ENQ (0x05);
 *   - a balança responde STX (0x02) + o peso em 5 dígitos + ETX (0x03):
 *     "00446" = 0,446 kg (três casas, em kg);
 *   - peso que ainda está mexendo vem "IIIII"; negativo (prato tirado depois
 *     da tara), "NNNNN"; acima da capacidade, "SSSSS";
 *   - 2400, 4800 ou 9600 bps, 8 bits, sem paridade, 1 bit de parada (8N1).
 *     De fábrica a Prix 3 vem para a impressora de etiqueta: o protocolo
 *     (C14) e a velocidade (C15) se ajustam no menu da balança.
 *
 * Inmetro (Portaria 157/2022, item 4.3.6.1): pela interface só se PEDE o
 * peso. Nada que ajuste, zere ou mude o que a balança mostra — a tara do prato
 * é feita na própria balança, e o visor dela é a indicação que vale.
 */

export const ENQ = 0x05;
const STX = 0x02;
const ETX = 0x03;

/** As velocidades da linha Prix, na ordem em que a detecção tenta. */
export const VELOCIDADES = [2400, 4800, 9600] as const;

export type LeituraDaBalanca =
  | { tipo: "peso"; kg: number }
  | { tipo: "instavel" }
  | { tipo: "negativo" }
  | { tipo: "sobrecarga" }
  | { tipo: "invalida"; texto: string };

/** Um quadro (o que veio entre STX e ETX) vira leitura. */
export function lerQuadro(texto: string): LeituraDaBalanca {
  const t = texto.trim();
  if (/^\d{5,6}$/.test(t)) return { tipo: "peso", kg: Number(t) / 1000 };
  if (/^I+$/.test(t)) return { tipo: "instavel" };
  if (/^N+$/.test(t)) return { tipo: "negativo" };
  if (/^S+$/.test(t)) return { tipo: "sobrecarga" };
  return { tipo: "invalida", texto: t.slice(0, 20) };
}

/**
 * Junta os bytes que chegam aos pedaços (a porta entrega como quiser) e tira
 * os quadros completos. O que sobrar sem ETX fica para a próxima leitura.
 * Começa no ÚLTIMO STX antes do ETX: lixo de uma resposta cortada não se mistura
 * com a seguinte, e ETX repetido (já visto em log do ACBr) não vira quadro vazio.
 */
export function extrairQuadros(buffer: number[]): { leituras: LeituraDaBalanca[]; resto: number[] } {
  const leituras: LeituraDaBalanca[] = [];
  let inicio = -1;
  let consumido = 0;
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b === STX) inicio = i;
    else if (b === ETX) {
      if (inicio >= 0) {
        leituras.push(lerQuadro(String.fromCharCode(...buffer.slice(inicio + 1, i))));
      }
      inicio = -1;
      consumido = i + 1;
    }
  }
  const resto = inicio >= 0 ? buffer.slice(inicio) : buffer.slice(consumido);
  // Sem STX à vista e lixo acumulando (velocidade errada): não guarda para sempre.
  return { leituras, resto: resto.length > 64 ? [] : resto };
}

/** O quadro que a balança mandaria para este peso — para a balança simulada e os testes. */
export function quadroDoPeso(kg: number | "instavel" | "negativo" | "sobrecarga"): number[] {
  const texto =
    kg === "instavel" ? "IIIII"
      : kg === "negativo" ? "NNNNN"
        : kg === "sobrecarga" ? "SSSSS"
          : String(Math.round(kg * 1000)).padStart(5, "0");
  return [STX, ...Array.from(texto, (c) => c.charCodeAt(0)), ETX];
}

// ─── Peso firme ─────────────────────────────────────────────────────────────

/** O mínimo que conta como prato (abaixo é a balança vazia ou um guardanapo). */
export const PESO_MINIMO_KG = 0.01;
/** Acima disto não é um prato: leitura errada ou alguém apoiado na balança. */
export const PESO_MAXIMO_KG = 30;
/** Leituras iguais seguidas para o peso valer (a balança pergunta a cada ~300 ms). */
export const LEITURAS_PARA_FIRMAR = 3;

/**
 * O peso só vale quando a balança repetiu o MESMO valor algumas vezes seguidas
 * — além do "IIIII" da própria balança. Prato ainda balançando, mão encostada
 * ou comida sendo servida em cima não lançam nada.
 */
export function pesoFirme(ultimas: LeituraDaBalanca[]): number | null {
  if (ultimas.length < LEITURAS_PARA_FIRMAR) return null;
  const fim = ultimas.slice(-LEITURAS_PARA_FIRMAR);
  const primeira = fim[0];
  if (primeira.tipo !== "peso") return null;
  if (!fim.every((l) => l.tipo === "peso" && l.kg === primeira.kg)) return null;
  if (primeira.kg < PESO_MINIMO_KG || primeira.kg > PESO_MAXIMO_KG) return null;
  return primeira.kg;
}

/** O valor do prato: peso × preço do quilo, em centavos inteiros (o que a nota e a conta usam). */
export function valorDoPeso(kg: number, precoDoQuilo: number): number {
  return Math.round(kg * precoDoQuilo * 100) / 100;
}

/** "0,452 kg" */
export function textoDoPeso(kg: number): string {
  return `${kg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

/**
 * O prato pesado é uma linha de quantidade 1 com o preço do peso: "2x" na
 * edição cobraria o mesmo prato duas vezes. Tirar o item continua valendo.
 */
export function recusaDoPratoPesado(nome: string | null | undefined, pesoKg: number): string {
  return `"${nome || "Prato"}" foi pesado (${textoDoPeso(pesoKg)}) e não muda de quantidade: tire o item e pese o prato de novo.`;
}
